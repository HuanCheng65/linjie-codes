/**
 * 挥动检测：把加速度模长序列变成一个个「挥动」时刻。
 *
 * 模长超过阈值进入峰值状态，记录其中最大值的时刻；回落到阈值一半以下，
 * 或峰值状态持续超过 220 ms 时结束，这一下的时间取最大值时刻。
 * 两次挥动至少间隔 160 ms。
 */

/** 灵敏度 1–5 档对应的阈值（m/s²），档位越高越灵敏。 */
export const SENSITIVITY_THRESHOLDS = [22, 17, 13, 10, 7] as const;
export const DEFAULT_SENSITIVITY = 3;

export function thresholdForSensitivity(level: number): number {
  const i = Math.min(Math.max(Math.round(level), 1), SENSITIVITY_THRESHOLDS.length) - 1;
  return SENSITIVITY_THRESHOLDS[i]!;
}

export interface SwingDetectorOptions {
  /** 进入峰值状态的阈值（m/s²）。 */
  threshold: number;
  /** 回落到阈值的多少倍以下时结束峰值，默认 0.5。 */
  releaseRatio?: number;
  /** 峰值状态最长持续时间（ms），默认 220。 */
  maxPeakMs?: number;
  /** 两次挥动的最小间隔（ms），默认 160。 */
  minIntervalMs?: number;
}

export interface Swing {
  /** 峰值时刻，与输入样本同一时间基准（ms）。 */
  t: number;
  /** 峰值模长（m/s²）。 */
  peak: number;
}

export class SwingDetector {
  threshold: number;
  private readonly releaseRatio: number;
  private readonly maxPeakMs: number;
  private readonly minIntervalMs: number;

  private inPeak = false;
  /** 峰值因超时结束后，要等信号回落才能再次触发，避免持续大幅晃动时连发。 */
  private armed = true;
  private peakStart = 0;
  private peakT = 0;
  private peakV = 0;
  private lastSwingT = Number.NEGATIVE_INFINITY;

  constructor(options: SwingDetectorOptions) {
    this.threshold = options.threshold;
    this.releaseRatio = options.releaseRatio ?? 0.5;
    this.maxPeakMs = options.maxPeakMs ?? 220;
    this.minIntervalMs = options.minIntervalMs ?? 160;
  }

  /** 送入一个样本。如果这个样本让一次挥动结束，返回这次挥动。 */
  push(t: number, magnitude: number): Swing | null {
    const release = this.threshold * this.releaseRatio;

    if (!this.inPeak) {
      if (!this.armed) {
        if (magnitude < release) this.armed = true;
        return null;
      }
      if (magnitude > this.threshold) {
        this.inPeak = true;
        this.peakStart = t;
        this.peakT = t;
        this.peakV = magnitude;
      }
      return null;
    }

    if (magnitude > this.peakV) {
      this.peakV = magnitude;
      this.peakT = t;
    }

    const released = magnitude < release;
    const timedOut = t - this.peakStart > this.maxPeakMs;
    if (!released && !timedOut) return null;

    this.inPeak = false;
    if (!released) this.armed = false;

    if (this.peakT - this.lastSwingT < this.minIntervalMs) return null;
    this.lastSwingT = this.peakT;
    return { t: this.peakT, peak: this.peakV };
  }

  reset(): void {
    this.inPeak = false;
    this.armed = true;
    this.lastSwingT = Number.NEGATIVE_INFINITY;
  }
}

/**
 * 拿不到去重力的 `acceleration` 时，用这个对 `accelerationIncludingGravity`
 * 做一阶高通：低通估计重力分量，再从原始值里减掉。
 */
export class GravityFilter {
  private gx = 0;
  private gy = 0;
  private gz = 0;
  private lastT: number | null = null;

  /** @param timeConstant 低通的时间常数（秒），越大越慢地跟随手机姿态变化。 */
  constructor(private readonly timeConstant = 0.25) {}

  /** 输入含重力的加速度（m/s²）和时间（ms），返回去掉重力后的模长。 */
  push(t: number, x: number, y: number, z: number): number {
    if (this.lastT === null) {
      this.gx = x;
      this.gy = y;
      this.gz = z;
      this.lastT = t;
      return 0;
    }
    const dt = Math.min(Math.max((t - this.lastT) / 1000, 0.001), 0.1);
    this.lastT = t;
    const a = this.timeConstant / (this.timeConstant + dt);
    this.gx = a * this.gx + (1 - a) * x;
    this.gy = a * this.gy + (1 - a) * y;
    this.gz = a * this.gz + (1 - a) * z;
    return Math.hypot(x - this.gx, y - this.gy, z - this.gz);
  }

  reset(): void {
    this.lastT = null;
  }
}
