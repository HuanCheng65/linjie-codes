import {
  beatPosition,
  beatTime,
  chartFromSelection,
  estimateDownbeat,
  findRestBeats,
  lastBeatAtOrBefore,
  MIN_SELECTION_SECONDS,
  nearestBar,
  recommendSelection,
  sectionBreaks,
  type BeatMap,
  type Chart,
} from '@linjie/penlight-core';
import type { Song, UploadState } from '../store';
import type { Analysis } from './analyze';

export function uploadFromAnalysis(a: Analysis): UploadState {
  return {
    song: a.song,
    map: a.map,
    detected: a.map,
    downbeat: a.downbeat,
    downbeatManual: false,
    selection: a.selection,
    selectionManual: false,
    analysis: a.complete ? 'full' : 'partial',
    pendingFull: null,
    edited: false,
  };
}

/** 整首分析完成：用户没改过节拍就直接换上，否则先放着等用户决定。 */
export function applyFullAnalysis(u: UploadState, map: BeatMap): UploadState {
  if (u.edited) return { ...u, analysis: 'full', pendingFull: map };
  const { song } = u;
  const downbeat = u.downbeatManual ? u.downbeat : estimateDownbeat(map, song.low, song.active.end);
  // 前 90 秒之后的拍子原来是推算的，整首的结果出来后推荐选段也重新算一次
  const selection = u.selectionManual ? u.selection : recommendSelection(map, song.env, downbeat, song.active.end, 60, song.chroma);
  return { ...u, map, detected: map, downbeat, selection, analysis: 'full', pendingFull: null };
}

/** 对齐到最近的小节线。靠近歌曲结尾时直接到结尾。 */
export function snapToBar(u: Pick<UploadState, 'map' | 'downbeat' | 'song'>, t: number, edge: 'start' | 'end'): number {
  const { duration } = u.song;
  // 靠近声音结束的地方（后面只剩尾音或空白）直接对齐到声音结束
  const end = u.song.active.end;
  if (edge === 'end' && t > end - 1.5) return Math.min(t, duration) > end + 1.5 ? Math.min(t, duration) : end;
  const bar = beatTime(u.map, nearestBar(u.map, t, u.downbeat));
  if (bar < 0) return beatTime(u.map, nearestBar(u.map, t, u.downbeat) + 4);
  return Math.min(bar, edge === 'end' ? duration : duration - MIN_SELECTION_SECONDS);
}

/** 第几小节（从 1 开始，按选段所在的节拍表计）。 */
export function barNumber(u: Pick<UploadState, 'map' | 'downbeat'>, t: number): number {
  const d = Math.round(beatPosition(u.map, u.downbeat));
  // 音频开始之后的第一条小节线算第 1 小节
  const firstBar = d + Math.ceil((Math.ceil(beatPosition(u.map, 0)) - d) / 4) * 4;
  return Math.floor((Math.round(beatPosition(u.map, t)) - firstBar) / 4) + 1;
}

export function chartForUpload(u: UploadState): Chart {
  const { map, song, selection } = u;
  const segStart = Math.round(beatPosition(map, selection.start));
  const endBeat = lastBeatAtOrBefore(map, Math.min(selection.end + 0.02, song.duration - 0.3));
  return chartFromSelection({
    map,
    start: selection.start,
    end: selection.end,
    duration: song.duration,
    breaks: sectionBreaks(map, song.env, segStart, endBeat, u.downbeat),
    restBeats: findRestBeats(map, song.env, segStart, endBeat),
  });
}

export function songForUpload(u: UploadState): Song {
  return { key: `upload:${u.song.title}`, title: u.song.title, buffer: u.song.buffer, chart: chartForUpload(u) };
}
