import { beatTime, firstBeatAtOrAfter, isBarLine, type BeatMap } from '@linjie/penlight-core';

let context: AudioContext | null = null;

export function audioContext(): AudioContext {
  context ??= new AudioContext({ latencyHint: 'interactive' });
  return context;
}

/**
 * 在用户点击里调用：恢复 AudioContext，并播放一段静音唤醒 iOS 的音频通道。
 * iOS 17 起可以把 audioSession 设成 playback，静音开关打开时也能出声。
 */
export function unlockAudio(): Promise<void> {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) {
    try {
      nav.audioSession.type = 'playback';
    } catch {
      // 不支持就算了
    }
  }
  const ctx = audioContext();
  const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = silent;
  src.connect(ctx.destination);
  src.start();
  return ctx.state === 'running' ? Promise.resolve() : ctx.resume();
}

export function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  // decodeAudioData 会接管传入的 ArrayBuffer，传一份拷贝，原件留着算指纹
  return audioContext().decodeAudioData(data.slice(0));
}

/** 低于 150 Hz 的部分（底鼓、贝斯），降采样到 4 kHz 单声道，用来找小节第一拍。 */
export async function lowBand(buffer: AudioBuffer): Promise<{ samples: Float32Array; sampleRate: number }> {
  const sampleRate = 4000;
  const offline = new OfflineAudioContext(1, Math.ceil(buffer.duration * sampleRate), sampleRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  const f = offline.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 150;
  src.connect(f).connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return { samples: rendered.getChannelData(0), sampleRate };
}

/** 混成 11025 Hz 单声道，给色度特征（找副歌）用。 */
export async function mono11k(buffer: AudioBuffer): Promise<Float32Array> {
  const offline = new OfflineAudioContext(1, Math.ceil(buffer.duration * 11025), 11025);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start();
  return (await offline.startRendering()).getChannelData(0);
}

/** 截取前 maxSeconds 秒，混成 44.1 kHz 单声道，给节拍识别用。 */
export async function toMono44k(buffer: AudioBuffer, maxSeconds: number): Promise<Float32Array> {
  const seconds = Math.min(buffer.duration, maxSeconds);
  const offline = new OfflineAudioContext(1, Math.ceil(seconds * 44100), 44100);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/**
 * 波形概览：把整首歌分成 buckets 段，每段取响度（RMS），归一化到 0–1。
 * 压缩得很重的歌大部分时间都接近满幅，直接画出来每根柱子都一样高；这里按整首的中位数调对比度，
 * 让中位数落在 0.6 左右，前奏、间奏和副歌的起伏才看得出来。
 */
export function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const levels = new Float32Array(buckets);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const size = buffer.length / buckets;
  const stride = Math.max(1, Math.floor(size / 512));
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size);
    const end = Math.min(buffer.length, Math.floor((b + 1) * size));
    let sum = 0;
    let n = 0;
    for (let i = start; i < end; i += stride) {
      for (const ch of channels) sum += ch[i]! * ch[i]!;
      n += channels.length;
    }
    levels[b] = n ? Math.sqrt(sum / n) : 0;
  }
  const sorted = Array.from(levels).sort((x, y) => x - y);
  const top = sorted[Math.floor(0.98 * (sorted.length - 1))] ?? 0;
  if (top <= 0) return levels;
  for (let b = 0; b < buckets; b++) levels[b] = Math.min(1, levels[b]! / top);
  const median = Math.min(1, (sorted[sorted.length >> 1] ?? 0) / top);
  const gamma = median > 0 && median < 1 ? Math.min(4, Math.max(1, Math.log(0.6) / Math.log(median))) : 1;
  for (let b = 0; b < buckets; b++) levels[b] = levels[b]! ** gamma;
  return levels;
}

export interface Playback {
  /** 歌曲时间 playFrom 对应的 AudioContext 时间。 */
  readonly startCtx: number;
  readonly playFrom: number;
  stop(fade?: number): void;
  onended: (() => void) | null;
}

