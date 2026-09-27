import { describe, expect, it } from 'vitest';
import { fitBeatGrid } from '../src/fit';
import { doubleGrid, halveGrid, nearestBeat, shiftGrid } from '../src/grid';

function ticks(bpm: number, first: number, count: number, jitter: number, seed = 1) {
  const p = 60 / bpm;
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return Array.from({ length: count }, (_, i) => first + i * p + rand() * jitter);
}

describe('fitBeatGrid', () => {
  it('recovers tempo and phase from jittered ticks', () => {
    const fit = fitBeatGrid(ticks(163.4, 0.412, 240, 0.012), 163);
    expect(fit.bpm).toBeCloseTo(163.4, 1);
    const p = 60 / 163.4;
    const phaseError = Math.abs(((fit.firstBeat - 0.412) % p + p * 1.5) % p - p / 2);
    expect(phaseError).toBeLessThan(0.005);
  });

  it('tolerates missing and spurious ticks', () => {
    const base = ticks(128, 1.03, 190, 0.008, 5);
    const withGaps = base.filter((_, i) => i % 7 !== 3);
    withGaps.push(10.21, 33.37, 51.9);
    const fit = fitBeatGrid(withGaps.sort((a, b) => a - b), 127.2);
    expect(fit.bpm).toBeCloseTo(128, 1);
    expect(Math.abs(nearestBeat(fit, 1.03).delta)).toBeLessThan(0.006);
  });
});

describe('grid helpers', () => {
  const grid = { bpm: 160, firstBeat: 0.2 };

  it('halves and doubles tempo around the first beat', () => {
    expect(halveGrid(grid)).toEqual({ bpm: 80, firstBeat: 0.2 });
    expect(doubleGrid(grid)).toEqual({ bpm: 320, firstBeat: 0.2 });
  });

  it('shifts and wraps the first beat into one period', () => {
    expect(shiftGrid(grid, 0.01).firstBeat).toBeCloseTo(0.21, 9);
    expect(shiftGrid(grid, -0.25).firstBeat).toBeCloseTo(0.325, 9);
  });
});
