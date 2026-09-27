import { GravityFilter } from '@linjie/penlight-core';

export interface MotionSample {
  /** 与 performance.now() 同一基准的时间（ms）。 */
  t: number;
  /** 去掉重力后的加速度模长（m/s²）。 */
  magnitude: number;
}

export type MotionPermission = 'granted' | 'denied' | 'unsupported';

type PermissionFn = () => Promise<'granted' | 'denied'>;

function permissionFn(): PermissionFn | null {
  if (typeof DeviceMotionEvent === 'undefined') return null;
  const fn = (DeviceMotionEvent as unknown as { requestPermission?: PermissionFn }).requestPermission;
  return typeof fn === 'function' ? fn.bind(DeviceMotionEvent) : null;
}

/** iOS 13+ 需要在点击事件里申请传感器权限。 */
export function motionPermissionRequired(): boolean {
  return permissionFn() !== null;
}

/** 必须在用户点击的回调里同步调用（中间不能有 await），否则 iOS 会直接拒绝。 */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return 'unsupported';
  const fn = permissionFn();
  if (!fn) return 'granted';
  try {
    return (await fn()) === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function isIOS(): boolean {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** 事件时间戳换算成 performance.now() 的基准。个别旧浏览器给的是 Unix 毫秒，直接用当前时间。 */
export function eventTime(timeStamp: number): number {
  const now = performance.now();
  if (!(timeStamp > 0) || timeStamp > now + 1000) return now;
  return timeStamp;
}

/**
 * 监听 devicemotion，输出加速度模长。
 * 优先用 `acceleration`（系统已去重力），拿不到时对 `accelerationIncludingGravity` 做高通。
 */
export class MotionSource {
  source: 'linear' | 'gravity' | null = null;
  private listener: ((s: MotionSample) => void) | null = null;
  private readonly gravity = new GravityFilter();
  private zeroRun = 0;
  private readonly timestamps: number[] = [];

  private readonly onMotion = (e: DeviceMotionEvent) => {
    const t = eventTime(e.timeStamp);
    let magnitude: number | null = null;

    const a = e.acceleration;
    if (this.source !== 'gravity' && a && a.x !== null && a.y !== null && a.z !== null) {
      magnitude = Math.hypot(a.x, a.y, a.z);
      // 少数机型 acceleration 一直是 0，改用含重力的数据。
      this.zeroRun = magnitude === 0 ? this.zeroRun + 1 : 0;
      if (this.zeroRun < 30) this.source = 'linear';
      else magnitude = null;
    }

    if (magnitude === null) {
      const g = e.accelerationIncludingGravity;
      if (g && g.x !== null && g.y !== null && g.z !== null) {
        if (this.source !== 'gravity') this.gravity.reset();
        this.source = 'gravity';
        magnitude = this.gravity.push(t, g.x, g.y, g.z);
      }
    }

    if (magnitude === null || !Number.isFinite(magnitude)) return;
    this.timestamps.push(t);
    if (this.timestamps.length > 60) this.timestamps.shift();
    this.listener?.({ t, magnitude });
  };

  start(listener: (s: MotionSample) => void): void {
    this.stop();
    this.listener = listener;
    window.addEventListener('devicemotion', this.onMotion);
  }

  stop(): void {
    window.removeEventListener('devicemotion', this.onMotion);
    this.listener = null;
  }

  /** 最近一秒左右的采样率（Hz）。 */
  get sampleRate(): number {
    const ts = this.timestamps;
    if (ts.length < 2) return 0;
    const span = ts[ts.length - 1]! - ts[0]!;
    return span > 0 ? ((ts.length - 1) * 1000) / span : 0;
  }

  get lastSampleAt(): number | null {
    return this.timestamps.at(-1) ?? null;
  }
}
