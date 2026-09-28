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

/** 对 (x, y) 做二次拟合，返回 x = 0 处的值。点太少或矩阵退化时退回直线拟合。 */
function quadraticAt0(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 5) {
    return linearFit(xs, ys).intercept;
  }
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    const x2 = x * x;
    s0 += 1;
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    t0 += y;
    t1 += x * y;
    t2 += x2 * y;
  }
  // 解 [s0 s1 s2; s1 s2 s3; s2 s3 s4] [c b a]ᵀ = [t0 t1 t2]ᵀ，只需要常数项 c
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (Math.abs(det) < 1e-9) return linearFit(xs, ys).intercept;
  const detC = t0 * (s2 * s4 - s3 * s3) - s1 * (t1 * s4 - s3 * t2) + s2 * (t1 * s3 - s2 * t2);
  return detC / det;
}

/**
 * 把节拍识别给出的拍点整理成节拍表：
 *
 * 1. 按局部的拍长（前后几拍间隔的中位数）补上漏检的拍、删掉多出来的拍；
 * 2. 检查识别出的变速是不是真的：半速 / 倍速感改回主段落的速度；拍点又稀又乱的可疑段落按两边补，
 *    拍点规律的（比如结尾真的渐慢）保留；
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

  // 按局部拍长补上漏检的拍。real 标记这一拍是识别出来的还是补出来的
  let filled = 0;
  const fill = (ticksIn: { t: number; real: boolean }[]) => {
    const ts = ticksIn.map((x) => x.t);
    const out: { t: number; real: boolean }[] = [ticksIn[0]!];
    for (let i = 1; i < ticksIn.length; i++) {
      const p = localPeriod(ts, i);
      const prev = out[out.length - 1]!.t;
      const gap = ticksIn[i]!.t - prev;
      const k = Math.round(gap / p);
      for (let j = 1; j < k; j++) {
        out.push({ t: prev + (gap * j) / k, real: false });
        filled++;
      }
      out.push(ticksIn[i]!);
    }
    return out;
  };
  let beats = fill(raw.map((t) => ({ t, real: true })));

  // 局部二次拟合：去掉抖动，同时跟得上渐快渐慢（直线拟合在速度变化大的地方会偏一两百毫秒）
  const smoothOf = (arr: number[]) =>
    arr.map((_, i) => {
      const a = Math.max(0, i - 8);
      const b = Math.min(arr.length, i + 9);
      const xs: number[] = [];
      for (let k = a; k < b; k++) xs.push(k - i);
      return quadraticAt0(xs, arr.slice(a, b));
    });

  /**
   * 一段拍点靠不靠谱：补出来的拍不到四分之一，而且相邻真实拍点的间隔变化平缓
   * （和前后几拍的间隔相比，偏差的中位数不到 8%）。渐快渐慢的拍点间隔是慢慢变的，也算靠谱。
   */
  const reliable = (from: number, to: number) => {
    const seg = beats.slice(from, to + 1);
    const realCount = seg.filter((b) => b.real).length;
    if (realCount < 0.75 * seg.length || realCount < 6) return false;
    const iois: number[] = [];
    for (let i = from + 1; i <= to; i++) if (beats[i]!.real && beats[i - 1]!.real) iois.push(beats[i]!.t - beats[i - 1]!.t);
    if (iois.length < 5) return false;
    const dev = iois.map((x, i) => {
      const around = median(iois.slice(Math.max(0, i - 3), i + 4));
      return Math.abs(x / around - 1);
    });
    return median(dev) < 0.08;
  };

  // 2. 检查变速是不是真的：
  //    - 和主段落差两倍、一半：多半是识别把这段当成了半速或倍速感，按主段落的速度改回来；
  //    - 太短（少于 32 拍或 12 秒）、在开头结尾且不够长、或者差 1.5 倍，并且拍点不靠谱
  //      （稀、乱、大多是补出来的）：丢掉这段的拍点，按两边的速度补。
  //      拍点规律的段落保留，比如抒情歌结尾真的渐慢。
  const near = (r: number, x: number) => Math.abs(r / x - 1) < 0.06;
  // 倍速 / 半速段落的平均速度常被交界处的乱拍点带偏，容差放宽一些
  const octave = (r: number, x: number) => Math.abs(r / x - 1) < 0.1;
  let smooth = smoothOf(beats.map((b) => b.t));
  for (let pass = 0; pass < 3; pass++) {
    const sections = tempoSections({ times: smooth }, 0.03, 12);
    if (sections.length <= 1) break;
    const main = sections.reduce((a, b) => (b.endBeat - b.startBeat > a.endBeat - a.startBeat ? b : a));
    const removed = new Set<number>();
    const inserted: { t: number; real: boolean }[] = [];
    let changed = false;
    for (const sec of sections) {
      if (sec === main) continue;
      const ratio = sec.bpm / main.bpm;
      const n = sec.endBeat - sec.startBeat;
      const seconds = sec.endTime - sec.startTime;
      const atStart = sec.startBeat === 0;
      const atEnd = sec.endBeat >= beats.length - 1;
      const p = 60 / main.bpm;
      // 段落边界是从平滑曲线估计的，比实际窄一点：往两边扩展到间隔不再是半拍 / 两拍为止
      const gapAt = (i: number) => beats[i]!.t - beats[i - 1]!.t;
      let lo = sec.startBeat;
      let hi = sec.endBeat;
      const inside = (g: number) => (octave(ratio, 2) ? g < 0.7 * p : g > 1.4 * p);
      if (octave(ratio, 2) || octave(ratio, 0.5)) {
        // 先收缩到这段里间隔确实是半拍 / 两拍的核心部分，再往两边扩展
        let first = -1;
        let last = -1;
        for (let i = Math.max(1, sec.startBeat + 1); i <= sec.endBeat; i++) {
          if (!inside(gapAt(i))) continue;
          if (first < 0) first = i - 1;
          last = i;
        }
        if (first < 0) continue;
        lo = first;
        hi = last;
        while (lo > 0 && inside(gapAt(lo))) lo--;
        while (hi < beats.length - 1 && inside(gapAt(hi + 1))) hi++;
      }
      if (octave(ratio, 2)) {
        // 隔一拍删一拍，删哪一组取决于哪组和前后主速度的拍子对得上
        const anchor = lo > 0 ? beats[lo - 1]!.t : beats[Math.min(beats.length - 1, hi + 1)]!.t;
        const miss = (parity: number) => {
          let e = 0;
          for (let i = lo; i <= hi; i++) {
            if ((i - lo) % 2 !== parity) continue;
            const k = (beats[i]!.t - anchor) / p;
            e += Math.abs(k - Math.round(k));
          }
          return e;
        };
        const keep = miss(0) <= miss(1) ? 0 : 1;
        for (let i = lo; i <= hi; i++) if ((i - lo) % 2 !== keep) removed.add(i);
        changed = true;
      } else if (octave(ratio, 0.5)) {
        for (let i = lo; i < hi; i++) if (inside(gapAt(i + 1))) inserted.push({ t: (beats[i]!.t + beats[i + 1]!.t) / 2, real: false });
        changed = true;
      } else {
        const suspicious = n < 32 || seconds < 12 || ((atStart || atEnd) && n < 64) || near(ratio, 1.5) || near(ratio, 2 / 3);
        if (suspicious && !reliable(sec.startBeat, sec.endBeat)) {
          const a = atStart ? 0 : sec.startBeat + 1;
          const b = atEnd ? beats.length : sec.endBeat;
          for (let i = a; i < b; i++) removed.add(i);
          changed = true;
        }
      }
    }
    if (!changed) break;
    const kept = beats
      .filter((_, i) => !removed.has(i))
      .concat(inserted)
      .sort((a, b) => a.t - b.t);
    if (kept.length < 8) break;
    beats = fill(kept);
    smooth = smoothOf(beats.map((b) => b.t));
  }
  const full = beats.map((b) => b.t);
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
    if (rms >= 0.02) continue;
    // 两头连续偏离直线的拍子（比如结尾渐慢）不拉直，保留局部拟合；中间零星的离群点照样拉直
    const off = (x: number) => Math.abs(full[x]! - (fit.intercept + fit.slope * x)) > 0.03;
    let a = s.startBeat;
    while (a < s.endBeat && off(a)) a++;
    let b = s.endBeat;
    while (b > a && off(b)) b--;
    const head = a - s.startBeat >= 4 ? a : s.startBeat;
    const tail = s.endBeat - b >= 4 ? b : s.endBeat;
    for (let x = head; x <= tail; x++) times[x] = fit.intercept + fit.slope * x;
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
