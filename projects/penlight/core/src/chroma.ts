/**
 * 色度特征（chroma）：每一帧 12 个音级各有多少能量。用来找歌里重复出现的段落（副歌）。
 * 只看音高分布，和音量、压缩程度无关。
 */
export interface Chroma {
  /** 帧间隔（秒）。 */
  hop: number;
  /** 帧数 × 12，按帧依次排列。 */
  values: Float32Array;
}

const RATE = 11025;
const SIZE = 2048;
const HOP = 1024;

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** 先降到约 11 kHz，再做 2048 点 FFT，把 65 Hz–2.1 kHz 的频谱按音级累加。 */
export function chromagram(pcm: Float32Array, sampleRate: number): Chroma {
  const factor = Math.max(1, Math.round(sampleRate / RATE));
  const rate = sampleRate / factor;
  const x = new Float32Array(Math.floor(pcm.length / factor));
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += pcm[i * factor + k]!;
    x[i] = s / factor;
  }
  const window = new Float64Array(SIZE);
  for (let i = 0; i < SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE);
  const bins: { k: number; pc: number }[] = [];
  for (let k = 1; k < SIZE / 2; k++) {
    const f = (k * rate) / SIZE;
    if (f < 65 || f > 2100) continue;
    const pc = ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12;
    bins.push({ k, pc });
  }
  const frames = Math.max(0, Math.floor((x.length - SIZE) / HOP) + 1);
  const values = new Float32Array(frames * 12);
  const re = new Float64Array(SIZE);
  const im = new Float64Array(SIZE);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < SIZE; i++) {
      re[i] = x[f * HOP + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (const { k, pc } of bins) values[f * 12 + pc]! += Math.sqrt(re[k]! ** 2 + im[k]! ** 2);
  }
  return { hop: HOP / rate, values };
}
