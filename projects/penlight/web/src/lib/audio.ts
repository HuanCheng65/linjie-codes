import { beatTime, firstBeatAtOrAfter, type BeatGrid } from '@linjie/penlight-core';

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

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const data = await file.arrayBuffer();
  return audioContext().decodeAudioData(data);
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

/** 波形概览：把整首歌分成 buckets 段，每段取绝对值最大值，归一化到 0–1。 */
export function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const peaks = new Float32Array(buckets);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const size = buffer.length / buckets;
  const stride = Math.max(1, Math.floor(size / 256));
  let max = 0;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size);
    const end = Math.min(buffer.length, Math.floor((b + 1) * size));
    let m = 0;
    for (let i = start; i < end; i += stride) {
      for (const ch of channels) {
        const v = Math.abs(ch[i]!);
        if (v > m) m = v;
      }
    }
    peaks[b] = m;
    if (m > max) max = m;
  }
  if (max > 0) for (let b = 0; b < buckets; b++) peaks[b]! /= max;
  return peaks;
}

export interface Playback {
  /** 歌曲时间 playFrom 对应的 AudioContext 时间。 */
  readonly startCtx: number;
  readonly playFrom: number;
  stop(fade?: number): void;
  onended: (() => void) | null;
}

export function playBuffer(
  buffer: AudioBuffer,
  from: number,
  until: number,
  delay = 0.08,
  volume = 1,
): Playback {
  const ctx = audioContext();
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(ctx.destination);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(gain);
  const startCtx = ctx.currentTime + delay;
  src.start(startCtx, from, Math.max(0, until - from));

  const playback: Playback = {
    startCtx,
    playFrom: from,
    onended: null,
    stop(fade = 0.12) {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fade);
      try {
        src.stop(now + fade + 0.02);
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

function scheduleClick(ctx: AudioContext, destination: AudioNode, when: number): AudioScheduledSourceNode {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1760, when);
  osc.frequency.exponentialRampToValueAtTime(1200, when + 0.04);
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(0.7, when + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
  osc.connect(env).connect(destination);
  osc.start(when);
  osc.stop(when + 0.08);
  return osc;
}

/**
 * 节拍器叠加原曲的试听。节拍网格随时可能被微调，每次调度都重新读取，
 * 网格一变就撤掉还没响的点击声重新排。
 */
export class MetronomePreview {
  private playback: Playback | null = null;
  private timer = 0;
  private scheduled = new Map<number, AudioScheduledSourceNode>();
  private gridKey = '';
  private clickBus: GainNode | null = null;
  onended: (() => void) | null = null;

  constructor(
    private readonly buffer: AudioBuffer,
    private readonly getGrid: () => BeatGrid,
  ) {}

  get playing(): boolean {
    return this.playback !== null;
  }

  /** 当前播放到的歌曲时间（秒），没在播放时为 null。 */
  position(): number | null {
    if (!this.playback) return null;
    const ctx = audioContext();
    return this.playback.playFrom + ctx.currentTime - (ctx.outputLatency || 0) - this.playback.startCtx;
  }

  start(from: number, length: number): void {
    this.stop();
    const ctx = audioContext();
    const until = Math.min(this.buffer.duration, from + length);
    this.clickBus = ctx.createGain();
    this.clickBus.gain.value = 0.55;
    this.clickBus.connect(ctx.destination);
    const playback = playBuffer(this.buffer, from, until, 0.08, 0.8);
    playback.onended = () => {
      if (this.playback === playback) {
        this.cleanup();
        this.onended?.();
      }
    };
    this.playback = playback;
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
    for (const node of this.scheduled.values()) {
      try {
        node.stop();
      } catch {
        // 已经响完
      }
    }
    this.scheduled.clear();
    const bus = this.clickBus;
    if (bus) window.setTimeout(() => bus.disconnect(), 200);
    this.clickBus = null;
    this.playback = null;
  }

  private tick(): void {
    const playback = this.playback;
    const bus = this.clickBus;
    if (!playback || !bus) return;
    const ctx = audioContext();
    const grid = this.getGrid();
    const key = `${grid.bpm}:${grid.firstBeat}`;
    if (key !== this.gridKey) {
      this.gridKey = key;
      for (const [, node] of this.scheduled) {
        try {
          node.stop();
        } catch {
          // 已经响完
        }
      }
      this.scheduled.clear();
    }

    const toCtx = (songTime: number) => playback.startCtx + songTime - playback.playFrom;
    const nowSong = playback.playFrom + ctx.currentTime - playback.startCtx;
    const horizon = nowSong + 0.15;
    for (let i = firstBeatAtOrAfter(grid, Math.max(playback.playFrom, nowSong)); ; i++) {
      const t = beatTime(grid, i);
      if (t > horizon) break;
      if (this.scheduled.has(i)) continue;
      const when = toCtx(t);
      if (when < ctx.currentTime) continue;
      this.scheduled.set(i, scheduleClick(ctx, bus, when));
    }
    for (const [i, node] of this.scheduled) {
      if (toCtx(beatTime(grid, i)) < ctx.currentTime - 0.5) {
        this.scheduled.delete(i);
        node.disconnect();
      }
    }
  }
}
