import { describe, expect, it } from 'vitest';
import { GravityFilter, SwingDetector, thresholdForSensitivity } from '../src/detector';

/** 以 60 Hz 采样一段信号：在给定时刻叠加一个宽度约 120 ms 的加速度脉冲。 */
function simulate(peaks: number[], amplitude: number, durationMs: number, noise = 0) {
  const samples: [number, number][] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let t = 0; t < durationMs; t += 1000 / 60) {
    let v = Math.abs(rand()) * noise;
    for (const p of peaks) {
      const x = (t - p) / 45;
      v += amplitude * Math.exp(-x * x);
    }
    samples.push([t, v]);
  }
  return samples;
}

describe('SwingDetector', () => {
  it('maps sensitivity levels to thresholds', () => {
    expect(thresholdForSensitivity(1)).toBe(22);
    expect(thresholdForSensitivity(3)).toBe(13);
    expect(thresholdForSensitivity(5)).toBe(7);
    expect(thresholdForSensitivity(9)).toBe(7);
  });

  it('counts each pulse once and reports the peak time', () => {
    const peaks = Array.from({ length: 20 }, (_, i) => 500 + i * 375);
    const d = new SwingDetector({ threshold: 13 });
    const swings = simulate(peaks, 25, 9000, 3)
      .map(([t, v]) => d.push(t, v))
      .filter((s) => s !== null);
    expect(swings).toHaveLength(20);
    swings.forEach((s, i) => expect(Math.abs(s!.t - peaks[i]!)).toBeLessThan(17));
  });

  it('ignores walking-level motion', () => {
    const steps = Array.from({ length: 16 }, (_, i) => 300 + i * 550);
    const d = new SwingDetector({ threshold: 13 });
    const swings = simulate(steps, 6, 9000, 2)
      .map(([t, v]) => d.push(t, v))
      .filter(Boolean);
    expect(swings).toHaveLength(0);
  });

  it('enforces the minimum interval between swings', () => {
    const d = new SwingDetector({ threshold: 13 });
    const swings = simulate([500, 620], 30, 1500)
      .map(([t, v]) => d.push(t, v))
      .filter(Boolean);
    expect(swings).toHaveLength(1);
  });

  it('does not re-trigger on a sustained plateau', () => {
    const d = new SwingDetector({ threshold: 13 });
    let count = 0;
    for (let t = 0; t < 2000; t += 16) if (d.push(t, 30)) count++;
    expect(count).toBe(1);
  });
});

describe('GravityFilter', () => {
  it('removes a constant gravity vector', () => {
    const f = new GravityFilter();
    let last = 0;
    for (let t = 0; t < 3000; t += 16) last = f.push(t, 0, 9.81, 0.5);
    expect(last).toBeLessThan(0.01);
  });

  it('passes a sharp swing through', () => {
    const f = new GravityFilter();
    for (let t = 0; t < 2000; t += 16) f.push(t, 0, 9.81, 0);
    expect(f.push(2016, 20, 9.81, 0)).toBeGreaterThan(15);
  });
});
