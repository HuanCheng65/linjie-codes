import { describe, expect, it } from 'vitest';
import { buildBeatMap } from '../src/fit';
import { beatPosition, beatTime, isBarLine, nearestBar, rescaleRange, shiftMap, tempoSections, uniformMap } from '../src/grid';

function jittered(times: number[], jitter: number, seed = 1) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return times.map((t) => t + rand() * jitter);
}

const uniform = (bpm: number, first: number, n: number) => Array.from({ length: n }, (_, i) => first + (i * 60) / bpm);

describe('buildBeatMap', () => {
  it('恒定速度：拍点被拉直，误差很小', () => {
    const truth = uniform(163.4, 0.412, 240);
    const m = buildBeatMap(jittered(truth, 0.012), { duration: 90 });
    for (const t of truth.slice(5, -5)) {
      const pos = beatPosition(m, t);
      expect(Math.abs(pos - Math.round(pos)) * (60 / 163.4)).toBeLessThan(0.006);
    }
    expect(tempoSections(m)).toHaveLength(1);
  });

  it('补上漏检、删掉多余的拍点', () => {
    const truth = uniform(128, 1.03, 190);
    const ticks = jittered(truth, 0.008, 5).filter((_, i) => i % 7 !== 3);
    ticks.push(10.21, 33.37, 51.9);
    const m = buildBeatMap(ticks.sort((a, b) => a - b), { duration: 90 });
    expect(m.filled).toBeGreaterThan(20);
    expect(m.dropped).toBe(3);
    for (const t of truth.slice(5, -5)) {
      const pos = beatPosition(m, t);
      expect(Math.abs(pos - Math.round(pos)) * (60 / 128)).toBeLessThan(0.015);
    }
  });

  it('中途提速：切成两段，两段都对得上', () => {
    const a = uniform(128, 0.5, 100);
    const last = a[a.length - 1]!;
    const b = uniform(140, last + 60 / 140, 120);
    const m = buildBeatMap(jittered([...a, ...b], 0.006, 9), { duration: 110 });
    const sections = tempoSections(m).filter((s) => s.endTime > 0 && s.startTime < 110);
    expect(sections.length).toBe(2);
    expect(sections[0]!.bpm).toBeCloseTo(128, 0);
    expect(sections[1]!.bpm).toBeCloseTo(140, 0);
    for (const t of [...a.slice(10, -10), ...b.slice(10, -10)]) {
      const pos = beatPosition(m, t);
      const p = beatTime(m, Math.round(pos) + 1) - beatTime(m, Math.round(pos));
      expect(Math.abs(pos - Math.round(pos)) * p).toBeLessThan(0.012);
    }
  });

  it('停顿里识别乱了也不会多切出一段变速', () => {
    const a = uniform(128, 0.5, 100);
    const last = a[a.length - 1]!;
    const b = uniform(140, last + 60 / 140, 140);
    // 提速后 20 拍的地方停顿 3.5 秒：这段时间没有拍点，只有几个乱七八糟的
    const gapStart = b[20]!;
    const ticks = [...a, ...b.filter((t) => t < gapStart || t > gapStart + 3.5), gapStart + 0.9, gapStart + 1.7, gapStart + 2.2];
    const m = buildBeatMap(jittered(ticks.sort((x, y) => x - y), 0.006, 4), { duration: 120 });
    const sections = tempoSections(m).filter((s) => s.endTime > 0 && s.startTime < 120);
    expect(sections.map((s) => Math.round(s.bpm))).toEqual([128, 140]);
    for (const t of b.slice(30, -10)) {
      const pos = beatPosition(m, t);
      expect(Math.abs(pos - Math.round(pos)) * (60 / 140)).toBeLessThan(0.012);
    }
  });

  it('尾奏拍点又稀又乱时不算变速，结尾按主段落的速度延伸', () => {
    const main = uniform(166, 0.4, 740); // 约 4 分 27 秒
    const last = main[main.length - 1]!;
    // 尾奏 20 秒：延音、淡出，识别只给出几个间隔很大的拍点
    const outro: number[] = [];
    for (let t = last + 1.1; t < last + 20; t += 1.0 + ((outro.length * 37) % 7) / 10) outro.push(t);
    const m = buildBeatMap(jittered([...main, ...outro], 0.006, 12), { duration: last + 21 });
    const sections = tempoSections(m).filter((x) => x.endTime > 0 && x.startTime < last + 21);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.bpm).toBeCloseTo(166, 0);
    const p = 60 / 166;
    const pos = beatPosition(m, last + 10 * p);
    expect(Math.abs(pos - Math.round(pos)) * p).toBeLessThan(0.01);
  });

  it('抒情歌结尾真的渐慢：拍点规律，保留下来', () => {
    const times: number[] = [];
    let t = 0.4;
    for (let i = 0; i < 360; i++) {
      times.push(t);
      t += 60 / 83;
    }
    // 最后 16 拍从 83 慢慢放慢到 55
    for (let i = 0; i < 16; i++) {
      times.push(t);
      t += 60 / (83 - (28 * (i + 1)) / 16);
    }
    const m = buildBeatMap(jittered(times, 0.008, 6), { duration: t + 2 });
    for (const x of times.slice(-14, -2)) {
      const pos = beatPosition(m, x);
      const p = beatTime(m, Math.round(pos) + 1) - beatTime(m, Math.round(pos));
      expect(Math.abs(pos - Math.round(pos)) * p).toBeLessThan(0.03);
    }
  });

  it('中间一段被识别成倍速：自动改回主段落的速度', () => {
    const truth = uniform(140, 0.5, 280);
    const ticks: number[] = [];
    truth.forEach((t, i) => {
      ticks.push(t);
      if (i >= 100 && i < 150) ticks.push(t + 30 / 140);
    });
    const m = buildBeatMap(jittered(ticks, 0.006, 21), { duration: 125 });
    const sections = tempoSections(m).filter((x) => x.endTime > 0 && x.startTime < 125);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.bpm).toBeCloseTo(140, 0);
  });

  it('中间一段被识别成半速：自动补回来', () => {
    const truth = uniform(150, 0.5, 300);
    const ticks = truth.filter((_, i) => i < 120 || i >= 180 || i % 2 === 0);
    const m = buildBeatMap(jittered(ticks, 0.006, 8), { duration: 125 });
    const sections = tempoSections(m).filter((x) => x.endTime > 0 && x.startTime < 125);
    expect(sections).toHaveLength(1);
    for (const t of truth.slice(10, -10)) {
      const pos = beatPosition(m, t);
      expect(Math.abs(pos - Math.round(pos)) * 0.4).toBeLessThan(0.012);
    }
  });

  it('速度慢慢漂移：局部拟合跟得上', () => {
    const truth: number[] = [];
    let t = 0.3;
    for (let i = 0; i < 300; i++) {
      truth.push(t);
      t += 60 / (100 + (12 * i) / 300);
    }
    const m = buildBeatMap(jittered(truth, 0.008, 3), { duration: t + 1 });
    for (const x of truth.slice(10, -10)) {
      const pos = beatPosition(m, x);
      expect(Math.abs(pos - Math.round(pos)) * 0.55).toBeLessThan(0.015);
    }
  });

  it('向前后延伸，覆盖音频开始之前的预备拍', () => {
    const m = buildBeatMap(uniform(120, 1, 100), { duration: 60, pad: 12 });
    expect(m.times[0]).toBeLessThanOrEqual(-12);
    expect(m.times[m.times.length - 1]).toBeGreaterThanOrEqual(72);
  });
});

