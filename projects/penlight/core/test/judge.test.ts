import { describe, expect, it } from 'vitest';
import { chartFromSegment } from '../src/chart';
import { beatTime } from '../src/grid';
import { Judge, hitScore } from '../src/judge';
import { TEST_TRACK_CHART } from '../src/presets';
import { chartAt, players, Rng, type Player } from './players';

function play(bpm: number, player: Player, seed: number) {
  const chart = chartAt(bpm);
  const judge = new Judge(chart);
  for (const h of player(chart, new Rng(seed))) judge.swing(h.t, h.dir);
  return judge.result();
}

function average(bpm: number, name: string, runs = 12) {
  let s = 0;
  for (let i = 0; i < runs; i++) s += play(bpm, players[name]!, 1000 + i * 7919).score;
  return s / runs;
}

describe.each([90, 120, 160, 190])('%i BPM 下的各类玩家', (bpm) => {
  const scores = Object.fromEntries(Object.keys(players).map((name) => [name, average(bpm, name)]));

  it('跟着节奏的人都能拿高分', () => {
    expect(scores['新手每拍']).toBeGreaterThan(75);
    expect(scores['新手每两拍']).toBeGreaterThan(75);
    expect(scores['点屏幕每拍']).toBeGreaterThan(75);
    expect(scores['会打的']).toBeGreaterThan(72);
  });

  it('会打的人不会因为加速、放慢、做花样而明显吃亏', () => {
    expect(scores['会打的']!).toBeGreaterThan(scores['新手每拍']! - 10);
  });

  it('乱挥拿不到分', () => {
    expect(scores['乱挥慢']).toBeLessThan(15);
    expect(scores['乱挥快']).toBeLessThan(15);
  });

  it('稳但速度不对的也拿不到高分', () => {
    expect(scores['很稳但快7']).toBeLessThan(35);
  });

  it('一小节一下和中途停下都只有部分分', () => {
    expect(scores['每小节一下']).toBeGreaterThan(30);
    expect(scores['每小节一下']).toBeLessThan(60);
    expect(scores['打一半不打了']).toBeGreaterThan(30);
    expect(scores['打一半不打了']).toBeLessThan(60);
  });
});

describe('Judge 细节', () => {
  const chart = TEST_TRACK_CHART;
  const beat = (i: number) => beatTime(chart.grid, i);

  it('W = min(100 ms, 0.25 拍)', () => {
    expect(new Judge(chart).window).toBeCloseTo(0.09375, 9);
    expect(new Judge(chartAt(90)).window).toBeCloseTo(0.1, 9);
  });

  it('完美的每拍一下得满分，习惯性偏晚不扣分', () => {
    const judge = new Judge(chart);
    for (let b = chart.startBeat; b <= chart.endBeat; b++) judge.swing(beat(b) + 0.07, 0);
    const r = judge.result();
    expect(r.score).toBeCloseTo(100, 6);
    expect(r.offsetMs).toBeCloseTo(70, 3);
    expect(r.meanAbsDeviationMs).toBeCloseTo(0, 3);
    expect(r.timeline.every((d) => d === 'beat')).toBe(true);
  });

  it('热身段不计分，结束后给出偏移估计', () => {
    const judge = new Judge(chart);
    for (let b = chart.startBeat; b < chart.startBeat + 8; b++) {
      expect(judge.swing(beat(b) + 0.03, 0).kind).toBe('warmup');
    }
    expect(judge.warmupOffset()! * 1000).toBeCloseTo(30, 3);
    expect(judge.warmupBeatSlots.size).toBe(8);
  });

  it('热身段挥得太少时没有偏移估计', () => {
    const judge = new Judge(chart);
    judge.swing(beat(chart.startBeat), 0);
    expect(judge.warmupOffset()).toBeNull();
  });

  it('实时稳定度看最近 8 下', () => {
    const judge = new Judge(chart);
    for (let b = chart.startBeat; b < chart.startBeat + 20; b++) judge.swing(beat(b), 0);
    expect(judge.stability()).toBeCloseTo(1, 6);
  });

  it('热身开始前和结束后的挥动被忽略', () => {
    const judge = new Judge(chart);
    expect(judge.swing(beat(0), 0).kind).toBe('ignored');
    expect(judge.swing(beat(chart.endBeat + 3), 0).kind).toBe('ignored');
  });

  it('命中得分曲线', () => {
    expect(hitScore(0, 0.1)).toBe(1);
    expect(hitScore(0.1, 0.1)).toBe(0);
    expect(hitScore(0.05, 0.1)).toBeCloseTo(1 - 0.5 ** 1.5, 9);
  });
});

describe('chartFromSegment', () => {
  it('留出预备拍，之后每 16 拍换一次颜色', () => {
    const g = { bpm: 120, firstBeat: 0.25 };
    const c = chartFromSegment({ grid: g, from: 30, length: 60, duration: 200 });
    expect(beatTime(g, c.startBeat)).toBeGreaterThanOrEqual(30 + 0.5 + 4 * 0.5);
    expect(beatTime(g, c.endBeat)).toBeLessThanOrEqual(90);
    expect(c.sections[0]!.color).toBe('teal');
    expect(c.sections[1]!.beat).toBe(c.startBeat + 8);
    expect(c.sections[2]!.beat - c.sections[1]!.beat).toBe(16);
  });
});

describe('热身偏移', () => {
  it('热身挥得很散时不给偏移估计', () => {
    const chart = TEST_TRACK_CHART;
    const judge = new Judge(chart);
    const r = new Rng(5);
    for (let b = chart.startBeat; b < chart.startBeat + 8; b++) judge.swing(beatTime(chart.grid, b) + r.next() * 0.375, 0);
    expect(judge.warmupOffset()).toBeNull();
  });
});
