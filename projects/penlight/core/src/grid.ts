/**
 * 节拍表：一首歌里每一拍的时间。两拍之间按线性插值，第一拍之前、最后一拍之后按边上那一拍的长度往外延伸。
 * 速度恒定的歌是最简单的情况；变速、渐快渐慢的歌也能表示。
 * 所有时间单位都是秒，以音频开头为 0（可以是负数，表示音频开始之前的预备拍）。
 */
export interface BeatMap {
  /** 各拍的时间，严格递增，至少两拍。数组下标就是拍号。 */
  times: number[];
}

/** 从某个时间点开始、速度恒定的节拍表，覆盖 [from, to]。 */
export function uniformMap(bpm: number, anchor: number, from: number, to: number): BeatMap {
  const p = 60 / bpm;
  const k0 = Math.floor((from - anchor) / p);
  const k1 = Math.ceil((to - anchor) / p);
  const times: number[] = [];
  for (let k = k0; k <= Math.max(k1, k0 + 1); k++) times.push(anchor + k * p);
  return { times };
}

function edgePeriod(map: BeatMap, end: 'start' | 'end'): number {
  const t = map.times;
  return end === 'start' ? t[1]! - t[0]! : t[t.length - 1]! - t[t.length - 2]!;
}

/** 第 i 拍的时间，i 可以是小数，也可以超出范围。 */
export function beatTime(map: BeatMap, i: number): number {
  const t = map.times;
  const n = t.length;
  if (i <= 0) return t[0]! + i * edgePeriod(map, 'start');
  if (i >= n - 1) return t[n - 1]! + (i - (n - 1)) * edgePeriod(map, 'end');
  const k = Math.floor(i);
  return t[k]! + (i - k) * (t[k + 1]! - t[k]!);
}

/** 时间 t 在节拍表上的位置（以拍为单位，可以是小数或负数）。 */
export function beatPosition(map: BeatMap, time: number): number {
  const t = map.times;
  const n = t.length;
  if (time <= t[0]!) return (time - t[0]!) / edgePeriod(map, 'start');
  if (time >= t[n - 1]!) return n - 1 + (time - t[n - 1]!) / edgePeriod(map, 'end');
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! <= time) lo = mid;
    else hi = mid;
  }
  return lo + (time - t[lo]!) / (t[lo + 1]! - t[lo]!);
}

/** 时间 t 附近一拍的长度（秒）。 */
export function periodAt(map: BeatMap, time: number): number {
  const pos = beatPosition(map, time);
  const k = Math.floor(pos);
  return beatTime(map, k + 1) - beatTime(map, k);
}

export function bpmAt(map: BeatMap, time: number): number {
  return 60 / periodAt(map, time);
}

/** 整张表的平均 BPM。 */
export function averageBpm(map: BeatMap): number {
  const t = map.times;
  return (60 * (t.length - 1)) / (t[t.length - 1]! - t[0]!);
}

export interface NearestBeat {
  index: number;
  /** t 减去最近拍子的时间（秒），负数表示早了。 */
  delta: number;
}

export function nearestBeat(map: BeatMap, time: number): NearestBeat {
  const index = Math.round(beatPosition(map, time));
  return { index, delta: time - beatTime(map, index) };
}

/** 第一个时间不早于 t 的拍子序号。 */
export function firstBeatAtOrAfter(map: BeatMap, time: number): number {
  return Math.ceil(beatPosition(map, time) - 1e-9);
}

/** 最后一个时间不晚于 t 的拍子序号。 */
export function lastBeatAtOrBefore(map: BeatMap, time: number): number {
  return Math.floor(beatPosition(map, time) + 1e-9);
}

/** 整体平移。 */
export function shiftMap(map: BeatMap, seconds: number): BeatMap {
  return { times: map.times.map((t) => t + seconds) };
}

/**
 * 把 [from, to) 这几拍的速度减半（隔一拍删一拍）或加倍（两拍之间插一拍）。
 * 识别结果常常在某一段差一倍，比如桥段鼓点变成半速感。
 */
export function rescaleRange(map: BeatMap, from: number, to: number, mode: 'half' | 'double'): BeatMap {
  const t = map.times;
  const a = Math.max(0, Math.min(from, t.length - 1));
  const b = Math.max(a, Math.min(to, t.length - 1));
  const before = t.slice(0, a);
  const after = t.slice(b);
  const mid: number[] = [];
  if (mode === 'half') {
    for (let i = a; i < b; i += 2) mid.push(t[i]!);
    // 删掉之后如果和后面的拍子只隔半拍，让后面的部分对齐
    if ((b - a) % 2 === 1 && after.length) after.shift();
  } else {
    for (let i = a; i < b; i++) mid.push(t[i]!, (t[i]! + t[i + 1]!) / 2);
  }
  const times = [...before, ...mid, ...after];
  return times.length >= 2 ? { times } : map;
}

