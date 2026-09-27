import { CALIBRATION_BEATS, type Chart } from './chart';
import { beatPeriod, beatPosition, beatTime, nearestBeat } from './grid';

/**
 * 判定规则（详见 projects/penlight/docs/brief.md「玩法与判定规则」）：
 *
 * 1. 校准：判定范围的前 8 拍，取每次挥动相对最近拍子的偏差（只取 ±0.3 拍以内的），
 *    中位数作为个人偏移。有效挥动少于 3 次时偏移记为 0。
 * 2. 命中：之后每次挥动先减去个人偏移，再找最近的拍子，偏差在 W 以内算命中，
 *    W = min(100 ms, 0.25 拍)。同一拍第一次命中计分，第二次起算多余挥动。
 * 3. 回程挥动：没命中的挥动落在两拍之间，这个区间里的第一下不计分也不算错，
 *    第二下起算多余挥动。
 * 4. 打法识别：命中率低于 65% 且 85% 以上命中集中在同一奇偶拍时，按「每两拍一下」
 *    只算那一半拍子的覆盖率。
 * 5. 计分：100 × 覆盖率 × 准确度 × max(0.5, 1 − 0.5 × 多余挥动 / 应打拍数)。
 */

export interface JudgeOptions {
  calibrationBeats?: number;
  /** 校准时只采用偏差在多少拍以内的挥动，默认 0.3。 */
  calibrationTolerance?: number;
  /** 校准段有效挥动少于这个数时偏移记为 0，默认 3。 */
  minCalibrationSamples?: number;
  /** 判定窗口上限（秒），默认 0.1。 */
  maxWindow?: number;
  /** 判定窗口占一拍的比例上限，默认 0.25。 */
  windowBeats?: number;
  /** 实时稳定度取最近几下，默认 8。 */
  stabilitySize?: number;
}

export type SwingKind = 'hit' | 'extra' | 'return';

export type Verdict =
  /** 校准段开始之前，或落在校准段拍子上的挥动，不参与判定。 */
  | { kind: 'ignored' }
  | { kind: 'calibration'; beat: number; delta: number; valid: boolean }
  | { kind: 'hit'; beat: number; delta: number; score: number }
  | { kind: 'extra'; beat: number; delta: number }
  | { kind: 'return'; beat: number; delta: number };

export interface SwingRecord {
  kind: SwingKind;
  beat: number;
  /** 减去个人偏移之后相对最近拍子的偏差（秒）。 */
  delta: number;
}

export type PlayStyle = 'every' | 'half';

export interface GameResult {
  /** 0–100。 */
  score: number;
  style: PlayStyle;
  /** 计入覆盖率的命中拍数。 */
  hits: number;
  /** 应打拍数（按识别到的打法）。 */
  expected: number;
  coverage: number;
  accuracy: number;
  /** max(0.5, 1 − 0.5 × extras / expected)。 */
  extrasFactor: number;
  extras: number;
  /** 命中挥动的平均绝对偏差（ms），没有命中时为 null。 */
  meanAbsDeviationMs: number | null;
  /** 命中挥动的平均偏差（ms），正数表示整体偏晚。 */
  meanDeviationMs: number | null;
  offsetMs: number;
  calibrationSamples: number;
  /** 校准段有效挥动不足，偏移按 0 计。 */
  calibrationFallback: boolean;
  windowMs: number;
  beatMs: number;
  /** 校准之后的全部挥动，偏差单位为 ms。 */
  swings: { kind: SwingKind; delta: number }[];
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function hitScore(delta: number, window: number): number {
  return 1 - Math.pow(Math.min(Math.abs(delta) / window, 1), 1.5);
}

export class Judge {
  readonly chart: Chart;
  /** 一拍的时长（秒）。 */
  readonly period: number;
  /** 判定窗口 W（秒）。 */
  readonly window: number;
  readonly calibrationBeats: number;
  /** 第一个计分的拍子。 */
  readonly playStart: number;

  private readonly tolerance: number;
  private readonly minSamples: number;
  private readonly stabilitySize: number;
  private readonly calibrationStartTime: number;
  private readonly calibrationEndTime: number;
  private readonly playEndTime: number;

  private readonly calibrationDeltas: number[] = [];
  private readonly calibratedBeats = new Set<number>();
  private _offset: number | null = null;
  private _fallback = false;

  private readonly hitScores = new Map<number, number>();
  private readonly intervalSwings = new Map<number, number>();
  private readonly recent: number[] = [];
  private readonly records: SwingRecord[] = [];
  private _extras = 0;

  constructor(chart: Chart, options: JudgeOptions = {}) {
    this.chart = chart;
    this.period = beatPeriod(chart.grid);
    this.window = Math.min(options.maxWindow ?? 0.1, (options.windowBeats ?? 0.25) * this.period);
    this.calibrationBeats = options.calibrationBeats ?? CALIBRATION_BEATS;
    this.tolerance = (options.calibrationTolerance ?? 0.3) * this.period;
    this.minSamples = options.minCalibrationSamples ?? 3;
    this.stabilitySize = options.stabilitySize ?? 8;
    this.playStart = chart.startBeat + this.calibrationBeats;

    const half = this.period / 2;
    this.calibrationStartTime = beatTime(chart.grid, chart.startBeat) - half;
    this.calibrationEndTime = beatTime(chart.grid, this.playStart) - half;
    this.playEndTime = beatTime(chart.grid, chart.endBeat) + half;
  }

  /** 个人偏移（秒）。校准结束之前为 null。 */
  get offset(): number | null {
    return this._offset;
  }

