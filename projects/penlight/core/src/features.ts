import { buildBeatMap } from './fit';
import { beatPosition, beatTime, firstBeatAtOrAfter, lastBeatAtOrBefore, nearestBar, resampleMap, tempoSections, type BeatMap } from './grid';

/**
 * 音频包络：每 hop 秒一个值（均方根）。手机端解码后算一次，之后的分析都在这上面做。
 */
export interface Envelope {
  hop: number;
  values: Float32Array;
}

/** 每个 hop 取均方根。samples 为单声道 PCM。 */
export function envelopeOf(samples: Float32Array, sampleRate: number, hop = 0.02): Envelope {
  const size = Math.max(1, Math.round(hop * sampleRate));
  const n = Math.ceil(samples.length / size);
  const values = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    const a = k * size;
    const b = Math.min(samples.length, a + size);
    for (let i = a; i < b; i++) s += samples[i]! * samples[i]!;
    values[k] = Math.sqrt(s / Math.max(1, b - a));
  }
  return { hop, values };
}

function meanIn(env: Envelope, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from / env.hop));
  const b = Math.min(env.values.length, Math.ceil(to / env.hop));
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += env.values[i]!;
  return s / (b - a);
}

/** 每一拍（前后各半拍）的平均能量。 */
export function beatEnergies(map: BeatMap, env: Envelope, from: number, to: number): number[] {
  const out: number[] = [];
  for (let b = from; b <= to; b++) out.push(meanIn(env, beatTime(map, b - 0.5), beatTime(map, b + 0.5)));
  return out;
}

/**
 * 估计小节的第一拍：底鼓通常落在小节第一拍和第三拍，低频能量按拍号除以 4 的余数累加，
 * 取最强的那一组。返回某个小节第一拍的时间。
 */
export function estimateDownbeat(map: BeatMap, low: Envelope, duration: number): number {
  const first = Math.max(0, firstBeatAtOrAfter(map, 0));
  const last = lastBeatAtOrBefore(map, duration);
  const sums = [0, 0, 0, 0];
  for (let b = first; b <= last; b++) {
    // 只看拍点附近 60 ms 的冲击
    sums[b % 4]! += meanIn(low, beatTime(map, b) - 0.02, beatTime(map, b) + 0.06);
  }
  let best = 0;
  for (let r = 1; r < 4; r++) if (sums[r]! > sums[best]!) best = r;
  let b0 = first;
  while (b0 % 4 !== best) b0++;
  return beatTime(map, b0);
}

/**
 * 几乎没有声音的拍子（停顿、安静的间奏），不计入参与度。
 * 能量低于整首中位数的 12%，并且连续至少 2 拍。
 */
export function findRestBeats(map: BeatMap, env: Envelope, from: number, to: number): number[] {
  const e = beatEnergies(map, env, from, to);
  const sorted = [...e].sort((a, b) => a - b);
  const mid = sorted[sorted.length >> 1] ?? 0;
  const quiet = e.map((x) => x < 0.12 * mid);
  const out: number[] = [];
  for (let i = 0; i < quiet.length; i++) {
    if (!quiet[i]) continue;
    if (quiet[i - 1] || quiet[i + 1]) out.push(from + i);
  }
  return out;
}

export interface Selection {
  start: number;
  end: number;
}

/**
 * 推荐一段副歌：在 16–32 小节长的窗口里找平均能量最高的一段，起止对齐小节线。
 * 找不到时退回整首。
 */
