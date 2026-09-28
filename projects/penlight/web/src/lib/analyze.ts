import {
  beatMapFromTicks,
  envelopeOf,
  estimateDownbeat,
  recommendSelection,
  type BeatMap,
  type Envelope,
  type Selection,
} from '@linjie/penlight-core';
import type { AnalyzeResponse } from '../workers/analyze.worker';
import { computePeaks, decodeAudio, lowBand, toMono44k } from './audio';
import { CACHE_VERSION, cacheGet, cachePut, fingerprint } from './cache';

/** 先分析前 90 秒，马上能用；整首歌在后台接着分析。 */
export const QUICK_SECONDS = 90;
/** 太长的歌解码后很占内存，旧一点的手机会直接崩溃。 */
export const MAX_SECONDS = 6 * 60;

export type AnalyzeStage = 'decode' | 'prepare' | 'detect' | 'fit';

export interface AnalyzedSong {
  title: string;
  hash: string;
  buffer: AudioBuffer;
  duration: number;
  peaks: Float32Array;
  /** 整首的能量包络，用来找停顿、推荐副歌、分段换色。 */
  env: Envelope;
  /** 低频包络，用来找小节第一拍。 */
  low: Envelope;
}

export interface Analysis {
  song: AnalyzedSong;
  map: BeatMap;
  downbeat: number;
  selection: Selection;
  /** 是否已经分析过整首歌。没分析完时，full 会在后台分析完成后给出整首的节拍表。 */
  complete: boolean;
  full: Promise<BeatMap> | null;
}

export class AnalyzeError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

function runWorker(pcm: Float32Array): Promise<{ bpm: number; confidence: number; ticks: number[] }> {
  const worker = new Worker(new URL('../workers/analyze.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<{ bpm: number; confidence: number; ticks: number[] }>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<AnalyzeResponse>) => {
      const r = e.data;
      if (r.ok) resolve(r);
      else reject(new AnalyzeError('节拍识别出错了', r.error));
    };
    worker.onerror = (e) => reject(new AnalyzeError('节拍识别没能运行', `浏览器报错：${e.message || '未知错误'}。换个浏览器试试。`));
    worker.postMessage({ pcm }, [pcm.buffer]);
  }).finally(() => worker.terminate());
}

function mapFrom(
  ticks: number[],
  o: { duration: number; env: Envelope; low: Envelope; reference?: { map: BeatMap; until: number } },
): BeatMap {
  if (ticks.length < 8) throw new AnalyzeError('没识别出稳定的节拍', '换一首鼓点清楚、节奏稳定的歌，或者用「跟着敲」手动标拍子。');
  return beatMapFromTicks(ticks, o);
}

export async function analyzeFile(file: File, onStage: (stage: AnalyzeStage) => void): Promise<Analysis> {
  onStage('decode');
  const data = await file.arrayBuffer();
  let buffer: AudioBuffer;
  try {
    buffer = await decodeAudio(data);
  } catch {
    throw new AnalyzeError('这个文件解不开', '换成 mp3、m4a 或 wav 格式再试一次。');
  }
  const duration = buffer.duration;
  if (duration < 20) throw new AnalyzeError('歌曲太短了', '至少需要 20 秒。');
  if (duration > MAX_SECONDS) {
    throw new AnalyzeError('歌曲超过 6 分钟', '太长的歌在手机上容易占满内存。先用剪辑软件截出要用的部分再上传。');
  }

  onStage('prepare');
  const hash = await fingerprint(data, file.name);
  const mono = await toMono44k(buffer, duration);
  const env = envelopeOf(mono, 44100, 0.02);
  const lowPcm = await lowBand(buffer);
  const low = envelopeOf(lowPcm.samples, lowPcm.sampleRate, 0.02);
  const song: AnalyzedSong = {
    title: file.name.replace(/\.[^.]+$/, ''),
    hash,
    buffer,
    duration,
    peaks: computePeaks(buffer, 1200),
    env,
    low,
  };

  const finish = (map: BeatMap, complete: boolean, full: Promise<BeatMap> | null): Analysis => {
    const downbeat = estimateDownbeat(map, low, duration);
    return { song, map, downbeat, selection: recommendSelection(map, env, downbeat, duration, 60), complete, full };
  };

  const features = { duration, env, low };
  const cached = await cacheGet(hash);
  if (cached?.full) {
    onStage('fit');
    const quickTicks = cached.quickTicks;
    const reference = quickTicks ? { map: mapFrom(quickTicks, features), until: Math.min(QUICK_SECONDS, duration) } : undefined;
    return finish(mapFrom(cached.ticks, { ...features, reference }), true, null);
  }

  onStage('detect');
  const quickLen = Math.min(mono.length, QUICK_SECONDS * 44100);
  const quick = cached ?? { ...(await runWorker(mono.slice(0, quickLen))), version: CACHE_VERSION, full: duration <= QUICK_SECONDS };
  if (!cached) void cachePut(hash, quick);

  onStage('fit');
  const map = mapFrom(quick.ticks, features);
  if (quick.full) return finish(map, true, null);

  // 整首歌在后台分析，分析完存进缓存。整首的结果有时会和前 90 秒差一倍，按前 90 秒的级别对齐
  const reference = { map, until: QUICK_SECONDS };
  const full = runWorker(mono).then(async (r) => {
    await cachePut(hash, { version: CACHE_VERSION, ticks: r.ticks, quickTicks: quick.ticks, bpm: r.bpm, confidence: r.confidence, full: true });
    return mapFrom(r.ticks, { ...features, reference });
  });
  return finish(map, false, full);
}
