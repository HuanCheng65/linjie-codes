import type { Chart } from './chart';
import { beatPosition, uniformMap } from './grid';

/**
 * 内置测试曲：160 BPM，约 46 秒，拍点位置精确已知，用作判定手感的基准。
 * 音频由手机端用 Web Audio 现场合成，这里只放谱面。
 *
 * 结构（以小节计，每小节 4 拍，第 b 小节从曲内第 4b 拍开始）：
 * 0 预备 · 1–2 热身 · 3–10 主歌 · 11–14 导歌 · 15–22 副歌 · 23–28 副歌二 · 29 收尾
 */
export const TEST_TRACK_BPM = 160;
export const TEST_TRACK_FIRST_BEAT = 0.6;
export const TEST_TRACK_DURATION = 46;

const map = uniformMap(TEST_TRACK_BPM, TEST_TRACK_FIRST_BEAT, -12, TEST_TRACK_DURATION + 12);
/** 曲内第 0 拍（第一声预备拍）在节拍表里的序号。 */
const b0 = Math.round(beatPosition(map, TEST_TRACK_FIRST_BEAT));

export const TEST_TRACK_CHART: Chart = {
  grid: map,
  startBeat: b0 + 4,
  endBeat: b0 + 116,
  playFrom: 0,
  playUntil: TEST_TRACK_DURATION,
  sections: [
    { beat: b0 + 4, color: 'teal' },
    { beat: b0 + 12, color: 'blue' },
    { beat: b0 + 44, color: 'purple' },
    { beat: b0 + 60, color: 'pink' },
    { beat: b0 + 92, color: 'yellow' },
    { beat: b0 + 116, color: 'white' },
  ],
};
