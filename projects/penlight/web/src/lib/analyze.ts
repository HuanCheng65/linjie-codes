import { fitBeatGrid, type BeatGrid, type GridFit } from '@linjie/penlight-core';
import type { AnalyzeResponse } from '../workers/analyze.worker';
import { computePeaks, decodeAudioFile, toMono44k } from './audio';

/** 只分析前 90 秒，够用而且手机上不会等太久。 */
export const ANALYZE_SECONDS = 90;

export type AnalyzeStage = 'decode' | 'prepare' | 'detect' | 'fit';

export interface AnalyzedSong {
  title: string;
  buffer: AudioBuffer;
  duration: number;
  peaks: Float32Array;
  /** 识别并拟合出的网格，之后可以被用户微调。 */
  detected: GridFit;
  confidence: number;
}

export class AnalyzeError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

function runWorker(pcm: Float32Array): Promise<AnalyzeResponse> {
  const worker = new Worker(new URL('../workers/analyze.worker.ts', import.meta.url), {
    type: 'module',
  });
  return new Promise<AnalyzeResponse>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<AnalyzeResponse>) => resolve(e.data);
    worker.onerror = (e) => reject(new Error(e.message || '节拍识别线程出错'));
    worker.postMessage({ pcm }, [pcm.buffer]);
  }).finally(() => worker.terminate());
}

export async function analyzeFile(
  file: File,
  onStage: (stage: AnalyzeStage) => void,
): Promise<AnalyzedSong> {
  onStage('decode');
  let buffer: AudioBuffer;
  try {
    buffer = await decodeAudioFile(file);
  } catch {
    throw new AnalyzeError('这个文件解不开', '换成 mp3、m4a 或 wav 格式再试一次。');
  }
  if (buffer.duration < 20) {
    throw new AnalyzeError('歌曲太短了', '至少需要 20 秒，建议选一段 60 秒左右的副歌。');
  }

  onStage('prepare');
  const pcm = await toMono44k(buffer, ANALYZE_SECONDS);
  const peaks = computePeaks(buffer, 1200);

  onStage('detect');
  let response: AnalyzeResponse;
  try {
    response = await runWorker(pcm);
  } catch (error) {
    throw new AnalyzeError('节拍识别没能运行', `浏览器报错：${String(error)}。换个浏览器试试。`);
  }
  if (!response.ok) {
    throw new AnalyzeError('节拍识别出错了', response.error);
  }

  onStage('fit');
  if (response.ticks.length < 8 || !(response.bpm > 0)) {
    throw new AnalyzeError('没识别出稳定的节拍', '换一首鼓点清楚、节奏稳定的歌再试。');
  }
  const detected = fitBeatGrid(response.ticks, response.bpm);

  return {
    title: file.name.replace(/\.[^.]+$/, ''),
    buffer,
    duration: buffer.duration,
    peaks,
    detected,
    confidence: response.confidence,
  };
}

export function gridOf(fit: BeatGrid): BeatGrid {
  return { bpm: fit.bpm, firstBeat: fit.firstBeat };
}
