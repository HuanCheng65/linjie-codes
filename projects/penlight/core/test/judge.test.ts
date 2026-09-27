import { describe, expect, it } from 'vitest';
import { chartFromSegment, type Chart } from '../src/chart';
import { beatTime } from '../src/grid';
import { Judge, hitScore, median } from '../src/judge';
import { TEST_TRACK_CHART } from '../src/presets';

const chart: Chart = TEST_TRACK_CHART;
const grid = chart.grid;
const beat = (i: number) => beatTime(grid, i);

function play(judge: Judge, times: number[]) {
  for (const t of times) {
    judge.tick(t);
    judge.swing(t);
  }
  return judge.result();
}

function range(from: number, to: number, step = 1) {
  const out: number[] = [];
  for (let i = from; i <= to; i += step) out.push(i);
  return out;
}

describe('Judge', () => {
  it('uses W = min(100 ms, 0.25 beat)', () => {
    expect(new Judge(chart).window).toBeCloseTo(0.09375, 9);
    const slow = { ...chart, grid: { bpm: 90, firstBeat: 0.6 } };
    expect(new Judge(slow).window).toBeCloseTo(0.1, 9);
  });

  it('gives a perfect score to a perfectly steady player with a personal lag', () => {
    const lag = 0.045;
    const r = play(new Judge(chart), range(4, 116).map((i) => beat(i) + lag));
    expect(r.offsetMs).toBeCloseTo(45, 6);
    expect(r.style).toBe('every');
    expect(r.hits).toBe(105);
    expect(r.expected).toBe(105);
    expect(r.extras).toBe(0);
    expect(r.score).toBeCloseTo(100, 6);
    expect(r.meanAbsDeviationMs).toBeCloseTo(0, 6);
  });

  it('takes the median of calibration swings within ±0.3 beat', () => {
    const judge = new Judge(chart);
    const deltas = [0.02, 0.03, 0.04, 0.2 /* 超过 0.3 拍，不采用 */, 0.05, -0.18 /* 超过 */];
    deltas.forEach((d, k) => judge.swing(beat(4 + k) + d));
    judge.tick(beat(12));
    expect(judge.offset).toBeCloseTo(median([0.02, 0.03, 0.04, 0.05]), 9);
    expect(judge.calibrationFallback).toBe(false);
  });

  it('falls back to zero offset with fewer than 3 calibration swings', () => {
    const judge = new Judge(chart);
    judge.swing(beat(5) + 0.05);
    judge.swing(beat(7) + 0.05);
    const r = play(judge, range(12, 116).map((i) => beat(i) + 0.05));
    expect(r.calibrationFallback).toBe(true);
    expect(r.offsetMs).toBe(0);
    expect(r.hits).toBe(105);
    expect(r.accuracy).toBeCloseTo(hitScore(0.05, 0.09375), 9);
  });

  it('counts a second swing within the window of the same beat as extra', () => {
    const times = range(4, 116).flatMap((i) => (i === 40 ? [beat(i) - 0.04, beat(i) + 0.05] : [beat(i)]));
    const r = play(new Judge(chart), times);
    expect(r.hits).toBe(105);
    expect(r.extras).toBe(1);
    expect(r.extrasFactor).toBeCloseTo(1 - 0.5 / 105, 9);
  });

  it('forgives one return swing between beats but penalises the second', () => {
    const p = 60 / 160;
    const once = play(new Judge(chart), range(4, 116).flatMap((i) => [beat(i), beat(i) + p / 2]));
    expect(once.extras).toBe(0);
    expect(once.score).toBeCloseTo(100, 6);

    const twice = play(
      new Judge(chart),
      range(4, 116).flatMap((i) => (i === 50 ? [beat(i), beat(i) + p * 0.4, beat(i) + p * 0.62] : [beat(i)])),
    );
    expect(twice.extras).toBe(1);
  });

  it('recognises swinging every other beat', () => {
    const calibration = range(4, 11).map(beat);
    const halfTime = range(12, 116, 2).map(beat);
    const r = play(new Judge(chart), [...calibration, ...halfTime]);
    expect(r.style).toBe('half');
    expect(r.expected).toBe(53);
    expect(r.hits).toBe(53);
    expect(r.score).toBeCloseTo(100, 6);
  });

  it('does not call a sloppy every-beat player "half"', () => {
    // 覆盖率低但奇偶拍平均分布
    const times = range(4, 116).filter((i) => i < 12 || i % 3 === 0).map(beat);
    const r = play(new Judge(chart), times);
    expect(r.style).toBe('every');
    expect(r.coverage).toBeCloseTo(r.hits / 105, 9);
  });

  it('floors the extras factor at 0.5', () => {
    const p = 60 / 160;
    const spam = range(4, 116).flatMap((i) => [beat(i), beat(i) + p * 0.3, beat(i) + p * 0.55, beat(i) + p * 0.8]);
    const r = play(new Judge(chart), spam);
    expect(r.extrasFactor).toBe(0.5);
  });

  it('reports stability over the last 8 counted swings', () => {
    const judge = new Judge(chart);
    range(4, 11).forEach((i) => judge.swing(beat(i)));
    expect(judge.stability()).toBeNull();
    range(12, 19).forEach((i) => {
      judge.tick(beat(i));
      judge.swing(beat(i));
    });
    expect(judge.stability()).toBeCloseTo(1, 9);
    judge.swing(beat(19) + 0.02);
    expect(judge.stability()).toBeCloseTo(7 / 8, 9);
  });

  it('ignores swings before calibration and after the last beat', () => {
    const judge = new Judge(chart);
    expect(judge.swing(beat(1)).kind).toBe('ignored');
    range(4, 116).forEach((i) => judge.swing(beat(i)));
    expect(judge.swing(beat(118)).kind).toBe('ignored');
    expect(judge.result().extras).toBe(0);
  });
});

describe('chartFromSegment', () => {
  it('leaves a count-in before calibration and colours sections every 16 beats', () => {
    const g = { bpm: 120, firstBeat: 0.25 };
    const c = chartFromSegment({ grid: g, from: 30, length: 60, duration: 200 });
    expect(beatTime(g, c.startBeat)).toBeGreaterThanOrEqual(30 + 0.5 + 4 * 0.5);
    expect(beatTime(g, c.endBeat)).toBeLessThanOrEqual(90);
    expect(c.sections[0]!.color).toBe('teal');
    expect(c.sections[1]!.beat).toBe(c.startBeat + 8);
    expect(c.sections[2]!.beat - c.sections[1]!.beat).toBe(16);
    expect(c.playUntil).toBeLessThanOrEqual(91);
  });
});
