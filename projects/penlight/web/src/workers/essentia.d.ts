declare module 'essentia.js/dist/essentia-wasm.es.js' {
  export const EssentiaWASM: unknown;
}

declare module 'essentia.js/dist/essentia.js-core.es.js' {
  interface EssentiaVector {
    size(): number;
    delete?(): void;
  }
  export default class Essentia {
    constructor(wasm: unknown, isDebug?: boolean);
    version: string;
    arrayToVector(input: Float32Array): EssentiaVector;
    vectorToArray(input: EssentiaVector): Float32Array;
    RhythmExtractor2013(
      signal: EssentiaVector,
      maxTempo?: number,
      method?: string,
      minTempo?: number,
    ): {
      bpm: number;
      ticks: EssentiaVector;
      confidence: number;
      estimates: EssentiaVector;
      bpmIntervals: EssentiaVector;
    };
    shutdown?(): void;
  }
}