export interface PlayOptions {
  /** 多久之后开始（秒）。 */
  delay?: number;
  volume?: number;
  /** 结尾淡出的秒数。 */
  fadeOut?: number;
  /** 要响节拍器的歌曲时间。 */
  clicks?: { time: number; accent: boolean }[];
}

/**
 * 播放 [from, until] 这一段。from 可以是负数：音频开始之前先空着，只响节拍器。
 */
export function playBuffer(buffer: AudioBuffer, from: number, until: number, options: PlayOptions = {}): Playback {
  const ctx = audioContext();
  const volume = options.volume ?? 1;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(ctx.destination);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(gain);
  const startCtx = ctx.currentTime + (options.delay ?? 0.08);
  const toCtx = (songTime: number) => startCtx + songTime - from;
  const audioFrom = Math.max(0, from);
  src.start(toCtx(audioFrom), audioFrom, Math.max(0, until - audioFrom));

  const fade = options.fadeOut ?? 0;
  if (fade > 0) {
    gain.gain.setValueAtTime(volume, toCtx(until - fade));
    gain.gain.linearRampToValueAtTime(0, toCtx(until));
  }

  const clickNodes: AudioScheduledSourceNode[] = [];
  if (options.clicks?.length) {
    const bus = ctx.createGain();
    bus.gain.value = 0.6;
    bus.connect(ctx.destination);
    for (const c of options.clicks) {
      const when = toCtx(c.time);
      if (when > ctx.currentTime) clickNodes.push(scheduleClick(ctx, bus, when, c.accent));
    }
  }

  const playback: Playback = {
    startCtx,
    playFrom: from,
    onended: null,
    stop(fadeTime = 0.12) {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeTime);
      for (const n of clickNodes) {
        try {
          n.stop();
        } catch {
          // 已经响完
        }
      }
      try {
        src.stop(now + fadeTime + 0.02);
      } catch {
        // 已经停了
      }
    },
  };
  src.onended = () => {
    gain.disconnect();
    playback.onended?.();
  };
  return playback;
}

/**
 * 把 performance.now() 时间换算成歌曲时间。
 *
 * 按 brief 的做法：事件发生时的 AudioContext 时间
 * = currentTime − (performance.now() − event.timeStamp) / 1000，再减去 outputLatency。
 * currentTime 是按音频块跳变的，这里持续采样两者之差，取最近一段的最大值来去掉跳变。
 */
export class SongClock {
  private readonly diffs: number[] = [];
  private readonly latency: number;

  constructor(
    private readonly ctx: AudioContext,
    private readonly playback: Pick<Playback, 'startCtx' | 'playFrom'>,
  ) {
    this.latency = ctx.outputLatency || 0;
    this.sample();
  }

  sample(): void {
    this.diffs.push(this.ctx.currentTime - performance.now() / 1000);
    if (this.diffs.length > 40) this.diffs.shift();
  }

  /** performance.now() 基准的时间（ms）对应的歌曲时间（秒）。 */
  songTimeAt(perfMs: number): number {
    const diff = Math.max(...this.diffs);
    const ctxTime = perfMs / 1000 + diff - this.latency;
    return this.playback.playFrom + ctxTime - this.playback.startCtx;
  }

  now(): number {
    this.sample();
    return this.songTimeAt(performance.now());
  }
}

export function scheduleClick(ctx: AudioContext, destination: AudioNode, when: number, accent = false): AudioScheduledSourceNode {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  const f = accent ? 2200 : 1600;
  osc.frequency.setValueAtTime(f, when);
  osc.frequency.exponentialRampToValueAtTime(f * 0.7, when + 0.04);
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.6, when + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
  osc.connect(env).connect(destination);
  osc.start(when);
  osc.stop(when + 0.08);
  return osc;
}