  get calibrationFallback(): boolean {
    return this._fallback;
  }

  get extras(): number {
    return this._extras;
  }

  get hits(): number {
    return this.hitScores.size;
  }

  /** 校准段里已有有效挥动的拍子（相对校准段第一拍的序号）。 */
  get calibratedBeatSlots(): ReadonlySet<number> {
    return this.calibratedBeats;
  }

  get swingRecords(): readonly SwingRecord[] {
    return this.records;
  }

  /** 时间推进到 t（歌曲时间，秒）。过了校准段就定下个人偏移。 */
  tick(t: number): void {
    if (this._offset === null && t >= this.calibrationEndTime) this.finishCalibration();
  }

  /** 处理一次挥动，t 为歌曲时间（秒）。 */
  swing(t: number): Verdict {
    if (t < this.calibrationStartTime) return { kind: 'ignored' };

    if (this._offset === null && t < this.calibrationEndTime) {
      const { index, delta } = nearestBeat(this.chart.grid, t);
      const valid = Math.abs(delta) <= this.tolerance;
      if (valid) {
        this.calibrationDeltas.push(delta);
        this.calibratedBeats.add(index - this.chart.startBeat);
      }
      return { kind: 'calibration', beat: index, delta, valid };
    }

    this.tick(t);
    const adjusted = t - this._offset!;
    const { index, delta } = nearestBeat(this.chart.grid, adjusted);
    if (index < this.playStart || adjusted > this.playEndTime || index > this.chart.endBeat) {
      return { kind: 'ignored' };
    }

    if (Math.abs(delta) <= this.window) {
      if (!this.hitScores.has(index)) {
        const score = hitScore(delta, this.window);
        this.hitScores.set(index, score);
        this.record({ kind: 'hit', beat: index, delta }, score);
        return { kind: 'hit', beat: index, delta, score };
      }
      this._extras++;
      this.record({ kind: 'extra', beat: index, delta }, 0);
      return { kind: 'extra', beat: index, delta };
    }

    const interval = Math.floor(beatPosition(this.chart.grid, adjusted));
    const seen = this.intervalSwings.get(interval) ?? 0;
    this.intervalSwings.set(interval, seen + 1);
    if (seen === 0) {
      // 回程挥动不计分。离拍子很近却没进窗口的，在实时稳定度里算一次失误。
      const nearBeat = Math.abs(delta) < 0.25 * this.period;
      this.record({ kind: 'return', beat: index, delta }, nearBeat ? 0 : null);
      return { kind: 'return', beat: index, delta };
    }
    this._extras++;
    this.record({ kind: 'extra', beat: index, delta }, 0);
    return { kind: 'extra', beat: index, delta };
  }

  /** 最近 8 下的稳定度（0–1），还没有数据时为 null。 */
  stability(): number | null {
    if (this.recent.length === 0) return null;
    return this.recent.reduce((a, b) => a + b, 0) / this.recent.length;
  }

  result(): GameResult {
    this.finishCalibration();

    const beats: number[] = [];
    for (let b = this.playStart; b <= this.chart.endBeat; b++) beats.push(b);
    const parity = (b: number) => (((b - this.playStart) % 2) + 2) % 2;

    const hitBeats = [...this.hitScores.keys()];
    const totalHits = hitBeats.length;
    const evenHits = hitBeats.filter((b) => parity(b) === 0).length;
    const oddHits = totalHits - evenHits;
    const hitRate = beats.length ? totalHits / beats.length : 0;
    const dominant = evenHits >= oddHits ? 0 : 1;
    const dominantHits = Math.max(evenHits, oddHits);

    const style: PlayStyle =
      totalHits > 0 && hitRate < 0.65 && dominantHits / totalHits >= 0.85 ? 'half' : 'every';
    const expected =
      style === 'half' ? beats.filter((b) => parity(b) === dominant).length : beats.length;
    const hits = style === 'half' ? dominantHits : totalHits;

    const scores = [...this.hitScores.values()];
    const accuracy = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const coverage = expected ? Math.min(1, hits / expected) : 0;
    const extrasFactor = expected ? Math.max(0.5, 1 - (0.5 * this._extras) / expected) : 0.5;

    const hitDeltas = this.records.filter((r) => r.kind === 'hit').map((r) => r.delta);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const meanAbs = mean(hitDeltas.map(Math.abs));
    const meanSigned = mean(hitDeltas);

    return {
      score: 100 * coverage * accuracy * extrasFactor,
      style,
      hits,
      expected,
      coverage,
      accuracy,
      extrasFactor,
      extras: this._extras,
      meanAbsDeviationMs: meanAbs === null ? null : meanAbs * 1000,
      meanDeviationMs: meanSigned === null ? null : meanSigned * 1000,
      offsetMs: (this._offset ?? 0) * 1000,
      calibrationSamples: this.calibrationDeltas.length,
      calibrationFallback: this._fallback,
      windowMs: this.window * 1000,
      beatMs: this.period * 1000,
      swings: this.records.map((r) => ({ kind: r.kind, delta: r.delta * 1000 })),
    };
  }

  private finishCalibration(): void {
    if (this._offset !== null) return;
    if (this.calibrationDeltas.length < this.minSamples) {
      this._offset = 0;
      this._fallback = true;
    } else {
      this._offset = median(this.calibrationDeltas);
    }
  }

  private record(r: SwingRecord, stabilityValue: number | null): void {
    this.records.push(r);
    if (stabilityValue === null) return;
    this.recent.push(stabilityValue);
    if (this.recent.length > this.stabilitySize) this.recent.shift();
  }
}
