import { beatPosition, beatTime, firstBeatAtOrAfter, lastBeatAtOrBefore, nearestBar, tempoSections, type BeatMap } from './grid';

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
