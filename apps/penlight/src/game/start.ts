import { unlockAudio } from '../lib/audio';
import { requestMotionPermission } from '../lib/motion';
import { navigate, replace, setCurrent, setMotionPermission, showToast, useStore, type Song } from '../store';

function enterFullscreen(): void {
  // 只在触屏设备上全屏；iOS Safari 不支持对普通元素全屏，调用会被忽略。
  if (navigator.maxTouchPoints === 0 || document.fullscreenElement) return;
  const el = document.documentElement;
  el.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => undefined);
}

export function exitFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
}

/**
 * 在「开始」按钮的点击回调里调用。音频解锁、全屏和传感器授权都要求在用户手势里同步发起，
 * 所以先把它们全部发出去，再等结果。
 */
export async function startGame(song: Song, options: { replace?: boolean } = {}): Promise<void> {
  const { inputMode, motionPermission } = useStore.getState();
  const audio = unlockAudio();
  enterFullscreen();
  const permission =
    inputMode === 'motion' && motionPermission !== 'granted' ? requestMotionPermission() : null;

  try {
    await audio;
  } catch {
    showToast('音频没能启动，请再点一次开始');
    return;
  }

  if (permission) {
    const result = await permission;
    setMotionPermission(result);
    if (result !== 'granted') {
      exitFullscreen();
      navigate('sensor');
      return;
    }
  }

  setCurrent(song);
  if (options.replace) replace('play');
  else navigate('play');
}
