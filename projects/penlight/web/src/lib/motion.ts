import type { MotionFrame, Vec3 } from '@linjie/penlight-core';

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

function vec(v: DeviceMotionEventAcceleration | DeviceMotionEventRotationRate | null, keys: readonly string[]): Vec3 | null {
  if (!v) return null;
  const r = v as unknown as Record<string, number | null>;
  const x = r[keys[0]!];
  const y = r[keys[1]!];
  const z = r[keys[2]!];
  if (x === null || y === null || z === null || x === undefined || y === undefined || z === undefined) return null;
  return [x, y, z];
}

const XYZ = ['x', 'y', 'z'] as const;
const ABG = ['alpha', 'beta', 'gamma'] as const;

/**
 * 监听 devicemotion，原样输出加速度和角速度，交给 core 里的 SwingDetector 处理。
 */
export class MotionSource {
  private listener: ((f: MotionFrame) => void) | null = null;
  private readonly timestamps: number[] = [];

  private readonly onMotion = (e: DeviceMotionEvent) => {
    const frame: MotionFrame = {
      t: eventTime(e.timeStamp),
      acc: vec(e.acceleration, XYZ),
      accG: vec(e.accelerationIncludingGravity, XYZ),
      rot: vec(e.rotationRate, ABG),
    };
    if (!frame.acc && !frame.accG && !frame.rot) return;
    this.timestamps.push(frame.t);
    if (this.timestamps.length > 60) this.timestamps.shift();
    this.listener?.(frame);
  };

  start(listener: (f: MotionFrame) => void): void {
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
}