export function recommendSelection(map: BeatMap, env: Envelope, downbeat: number, duration: number, targetSeconds = 60): Selection {
  const firstBar = nearestBar(map, Math.max(0, beatTime(map, 0)), downbeat);
  const bars: number[] = [];
  for (let b = firstBar; beatTime(map, b) < duration - 1; b += 4) if (beatTime(map, b) >= 0) bars.push(b);
  if (bars.length < 6) return { start: 0, end: duration };
  const barEnergy = bars.map((b) => meanIn(env, beatTime(map, b), beatTime(map, b + 4)));
  const barLen = beatTime(map, bars[1]!) - beatTime(map, bars[0]!);
  const n = Math.max(4, Math.min(bars.length - 1, Math.round(targetSeconds / barLen / 4) * 4));
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i + n <= bars.length; i++) {
    let s = 0;
    for (let k = i; k < i + n; k++) s += barEnergy[k]!;
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  const endBar = bars[best + n] ?? bars[bars.length - 1]! + 4;
  return { start: beatTime(map, bars[best]!), end: Math.min(duration, beatTime(map, endBar)) };
}

/**
 * 找段落交界（拍号），用来换应援棒颜色：变速点，或者前后 4 小节能量明显变化的小节线。
 * 两个交界至少隔 4 小节；一段超过 32 拍还没变化，就每 16 拍换一次。
 */
export function sectionBreaks(map: BeatMap, env: Envelope, fromBeat: number, toBeat: number, downbeat: number): number[] {
  const candidates = new Set<number>();
  for (const s of tempoSections(map)) if (s.startBeat > fromBeat && s.startBeat < toBeat) candidates.add(s.startBeat);

  const d = Math.round(beatPosition(map, downbeat));
  const firstBar = d + Math.ceil((fromBeat - d) / 4) * 4;
  const barE = (b: number) => meanIn(env, beatTime(map, b), beatTime(map, b + 4));
  const jumps: { beat: number; score: number }[] = [];
  for (let b = firstBar + 16; b + 16 <= toBeat; b += 4) {
    let before = 0;
    let after = 0;
    for (let k = 1; k <= 4; k++) before += barE(b - 4 * k);
    for (let k = 0; k < 4; k++) after += barE(b + 4 * k);
    jumps.push({ beat: b, score: before > 0 && after > 0 ? Math.abs(Math.log(after / before)) : 0 });
  }
  // 一次能量变化会让附近好几个小节都超过门槛，只取变化最大的那个
  jumps.forEach((j, i) => {
    if (j.score <= 0.35) return;
    const near = jumps.slice(Math.max(0, i - 3), i + 4);
    if (near.every((x) => x.score <= j.score)) candidates.add(j.beat);
  });

  const sorted = [...candidates].sort((a, b) => a - b);
  const out: number[] = [];
  let last = fromBeat;
  for (const b of sorted) {
    // 离下一个真正的交界还远时，每 16 拍补一次换色，但不挤占真正的交界
    while (b - last >= 32) {
      last += 16;
      out.push(last);
    }
    if (b - last >= 16) {
      out.push(b);
      last = b;
    }
  }
  while (toBeat - last > 32) {
    last += 16;
    out.push(last);
  }
  return out;
}

/**
 * 换拍子级别时可能的对齐方式（以原来的拍为单位）。
 * 比如 1.5 倍：新拍子每 2/3 个原拍一下，可以从原拍点开始，也可以错开 1/3。
 */
const PHASES: Record<number, number[]> = { 0.5: [0, 1], 2: [0], 1.5: [0, 1 / 3], [2 / 3]: [0, 0.5, 1] };

/** 起音强度：能量对数的正向差分（能量突然变大的地方大）。 */
export function onsetEnvelope(env: Envelope): Envelope {
  const v = env.values;
  const out = new Float32Array(v.length);
  for (let i = 1; i < v.length; i++) out[i] = Math.max(0, Math.log(1e-4 + v[i]!) - Math.log(1e-4 + v[i - 1]!));
  return { hop: env.hop, values: out };
}

