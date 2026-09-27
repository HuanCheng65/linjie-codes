import type { BeatGrid } from './grid';

export interface GridFit extends BeatGrid {
  /** 参与拟合的拍点数。 */
  inliers: number;
  /** 拟合后拍点残差的均方根（秒）。 */
  rms: number;
}

/**
 * 把节拍识别给出的拍点拟合成一条等间距网格：
 * 周期用最小二乘（拍点时间对拍序号做线性回归），相位取圆周平均。
 *
 * @param ticks 识别出的拍点时间（秒），升序。
 * @param bpmHint 识别给出的 BPM，用来给拍点编号。
 */
export function fitBeatGrid(ticks: readonly number[], bpmHint: number): GridFit {
  const sorted = [...ticks].filter(Number.isFinite).sort((a, b) => a - b);
  let period = 60 / bpmHint;
  if (sorted.length < 4) {
    return { bpm: bpmHint, firstBeat: wrap(sorted[0] ?? 0, period), inliers: sorted.length, rms: 0 };
  }

  // 按相邻间隔累加编号，BPM 估得略有偏差时不会越往后错得越多。
  // 多出来的拍点编号和前一个相同，会在下面的回归里被当成离群点剔除。
  const index = new Array<number>(sorted.length);
  index[0] = 0;
  for (let i = 1; i < sorted.length; i++) {
    index[i] = index[i - 1]! + Math.round((sorted[i]! - sorted[i - 1]!) / period);
  }

  let keep = sorted.map(() => true);
  let intercept = sorted[0]!;
  for (let iter = 0; iter < 4; iter++) {
    const fit = linearFit(
      index.filter((_, i) => keep[i]),
      sorted.filter((_, i) => keep[i]),
    );
    if (!fit) break;
    period = fit.slope;
    intercept = fit.intercept;
    // 用新周期重新编号，并剔除离网格太远的拍点。
    for (let i = 0; i < sorted.length; i++) index[i] = Math.round((sorted[i]! - intercept) / period);
    const next = sorted.map((t, i) => Math.abs(t - (intercept + index[i]! * period)) < 0.2 * period);
    if (next.filter(Boolean).length < 4) break;
    keep = next;
  }

  const inliers = sorted.filter((_, i) => keep[i]);
  const phase = circularMean(inliers, period);
  const firstBeat = wrap(phase, period);
  const residuals = inliers.map((t) => {
    const r = wrap(t - firstBeat, period);
    return r > period / 2 ? r - period : r;
  });
  const rms = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / residuals.length);

  return { bpm: 60 / period, firstBeat, inliers: inliers.length, rms };
}

function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/** 拍点在一个周期内的平均位置（秒，落在 [0, period) 内）。 */
function circularMean(times: readonly number[], period: number): number {
  let s = 0;
  let c = 0;
  for (const t of times) {
    const a = (2 * Math.PI * t) / period;
    s += Math.sin(a);
    c += Math.cos(a);
  }
  return wrap((Math.atan2(s, c) / (2 * Math.PI)) * period, period);
}

function wrap(t: number, period: number): number {
  return ((t % period) + period) % period;
}
