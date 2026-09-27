import { describe, expect, it } from 'vitest';
import { estimateDownbeat, envelopeOf, findRestBeats, recommendSelection, sectionBreaks } from '../src/features';
import { beatPosition, beatTime, uniformMap } from '../src/grid';

const SR = 8000;
const map = uniformMap(120, 0.5, -12, 132);

/** 合成一首歌：每拍一个鼓点，小节第一拍更重；60–90 秒最响；40–44 秒完全停顿。 */
function song(): Float32Array {
  const x = new Float32Array(SR * 120);
  for (let b = 0; b < map.times.length; b++) {
    const t = map.times[b]!;
    if (t < 0 || t > 119 || (t >= 40 && t < 44)) continue;
    const loud = t >= 60 && t < 90 ? 1 : 0.35;
    const accent = (b - Math.round(beatPosition(map, 2.5))) % 4 === 0 ? 1 : 0.4;
    const s = Math.round(t * SR);
    for (let i = 0; i < 800 && s + i < x.length; i++) x[s + i]! += loud * accent * Math.exp(-i / 200) * Math.sin(i / 3);
    for (let i = 0; i < SR * 0.5 && s + i < x.length; i++) x[s + i]! += loud * 0.05 * Math.sin(i / 7);
  }
  return x;
}

describe('音频特征', () => {
  const env = envelopeOf(song(), SR);

  it('找到小节第一拍', () => {
    const d = estimateDownbeat(map, env, 120);
    const k = Math.round(beatPosition(map, d)) - Math.round(beatPosition(map, 2.5));
    expect(((k % 4) + 4) % 4).toBe(0);
  });

  it('找到停顿', () => {
    const from = Math.round(beatPosition(map, 10));
    const to = Math.round(beatPosition(map, 110));
    const rests = findRestBeats(map, env, from, to).map((b) => beatTime(map, b));
    expect(rests.length).toBeGreaterThanOrEqual(6);
    for (const t of rests) expect(t).toBeGreaterThan(39.5);
    for (const t of rests) expect(t).toBeLessThan(44.5);
  });

  it('推荐最响的一段', () => {
    const sel = recommendSelection(map, env, 2.5, 120, 30);
    expect(sel.start).toBeGreaterThanOrEqual(58);
    expect(sel.start).toBeLessThanOrEqual(62);
    // 长度按 4 小节取整
    expect(sel.end - sel.start).toBeGreaterThanOrEqual(24);
    expect(sel.end - sel.start).toBeLessThanOrEqual(36);
  });

  it('能量明显变化的地方分段', () => {
    const from = Math.round(beatPosition(map, 20.5));
    const to = Math.round(beatPosition(map, 110.5));
    const breaks = sectionBreaks(map, env, from, to, 2.5).map((b) => beatTime(map, b));
    expect(breaks.some((t) => Math.abs(t - 60.5) < 2.5)).toBe(true);
    expect(breaks.some((t) => Math.abs(t - 90.5) < 2.5)).toBe(true);
  });
});
