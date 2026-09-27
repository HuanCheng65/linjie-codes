/**
 * 挥动检测：把传感器样本变成一个个「挥动」时刻。
 *
 * 挥应援棒主要是手腕带着手机来回转。每一下「到位」的时刻，是棒子停住、开始往回走的转向点。
 *
 * - 有陀螺仪时（首选）：把角速度投影到主要转动轴上，得到一条正负交替的曲线，
 *   每段同号的「波瓣」是一次朝某个方向的挥动，波瓣结束（角速度过零）就是转向点。
 * - 只有加速度时：把加速度投影到主要运动轴上，转向点附近加速度最大，取每个波瓣的峰值时刻。
 *
 * 两种方式都能分出方向（去程 / 回程），判定时分开统计。
 * 波瓣的峰值要超过门槛才算一下；门槛取「灵敏度对应的下限」和「最近几下平均力度的 35%」中较大的，
 * 所以动作大小变了也能跟上，挥得很猛时手的小抖动也不会被算进去。
 */

export type Vec3 = readonly [number, number, number];

export interface MotionFrame {
  /** 与 performance.now() 同一基准的时间（ms）。 */
  t: number;
  /** 去掉重力的加速度（m/s²）。 */
  acc: Vec3 | null;
  /** 含重力的加速度（m/s²）。 */
  accG: Vec3 | null;
  /** 角速度（°/s）。 */
  rot: Vec3 | null;
}

export type SwingDirection = 0 | 1;

export interface Swing {
  /** 转向点时刻（ms），与输入同一基准。 */
  t: number;
  /** 这次挥动的方向。同一个人来回挥时，去程和回程的方向不同。 */
  dir: SwingDirection;
  /** 这一下的力度（陀螺仪为 °/s，加速度为 m/s²）。 */
  strength: number;
}

export type MotionSourceKind = 'gyro' | 'accel';

/** 灵敏度 1–5 档，档位越高越灵敏。 */
export const SENSITIVITY_LEVELS = 5;
export const DEFAULT_SENSITIVITY = 3;
/** 陀螺仪门槛（°/s）。正常挥一下峰值通常有几百到上千，走路时手腕转动一般在 100 以内。 */
export const GYRO_GATES = [360, 270, 200, 140, 100] as const;
/** 加速度门槛（m/s²）。 */
export const ACCEL_GATES = [22, 17, 13, 10, 7] as const;

export function gateFor(kind: MotionSourceKind, level: number): number {
  const table = kind === 'gyro' ? GYRO_GATES : ACCEL_GATES;
  const i = Math.min(Math.max(Math.round(level), 1), table.length) - 1;
  return table[i]!;
}

/**
 * 跟踪最近一段时间里运动最集中的方向（协方差矩阵的主特征向量）。
 * 用幂迭代逐样本更新，方向的正负号保持连续，不会来回翻转。
 */
const SEED = 1 / Math.sqrt(3);

export class AxisTracker {
  private c = [1e-6, 0, 0, 1e-6, 0, 1e-6]; // xx xy xz yy yz zz
  private u: [number, number, number] = [SEED, SEED, SEED];
  private lastT: number | null = null;

  /** @param timeConstant 协方差的遗忘时间（秒）。 */
  constructor(private readonly timeConstant = 1.5) {}

  /** 送入一个向量，返回它在主轴上的投影。 */
  push(t: number, v: Vec3): number {
    const dt = this.lastT === null ? 0.016 : Math.min(Math.max((t - this.lastT) / 1000, 0.001), 0.2);
    this.lastT = t;
    const a = Math.min(1, dt / this.timeConstant);
    const [x, y, z] = v;
    const c = this.c;
    const k = 1 - a;
    c[0] = k * c[0]! + a * x * x;
    c[1] = k * c[1]! + a * x * y;
    c[2] = k * c[2]! + a * x * z;
    c[3] = k * c[3]! + a * y * y;
    c[4] = k * c[4]! + a * y * z;
    c[5] = k * c[5]! + a * z * z;

    const [ux, uy, uz] = this.u;
    const nx = c[0]! * ux + c[1]! * uy + c[2]! * uz;
    const ny = c[1]! * ux + c[3]! * uy + c[4]! * uz;
    const nz = c[2]! * ux + c[4]! * uy + c[5]! * uz;
    const n = Math.hypot(nx, ny, nz);
    const trace = c[0]! + c[3]! + c[5]!;
    if (n > 1e-3 * trace) this.u = [nx / n, ny / n, nz / n];
    else {
      // 当前估计几乎和主轴垂直，用这一个样本的方向重新开始
      const m = Math.hypot(x, y, z);
      if (m > 1e-9) this.u = [x / m, y / m, z / m];
    }
    return x * this.u[0] + y * this.u[1] + z * this.u[2];
  }