/** 起音强度在某个速度（一拍的间隔）上的自相关，已按方差归一化。越大说明音乐越按这个间隔重复。 */
export function tempoSalience(onset: Envelope, bpm: number): number {
  const v = onset.values;
  const n = v.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += v[i]!;
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (v[i]! - mean) ** 2;
  variance /= n;
  if (variance === 0) return 0;
  const lag = 60 / bpm / onset.hop;
  const at = (L: number) => {
    let s = 0;
    for (let i = 0; i + L < n; i++) s += (v[i]! - mean) * (v[i + L]! - mean);
    return s / Math.max(1, n - L);
  };
  const l0 = Math.floor(lag);
  const f = lag - l0;
  return ((1 - f) * at(l0) + f * at(l0 + 1)) / variance;
}

/** 某条节拍表的拍点上平均的起音强度（前后各一格取最大），用来比较同一速度下哪种对齐更准。 */
function gridOnset(onset: Envelope, times: number[], from: number, to: number): number {
  let s = 0;
  let n = 0;
  for (const t of times) {
    if (t < from || t > to) continue;
    const k = Math.round(t / onset.hop);
    let m = 0;
    for (let d = -1; d <= 1; d++) m = Math.max(m, onset.values[k + d] ?? 0);
    s += m;
    n++;
  }
  return n ? s / n : 0;
}

/**
 * 检查识别出的拍子是不是其实是附点节奏（每 1.5 拍一下）或者三连音级别：
 * 在「1.5 倍」或「2/3 倍」速度上，起音的自相关明显比原速度强（多 30% 以上），就换过去。
 * 快一倍、慢一半的情况两边往往一样强，分不清，不在这里改。
 */
export function correctMetricalLevel(
  map: BeatMap,
  onset: Envelope,
  duration: number,
  lowOnset?: Envelope,
): { map: BeatMap; factor: number } {
  const t = map.times.filter((x) => x >= 0 && x <= duration);
  if (t.length < 16) return { map, factor: 1 };
  const bpm = (60 * (t.length - 1)) / (t[t.length - 1]! - t[0]!);
  const base = tempoSalience(onset, bpm);
  let best = { factor: 1, score: base };
  for (const factor of [1.5, 2 / 3]) {
    const s = tempoSalience(onset, bpm * factor);
    if (s > 0.1 && s > base * 1.3 && s > best.score) best = { factor, score: s };
  }
  if (best.factor === 1) return { map, factor: 1 };
  // 新拍子可能和原来的拍点错开，几种对齐方式里取拍点上起音最强的
  const phases = PHASES[best.factor] ?? [0];
  let chosen = resampleMap(map, best.factor, 0);
  let chosenScore = -Infinity;
  for (const ph of phases) {
    const m = resampleMap(map, best.factor, ph);
    // 全频段和低频（底鼓）一起看：八分音符很密的歌只看全频段分不清正拍和反拍
    const s = gridOnset(onset, m.times, 0, duration) + (lowOnset ? gridOnset(lowOnset, m.times, 0, duration) : 0);
    if (s > chosenScore) {
      chosenScore = s;
      chosen = m;
    }
  }
  return { map: chosen, factor: best.factor };
}

/**
 * 让整首分析的结果和先分析的前 90 秒保持同一个拍子级别（识别有时会在两次分析里一次给 83、一次给 166）。
 * 在重叠的时间里比较两边的平均速度，差两倍、一半、1.5 倍时按参考结果换级别，并选和参考拍点最对齐的相位。
 */
export function alignLevel(map: BeatMap, reference: BeatMap, from: number, to: number): BeatMap {
  const inRange = (m: BeatMap) => m.times.filter((x) => x >= from && x <= to);
  const a = inRange(map);
  const b = inRange(reference);
  if (a.length < 8 || b.length < 8) return map;
  const bpmA = (60 * (a.length - 1)) / (a[a.length - 1]! - a[0]!);
  const bpmB = (60 * (b.length - 1)) / (b[b.length - 1]! - b[0]!);
  const want = bpmB / bpmA;
  const factor = [0.5, 2 / 3, 1, 1.5, 2].reduce((x, y) => (Math.abs(Math.log(y / want)) < Math.abs(Math.log(x / want)) ? y : x));
  if (factor === 1 || Math.abs(Math.log(factor / want)) > 0.06) return map;
  // 选和参考拍点平均距离最小的相位
  let best = map;
  let bestErr = Infinity;
  for (const phase of PHASES[factor] ?? [0]) {
    const pts = inRange(resampleMap(map, factor, phase));
    let err = 0;
    for (const t of b) {
      let d = Infinity;
      for (const x of pts) d = Math.min(d, Math.abs(x - t));
      err += d;
    }
    if (err < bestErr) {
      bestErr = err;
      best = resampleMap(map, factor, phase);
    }
  }
  return best;
}


