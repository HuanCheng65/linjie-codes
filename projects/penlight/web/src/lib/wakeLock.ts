/** 游戏过程中保持屏幕常亮。页面切回前台时系统会自动释放，需要重新申请。 */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  private readonly onVisibility = () => {
    if (this.wanted && document.visibilityState === 'visible') void this.acquire();
  };

  async request(): Promise<void> {
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    await this.acquire();
  }

  async release(): Promise<void> {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    const s = this.sentinel;
    this.sentinel = null;
    try {
      await s?.release();
    } catch {
      // 已经被系统释放
    }
  }

  private async acquire(): Promise<void> {
    if (!('wakeLock' in navigator) || this.sentinel) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
    } catch {
      // 省电模式等情况下会被拒绝，不影响游戏
    }
  }
}
