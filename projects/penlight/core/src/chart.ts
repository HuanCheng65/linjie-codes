import {
  beatPeriod,
  beatTime,
  firstBeatAtOrAfter,
  lastBeatAtOrBefore,
  type BeatGrid,
} from './grid';

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

/** 自动分段时轮换的颜色顺序。 */
export const SECTION_CYCLE: readonly PenlightColor[] = [
  'blue',
  'pink',
  'yellow',
  'purple',
  'orange',
  'green',
  'red',
];

export interface ChartSection {
  /** 从这一拍开始使用这个颜色。 */
  beat: number;
  color: PenlightColor;
}

/**
 * 谱面：一条节拍网格 + 判定范围 + 分段颜色表。
 * 判定范围的前 `calibrationBeats` 拍是校准段。
 */
export interface Chart {
  grid: BeatGrid;
  /** 第一个参与判定的拍子（校准段从这里开始）。 */
  startBeat: number;
  /** 最后一个参与判定的拍子（含）。 */
  endBeat: number;
  /** 从音频的哪个时间开始播放（秒）。 */
  playFrom: number;
  /** 播放到音频的哪个时间结束（秒）。 */
  playUntil: number;
  sections: ChartSection[];
}

export const CALIBRATION_BEATS = 8;
/** 校准开始前的预备拍数，界面上用来倒数。 */
export const COUNT_IN_BEATS = 4;

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

export interface SegmentOptions {
  grid: BeatGrid;
  /** 选段开始时间（秒）。 */
  from: number;
  /** 选段长度（秒）。 */
  length: number;
  /** 音频总长（秒）。 */
  duration: number;
  /** 每多少拍换一次颜色，默认 16。 */
  sectionBeats?: number;
}

/**
 * 从一段音频生成谱面：留出预备拍，之后 8 拍校准，再往后每 16 拍换一次颜色。
 * 结尾多放半拍再停，最后一拍不会被截掉。
 */
export function chartFromSegment(options: SegmentOptions): Chart {
  const { grid, duration } = options;
  const p = beatPeriod(grid);
  const from = Math.max(0, Math.min(options.from, duration));
  const until = Math.min(duration, from + options.length);

  // 播放开始后至少留 0.5 秒 + 预备拍，再开始校准。
  const startBeat = firstBeatAtOrAfter(grid, from + 0.5 + COUNT_IN_BEATS * p);
  const endBeat = Math.max(startBeat, lastBeatAtOrBefore(grid, until - p / 2));
  const sectionBeats = options.sectionBeats ?? 16;

  const sections: ChartSection[] = [{ beat: startBeat, color: 'teal' }];
  let k = 0;
  for (let b = startBeat + CALIBRATION_BEATS; b <= endBeat; b += sectionBeats) {
    sections.push({ beat: b, color: SECTION_CYCLE[k % SECTION_CYCLE.length]! });
    k++;
  }

  return {
    grid,
    startBeat,
    endBeat,
    playFrom: from,
    playUntil: Math.min(duration, beatTime(grid, endBeat) + p / 2 + 0.6),
    sections,
  };
}

/** 判定范围内的总拍数（含校准段）。 */
export function judgedBeatCount(chart: Chart): number {
  return chart.endBeat - chart.startBeat + 1;
}
