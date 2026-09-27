import type { Chart } from './chart';

/**
 * 内置测试曲：160 BPM，约 46 秒，拍点位置精确已知，用作判定手感的基准。
 * 音频由手机端用 Web Audio 现场合成，这里只放谱面。
 *
 * 结构（以小节计，每小节 4 拍，第 b 小节从第 4b 拍开始）：
 * 0 预备 · 1–2 校准 · 3–10 主歌 · 11–14 导歌 · 15–22 副歌 · 23–28 副歌二 · 29 收尾
 */
export const TEST_TRACK_BPM = 160;
export const TEST_TRACK_FIRST_BEAT = 0.6;
export const TEST_TRACK_DURATION = 46;

export const TEST_TRACK_CHART: Chart = {
  grid: { bpm: TEST_TRACK_BPM, firstBeat: TEST_TRACK_FIRST_BEAT },
  startBeat: 4,
  endBeat: 116,
  playFrom: 0,
  playUntil: TEST_TRACK_DURATION,
  sections: [
    { beat: 4, color: 'teal' },
    { beat: 12, color: 'blue' },
    { beat: 44, color: 'purple' },
    { beat: 60, color: 'pink' },
    { beat: 92, color: 'yellow' },
    { beat: 116, color: 'white' },
  ],
};
