import { describe, expect, it } from 'vitest';
import { chartFromSelection } from '../src/chart';
import { beatPosition, beatTime, uniformMap } from '../src/grid';
import { Judge, hitScore } from '../src/judge';
import { TEST_TRACK_CHART } from '../src/presets';
import { chartAt, chartOn, driftMap, players, Rng, tempoChangeMap, type Player } from './players';

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

  it('shuffle 节奏的八分音符也能认出来', () => {
    expect(scores['点屏幕shuffle']).toBeGreaterThan(70);
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

  it('变速的歌：跟着实际拍子挥照样拿高分，乱挥照样拿不到', () => {
    for (const map of [tempoChangeMap(), driftMap()]) {
      const c = chartOn(map);
      let good = 0;
      let bad = 0;
      for (let i = 0; i < 8; i++) {
        for (const [name, acc] of [['新手每拍', 'good'], ['乱挥快', 'bad']] as const) {
          const j = new Judge(c);
          for (const h of players[name]!(c, new Rng(77 + i))) j.swing(h.t, h.dir);
          if (acc === 'good') good += j.result().score / 8;
          else bad += j.result().score / 8;
        }
      }
      expect(good).toBeGreaterThan(75);
      expect(bad).toBeLessThan(15);
    }
  });

  it('没声音的拍子不计入参与度', () => {
    const map = uniformMap(120, 0.6, -12, 60);
    const b0 = Math.round(beatPosition(map, 0.6));
    const restBeats: number[] = [];
    for (let b = b0 + 40; b < b0 + 56; b++) restBeats.push(b);
    const c = chartOn(map, { restBeats });
    const j = new Judge(c);
    for (let b = c.startBeat; b <= c.endBeat; b++) if (!restBeats.includes(b)) j.swing(beatTime(map, b), 0);
    expect(j.result().participation).toBeCloseTo(1, 6);
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

describe('chartFromSelection', () => {
  const map = uniformMap(120, 0.25, -12, 212);

  it('预备和热身放在选段开头之前，选中的部分全部计分', () => {
    const c = chartFromSelection({ map, start: 30.25, end: 90.25, duration: 200 });
    const j = new Judge(c);
    expect(beatTime(map, j.playStart)).toBeCloseTo(30.25, 6);
    expect(beatTime(map, c.startBeat)).toBeCloseTo(30.25 - 8 * 0.5, 6);
    expect(c.playFrom).toBeLessThan(beatTime(map, c.startBeat - 4));
    expect(beatTime(map, c.endBeat)).toBeCloseTo(90.25, 6);
    expect(c.playUntil).toBeCloseTo(90.25 + 1.2, 6);
    expect(c.fadeOut).toBeCloseTo(1, 6);
    expect(c.clickBeats).toEqual([]);
  });

  it('开头太靠前时，音频之前的预备拍用节拍器补上', () => {
    const c = chartFromSelection({ map, start: 2.25, end: 60.25, duration: 200 });
    expect(c.playFrom).toBeLessThan(0);
    expect(c.clickBeats!.length).toBeGreaterThan(0);
    for (const b of c.clickBeats!) expect(beatTime(map, b)).toBeLessThan(0.15);
  });

  it('选到歌曲结尾时播放到结尾', () => {
    const c = chartFromSelection({ map, start: 150.25, end: 200, duration: 200 });
    expect(c.playUntil).toBe(200);
    expect(beatTime(map, c.endBeat)).toBeLessThanOrEqual(199.7);
  });

  it('段落交界换颜色，热身是青色', () => {
    const c = chartFromSelection({ map, start: 30.25, end: 90.25, duration: 200 });
    expect(c.sections[0]!.color).toBe('teal');
    expect(c.sections[1]!.beat).toBe(c.startBeat + 8);
    expect(c.sections[2]!.beat - c.sections[1]!.beat).toBe(16);
  });
});
