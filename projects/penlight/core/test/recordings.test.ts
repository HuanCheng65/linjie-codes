import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { beatPosition, normalizeChart, replay, type Recording } from '../src/index';

const load = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', 'recordings', name), 'utf8')) as Recording;

/** 真机录制：Android + Edge，110 BPM，正常每拍挥（下挥有力、回程较慢）。 */
describe('真机录制 android-edge-110bpm-normal', () => {
  const rec = load('android-edge-110bpm-normal.json');
  const chart = normalizeChart(rec.chart);

  it('陀螺仪：每一拍恰好检测到一次下挥，得分在 90 以上', () => {
    const r = replay(rec);
    expect(r.source).toBe('gyro');
    const downs = r.swings.filter((s) => s.dir === 0);
    const perBeat = new Map<number, number>();
    for (const s of downs) {
      const b = Math.round(beatPosition(chart.grid, s.t) - 0.065);
      perBeat.set(b, (perBeat.get(b) ?? 0) + 1);
    }
    for (let b = chart.startBeat; b <= chart.endBeat; b++) expect(perBeat.get(b)).toBe(1);
    expect(r.result.score).toBeGreaterThan(90);
    expect(r.result.strays).toBe(0);
  });

  it('灵敏度 2–5 档结果一致，说明门槛离实际力度有足够余量', () => {
    const scores = [2, 3, 4, 5].map((s) => replay(rec, { sensitivity: s }).result.score);
    for (const s of scores) expect(s).toBeCloseTo(scores[0]!, 0);
  });

  it('去掉陀螺仪后，用加速度也能得到接近的分数', () => {
    const noGyro: Recording = { ...rec, frames: rec.frames.map((f) => [...f.slice(0, 8), null, null, null]) };
    const r = replay(noGyro);
    expect(r.source).toBe('accel');
    expect(r.result.score).toBeGreaterThan(88);
  });
});
