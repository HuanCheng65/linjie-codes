/** 同步浏览器地址栏 / 状态栏的颜色。 */
export function setThemeColor(color: string): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}

export function syncThemeColorWithPage(): void {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) setThemeColor(bg);
}