  get axis(): Vec3 {
    return this.u;
  }

  reset(): void {
    this.c = [1e-6, 0, 0, 1e-6, 0, 1e-6];
    this.u = [SEED, SEED, SEED];
    this.lastT = null;
  }
}

export interface LobeDetectorOptions {
  /** 波瓣峰值的最低门槛。 */
  gate: number;
  /** 'end'：在波瓣结束（过零）时刻记一下；'peak'：在波瓣峰值时刻记一下。 */
  eventAt: 'end' | 'peak';
  /** 门槛随最近几下力度自适应的比例，默认 0.35。 */
  relativeGate?: number;
  /** 两下之间的最小间隔（ms），默认 70。 */
  minIntervalMs?: number;
}

/**
 * 把一条正负交替的曲线切成波瓣。过零判断带回差，避免在零附近抖动时被切碎。
 */
export class LobeDetector {
  gate: number;
  private readonly eventAt: 'end' | 'peak';
  private readonly relativeGate: number;
  private readonly minInterval: number;

  private sign: 1 | -1 | 0 = 0;
  private peakV = 0;
  private peakT = 0;
  private lastT = 0;
  private lastV = 0;
  /** 最近一次从正负号一侧穿过零点的时刻（线性插值）。 */
  private crossT = 0;
  private lastSwingT = Number.NEGATIVE_INFINITY;
  private readonly recent: { t: number; v: number }[] = [];

  constructor(options: LobeDetectorOptions) {
    this.gate = options.gate;
    this.eventAt = options.eventAt;
    this.relativeGate = options.relativeGate ?? 0.35;
    this.minInterval = options.minIntervalMs ?? 70;
  }

  /** 当前生效的门槛（含自适应部分）。 */
  get effectiveGate(): number {
    if (this.recent.length < 3) return this.gate;
    const sorted = this.recent.map((r) => r.v).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1]!;
    return Math.max(this.gate, this.relativeGate * median);
  }

  push(t: number, v: number): Swing | null {
    const hysteresis = 0.15 * this.gate;
    let out: Swing | null = null;

    // 记录过零时刻，供 eventAt = 'end' 使用
    if ((this.lastV > 0 && v <= 0) || (this.lastV < 0 && v >= 0)) {
      const span = this.lastV - v;
      const f = span !== 0 ? this.lastV / span : 0;
      this.crossT = this.lastT + f * (t - this.lastT);
    }

    const s: 1 | -1 | 0 = v > hysteresis ? 1 : v < -hysteresis ? -1 : 0;
    if (s !== 0 && s !== this.sign) {
      // 上一个波瓣结束
      if (this.sign !== 0) out = this.finishLobe();
      this.sign = s;
      this.peakV = 0;
    }
    if (this.sign !== 0 && Math.abs(v) > this.peakV && Math.sign(v) === this.sign) {
      this.peakV = Math.abs(v);
      this.peakT = t;
    }

    this.lastT = t;
    this.lastV = v;
    while (this.recent.length > 0 && t - this.recent[0]!.t > 2500) this.recent.shift();
    return out;
  }

  private finishLobe(): Swing | null {
    const strength = this.peakV;
    const gate = this.effectiveGate;
    if (strength >= this.gate) {
      this.recent.push({ t: this.peakT, v: strength });
      if (this.recent.length > 8) this.recent.shift();
    }
    if (strength < gate) return null;
    const t = this.eventAt === 'end' ? this.crossT : this.peakT;
    if (t - this.lastSwingT < this.minInterval) return null;
    this.lastSwingT = t;
    return { t, dir: this.sign > 0 ? 0 : 1, strength };
  }

  reset(): void {
    this.sign = 0;
    this.peakV = 0;
    this.lastV = 0;
    this.lastSwingT = Number.NEGATIVE_INFINITY;
    this.recent.length = 0;
  }
}

