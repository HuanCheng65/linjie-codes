import { beatPosition, beatTime, lastBeatAtOrBefore, type BeatMap } from './grid';

/** 应援棒配色。 */
export const PENLIGHT_COLORS = {
  teal: '#39C5BB',
  blue: '#3F7CFF',
  purple: '#9D6BFF',
  pink: '#FF5DA2',
  red: '#FF4D5E',
  orange: '#FF8A3D',
  yellow: '#FFD23F',
  green: '#3DDC84',
  white: '#F4F4F6',
} as const;

export type PenlightColor = keyof typeof PENLIGHT_COLORS;

/** 换段时轮换的颜色顺序。 */
export const SECTION_CYCLE: readonly PenlightColor[] = ['blue', 'pink', 'yellow', 'purple', 'orange', 'green', 'red'];

export interface ChartSection {
  /** 从这一拍开始使用这个颜色。 */
  beat: number;
  color: PenlightColor;
}

/**
 * 谱面：节拍表 + 判定范围 + 分段颜色表。
 * 判定范围的前 `CALIBRATION_BEATS` 拍是热身，不计分。
 */
export interface Chart {
  grid: BeatMap;
  /** 第一个参与判定的拍子（热身从这里开始）。 */
  startBeat: number;
  /** 最后一个参与判定的拍子（含）。 */
  endBeat: number;
  /** 从音频的哪个时间开始播放（秒）。可以是负数：前面补一段空白，用节拍器数拍。 */
  playFrom: number;
  /** 播放到音频的哪个时间结束（秒）。 */
  playUntil: number;
  sections: ChartSection[];
  /** 几乎没有声音的拍子，不计入参与度。 */
  restBeats?: number[];
  /** 需要响节拍器的拍子（落在音频开始之前的预备拍和热身拍）。 */
  clickBeats?: number[];
  /** 结尾淡出的秒数。 */
  fadeOut?: number;
}

/** 热身拍数（不计分）。 */
export const CALIBRATION_BEATS = 8;
export const WARMUP_BEATS = CALIBRATION_BEATS;
/** 热身之前的预备拍数，界面上用来倒数。 */
export const COUNT_IN_BEATS = 4;
/** 选段最短时长（秒）。 */
export const MIN_SELECTION_SECONDS = 20;

/** 某一拍所在的分段。早于第一段的拍子算作第一段。 */
export function sectionAt(chart: Chart, beat: number): ChartSection {
  let current = chart.sections[0]!;
  for (const s of chart.sections) {
    if (s.beat <= beat) current = s;
    else break;
  }
  return current;
}

export function chartDuration(chart: Chart): number {
  return chart.playUntil - chart.playFrom;
}

export interface SelectionOptions {
  map: BeatMap;
  /** 选段开头（秒），通常已经对齐到小节线。 */
  start: number;
  /** 选段结尾（秒）。 */
  end: number;
  /** 音频总长（秒）。 */
  duration: number;
  /** 换颜色的拍号（段落交界），不给时每 16 拍换一次。 */
  breaks?: number[];
  /** 不计入参与度的拍子。 */
  restBeats?: number[];
}

/**
 * 从选段生成谱面。预备拍和热身放在选段开头之前，选中的部分全部计分；
 * 开头之前音频不够时，缺的部分播放空白并响节拍器。结尾淡出 1 秒。
 */
export function chartFromSelection(o: SelectionOptions): Chart {
  const { map, duration } = o;
  const segStart = Math.round(beatPosition(map, o.start));
  const atSongEnd = o.end >= duration - 0.05;
  const endBeat = Math.max(segStart + 1, lastBeatAtOrBefore(map, atSongEnd ? duration - 0.3 : o.end + 0.02));
  const startBeat = segStart - CALIBRATION_BEATS;
  const firstCountIn = startBeat - COUNT_IN_BEATS;
  const playFrom = beatTime(map, firstCountIn) - 0.6;
  const tail = atSongEnd ? duration : Math.min(duration, beatTime(map, endBeat) + 1.2);
  const fadeOut = atSongEnd ? 0.2 : Math.min(1, tail - beatTime(map, endBeat));

  const clickBeats: number[] = [];
  for (let b = firstCountIn; b < segStart; b++) if (beatTime(map, b) < 0.15) clickBeats.push(b);

  const breaks = (o.breaks ?? defaultBreaks(segStart, endBeat)).filter((b) => b > segStart && b <= endBeat);
  const sections: ChartSection[] = [
    { beat: startBeat, color: 'teal' },
    { beat: segStart, color: SECTION_CYCLE[0]! },
    ...breaks.map((beat, i) => ({ beat, color: SECTION_CYCLE[(i + 1) % SECTION_CYCLE.length]! })),
  ];

  return {
    grid: map,
    startBeat,
    endBeat,
    playFrom,
    playUntil: tail,
    sections,
    restBeats: (o.restBeats ?? []).filter((b) => b >= segStart && b <= endBeat),
    clickBeats,
    fadeOut,
  };
}

function defaultBreaks(from: number, to: number): number[] {
  const out: number[] = [];
  for (let b = from + 16; b <= to; b += 16) out.push(b);
  return out;
}

/** 判定范围内的总拍数（含热身）。 */
export function judgedBeatCount(chart: Chart): number {
  return chart.endBeat - chart.startBeat + 1;
}
