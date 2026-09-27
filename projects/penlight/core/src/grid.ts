/**
 * 节拍网格：一首歌的全部拍点由 BPM 和第一拍的时间决定。
 * 所有时间单位都是秒，以歌曲音频的开头为 0。
 */
export interface BeatGrid {
  bpm: number;
  /** 第 0 拍在音频里的时间（秒）。可以大于一拍，表示前面有空白。 */
  firstBeat: number;
}

export function beatPeriod(grid: BeatGrid): number {
  return 60 / grid.bpm;
}

export function beatTime(grid: BeatGrid, index: number): number {
  return grid.firstBeat + index * beatPeriod(grid);
}

/** 时间 t 在网格上的位置（以拍为单位，可以是小数或负数）。 */
export function beatPosition(grid: BeatGrid, t: number): number {
  return (t - grid.firstBeat) / beatPeriod(grid);
}

export interface NearestBeat {
  index: number;
  /** t 减去最近拍子的时间（秒），负数表示挥早了。 */
  delta: number;
}

export function nearestBeat(grid: BeatGrid, t: number): NearestBeat {
  const index = Math.round(beatPosition(grid, t));
  return { index, delta: t - beatTime(grid, index) };
}

/** BPM 减半，第一拍位置不变。 */
export function halveGrid(grid: BeatGrid): BeatGrid {
  return { ...grid, bpm: grid.bpm / 2 };
}

/** BPM 加倍，第一拍位置不变。 */
export function doubleGrid(grid: BeatGrid): BeatGrid {
  return { ...grid, bpm: grid.bpm * 2 };
}

/** 平移第一拍，并把它规整到 [0, 一拍) 之内。 */
export function shiftGrid(grid: BeatGrid, seconds: number): BeatGrid {
  const p = beatPeriod(grid);
  const shifted = grid.firstBeat + seconds;
  return { ...grid, firstBeat: ((shifted % p) + p) % p };
}

/** 第一个时间不早于 t 的拍子序号。 */
export function firstBeatAtOrAfter(grid: BeatGrid, t: number): number {
  return Math.ceil(beatPosition(grid, t) - 1e-9);
}

/** 最后一个时间不晚于 t 的拍子序号。 */
export function lastBeatAtOrBefore(grid: BeatGrid, t: number): number {
  return Math.floor(beatPosition(grid, t) + 1e-9);
}
