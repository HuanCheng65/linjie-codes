import { CALIBRATION_BEATS, type Chart } from './chart';
import type { SwingDirection } from './detector';
import { beatPeriod, beatTime, type BeatGrid } from './grid';

/**
 * 判定规则（设计说明见 projects/penlight/docs/judging.md）。
 *
 * 核心想法：只看每一下落在拍子里的什么位置，不管挥了多少下。
 * 把挥动按方向分成两路（去程、回程；点屏幕只有一路），对每一下，取同一路里前后 8 拍内的挥动，
 * 看它们在「一拍一圈」或「半拍一圈」的钟面上是否聚在一起（相位锁定）。
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
 *   挥得更密不额外加分。
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
  /** 统计相位锁定时，向前后各看多少拍，默认 8。挥得稀时自动放宽到两倍。 */
  contextBeats?: number;
  /** 一拍一圈判为锁定所需的 Rayleigh 统计量 n·R²，默认 3.5。 */
  lockZ?: number;
  /** 半拍一圈判为锁定所需的 n·R²，默认 4.5（点更密，随机碰上的机会更大，要求更严）。 */
  lockZHalf?: number;
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

interface Lock {
  h: 1 | 2;
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
  readonly period: number;
  /** 一拍一圈时的判定窗口（秒）。 */
  readonly window: number;
  readonly halfWindow: number;
  readonly warmupBeats: number;
  /** 第一个计分的拍子。 */
  readonly playStart: number;

  private readonly o: Required<JudgeOptions>;
  private readonly warmupStart: number;
  private readonly scoreStart: number;
  private readonly scoreEnd: number;
  private readonly events: Event[] = [];
  private readonly live: { dir: SwingDirection; value: number }[] = [];
  private readonly warmupSlots = new Set<number>();

  constructor(chart: Chart, options: JudgeOptions = {}) {
    this.o = {
      warmupBeats: CALIBRATION_BEATS,
      maxWindow: 0.1,
      windowBeats: 0.25,
      halfWindowBeats: 0.19,
      contextBeats: 8,
      lockZ: 3.5,
      lockZHalf: 4.5,
      minEvents: 4,
      stabilitySize: 8,
      ...options,
    };
    this.chart = chart;
    this.period = beatPeriod(chart.grid);
    this.window = Math.min(this.o.maxWindow, this.o.windowBeats * this.period);
    this.halfWindow = Math.min(this.o.maxWindow, this.o.halfWindowBeats * this.period);
    this.warmupBeats = this.o.warmupBeats;
    this.playStart = chart.startBeat + this.warmupBeats;
    const half = this.period / 2;
    this.warmupStart = beatTime(chart.grid, chart.startBeat) - half;
    this.scoreStart = beatTime(chart.grid, this.playStart) - half;
    this.scoreEnd = beatTime(chart.grid, chart.endBeat) + half;
  }

  get grid(): BeatGrid {
    return this.chart.grid;
  }

  /** 热身段里挥在拍子附近的拍位（相对热身第一拍的序号），给界面画圆点用。 */
  get warmupBeatSlots(): ReadonlySet<number> {
    return this.warmupSlots;
  }

