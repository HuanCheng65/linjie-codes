/// <reference lib="webworker" />
/**
 * 在后台线程里跑 Essentia 的 RhythmExtractor2013（multifeature），避免界面卡顿。
 * 输入：44.1 kHz 单声道 PCM。输出：BPM 和拍点时间。
 *
 * Essentia.js 是 AGPL-3.0 协议，对外提供服务或开源时要注意。
 */
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';

export interface AnalyzeRequest {
  pcm: Float32Array;
}

export type AnalyzeResponse =
  | { ok: true; bpm: number; confidence: number; ticks: number[] }
  | { ok: false; error: string };

let essentia: Essentia | null = null;

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  try {
    essentia ??= new Essentia(EssentiaWASM);
    const signal = essentia.arrayToVector(event.data.pcm);
    const r = essentia.RhythmExtractor2013(signal, 208, 'multifeature', 40);
    const ticks = Array.from(essentia.vectorToArray(r.ticks));
    const response: AnalyzeResponse = { ok: true, bpm: r.bpm, confidence: r.confidence, ticks };
    self.postMessage(response);
  } catch (error) {
    const response: AnalyzeResponse = { ok: false, error: String(error) };
    self.postMessage(response);
  }
};