describe('节拍表工具', () => {
  const m = uniformMap(120, 0.25, 0, 30);

  it('插值和外推', () => {
    expect(beatTime(m, beatPosition(m, 7.3))).toBeCloseTo(7.3, 9);
    expect(beatPosition(m, -1)).toBeLessThan(0);
    expect(beatTime(m, -2)).toBeCloseTo(m.times[0]! - 1, 9);
  });

  it('按段减半、加倍', () => {
    const half = rescaleRange(m, 10, 30, 'half');
    expect(half.times.length).toBe(m.times.length - 10);
    const dbl = rescaleRange(m, 10, 20, 'double');
    expect(dbl.times.length).toBe(m.times.length + 10);
    expect(tempoSections(dbl, 0.03, 4).length).toBeGreaterThan(1);
  });

  it('整体平移', () => {
    expect(shiftMap(m, 0.01).times[3]).toBeCloseTo(m.times[3]! + 0.01, 9);
  });

  it('小节线', () => {
    const down = beatTime(m, 5);
    expect(isBarLine(m, 9, down)).toBe(true);
    expect(isBarLine(m, 10, down)).toBe(false);
    expect(nearestBar(m, beatTime(m, 10.9), down)).toBe(9);
    expect(nearestBar(m, beatTime(m, 11.2), down)).toBe(13);
  });
});

describe('spliceMap', () => {
  it('用敲出来的拍子替换一段', async () => {
    const { spliceMap } = await import('../src/grid');
    const m = uniformMap(120, 0, 0, 20);
    const taps = [5.1, 5.6, 6.1, 6.6, 7.1, 7.6, 8.1];
    const r = spliceMap(m, taps, 5, 8.3);
    expect(r.times.filter((t) => t >= 5 && t <= 8.3)).toEqual(taps);
    const gaps = r.times.slice(1).map((t, i) => t - r.times[i]!);
    expect(Math.min(...gaps)).toBeGreaterThan(0.3);
  });
});
