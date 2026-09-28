import {
  DEFAULT_SENSITIVITY,
  type BeatMap,
  type Chart,
  type GameResult,
  type Recording,
} from '@linjie/penlight-core';
import { create } from 'zustand';
import type { AnalyzedSong } from './lib/analyze';
import type { MotionPermission } from './lib/motion';
import { load, loadRaw, save, saveRaw } from './lib/storage';

export type Screen = 'home' | 'sensor' | 'songs' | 'editor' | 'play' | 'result';
export type InputMode = 'motion' | 'tap';
export type ThemePref = 'system' | 'light' | 'dark';

export interface Song {
  key: string;
  title: string;
  buffer: AudioBuffer;
  chart: Chart;
}

export interface UploadState {
  song: AnalyzedSong;
  /** 当前使用的节拍表（可能被用户改过）。 */
  map: BeatMap;
  /** 识别出来的节拍表，「还原」时用。 */
  detected: BeatMap;
  /** 某个小节第一拍的时间。 */
  downbeat: number;
  downbeatManual: boolean;
  selection: { start: number; end: number };
  /** 用户自己调过选段。没调过时，整首分析完会按完整结果重新推荐一次。 */
  selectionManual: boolean;
  /** partial：只分析了前 90 秒，整首还在后台分析；full：整首分析完；failed：后台分析失败。 */
  analysis: 'partial' | 'full' | 'failed';
  /** 整首分析完成时用户已经改过节拍，先放在这里，等用户决定要不要用。 */
  pendingFull: BeatMap | null;
  edited: boolean;
}

export interface ResultState {
  result: GameResult;
  songKey: string;
  songTitle: string;
  inputMode: InputMode;
  previousBest: number | null;
  recording: Recording;
}

interface State {
  stack: Screen[];
  direction: 1 | -1;

  nickname: string;
  sensitivity: number;
  inputMode: InputMode;
  theme: ThemePref;
  motionPermission: MotionPermission | null;

  upload: UploadState | null;
  current: Song | null;
  lastResult: ResultState | null;
  toast: { id: number; text: string } | null;
}

export const useStore = create<State>(() => ({
  stack: ['home'],
  direction: 1,
  nickname: load('nickname', ''),
  sensitivity: load('sensitivity', DEFAULT_SENSITIVITY),
  inputMode: load<InputMode>('inputMode', 'motion'),
  theme: (loadRaw('theme') as ThemePref | null) ?? 'system',
  motionPermission: null,
  upload: null,
  current: null,
  lastResult: null,
  toast: null,
}));

const set = useStore.setState;
const get = useStore.getState;

export const currentScreen = (s: State): Screen => s.stack[s.stack.length - 1]!;

/* ---------- 导航：和浏览器历史同步，安卓返回手势也能用 ---------- */

export function navigate(screen: Screen): void {
  const stack = [...get().stack, screen];
  history.pushState({ depth: stack.length - 1 }, '');
  set({ stack, direction: 1 });
}

export function replace(screen: Screen): void {
  const stack = [...get().stack.slice(0, -1), screen];
  set({ stack, direction: 1 });
}

export function back(): void {
  if (get().stack.length > 1) history.back();
}

/** 退回到栈里最近的 screen；栈里没有时把它放在首页之后。 */
export function backTo(screen: Screen): void {
  const { stack } = get();
  const i = stack.lastIndexOf(screen);
  if (i >= 0) {
    const steps = stack.length - 1 - i;
    if (steps > 0) history.go(-steps);
    return;
  }
  const depth = stack.length - 1;
  set({ stack: ['home', screen], direction: -1 });
  if (depth > 1) history.go(-(depth - 1));
  else if (depth === 0) history.pushState({ depth: 1 }, '');
}

export function installHistory(): () => void {
  history.replaceState({ depth: 0 }, '');
  const onPop = (e: PopStateEvent) => {
    const depth = typeof e.state?.depth === 'number' ? (e.state.depth as number) : 0;
    const { stack } = get();
    if (depth < stack.length - 1) set({ stack: stack.slice(0, depth + 1), direction: -1 });
  };
  window.addEventListener('popstate', onPop);
  return () => window.removeEventListener('popstate', onPop);
}

/* ---------- 偏好设置 ---------- */

export function setNickname(nickname: string): void {
  set({ nickname });
  save('nickname', nickname.trim());
}

export function setSensitivity(sensitivity: number): void {
  set({ sensitivity });
  save('sensitivity', sensitivity);
}

export function setInputMode(inputMode: InputMode): void {
  set({ inputMode });
  save('inputMode', inputMode);
}

export function setTheme(theme: ThemePref): void {
  set({ theme });
  saveRaw('theme', theme === 'system' ? null : theme);
  applyTheme(theme);
}

export function applyTheme(theme: ThemePref): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function setMotionPermission(motionPermission: MotionPermission): void {
  set({ motionPermission });
}

/* ---------- 歌曲与结果 ---------- */

export function setUpload(upload: UploadState | null): void {
  set({ upload });
}

export function updateUpload(patch: Partial<UploadState>): void {
  const upload = get().upload;
  if (upload) set({ upload: { ...upload, ...patch } });
}

export function setCurrent(current: Song): void {
  set({ current });
}

export function bestScore(songKey: string): number | null {
  return load<number | null>(`best:${songKey}`, null);
}

export function finishGame(result: GameResult, recording: Recording): void {
  const { current, inputMode } = get();
  if (!current) return;
  const previousBest = bestScore(current.key);
  if (previousBest === null || result.score > previousBest) save(`best:${current.key}`, result.score);
  set({
    lastResult: {
      result,
      songKey: current.key,
      songTitle: current.title,
      inputMode,
      previousBest,
      recording,
    },
  });
}

let toastId = 0;
export function showToast(text: string): void {
  set({ toast: { id: ++toastId, text } });
}

export function dismissToast(): void {
  set({ toast: null });
}
