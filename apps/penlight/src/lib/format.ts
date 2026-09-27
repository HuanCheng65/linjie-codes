export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 带正负号的毫秒数，0 不带符号。 */
export function signedMs(ms: number): string {
  const r = Math.round(ms);
  if (r === 0) return '0';
  return r > 0 ? `+${r}` : `−${Math.abs(r)}`;
}

export function formatBpm(bpm: number): string {
  return bpm.toFixed(1);
}
