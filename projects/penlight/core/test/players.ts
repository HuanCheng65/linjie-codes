/**
 * 模拟玩家，用来检验判定规则：跟着节奏的人不管怎么打都要拿高分，乱挥的人要拿低分。
 * 每个玩家输出一串带方向的挥动（dir 0 = 下挥到位，dir 1 = 回程到位）。
 */
import { type Chart } from '../src/chart';
import { beatPeriod, beatTime } from '../src/grid';
import type { SwingDirection } from '../src/detector';
import { TEST_TRACK_CHART } from '../src/presets';

export interface Hit {
  t: number;
  dir: SwingDirection;
}

export type Player = (c: Chart, rnd: Rng) => Hit[];

export class Rng {
  constructor(private seed: number) {}
  next(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  gauss(): number {
    return Math.sqrt(-2 * Math.log(this.next() + 1e-12)) * Math.cos(2 * Math.PI * this.next());
  }
}

export function chartAt(bpm: number): Chart {
  if (bpm === 160) return TEST_TRACK_CHART;
  const p = 60 / bpm;
  const endBeat = Math.floor(44 / p);
  return { ...TEST_TRACK_CHART, grid: { bpm, firstBeat: 0.6 }, endBeat, playUntil: 0.6 + (endBeat + 2) * p };
}

const bt = (c: Chart, b: number) => beatTime(c.grid, b);
const beats = (c: Chart, step = 1) => {
  const out: number[] = [];
  for (let b = c.startBeat; b <= c.endBeat; b += step) out.push(b);
  return out;
};
const sorted = (hs: Hit[]) => hs.sort((a, b) => a.t - b.t);

/** 来回挥：下挥到位落在 at 上，回程在两次下挥之间比较随意的位置。 */
function backAndForth(downs: number[], rnd: Rng, jitter: number, offset: number): Hit[] {
  const out: Hit[] = [];
  downs.forEach((t, i) => {
    out.push({ t: t + offset + rnd.gauss() * jitter, dir: 0 });
    const next = downs[i + 1];
    if (next !== undefined) out.push({ t: t + (next - t) * rnd.range(0.4, 0.65), dir: 1 });
  });
  return out;
}

export const players: Record<string, Player> = {
  新手每拍: (c, r) => backAndForth(beats(c).filter(() => r.next() > 0.05).map((b) => bt(c, b)), r, 0.03, 0.05),
  新手每两拍: (c, r) => backAndForth(beats(c, 2).map((b) => bt(c, b)), r, 0.03, 0.06),
  每小节一下: (c, r) => backAndForth(beats(c, 4).map((b) => bt(c, b)), r, 0.03, 0.04),
  点屏幕每拍: (c, r) => beats(c).map((b) => ({ t: bt(c, b) + 0.03 + r.gauss() * 0.025, dir: 0 as const })),
  /** 前段每拍，中段加速到半拍一个来回，后段放慢到两拍，另有 8% 与节奏无关的花样动作。 */
  会打的: (c, r) => {
    const p = beatPeriod(c.grid);
    const out: Hit[] = [];
    const n = c.endBeat - c.startBeat;
    for (const b of beats(c)) {
      const k = (b - c.startBeat) / n;
      const t0 = bt(c, b) + 0.04;
      const j = () => r.gauss() * 0.025;
      if (k < 0.35) {
        out.push({ t: t0 + j(), dir: 0 }, { t: t0 + p * r.range(0.4, 0.6), dir: 1 });
      } else if (k < 0.7) {
        out.push({ t: t0 + j(), dir: 0 }, { t: t0 + p / 4 + j() * 2, dir: 1 });
        out.push({ t: t0 + p / 2 + j(), dir: 0 }, { t: t0 + (3 * p) / 4 + j() * 2, dir: 1 });
      } else if ((b - c.startBeat) % 2 === 0) {
        out.push({ t: t0 + j(), dir: 0 }, { t: t0 + p * r.range(0.8, 1.2), dir: 1 });
      }
      if (r.next() < 0.08) {
        const x = t0 + r.next() * p;
        out.push({ t: x, dir: 0 }, { t: x + 0.12, dir: 1 });
      }
    }
    return sorted(out);
  },
  乱挥慢: (c, r) => flail(c, r, 0.25, 0.6),
  乱挥快: (c, r) => flail(c, r, 0.16, 0.32),
  很稳但快7: (c, r) => {
    const p = beatPeriod(c.grid) / 1.07;
    const downs: number[] = [];
    for (let t = bt(c, c.startBeat); t < bt(c, c.endBeat); t += p) downs.push(t);
    return backAndForth(downs, r, 0.02, 0);
  },
  打一半不打了: (c, r) => {
    const mid = (c.startBeat + c.endBeat) / 2;
    return backAndForth(beats(c).filter((b) => b < mid).map((b) => bt(c, b)), r, 0.03, 0.05);
  },
};

function flail(c: Chart, r: Rng, lo: number, hi: number): Hit[] {
  const out: Hit[] = [];
  let t = bt(c, c.startBeat) - 0.3;
  let dir: SwingDirection = 0;
  while (t < bt(c, c.endBeat)) {
    out.push({ t, dir });
    dir = dir === 0 ? 1 : 0;
    t += r.range(lo, hi);
  }
  return out;
}
