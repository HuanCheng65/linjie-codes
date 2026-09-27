import {
  beatPosition,
  beatTime,
  COUNT_IN_BEATS,
  Judge,
  sectionAt,
  SwingDetector,
  thresholdForSensitivity,
  type GameResult,
  type PenlightColor,
  type Verdict,
} from '@linjie/penlight-core';
import { audioContext, playBuffer, SongClock, type Playback } from '../lib/audio';
import { MotionSource } from '../lib/motion';
import type { InputMode, Song } from '../store';

export type Phase = 'lead' | 'countin' | 'calibration' | 'play' | 'outro';

export interface Frame {
  songTime: number;
  phase: Phase;
  /** 预备拍倒数（4、3、2、1），不在预备段时为 null。 */
  countIn: number | null;
  /** 校准段当前是第几拍（0–7）。 */
  calibrationBeat: number;
  /** 0–1 */
  progress: number;
  color: PenlightColor;
}

export interface SessionOptions {
  inputMode: InputMode;
  sensitivity: number;
  onSwing: (verdict: Verdict) => void;
  onEnd: (result: GameResult) => void;
}

/** 一局游戏：播放音频、接收挥动、交给 Judge 判定。 */
export class GameSession {
  readonly judge: Judge;
  private playback: Playback | null = null;
  private clock: SongClock | null = null;
  private motion: MotionSource | null = null;
  private readonly detector: SwingDetector;
  private ended = false;

  constructor(
    private readonly song: Song,
    private readonly options: SessionOptions,
  ) {
    this.judge = new Judge(song.chart);
    this.detector = new SwingDetector({ threshold: thresholdForSensitivity(options.sensitivity) });
  }

  start(): void {
    const { chart, buffer } = this.song;
    const ctx = audioContext();
    this.playback = playBuffer(buffer, chart.playFrom, chart.playUntil, 0.25);
    this.playback.onended = () => this.finish();
    this.clock = new SongClock(ctx, this.playback);

    if (this.options.inputMode === 'motion') {
      this.motion = new MotionSource();
      this.motion.start(({ t, magnitude }) => {
        this.clock?.sample();
        const swing = this.detector.push(t, magnitude);
        if (swing) this.input(swing.t);
      });
    }
  }

  /** 一次挥动（或点屏幕），t 为 performance.now() 基准的时间（ms）。 */
  input(perfMs: number): void {
    if (!this.clock || this.ended) return;
    const verdict = this.judge.swing(this.clock.songTimeAt(perfMs));
    this.options.onSwing(verdict);
  }

  frame(): Frame {
    const { chart } = this.song;
    const t = this.clock ? this.clock.now() : chart.playFrom;
    this.judge.tick(t);
    const grid = chart.grid;
    const period = this.judge.period;
    const pos = beatPosition(grid, t);

    let phase: Phase;
    let countIn: number | null = null;
    if (t < beatTime(grid, chart.startBeat - COUNT_IN_BEATS) - 0.05) phase = 'lead';
    else if (t < beatTime(grid, chart.startBeat) - 0.05) {
      phase = 'countin';
      countIn = Math.max(1, Math.min(COUNT_IN_BEATS, chart.startBeat - Math.floor(pos + 0.05 / period)));
    } else if (t < beatTime(grid, this.judge.playStart) - period / 2) phase = 'calibration';
    else if (t < beatTime(grid, chart.endBeat) + period / 2) phase = 'play';
    else phase = 'outro';

    const calibrationBeat = Math.min(
      this.judge.calibrationBeats - 1,
      Math.max(0, Math.round(pos) - chart.startBeat),
    );
    const progress = Math.min(1, Math.max(0, (t - chart.playFrom) / (chart.playUntil - chart.playFrom)));

    if (t >= chart.playUntil + 0.1) this.finish();

    return {
      songTime: t,
      phase,
      countIn,
      calibrationBeat,
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
    this.options.onEnd(this.judge.result());
  }

  private teardown(): void {
    this.motion?.stop();
    this.motion = null;
    this.playback?.stop(0.4);
    this.playback = null;
  }
}