export interface TempoSection {
  startBeat: number;
  /** 不含。 */
  endBeat: number;
  startTime: number;
  endTime: number;
  bpm: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * 把节拍表按速度切成几段。相邻两段的速度差超过 tolerance（默认 3%）才算变速，
 * 少于 minBeats 拍的小段并进旁边。
 */
export function tempoSections(map: BeatMap, tolerance = 0.03, minBeats = 12): TempoSection[] {
  const t = map.times;
  const periods = t.slice(1).map((x, i) => x - t[i]!);
  const smooth = periods.map((_, i) => median(periods.slice(Math.max(0, i - 4), i + 5)));

  const cuts = [0];
  let ref = smooth[0]!;
  let run = 0;
  for (let i = 1; i < smooth.length; i++) {
    if (Math.abs(smooth[i]! / ref - 1) > tolerance) {
      run++;
      if (run >= 4) {
        const at = i - 3;
        if (at - cuts[cuts.length - 1]! >= minBeats) cuts.push(at);
        ref = smooth[i]!;
        run = 0;
      }
    } else {
      run = 0;
      // 慢慢漂移的歌让参考值跟着走，只有明显跳变才切段
      ref = ref * 0.9 + smooth[i]! * 0.1;
    }
  }
  cuts.push(periods.length);
  if (cuts.length > 2 && cuts[cuts.length - 1]! - cuts[cuts.length - 2]! < minBeats) cuts.splice(cuts.length - 2, 1);

  const make = (a: number, b: number): TempoSection => ({
    startBeat: a,
    endBeat: b,
    startTime: t[a]!,
    endTime: t[b]!,
    bpm: (60 * (b - a)) / (t[b]! - t[a]!),
  });
  const sections: TempoSection[] = [];
  for (let k = 0; k < cuts.length - 1; k++) sections.push(make(cuts[k]!, cuts[k + 1]!));

  // 夹在两段速度相近的段落之间的短段（多半是停顿里识别乱了），并进两边
  const close = (x: number, y: number) => Math.abs(x / y - 1) <= tolerance;
  for (let changed = true; changed; ) {
    changed = false;
    // 相邻两段平均速度几乎一样（只是交界处抖了一下），直接合并
    for (let i = 1; i < sections.length; i++) {
      if (Math.abs(sections[i]!.bpm / sections[i - 1]!.bpm - 1) <= tolerance / 2) {
        sections.splice(i - 1, 2, make(sections[i - 1]!.startBeat, sections[i]!.endBeat));
        changed = true;
        break;
      }
    }
    if (changed) continue;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i]!;
      if (s.endBeat - s.startBeat >= 2 * minBeats) continue;
      const prev = sections[i - 1];
      const next = sections[i + 1];
      if (prev && next && close(prev.bpm, next.bpm)) {
        sections.splice(i - 1, 3, make(prev.startBeat, next.endBeat));
        changed = true;
        break;
      }
      const neighbor = prev && (!next || close(prev.bpm, s.bpm)) ? prev : next;
      if (neighbor && close(neighbor.bpm, s.bpm)) {
        const j = neighbor === prev ? i - 1 : i;
        sections.splice(j, 2, make(sections[j]!.startBeat, sections[j + 1]!.endBeat));
        changed = true;
        break;
      }
    }
  }
  return sections;
}

/** 以 downbeat（某个小节第一拍的时间）为准，第 i 拍是不是小节线。 */
export function isBarLine(map: BeatMap, i: number, downbeat: number): boolean {
  const d = Math.round(beatPosition(map, downbeat));
  return (((i - d) % 4) + 4) % 4 === 0;
}

/** 离 t 最近的小节线（拍号）。 */
export function nearestBar(map: BeatMap, time: number, downbeat: number): number {
  const d = Math.round(beatPosition(map, downbeat));
  const pos = beatPosition(map, time);
  return d + Math.round((pos - d) / 4) * 4;
}

/**
 * 用一段新的拍点（比如用户跟着敲出来的）替换 [from, to] 这段时间里的拍子。
 * 两头和原来的拍子挨得太近的会被去掉，避免出现半拍的空隙。
 */
export function spliceMap(map: BeatMap, patch: readonly number[], from: number, to: number): BeatMap {
  const mid = patch.filter((t) => t >= from && t <= to);
  if (mid.length < 2) return map;
  const gaps = mid.slice(1).map((t, i) => t - mid[i]!);
  const p = median(gaps);
  const before = map.times.filter((t) => t < from);
  const after = map.times.filter((t) => t > to);
  while (before.length && mid[0]! - before[before.length - 1]! < 0.6 * p) before.pop();
  while (after.length && after[0]! - mid[mid.length - 1]! < 0.6 * p) after.shift();
  return { times: [...before, ...mid, ...after] };
}
