import type { Chroma } from './chroma';
import { beatTime, type BeatMap } from './grid';

/**
 * 歌曲里重复出现的段落，按小节算。副歌一般会出现好几次，而且每次出现的起点就是一句的开头。
 */
export interface Repetition {
  /** 每个小节被多少对重复段覆盖（0 表示这一小节在别处没有重复）。 */
  coverage: number[];
  /** 每个小节作为重复段起点的次数。 */
  starts: number[];
}

/** 每小节的色度向量，减去整首的平均再归一化，这样和弦走向的差别才明显。 */
function barChroma(map: BeatMap, chroma: Chroma, bars: number[]): number[][] {
  const feats = bars.map((b) => {
    const v = new Array<number>(12).fill(0);
    const a = Math.max(0, Math.floor(beatTime(map, b) / chroma.hop));
    const e = Math.min(chroma.values.length / 12, Math.floor(beatTime(map, b + 4) / chroma.hop));
    for (let i = a; i < e; i++) for (let k = 0; k < 12; k++) v[k]! += chroma.values[i * 12 + k]!;
    const s = Math.hypot(...v) || 1;
    return v.map((x) => x / s);
  });
  const mean = new Array<number>(12).fill(0);
  for (const v of feats) for (let k = 0; k < 12; k++) mean[k]! += v[k]! / feats.length;
  for (const v of feats) {
    for (let k = 0; k < 12; k++) v[k]! -= mean[k]!;
    const s = Math.hypot(...v) || 1;
    for (let k = 0; k < 12; k++) v[k]! /= s;
  }
  return feats;
}

const MIN_BARS = 8;
const GOOD = 0.5;
const STRONG = 0.7;

/**
 * 在小节自相似矩阵的对角线上找重复段：隔 L 小节的两处连续至少 8 小节都很像，就算一对重复。
 * 允许中间偶尔有一小节不像（加花、换词）；起点取第一个连着很像的小节，免得把前一句的尾巴算进来。
 */
export function findRepetition(map: BeatMap, chroma: Chroma, bars: number[]): Repetition {
  const n = bars.length;
  const f = barChroma(map, chroma, bars);
  const sim = (i: number, j: number) => {
    let s = 0;
    for (let k = 0; k < 12; k++) s += f[i]![k]! * f[j]![k]!;
    return s;
  };
  const coverage = new Array<number>(n).fill(0);
  const starts = new Array<number>(n).fill(0);
  for (let lag = MIN_BARS; lag + MIN_BARS <= n; lag++) {
    const d = Array.from({ length: n - lag }, (_, i) => sim(i, i + lag));
    let i = 0;
    while (i < d.length) {
      if (d[i]! < GOOD) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < d.length && (d[j + 1]! >= GOOD || (j + 2 < d.length && d[j + 2]! >= GOOD))) j++;
      // [i, j] 是一段（允许单个小节的空隙）；起点往后挪到连着很像的地方
      let s = i;
      while (s <= j - 3 && !(d[s]! >= STRONG && [1, 2, 3].filter((k) => d[s + k]! >= STRONG).length >= 2)) s++;
      const len = Math.min(j - s + 1, lag);
      let mean = 0;
      for (let k = s; k < s + len; k++) mean += d[k]!;
      mean /= Math.max(1, len);
      if (len >= MIN_BARS && mean >= STRONG) {
        starts[s]!++;
        starts[s + lag]!++;
        for (let k = s; k < s + len; k++) {
          coverage[k]!++;
          coverage[k + lag]!++;
        }
      }
      i = j + 1;
    }
  }
  return { coverage, starts };
}
