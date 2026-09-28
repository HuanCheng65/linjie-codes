import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeRange, averageBpm, beatMapFromTicks, tempoSections, type BeatMap, type Envelope } from '../src/index';

/**
 * 真实歌曲的识别数据（只有拍点和能量包络，不含音频），在手机端用 Essentia.js 跑出来的。
 * quick 是前 90 秒的结果，full 是整首的结果。
 */
interface Fixture {
  duration: number;
  quick: { bpm: number; ticks: number[] };
  full: { bpm: number; ticks: number[] };
  hop: number;
  env: number[];
  low: number[];
}

const load = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8')) as Fixture;

function pipeline(f: Fixture): { quick: BeatMap; full: BeatMap } {
  const env: Envelope = { hop: f.hop, values: Float32Array.from(f.env) };
  const low: Envelope = { hop: f.hop, values: Float32Array.from(f.low) };
  const until = Math.min(90, f.duration);
  const quick = beatMapFromTicks(f.quick.ticks, { duration: f.duration, env, low });
  const full = beatMapFromTicks(f.full.ticks, { duration: f.duration, env, low, reference: { map: quick, until } });
  return { quick, full };
}

const inSong = (m: BeatMap, duration: number) => tempoSections(m).filter((s) => s.endTime > 0 && s.startTime < duration);

describe('余花にみとれて（BPM 80–89，4:31 之后只剩很轻的尾音）', () => {
  const f = load('yoka');
  const { quick, full } = pipeline(f);
  const env: Envelope = { hop: f.hop, values: Float32Array.from(f.env) };

  it('前 90 秒识别为 83 BPM，整首识别给出了翻倍的 166', () => {
    expect(f.quick.bpm).toBeCloseTo(83, 0);
    expect(f.full.bpm).toBeCloseTo(166, 0);
  });

  it('有声音的范围到 4:31 左右为止', () => {
    const r = activeRange(env, f.duration);
    expect(r.end).toBeGreaterThan(270);
    expect(r.end).toBeLessThan(274);
  });

  it('整首的结果和前 90 秒保持同一级别，只有一段约 83 BPM，尾音里的拍点不算变速', () => {
    expect(averageBpm(quick)).toBeCloseTo(83, 0);
    const sections = inSong(full, activeRange(env, f.duration).end);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.bpm).toBeGreaterThan(80);
    expect(sections[0]!.bpm).toBeLessThan(86);
  });
});

describe('ReDreaming Angel（155 BPM）', () => {
  const f = load('redreaming');
  const { quick, full } = pipeline(f);

  it('识别给出的是附点节奏的级别（约 104 = 155 × 2/3）', () => {
    expect(f.full.bpm / 155).toBeCloseTo(2 / 3, 1);
  });

  it('有声音的范围到 3:05 左右为止', () => {
    const r = activeRange({ hop: f.hop, values: Float32Array.from(f.env) }, f.duration);
    expect(r.end).toBeGreaterThan(184);
    expect(r.end).toBeLessThan(188);
  });

  it('纠正到真正的拍子，约 155 BPM，一段', () => {
    expect(averageBpm(quick)).toBeGreaterThan(153);
    expect(averageBpm(quick)).toBeLessThan(158);
    const sections = inSong(full, f.duration);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.bpm).toBeGreaterThan(153);
    expect(sections[0]!.bpm).toBeLessThan(158);
  });
});

describe('カラノワレモノ（140 BPM，开头约 8 秒乐器少、声音轻）', () => {
  const f = load('karano');
  const { quick, full } = pipeline(f);

  it('识别在前奏里给出的拍点间隔约 0.5 秒，和主体的 140 BPM 对不上', () => {
    const intro = f.full.ticks.filter((t) => t > 1 && t < 7);
    const gap = (intro[intro.length - 1]! - intro[0]!) / (intro.length - 1);
    expect(60 / gap).toBeLessThan(128);
  });

  it('轻的前奏不单独算一段速度，整首一段约 140 BPM', () => {
    expect(averageBpm(quick)).toBeCloseTo(140, 0);
    const sections = inSong(full, f.duration);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.bpm).toBeCloseTo(140, 0);
  });
});
