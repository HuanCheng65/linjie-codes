import {
  beatPosition,
  beatTime,
  COUNT_IN_BEATS,
  frameRow,
  Judge,
  sectionAt,
  SwingDetector,
  type GameResult,
  type LiveVerdict,
  type PenlightColor,
  type Recording,
  type SwingDirection,
} from '@linjie/penlight-core';
import { audioContext, playBuffer, SongClock, type Playback } from '../lib/audio';
import { MotionSource } from '../lib/motion';
import type { InputMode, Song } from '../store';

export type Phase = 'lead' | 'countin' | 'warmup' | 'play' | 'outro';

export interface Frame {
  songTime: number;
  phase: Phase;
  /** 预备拍倒数（4、3、2、1），不在预备段时为 null。 */
  countIn: number | null;
  /** 热身段当前是第几拍（0–7）。 */
  warmupBeat: number;
  /** 0–1 */
  progress: number;
  color: PenlightColor;
}

export interface SessionOptions {
  inputMode: InputMode;
  sensitivity: number;
  onSwing: (verdict: LiveVerdict) => void;
  onEnd: (result: GameResult, recording: Recording) => void;
}

/** 一局游戏：播放音频、接收挥动、交给 Judge 判定，同时把原始数据录下来。 */
export class GameSession {
  readonly judge: Judge;
  private playback: Playback | null = null;
  private clock: SongClock | null = null;
  private motion: MotionSource | null = null;
  private readonly detector: SwingDetector;
  private ended = false;
  private readonly frames: (number | null)[][] = [];
  private readonly taps: [number, number][] = [];

  constructor(
    private readonly song: Song,
    private readonly options: SessionOptions,
  ) {
    this.judge = new Judge(song.chart);
    this.detector = new SwingDetector(options.sensitivity);
  }

  start(): void {
    const { chart, buffer } = this.song;
    const ctx = audioContext();
    this.playback = playBuffer(buffer, chart.playFrom, chart.playUntil, 0.25);
    this.playback.onended = () => this.finish();
    this.clock = new SongClock(ctx, this.playback);

    if (this.options.inputMode === 'motion') {
      this.motion = new MotionSource();
      this.motion.start((frame) => {
        const clock = this.clock;
        if (!clock || this.ended) return;
        clock.sample();
        this.frames.push(frameRow(frame, clock.songTimeAt(frame.t)));
        const swing = this.detector.push(frame);
        if (swing) this.input(swing.t, swing.dir);
      });
    }
  }

  /** 一次挥动（或点屏幕），t 为 performance.now() 基准的时间（ms）。 */
  input(perfMs: number, dir: SwingDirection = 0): void {
    if (!this.clock || this.ended) return;
    const songTime = this.clock.songTimeAt(perfMs);
    if (this.options.inputMode === 'tap') this.taps.push([Number(perfMs.toFixed(2)), Number(songTime.toFixed(4))]);
    this.options.onSwing(this.judge.swing(songTime, dir));
  }

  frame(): Frame {
    const { chart } = this.song;
    const t = this.clock ? this.clock.now() : chart.playFrom;
    const grid = chart.grid;
    const period = this.judge.period;
    const pos = beatPosition(grid, t);

    let phase: Phase;
    let countIn: number | null = null;
    if (t < beatTime(grid, chart.startBeat - COUNT_IN_BEATS) - 0.05) phase = 'lead';
    else if (t < beatTime(grid, chart.startBeat) - 0.05) {
      phase = 'countin';
      countIn = Math.max(1, Math.min(COUNT_IN_BEATS, chart.startBeat - Math.floor(pos + 0.05 / period)));
    } else if (t < beatTime(grid, this.judge.playStart) - period / 2) phase = 'warmup';
    else if (t < beatTime(grid, chart.endBeat) + period / 2) phase = 'play';
    else phase = 'outro';

    const warmupBeat = Math.min(this.judge.warmupBeats - 1, Math.max(0, Math.round(pos) - chart.startBeat));
    const progress = Math.min(1, Math.max(0, (t - chart.playFrom) / (chart.playUntil - chart.playFrom)));

    if (t >= chart.playUntil + 0.1) this.finish();

    return {
      songTime: t,
      phase,
      countIn,
      warmupBeat,
      progress,
      color: sectionAt(chart, Math.round(pos)).color,
    };
  }

  /** 中途退出，不出成绩。 */
  stop(): void {
    this.ended = true;
    this.teardown();
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.teardown();
    const result = this.judge.result();
    this.options.onEnd(result, this.recording(result));
  }

  private recording(result: GameResult): Recording {
    return {
      format: 'penlight-recording',
      version: 1,
      createdAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      inputMode: this.options.inputMode,
      sensitivity: this.options.sensitivity,
      source: this.detector.kind,
      tags: [],
      song: { key: this.song.key, title: this.song.title },
      chart: this.song.chart,
      frames: this.frames,
      taps: this.taps,
      result: {
        score: result.score,
        sync: result.sync,
        participation: result.participation,
        hits: result.hits,
        strays: result.strays,
      },
    };
  }

  private teardown(): void {
    this.motion?.stop();
    this.motion = null;
    this.playback?.stop(0.4);
    this.playback = null;
  }
}