  /** 处理一次挥动，t 为歌曲时间（秒）。 */
  swing(t: number, dir: SwingDirection = 0): LiveVerdict {
    if (t < this.warmupStart || t > this.scoreEnd) return { kind: 'ignored' };
    this.events.push({ t, dir });

    if (t < this.scoreStart) {
      const pos = (t - this.grid.firstBeat) / this.period;
      const beat = Math.round(pos);
      const onBeat = Math.abs(pos - beat) <= 0.3;
      if (onBeat) this.warmupSlots.add(beat - this.chart.startBeat);
      return { kind: 'warmup', dir, onBeat };
    }

    // 实时判定只能往前看
    const from = t - 2 * this.o.contextBeats * this.period;
    const window = this.events.filter((e) => e.dir === dir && e.t >= from).map((e) => e.t);
    const lock = this.lockOf(window);
    const score = lock ? this.scoreAt(t, lock) : null;
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

  /** 热身结束后给出的个人偏移估计。热身段挥得太少或太散时返回 null。 */
  warmupOffset(): number | null {
    const warm = this.events.filter((e) => e.t < this.scoreStart);
    const main = this.dominant(warm).map((e) => e.t);
    if (main.length < 3) return null;
    let s = 0;
    let c = 0;
    for (const t of main) {
      s += Math.sin(this.phase(t, 1));
      c += Math.cos(this.phase(t, 1));
    }
    if (Math.hypot(s, c) / main.length < 0.6) return null;
    return this.meanOffset(main);
  }

  result(): GameResult {
    const p = this.period;
    const context = this.o.contextBeats * p;
    const scored = this.events.filter((e) => e.t >= this.scoreStart && e.t <= this.scoreEnd);

    // 1. 逐下判断是否锁定
    type Judged = Event & { lock: Lock | null; score: number | null; delta: number };
    const judged: Judged[] = scored.map((e) => {
      const same = this.events.filter((x) => x.dir === e.dir);
      let window = same.filter((x) => Math.abs(x.t - e.t) <= context).map((x) => x.t);
      // 挥得稀（比如一小节一下）时窗口里点太少，放宽到两倍范围
      if (window.length < 6) window = same.filter((x) => Math.abs(x.t - e.t) <= 2 * context).map((x) => x.t);
      const lock = this.lockOf(window);
      const score = lock ? this.scoreAt(e.t, lock) : null;
      const delta = lock ? this.deviation(e.t, lock) : this.nearestBeatDelta(e.t);
      return { ...e, lock, score, delta };
    });

    // 2. 没锁定的：快速抖动、回程/花样、乱挥
    const kinds: SwingKind[] = new Array(judged.length);
    const sameDir = (i: number, step: 1 | -1) => {
      for (let j = i + step; j >= 0 && j < judged.length; j += step) if (judged[j]!.dir === judged[i]!.dir) return judged[j]!;
      return null;
    };
    const tremoloGap = Math.min(0.45 * p, 0.22);
    const hitIdx = judged.map((j, i) => (j.score !== null ? i : -1)).filter((i) => i >= 0);
    let prevHit = -1;
    let nextHitPtr = 0;
    const used: [boolean, boolean] = [false, false];
    judged.forEach((j, i) => {
      if (j.score !== null) {
        kinds[i] = 'hit';
        prevHit = i;
        used[0] = used[1] = false;
        return;
      }
      const prev = sameDir(i, -1);
      const next = sameDir(i, 1);
      if (prev && next && j.t - prev.t < tremoloGap && next.t - j.t < tremoloGap) {
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

    // 3. 参与度：看每一拍前后两次命中相隔多久
    const hitTimes = hits.map((h) => h.t);
    const beats: number[] = [];
    for (let b = this.playStart; b <= this.chart.endBeat; b++) beats.push(b);
    let k = 0;
    const covered = beats.map((b) => {
      const tb = beatTime(this.grid, b);
      while (k < hitTimes.length && hitTimes[k]! <= tb) k++;
      const before = k > 0 ? hitTimes[k - 1]! : null;
      const after = k < hitTimes.length ? hitTimes[k]! : null;
      if (before === null && after === null) return 0;
      if (before === null || after === null) {
        const d = Math.abs((before ?? after)! - tb) / p;
        return d <= 1.2 ? 1 : d <= 2.2 ? 0.5 : 0;
      }
      const gap = (after - before) / p;
      return gap <= 2.4 ? 1 : gap <= 4.4 ? 0.5 : 0;
    });
    const participation = beats.length ? covered.reduce<number>((a, b) => a + b, 0) / beats.length : 0;

    // 4. 统计与展示
    const main = this.dominant(hits);
    const timeline: Density[] = [];
    for (let b = this.playStart; b <= this.chart.endBeat; b += 4) {
      const t0 = beatTime(this.grid, b) - p / 2;
      const t1 = t0 + 4 * p;
      const inBar = hits.filter((h) => h.t >= t0 && h.t < t1);
      const top = this.dominant(inBar).length;
      const beatsInBar = Math.min(4, this.chart.endBeat - b + 1);
      const rate = top / beatsInBar;
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
      offsetMs: main.length ? this.meanOffset(main.map((h) => h.t)) * 1000 : null,
      windowMs: this.window * 1000,
      beatMs: p * 1000,
      timeline,
      swings: judged.map((j, i) => ({ kind: kinds[i]!, delta: j.delta * 1000 })),
    };
  }

  /** 一组同一路的挥动是否锁定在节拍上；锁定时返回用的是哪种钟面和平均位置。 */
  private lockOf(times: number[]): Lock | null {
    const n = times.length;
    if (n < this.o.minEvents) return null;
    let best: Lock | null = null;
    for (const h of [1, 2] as const) {
      let s = 0;
      let c = 0;
      for (const t of times) {
        const a = this.phase(t, h);
        s += Math.sin(a);
        c += Math.cos(a);
      }
      const R = Math.hypot(s, c) / n;
      const z = n * R * R;
      const need = h === 1 ? this.o.lockZ : this.o.lockZHalf;
      if (z >= need && (!best || z > best.z)) best = { h, mu: Math.atan2(s, c), z };
    }
    return best;
  }

  private phase(t: number, h: 1 | 2): number {
    return (TAU * h * (t - this.grid.firstBeat)) / this.period;
  }

  /** 相对这一路平均位置的偏差（秒）。 */
  private deviation(t: number, lock: Lock): number {
    return (wrapAngle(this.phase(t, lock.h) - lock.mu) / (TAU * lock.h)) * this.period;
  }

  private scoreAt(t: number, lock: Lock): number | null {
    const w = lock.h === 1 ? this.window : this.halfWindow;
    const d = this.deviation(t, lock);
    return Math.abs(d) <= w ? hitScore(d, w) : null;
  }

  private nearestBeatDelta(t: number): number {
    return (wrapAngle(this.phase(t, 1)) / TAU) * this.period;
  }

  /** 一拍一圈钟面上的平均位置，换算成相对拍点的偏移（秒）。 */
  private meanOffset(times: number[]): number {
    let s = 0;
    let c = 0;
    for (const t of times) {
      const a = this.phase(t, 1);
      s += Math.sin(a);
      c += Math.cos(a);
    }
    return (Math.atan2(s, c) / TAU) * this.period;
  }

  /** 两路里挥动更多的那一路。 */
  private dominant<T extends Event>(list: T[]): T[] {
    const a = list.filter((e) => e.dir === 0);
    const b = list.filter((e) => e.dir === 1);
    return a.length >= b.length ? a : b;
  }
}