function medianOf(values: Float32Array): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
}

/** 某个时间前后 half 秒的平均能量。 */
function energyAround(env: Envelope, t: number, half = 0.5): number {
  return meanIn(env, Math.max(0, t - half), t + half);
}

/**
 * 有声音的范围：前后 0.5 秒平均能量不低于整首中位数 threshold 倍的第一个和最后一个时刻。
 * 很多音频结尾有一段只剩很轻尾音或者空白，「整首」和推荐选段都以这里为准。
 */
export function activeRange(env: Envelope, duration: number, threshold = 0.1): { start: number; end: number } {
  const floor = threshold * medianOf(env.values);
  const step = env.hop * 5;
  let start = 0;
  while (start < duration && energyAround(env, start) < floor) start += step;
  let end = duration;
  while (end > start && energyAround(env, end) < floor) end -= step;
  return { start: Math.max(0, start - 0.25), end: Math.min(duration, end + 0.25) };
}

/** 首尾短于这么多秒、平均能量低于整首中位数这个倍数的段落，不单独算速度。 */
const QUIET_EDGE_SECONDS = 20;
const QUIET_EDGE_RATIO = 0.35;

/**
 * 从节拍识别的拍点得到最终的节拍表：去掉没声音处的拍点，整理成逐拍的表，检查是不是附点节奏的级别，
 * 有参考结果（先分析的前 90 秒）时和它保持同一个级别。手机端和测试共用这一条流程。
 */
export function beatMapFromTicks(
  ticks: number[],
  o: { duration: number; env: Envelope; low?: Envelope; reference?: { map: BeatMap; until: number } },
): BeatMap {
  const onset = onsetEnvelope(o.env);
  const lowOnset = o.low ? onsetEnvelope(o.low) : undefined;
  // 声音很轻的地方（结尾尾音、空白、停顿）识别器还会按惯性继续给拍点，这些不能用来判断速度，
  // 去掉之后按前后的速度补
  const median = medianOf(o.env.values);
  const floor = 0.1 * median;
  const heard = ticks.filter((t) => energyAround(o.env, t) >= floor);
  let used = heard.length >= 8 ? heard : ticks;
  let map: BeatMap = buildBeatMap(used, { duration: o.duration });
  // 开头或结尾一小段声音明显偏轻（乐器少的前奏、淡出）时，识别器常常抓不准，给出一段对不上的速度。
  // 这种段落不单独算速度，去掉里面的拍点，按旁边主体的速度往外延
  const sections = tempoSections(map);
  if (sections.length > 1) {
    const edges = [sections[0]!, sections[sections.length - 1]!]
      .map((s) => [Math.max(0, s.startTime), Math.min(o.duration, s.endTime)] as const)
      .filter(([a, b]) => b - a < QUIET_EDGE_SECONDS && meanIn(o.env, a, b) < QUIET_EDGE_RATIO * median);
    const kept = used.filter((t) => !edges.some(([a, b]) => (a === 0 || t >= a) && (b === o.duration || t < b)));
    if (edges.length && kept.length >= 8) {
      used = kept;
      map = buildBeatMap(used, { duration: o.duration });
    }
  }
  map = correctMetricalLevel(map, onset, o.duration, lowOnset).map;
  if (o.reference) map = alignLevel(map, o.reference.map, 0, o.reference.until);
  return map;
}
