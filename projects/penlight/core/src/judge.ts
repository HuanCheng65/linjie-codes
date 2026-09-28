import { CALIBRATION_BEATS, type Chart } from './chart';
import type { SwingDirection } from './detector';
import { beatPosition, beatTime, periodAt, type BeatMap } from './grid';

/**
 * 判定规则（设计说明见 projects/penlight/docs/judging.md）。
 *
 * 核心想法：只看每一下落在拍子里的什么位置，不管挥了多少下。
 * 把挥动按方向分成两路（去程、回程；点屏幕只有一路），对每一下，取同一路里前后 8 拍内的挥动，
 * 看它们在「一拍一圈」「半拍一圈」或「三分之一拍一圈」（shuffle 节奏）的钟面上是否聚在一起（相位锁定）。
 * 位置按「第几拍」计算，变速的歌也一样适用。
 *
 * - 锁定：这一路在这段时间里是跟着节奏的。这一下相对这一路平均位置的偏差在窗口 W 内算命中，
 *   得分 1 − (|偏差| / W)^1.5。平均位置本身就是这个人的习惯偏移，所以早一点晚一点都不吃亏。
 * - 没锁定的挥动：
 *   - 很快的连续抖动（ケチャ之类）不计分也不扣分；
 *   - 夹在两次命中之间、每一路的第一下，当作回程或花样动作，不计分也不扣分；
 *   - 其余算乱挥，按 0 分计入同步率。
 *
 * 总分 = 100 × 同步率 × 参与度。
 * - 同步率：命中得分之和 ÷（命中数 + 乱挥数）。
 * - 参与度：逐拍看这一拍前后两次命中相隔多久。两拍以内算满，四拍以内算一半，再长算没在打。
 *   挥得更密不额外加分。歌里几乎没声音的拍子（停顿、安静的间奏）不计入。
 */

export interface JudgeOptions {
  /** 开头不计分的热身拍数，默认 8。 */
  warmupBeats?: number;
  /** 判定窗口上限（秒），默认 0.1。 */
  maxWindow?: number;
  /** 一拍一圈时判定窗口占一拍的比例，默认 0.25。 */
  windowBeats?: number;
  /** 半拍一圈时判定窗口占一拍的比例，默认 0.19。 */
  halfWindowBeats?: number;
  /** 三分之一拍一圈时判定窗口占一拍的比例，默认 0.16。 */
  thirdWindowBeats?: number;
  /** 统计相位锁定时，向前后各看多少拍，默认 8。挥得稀时自动放宽到两倍。 */
  contextBeats?: number;
  /** 一拍一圈判为锁定所需的 Rayleigh 统计量 n·R²，默认 3.5。 */
  lockZ?: number;
  /** 半拍一圈判为锁定所需的 n·R²，默认 4.5（点更密，随机碰上的机会更大，要求更严）。 */
  lockZHalf?: number;
  /** 三分之一拍一圈判为锁定所需的 n·R²，默认 5.5。 */
  lockZThird?: number;
  /** 窗口里至少要有几下才判断锁定，默认 4。 */
  minEvents?: number;
  /** 实时稳定度取最近几下，默认 8。 */
  stabilitySize?: number;
}

export type SwingKind = 'hit' | 'stray' | 'neutral';

export type LiveVerdict =
  | { kind: 'ignored' }
  | { kind: 'warmup'; dir: SwingDirection; onBeat: boolean }
  | { kind: 'hit'; dir: SwingDirection; score: number }
  | { kind: 'miss'; dir: SwingDirection };

export type Density = 'half' | 'beat' | 'two' | 'sparse' | 'none';

export interface GameResult {
  /** 0–100。 */
  score: number;
  /** 同步率 0–1。 */
  sync: number;
  /** 参与度 0–1。 */
  participation: number;
  hits: number;
  strays: number;
  neutral: number;
  /** 计分段的拍数。 */
  beats: number;
  /** 命中挥动的平均绝对偏差（ms），相对这一路自己的平均位置。 */
  meanAbsDeviationMs: number | null;
  /** 主要那一路挥动相对拍点的平均偏移（ms），正数表示习惯偏晚。 */
  offsetMs: number | null;
  windowMs: number;
  beatMs: number;
  /** 每小节（4 拍）一段，识别到的挥动密度。 */
  timeline: Density[];
  /** 计分段的全部挥动，偏差单位为 ms。 */
  swings: { kind: SwingKind; delta: number }[];
}

