import { describe, expect, it } from 'vitest';
import { AxisTracker, gateFor, SwingDetector, type MotionFrame, type Vec3 } from '../src/detector';

const DT = 1000 / 60;

/** 绕某个轴来回转动：角速度是正弦，过零点就是转向点。 */
function rotation(axis: Vec3, amp: (t: number) => number, freq: number, ms: number, noise = 0): MotionFrame[] {
  const frames: MotionFrame[] = [];
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let t = 0; t < ms; t += DT) {
    const w = amp(t) * Math.sin((2 * Math.PI * freq * t) / 1000);
    frames.push({
      t,
      acc: [0, 0, 0],
      accG: [0, 9.8, 0],
      rot: [axis[0] * w + rnd() * noise, axis[1] * w + rnd() * noise, axis[2] * w + rnd() * noise],
    });
  }
  return frames;
}

function run(frames: MotionFrame[], level = 3) {
  const d = new SwingDetector(level);
  return frames.map((f) => d.push(f)).filter((s) => s !== null);
}

describe('SwingDetector（陀螺仪）', () => {
  it('每个转向点记一下，时间准，方向交替', () => {
    const freq = 160 / 60; // 一拍一个来回
    const swings = run(rotation([0.6, 0.8, 0], () => 700, freq, 8000, 15));
    const half = 1000 / freq / 2;
    expect(swings.length).toBeGreaterThanOrEqual(40);
    swings.slice(2).forEach((s, i) => {
      const k = Math.round(s.t / half);
      expect(Math.abs(s.t - k * half)).toBeLessThan(8);
      if (i > 0) expect(s.dir).not.toBe(swings[i + 1]!.dir);
    });
  });

  it('快速连续挥动不会被合并成一下', () => {
    const swings = run(rotation([0, 0, 1], () => 1400, 5.3, 4000, 20));
    // 5.3 Hz 来回，4 秒约 42 个转向点
    expect(swings.length).toBeGreaterThan(38);
  });

  it('走路时的小幅晃动不触发', () => {
    expect(run(rotation([1, 0, 0], () => 70, 1.8, 8000, 10))).toHaveLength(0);
  });

  it('挥得很猛时，手的小抖动被自适应门槛滤掉', () => {
    const frames = rotation([0, 1, 0], (t) => (Math.floor(t / 150) % 2 ? 250 : 900), 3.33, 6000, 10);
    const swings = run(frames, 5);
    const strong = swings.filter((s) => s.strength > 600).length;
    expect(swings.length - strong).toBeLessThan(strong * 0.3);
  });

  it('门槛按灵敏度分 5 档', () => {
    expect(gateFor('gyro', 1)).toBeGreaterThan(gateFor('gyro', 5));
    expect(gateFor('accel', 3)).toBe(13);
  });
});

describe('SwingDetector（只有加速度）', () => {
  it('没有陀螺仪时用加速度的峰值', () => {
    const frames: MotionFrame[] = [];
    const freq = 2;
    for (let t = 0; t < 6000; t += DT) {
      const a = 25 * Math.cos((2 * Math.PI * freq * t) / 1000);
      frames.push({ t, acc: [a * 0.8, a * 0.6, 0], accG: null, rot: null });
    }
    const d = new SwingDetector(3);
    const swings = frames.map((f) => d.push(f)).filter((s) => s !== null);
    expect(d.kind).toBe('accel');
    expect(swings.length).toBeGreaterThanOrEqual(22);
    const half = 1000 / freq / 2;
    swings.slice(2).forEach((s) => expect(Math.abs(s.t - Math.round(s.t / half) * half)).toBeLessThan(17));
  });
});

describe('AxisTracker', () => {
  it('找到主要转动轴，投影的正负号保持稳定', () => {
    const axis: Vec3 = [0, 0.6, 0.8];
    const tr = new AxisTracker();
    const signs = new Set<number>();
    for (let t = 0; t < 5000; t += DT) {
      const w = 500 * Math.sin((2 * Math.PI * 2 * t) / 1000);
      const p = tr.push(t, [axis[0] * w, axis[1] * w, axis[2] * w]);
      if (t > 2000 && Math.abs(w) > 100) {
        expect(Math.abs(p)).toBeCloseTo(Math.abs(w), 0);
        signs.add(Math.sign(p) * Math.sign(w));
      }
    }
    expect(signs.size).toBe(1);
    const [x, y, z] = tr.axis;
    expect(Math.abs(x * axis[0] + y * axis[1] + z * axis[2])).toBeGreaterThan(0.99);
  });
});
