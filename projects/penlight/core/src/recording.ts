import type { Chart } from './chart';
import { SwingDetector, type MotionFrame, type MotionSourceKind, type SwingDirection, type Vec3 } from './detector';
import { Judge, type GameResult } from './judge';

/**
 * 一局游戏的原始数据：传感器样本（或点屏幕的时刻）加上谱面。
 * 用来离线回放，调检测和判定的参数。
 */
export interface Recording {
  format: 'penlight-recording';
  version: 1;
  createdAt: string;
  userAgent: string;
  inputMode: 'motion' | 'tap';
  sensitivity: number;
  /** 录制时用的检测来源。 */
  source: MotionSourceKind | null;
  /** 录制时玩家自己标的情况，比如「快慢变化」「走路」。 */
  tags: string[];
  song: { key: string; title: string };
  chart: Chart;
  /**
   * 每行：[t(ms), 歌曲时间(s), 加速度 xyz, 含重力加速度 xyz, 角速度 alpha beta gamma]，
   * 拿不到的量为 null。
   */
  frames: (number | null)[][];
  /** 点屏幕模式：[t(ms), 歌曲时间(s)] */
  taps: [number, number][];
  /** 录制时的成绩，方便对照。 */
  result: Pick<GameResult, 'score' | 'sync' | 'participation' | 'hits' | 'strays'> | null;
}

const round = (x: number | null, digits: number) => (x === null ? null : Number(x.toFixed(digits)));

export function frameRow(frame: MotionFrame, songTime: number): (number | null)[] {
  const v = (x: Vec3 | null) => (x ? [round(x[0], 3), round(x[1], 3), round(x[2], 3)] : [null, null, null]);
  return [round(frame.t, 2), round(songTime, 4), ...v(frame.acc), ...v(frame.accG), ...v(frame.rot)];
}

export function rowFrame(row: (number | null)[]): { frame: MotionFrame; songTime: number } {
  const v = (i: number): Vec3 | null =>
    row[i] === null || row[i + 1] === null || row[i + 2] === null ? null : [row[i]!, row[i + 1]!, row[i + 2]!];
  return { frame: { t: row[0]!, acc: v(2), accG: v(5), rot: v(8) }, songTime: row[1]! };
}

export interface ReplayedSwing {
  /** 歌曲时间（秒）。 */
  t: number;
  dir: SwingDirection;
  strength: number;
}

export interface Replay {
  source: MotionSourceKind | null;
  swings: ReplayedSwing[];
  result: GameResult;
}

/** 用当前的检测和判定重新跑一遍录制的数据。 */
export function replay(rec: Recording, options: { sensitivity?: number } = {}): Replay {
  const judge = new Judge(rec.chart);
  const swings: ReplayedSwing[] = [];

  if (rec.inputMode === 'tap') {
    for (const [, song] of rec.taps) {
      swings.push({ t: song, dir: 0, strength: 1 });
      judge.swing(song, 0);
    }
    return { source: null, swings, result: judge.result() };
  }

  const detector = new SwingDetector(options.sensitivity ?? rec.sensitivity);
  const rows = rec.frames.map(rowFrame);
  // 检测出的时刻落在两个样本之间，按线性插值换算成歌曲时间
  const toSong = (t: number) => {
    let i = rows.findIndex((r) => r.frame.t >= t);
    if (i <= 0) i = 1;
    const a = rows[i - 1]!;
    const b = rows[Math.min(i, rows.length - 1)]!;
    const span = b.frame.t - a.frame.t;
    return span > 0 ? a.songTime + ((t - a.frame.t) / span) * (b.songTime - a.songTime) : a.songTime;
  };
  for (const { frame } of rows) {
    const s = detector.push(frame);
    if (!s) continue;
    const t = toSong(s.t);
    swings.push({ t, dir: s.dir, strength: s.strength });
    judge.swing(t, s.dir);
  }
  return { source: detector.kind, swings, result: judge.result() };
}
