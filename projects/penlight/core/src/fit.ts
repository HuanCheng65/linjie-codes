import { tempoSections, type BeatMap } from './grid';

export interface BuildOptions {
  /** 音频总长（秒），节拍表会延伸到这之后 pad 秒。 */
  duration: number;
  /** 节拍表在音频开头之前、结尾之后各多延伸多少秒，默认 12（给预备拍和热身留空间）。 */
  pad?: number;
}

export interface BuiltMap extends BeatMap {
  /** 拟合后拍点残差的均方根（秒），越小说明识别结果越可信。 */
  rms: number;
  /** 被当成多余拍点删掉的个数。 */
  dropped: number;
  /** 补上的漏检拍点个数。 */
  filled: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx };
}

/**
 * 把节拍识别给出的拍点整理成节拍表：
 *
 * 1. 按局部的拍长（前后几拍间隔的中位数）补上漏检的拍、删掉多出来的拍；
 * 2. 检查识别出的变速是不是真的，半速 / 倍速感改回主段落的速度，前奏尾奏这类不可靠的段落按两边补；
 * 3. 每一拍用前后 8 拍做局部线性拟合，按速度切段，接近匀速的段落拉成直线；
 * 4. 往两头按边上 16 拍的中位拍长延伸，覆盖整首歌和前后留白。
 */