interface Event {
  t: number;
  dir: SwingDirection;
}

type Harmonic = 1 | 2 | 3;

interface Lock {
  h: Harmonic;
  /** 这一路在钟面上的平均位置（弧度）。 */
  mu: number;
  z: number;
}

const TAU = Math.PI * 2;

function wrapAngle(a: number): number {
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

export function hitScore(delta: number, window: number): number {
  return 1 - Math.pow(Math.min(Math.abs(delta) / window, 1), 1.5);
}

export class Judge {
  readonly chart: Chart;
  /** 计分段的平均拍长（秒）。 */
  readonly period: number;
  /** 一拍一圈时计分段开头的判定窗口（秒），只用来展示。 */
  readonly window: number;
  readonly warmupBeats: number;
  /** 第一个计分的拍子。 */
  readonly playStart: number;

  private readonly o: Required<JudgeOptions>;
  private readonly warmupStart: number;
  private readonly scoreStart: number;
  private readonly scoreEnd: number;
  private readonly rests: Set<number>;
  private readonly events: (Event & { pos: number })[] = [];
  private readonly live: { dir: SwingDirection; value: number }[] = [];
  private readonly warmupSlots = new Set<number>();

  constructor(chart: Chart, options: JudgeOptions = {}) {
    this.o = {
      warmupBeats: CALIBRATION_BEATS,
      maxWindow: 0.1,
      windowBeats: 0.25,
      halfWindowBeats: 0.19,
      thirdWindowBeats: 0.16,
      contextBeats: 8,
      lockZ: 3.5,
      lockZHalf: 4.5,
      lockZThird: 5.5,
      minEvents: 4,
      stabilitySize: 8,
      ...options,
    };
    this.chart = chart;
    this.warmupBeats = this.o.warmupBeats;
    this.playStart = chart.startBeat + this.warmupBeats;
    this.warmupStart = beatTime(chart.grid, chart.startBeat - 0.5);
    this.scoreStart = beatTime(chart.grid, this.playStart - 0.5);
    this.scoreEnd = beatTime(chart.grid, chart.endBeat + 0.5);
    this.period = (beatTime(chart.grid, chart.endBeat) - beatTime(chart.grid, this.playStart)) / Math.max(1, chart.endBeat - this.playStart);
    this.window = this.windowAt(this.scoreStart, 1);
    this.rests = new Set(chart.restBeats ?? []);
  }

  get grid(): BeatMap {
    return this.chart.grid;
  }

  /** 热身段里挥在拍子附近的拍位（相对热身第一拍的序号），给界面画圆点用。 */
  get warmupBeatSlots(): ReadonlySet<number> {
    return this.warmupSlots;
  }

  /** 处理一次挥动，t 为歌曲时间（秒）。 */
  swing(t: number, dir: SwingDirection = 0): LiveVerdict {
    if (t < this.warmupStart || t > this.scoreEnd) return { kind: 'ignored' };
    const pos = beatPosition(this.grid, t);
    this.events.push({ t, dir, pos });

    if (t < this.scoreStart) {
      const beat = Math.round(pos);
      const onBeat = Math.abs(pos - beat) <= 0.3;
      if (onBeat) this.warmupSlots.add(beat - this.chart.startBeat);
      return { kind: 'warmup', dir, onBeat };
    }

    // 实时判定只能往前看
    const from = pos - 2 * this.o.contextBeats;
    const window = this.events.filter((e) => e.dir === dir && e.pos >= from).map((e) => e.pos);
    const lock = this.lockOf(window);
    const score = lock ? this.scoreAt(t, pos, lock) : null;
    this.live.push({ dir, value: score ?? 0 });
    if (this.live.length > 64) this.live.shift();
    return score !== null ? { kind: 'hit', dir, score } : { kind: 'miss', dir };
  }

  /** 最近 8 下的稳定度（0–1）。只看最近命中更多的那一路，另一路通常是回程。 */
  stability(): number | null {
    const recent = this.live.slice(-24);
    if (recent.length < 3) return null;
    const hitsOf = (d: SwingDirection) => recent.filter((r) => r.dir === d && r.value > 0).length;
    const dir: SwingDirection = hitsOf(0) >= hitsOf(1) ? 0 : 1;
    const values = recent.filter((r) => r.dir === dir).slice(-this.o.stabilitySize);
    if (values.length < 3) return null;
    return values.reduce((a, r) => a + r.value, 0) / values.length;
  }

  /** 热身结束后给出的个人偏移估计（秒）。热身段挥得太少或太散时返回 null。 */
  warmupOffset(): number | null {
    const warm = this.events.filter((e) => e.t < this.scoreStart);
    const main = this.dominant(warm);
    if (main.length < 3) return null;
    let s = 0;
    let c = 0;
    for (const e of main) {
      s += Math.sin(this.phase(e.pos, 1));
      c += Math.cos(this.phase(e.pos, 1));
    }
    if (Math.hypot(s, c) / main.length < 0.6) return null;
    return this.meanOffset(main);
  }

  result(): GameResult {
    const context = this.o.contextBeats;
    const scored = this.events.filter((e) => e.t >= this.scoreStart && e.t <= this.scoreEnd);

    // 1. 逐下判断是否锁定
    type Judged = Event & { pos: number; score: number | null; delta: number };
    const judged: Judged[] = scored.map((e) => {
      const same = this.events.filter((x) => x.dir === e.dir);
      let window = same.filter((x) => Math.abs(x.pos - e.pos) <= context).map((x) => x.pos);
      // 挥得稀（比如一小节一下）时窗口里点太少，放宽到两倍范围
      if (window.length < 6) window = same.filter((x) => Math.abs(x.pos - e.pos) <= 2 * context).map((x) => x.pos);
      const lock = this.lockOf(window);
      const score = lock ? this.scoreAt(e.t, e.pos, lock) : null;
      const beats = lock ? this.deviation(e.pos, lock) : wrapAngle(this.phase(e.pos, 1)) / TAU;
      return { ...e, score, delta: beats * periodAt(this.grid, e.t) };
    });

    // 2. 没锁定的：快速抖动、回程/花样、乱挥
    const kinds: SwingKind[] = new Array(judged.length);
    const sameDir = (i: number, step: 1 | -1) => {
      for (let j = i + step; j >= 0 && j < judged.length; j += step) if (judged[j]!.dir === judged[i]!.dir) return judged[j]!;
      return null;
    };
    const hitIdx = judged.map((j, i) => (j.score !== null ? i : -1)).filter((i) => i >= 0);
    let prevHit = -1;
    let nextHitPtr = 0;
    const used: [boolean, boolean] = [false, false];
    const tremolo = (a: Judged, b: Judged) => Math.abs(b.pos - a.pos) < 0.45 && Math.abs(b.t - a.t) < 0.22;
    judged.forEach((j, i) => {
      if (j.score !== null) {
        kinds[i] = 'hit';
        prevHit = i;
        used[0] = used[1] = false;
        return;
      }
      const prev = sameDir(i, -1);
      const next = sameDir(i, 1);
      if (prev && next && tremolo(prev, j) && tremolo(j, next)) {
        kinds[i] = 'neutral';
        return;
      }
      while (nextHitPtr < hitIdx.length && hitIdx[nextHitPtr]! <= i) nextHitPtr++;
      const sandwiched = prevHit >= 0 && nextHitPtr < hitIdx.length;
      if (sandwiched && !used[j.dir]) {
        used[j.dir] = true;
        kinds[i] = 'neutral';
        return;
      }
      kinds[i] = 'stray';
    });

    const hits = judged.filter((_, i) => kinds[i] === 'hit');
    const strays = kinds.filter((k) => k === 'stray').length;
    const neutral = kinds.filter((k) => k === 'neutral').length;
    const scoreSum = hits.reduce((a, h) => a + h.score!, 0);
    const sync = hits.length + strays > 0 ? scoreSum / (hits.length + strays) : 0;

    // 3. 参与度：看每一拍前后两次命中相隔几拍；没声音的拍子不算
    const hitPos = hits.map((h) => h.pos);
    const beats: number[] = [];
    for (let b = this.playStart; b <= this.chart.endBeat; b++) if (!this.rests.has(b)) beats.push(b);
    let k = 0;
    const covered = beats.map((b) => {
      while (k < hitPos.length && hitPos[k]! <= b) k++;
      const before = k > 0 ? hitPos[k - 1]! : null;
      const after = k < hitPos.length ? hitPos[k]! : null;
      if (before === null && after === null) return 0;
      if (before === null || after === null) {
        const d = Math.abs((before ?? after)! - b);
        return d <= 1.2 ? 1 : d <= 2.2 ? 0.5 : 0;
      }
      // 中间夹着停顿时，停顿的拍子不算进间隔
      let gap = after - before;
      for (let r = Math.ceil(before); r < after; r++) if (this.rests.has(r)) gap -= 1;
      return gap <= 2.4 ? 1 : gap <= 4.4 ? 0.5 : 0;
    });
    const participation = beats.length ? covered.reduce<number>((a, b) => a + b, 0) / beats.length : 0;

    // 4. 统计与展示
    const main = this.dominant(hits);
    const timeline: Density[] = [];
    for (let b = this.playStart; b <= this.chart.endBeat; b += 4) {
      const inBar = hits.filter((h) => h.pos >= b - 0.5 && h.pos < b + 3.5);
      const beatsInBar = Math.min(4, this.chart.endBeat - b + 1);
      const rate = this.dominant(inBar).length / beatsInBar;
      timeline.push(rate >= 1.5 ? 'half' : rate >= 0.7 ? 'beat' : rate >= 0.35 ? 'two' : rate > 0 ? 'sparse' : 'none');
    }

    return {
      score: 100 * sync * participation,
      sync,
      participation,
      hits: hits.length,
      strays,
      neutral,
      beats: beats.length,
      meanAbsDeviationMs: hits.length ? (hits.reduce((a, h) => a + Math.abs(h.delta), 0) / hits.length) * 1000 : null,
      offsetMs: main.length ? this.meanOffset(main) * 1000 : null,
      windowMs: this.window * 1000,
      beatMs: this.period * 1000,
      timeline,
      swings: judged.map((j, i) => ({ kind: kinds[i]!, delta: j.delta * 1000 })),
    };
  }

  /** 一组同一路挥动（拍位）是否锁定在节拍上；锁定时返回用的是哪种钟面和平均位置。 */
  private lockOf(positions: number[]): Lock | null {
    const n = positions.length;
    if (n < this.o.minEvents) return null;
    let best: Lock | null = null;
    const need: Record<Harmonic, number> = { 1: this.o.lockZ, 2: this.o.lockZHalf, 3: this.o.lockZThird };
    for (const h of [1, 2, 3] as const) {
      let s = 0;
      let c = 0;
      for (const p of positions) {
        const a = this.phase(p, h);
        s += Math.sin(a);
        c += Math.cos(a);
      }
      const R = Math.hypot(s, c) / n;
      const z = n * R * R;
      if (z >= need[h] && (!best || z > best.z)) best = { h, mu: Math.atan2(s, c), z };
    }
    return best;
  }

  private phase(pos: number, h: Harmonic): number {
    return TAU * h * pos;
  }

  private windowAt(t: number, h: Harmonic): number {
    const ratio = h === 1 ? this.o.windowBeats : h === 2 ? this.o.halfWindowBeats : this.o.thirdWindowBeats;
    return Math.min(this.o.maxWindow, ratio * periodAt(this.grid, t));
  }

  /** 相对这一路平均位置的偏差（拍）。 */
  private deviation(pos: number, lock: Lock): number {
    return wrapAngle(this.phase(pos, lock.h) - lock.mu) / (TAU * lock.h);
  }

  private scoreAt(t: number, pos: number, lock: Lock): number | null {
    const w = this.windowAt(t, lock.h);
    const d = this.deviation(pos, lock) * periodAt(this.grid, t);
    return Math.abs(d) <= w ? hitScore(d, w) : null;
  }

  /** 一拍一圈钟面上的平均位置，换算成相对拍点的偏移（秒）。 */
  private meanOffset(list: { t: number; pos: number }[]): number {
    let s = 0;
    let c = 0;
    let p = 0;
    for (const e of list) {
      const a = this.phase(e.pos, 1);
      s += Math.sin(a);
      c += Math.cos(a);
      p += periodAt(this.grid, e.t);
    }
    return (Math.atan2(s, c) / TAU) * (p / list.length);
  }

  /** 两路里挥动更多的那一路。 */
  private dominant<T extends Event>(list: T[]): T[] {
    const a = list.filter((e) => e.dir === 0);
    const b = list.filter((e) => e.dir === 1);
    return a.length >= b.length ? a : b;
  }
}
