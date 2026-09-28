/// <reference lib="webworker" />
/** 在后台线程算色度特征，用来找副歌。输入单声道 PCM 和采样率。 */
import { chromagram, type Chroma } from '@linjie/penlight-core';

self.onmessage = (event: MessageEvent<{ pcm: Float32Array; sampleRate: number }>) => {
  const chroma: Chroma = chromagram(event.data.pcm, event.data.sampleRate);
  self.postMessage(chroma, [chroma.values.buffer]);
};