export function buildBeatMap(ticks: readonly number[], options: BuildOptions): BuiltMap {
  const pad = options.pad ?? 12;
  let raw = [...ticks].filter(Number.isFinite).sort((a, b) => a - b);
  if (raw.length < 4) throw new Error('拍点太少，没法整理成节拍表');

  // 1. 局部拍长
  const localPeriod = (arr: number[], i: number) => {
    const iois: number[] = [];
    for (let j = Math.max(1, i - 6); j <= Math.min(arr.length - 1, i + 6); j++) iois.push(arr[j]! - arr[j - 1]!);
    return median(iois);
  };

  // 两个拍点挨得太近时，保留离「上一拍 + 一拍」更近的那个
  let dropped = 0;
  const cleaned: number[] = [raw[0]!];
  for (let i = 1; i < raw.length; i++) {
    const p = localPeriod(raw, i);
    const last = cleaned[cleaned.length - 1]!;
    if (raw[i]! - last >= 0.55 * p) {
      cleaned.push(raw[i]!);
      continue;
    }
    dropped++;
    const anchor = cleaned.length >= 2 ? cleaned[cleaned.length - 2]! + p : raw[i + 1] !== undefined ? raw[i + 1]! - p : last;
    if (Math.abs(raw[i]! - anchor) < Math.abs(last - anchor)) cleaned[cleaned.length - 1] = raw[i]!;
  }
  raw = cleaned;

  // 按局部拍长补上漏检的拍
  let filled = 0;
  const fill = (ticksIn: number[]) => {
    const out: number[] = [ticksIn[0]!];
    for (let i = 1; i < ticksIn.length; i++) {
      const p = localPeriod(ticksIn, i);
      const gap = ticksIn[i]! - out[out.length - 1]!;
      const k = Math.round(gap / p);
      for (let j = 1; j < k; j++) {
        out.push(out[out.length - 1]! + gap / k);
        filled++;
      }
      out.push(ticksIn[i]!);
    }
    return out;
  };
  let full = fill(raw);

  // 局部线性拟合
  const smoothOf = (arr: number[]) =>
    arr.map((_, i) => {
      const a = Math.max(0, i - 8);
      const b = Math.min(arr.length, i + 9);
      const xs: number[] = [];
      for (let k = a; k < b; k++) xs.push(k);
      const { slope, intercept } = linearFit(xs, arr.slice(a, b));
      return intercept + slope * i;
    });

  // 2. 检查变速是不是真的。真正的中途变速很少见，要证据足够才认：
  //    - 和主段落差两倍、一半：多半是识别把这段当成了半速或倍速感，按主段落的速度改回来；
  //    - 太短（少于 32 拍或 12 秒）、在开头结尾（前奏、尾奏、延音、淡出）且不够长、或者差 1.5 倍：
  //      当作识别不可靠，丢掉这段的拍点，按两边的速度补。
  const near = (r: number, x: number) => Math.abs(r / x - 1) < 0.06;
  let smooth = smoothOf(full);
  for (let pass = 0; pass < 3; pass++) {
    const sections = tempoSections({ times: smooth }, 0.03, 12);
    if (sections.length <= 1) break;
    const main = sections.reduce((a, b) => (b.endBeat - b.startBeat > a.endBeat - a.startBeat ? b : a));
    const next = [...full];
    const removed = new Set<number>();
    const inserted: number[] = [];
    let changed = false;
    for (const sec of sections) {
      if (sec === main) continue;
      const ratio = sec.bpm / main.bpm;
      const beats = sec.endBeat - sec.startBeat;
      const seconds = sec.endTime - sec.startTime;
      const atEdge = sec.startBeat === 0 || sec.endBeat >= full.length - 1;
      if (near(ratio, 2)) {
        for (let i = sec.startBeat + 1; i < sec.endBeat; i += 2) removed.add(i);
        changed = true;
      } else if (near(ratio, 0.5)) {
        for (let i = sec.startBeat; i < sec.endBeat; i++) inserted.push((full[i]! + full[i + 1]!) / 2);
        changed = true;
      } else if (beats < 32 || seconds < 12 || (atEdge && beats < 64) || near(ratio, 1.5) || near(ratio, 2 / 3)) {
        const a = atEdge && sec.startBeat === 0 ? 0 : sec.startBeat + 1;
        const b = atEdge && sec.endBeat >= full.length - 1 ? full.length : sec.endBeat;
        for (let i = a; i < b; i++) removed.add(i);
        changed = true;
      }
    }
    if (!changed) break;
    const kept = next.filter((_, i) => !removed.has(i)).concat(inserted).sort((a, b) => a - b);
    if (kept.length < 8) break;
    full = fill(kept);
    smooth = smoothOf(full);
  }
  const idx = full.map((_, i) => i);

  // 3. 分段，每段接近匀速就拉直
  const sections = tempoSections({ times: smooth }, 0.03, 12);
  const times = [...smooth];
  for (const s of sections) {
    let xs = idx.slice(s.startBeat, s.endBeat + 1);
    let ys = full.slice(s.startBeat, s.endBeat + 1);
    const n = xs.length;
    // 剔除离群点（停顿里补出来的拍子、识别错的拍子）再拟合一次
    let fit = linearFit(xs, ys);
    for (let iter = 0; iter < 2; iter++) {
      const keep = xs.map((x, k) => Math.abs(ys[k]! - (fit.intercept + fit.slope * x)) < 0.04);
      const kx = xs.filter((_, k) => keep[k]);
      if (kx.length < 0.8 * n) break;
      ys = ys.filter((_, k) => keep[k]);
      xs = kx;
      fit = linearFit(xs, ys);
    }
    const resid = xs.map((x, k) => ys[k]! - (fit.intercept + fit.slope * x));
    const rms = Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / resid.length);
    if (rms < 0.02) for (let x = s.startBeat; x <= s.endBeat; x++) times[x] = fit.intercept + fit.slope * x;
  }
  // 段与段交界处保证递增
  for (let i = 1; i < times.length; i++) if (times[i]! <= times[i - 1]!) times[i] = times[i - 1]! + 0.05;

  const resid = full.map((t, i) => t - times[i]!);
  const rms = Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / resid.length);

  // 4. 往两头延伸，拍长取两头各 16 拍的中位数，不被最后一两拍的抖动带偏
  const intervals = times.slice(1).map((t, i) => t - times[i]!);
  const p0 = median(intervals.slice(0, 16));
  const p1 = median(intervals.slice(-16));
  while (times[0]! > -pad) times.unshift(times[0]! - p0);
  while (times[times.length - 1]! < options.duration + pad) times.push(times[times.length - 1]! + p1);

  return { times, rms, dropped, filled };
}
