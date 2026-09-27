import type { DeviceInfo } from '@linjie/penlight-core';

interface UAData {
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?(hints: string[]): Promise<Record<string, unknown>>;
}

/**
 * 设备信息。Android 上的 Chromium 系浏览器把 UA 里的型号统一写成「K」，
 * 真实型号要通过 Client Hints 拿；iPhone 的 Safari 没有这个接口，只能记屏幕尺寸。
 */
export async function deviceInfo(): Promise<DeviceInfo> {
  const info: DeviceInfo = {
    screen: { width: screen.width, height: screen.height, dpr: devicePixelRatio || 1 },
  };
  const ua = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  if (!ua) return info;
  info.mobile = ua.mobile;
  info.platform = ua.platform;
  try {
    const hi = (await ua.getHighEntropyValues?.(['model', 'platformVersion'])) ?? {};
    if (typeof hi.model === 'string' && hi.model) info.model = hi.model;
    if (typeof hi.platformVersion === 'string') info.platformVersion = hi.platformVersion;
  } catch {
    // 浏览器拒绝也没关系
  }
  return info;
}