/**
 * 拿不到去重力的 `acceleration` 时，用这个对 `accelerationIncludingGravity`
 * 做一阶高通：低通估计重力分量，再从原始值里减掉。
 */
export class GravityFilter {
  private g: [number, number, number] = [0, 0, 0];
  private lastT: number | null = null;

  /** @param timeConstant 低通的时间常数（秒），越大越慢地跟随手机姿态变化。 */
  constructor(private readonly timeConstant = 0.25) {}

  push(t: number, v: Vec3): Vec3 {
    if (this.lastT === null) {
      this.g = [v[0], v[1], v[2]];
      this.lastT = t;
      return [0, 0, 0];
    }
    const dt = Math.min(Math.max((t - this.lastT) / 1000, 0.001), 0.1);
    this.lastT = t;
    const a = this.timeConstant / (this.timeConstant + dt);
    const g = this.g;
    for (let i = 0; i < 3; i++) g[i] = a * g[i]! + (1 - a) * v[i]!;
    return [v[0] - g[0], v[1] - g[1], v[2] - g[2]];
  }

  reset(): void {
    this.lastT = null;
  }
}

export interface DetectorSignal {
  t: number;
  /** 投影到主轴上的有符号信号。 */
  value: number;
}

/**
 * 完整的挥动检测：自动选择陀螺仪或加速度，投影到主轴，切波瓣，输出带方向的挥动。
 */
export class SwingDetector {
  kind: MotionSourceKind | null = null;
  /** 最近一个样本处理后的信号，给自检页画曲线用。 */
  signal: DetectorSignal | null = null;

  private level: number;
  private readonly axis = new AxisTracker();
  private readonly gravity = new GravityFilter();
  private lobes: LobeDetector | null = null;
  private zeroAcc = 0;
  private gyroSeen = false;

  constructor(sensitivity: number = DEFAULT_SENSITIVITY) {
    this.level = sensitivity;
  }

  setSensitivity(level: number): void {
    this.level = level;
    if (this.lobes && this.kind) this.lobes.gate = gateFor(this.kind, level);
  }

  /** 当前生效的门槛，单位随 kind 变化。 */
  get gate(): number {
    return this.lobes?.effectiveGate ?? (this.kind ? gateFor(this.kind, this.level) : 0);
  }

  push(frame: MotionFrame): Swing | null {
    const kind = this.pickSource(frame);
    if (!kind) return null;
    if (kind !== this.kind) this.switchTo(kind);

    let v: Vec3 | null;
    if (kind === 'gyro') v = frame.rot;
    else v = frame.acc && this.zeroAcc < 30 ? frame.acc : frame.accG ? this.gravity.push(frame.t, frame.accG) : null;
    if (!v || !v.every(Number.isFinite)) return null;

    const value = this.axis.push(frame.t, v);
    this.signal = { t: frame.t, value };
    return this.lobes!.push(frame.t, value);
  }

  reset(): void {
    this.kind = null;
    this.lobes = null;
    this.signal = null;
    this.axis.reset();
    this.gravity.reset();
    this.zeroAcc = 0;
    this.gyroSeen = false;
  }

  private pickSource(frame: MotionFrame): MotionSourceKind | null {
    const rot = frame.rot;
    // 有的机型没有陀螺仪，rotationRate 一直是 null 或全 0。
    if (rot && rot.some((x) => x !== 0)) this.gyroSeen = true;
    if (this.gyroSeen && rot) return 'gyro';

    const acc = frame.acc;
    if (acc) this.zeroAcc = acc.every((x) => x === 0) ? this.zeroAcc + 1 : 0;
    if ((acc && this.zeroAcc < 30) || frame.accG) return 'accel';
    return null;
  }

  private switchTo(kind: MotionSourceKind): void {
    this.kind = kind;
    this.axis.reset();
    this.lobes = new LobeDetector({ gate: gateFor(kind, this.level), eventAt: kind === 'gyro' ? 'end' : 'peak' });
  }
}
