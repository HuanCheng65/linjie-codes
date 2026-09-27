import { PENLIGHT_COLORS, type PenlightColor } from '@linjie/penlight-core';

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** 应援棒颜色上用深色字还是浅色字，取对比度更高的一边。 */
export function inkFor(hex: string): 'dark' | 'light' {
  const l = luminance(hex);
  const onDark = (l + 0.05) / (0.012 + 0.05);
  const onLight = (1.0 + 0.05) / (l + 0.05);
  return onDark >= onLight ? 'dark' : 'light';
}

export function stickHex(color: PenlightColor): string {
  return PENLIGHT_COLORS[color];
}