/**
 * 校对节拍页的播放器：从任意位置播放，可以叠加节拍器（小节第一拍音高更高）。
 * 节拍表随时可能被修改，每次调度都重新读取，一变就撤掉还没响的点击声重新排。
 */
export class EditorPlayer {
  private playback: Playback | null = null;
  private timer = 0;
  private scheduled = new Map<number, AudioScheduledSourceNode>();
  private mapKey = '';
  private clickBus: GainNode | null = null;
  private until = Infinity;
  /** 播放开始时歌曲时间和 performance.now() 的对应关系，用来算平滑的播放位置。 */
  private anchor: { perf: number; song: number } | null = null;
  metronome = true;
  onended: (() => void) | null = null;

  constructor(
    private readonly buffer: AudioBuffer,
    private readonly getMap: () => BeatMap,
    private readonly getDownbeat: () => number,
  ) {}

  get playing(): boolean {
    return this.playback !== null;
  }

  /**
   * 当前播放到的歌曲时间（秒），没在播放时为 null。
   * AudioContext 的时钟是一块一块跳的（手机上一次 10–20 ms），画面跟着它走会一顿一顿，
   * 这里用播放开始时对准的 performance.now() 推算，试听只有几秒，两个时钟的漂移可以忽略。
   */
  position(): number | null {
    if (!this.playback || !this.anchor) return null;
    return this.anchor.song + (performance.now() - this.anchor.perf) / 1000;
  }

  play(from: number, until = this.buffer.duration): void {
    this.stop();
    const ctx = audioContext();
    this.until = Math.min(this.buffer.duration, until);
    this.clickBus = ctx.createGain();
    this.clickBus.gain.value = 0.55;
    this.clickBus.connect(ctx.destination);
    const playback = playBuffer(this.buffer, Math.max(0, from), this.until, { delay: 0.06, volume: 0.85 });
    playback.onended = () => {
      if (this.playback === playback) {
        this.cleanup();
        this.onended?.();
      }
    };
    this.playback = playback;
    // 歌曲时间 from 在 startCtx 响起，再加上输出延迟才被听到
    const latency = ctx.outputLatency || ctx.baseLatency || 0;
    this.anchor = { perf: performance.now() + (playback.startCtx - ctx.currentTime + latency) * 1000, song: Math.max(0, from) };
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  stop(): void {
    if (!this.playback) return;
    this.playback.stop();
    this.cleanup();
  }

  private cleanup(): void {
    window.clearInterval(this.timer);
    this.clearClicks();
    const bus = this.clickBus;
    if (bus) window.setTimeout(() => bus.disconnect(), 200);
    this.clickBus = null;
    this.playback = null;
    this.anchor = null;
  }

  private clearClicks(): void {
    for (const node of this.scheduled.values()) {
      try {
        node.stop();
      } catch {
        // 已经响完
      }
    }
    this.scheduled.clear();
  }

  private tick(): void {
    const playback = this.playback;
    const bus = this.clickBus;
    if (!playback || !bus) return;
    const ctx = audioContext();
    const map = this.getMap();
    const down = this.getDownbeat();
    const key = `${map.times.length}:${map.times[0]}:${map.times[map.times.length - 1]}:${down}:${this.metronome}`;
    if (key !== this.mapKey) {
      this.mapKey = key;
      this.clearClicks();
    }
    if (!this.metronome) return;

    const toCtx = (songTime: number) => playback.startCtx + songTime - playback.playFrom;
    const nowSong = playback.playFrom + ctx.currentTime - playback.startCtx;
    const horizon = Math.min(this.until, nowSong + 0.15);
    for (let i = firstBeatAtOrAfter(map, Math.max(playback.playFrom, nowSong)); ; i++) {
      const t = beatTime(map, i);
      if (t > horizon) break;
      if (this.scheduled.has(i)) continue;
      const when = toCtx(t);
      if (when < ctx.currentTime) continue;
      this.scheduled.set(i, scheduleClick(ctx, bus, when, isBarLine(map, i, down)));
    }
  }
}
