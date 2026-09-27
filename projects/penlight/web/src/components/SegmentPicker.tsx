import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cssVar, fitCanvas } from '../lib/canvas';
import { formatTime } from '../lib/format';
import styles from './SegmentPicker.module.css';

interface SegmentPickerProps {
  peaks: Float32Array;
  duration: number;
  from: number;
  length: number;
  onChange: (from: number) => void;
  position: () => number | null;
}

/** 整首歌的波形概览，拖动高亮窗口选择游戏片段。 */
export function SegmentPicker({ peaks, duration, from, length, onChange, position }: SegmentPickerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ grab: number } | null>(null);
  const state = useRef({ from, length, position });
  state.current = { from, length, position };

  const maxFrom = Math.max(0, duration - length);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let colors = { muted: '', accent: '', text: '' };
    let colorsAt = -Infinity;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const fitted = fitCanvas(canvas);
      if (!fitted) return;
      const { ctx, width, height } = fitted;
      if (now - colorsAt > 500) {
        colors = { muted: cssVar(canvas, '--chart-muted'), accent: cssVar(canvas, '--accent'), text: cssVar(canvas, '--text') };
        colorsAt = now;
      }
      ctx.clearRect(0, 0, width, height);
      const { from: f, length: l, position: pos } = state.current;
      const bar = 2;
      const gap = 1;
      const n = Math.floor(width / (bar + gap));
      const mid = height / 2;
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n) * duration;
        const p = peaks[Math.min(peaks.length - 1, Math.floor((i / n) * peaks.length))]!;
        const h = Math.max(1.5, p * (height / 2 - 4));
        ctx.fillStyle = t >= f && t <= f + l ? colors.accent : colors.muted;
        ctx.fillRect(i * (bar + gap), mid - h, bar, h * 2);
      }
      const p = pos();
      if (p !== null) {
        const x = Math.round((p / duration) * width) + 0.5;
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [peaks, duration]);

  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * duration;
  };

  const clamp = (v: number) => Math.round(Math.min(maxFrom, Math.max(0, v)) * 2) / 2;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = timeAt(e.clientX);
    const inside = t >= from && t <= from + length;
    const grab = inside ? t - from : length / 2;
    drag.current = { grab };
    if (!inside) onChange(clamp(t - grab));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onChange(clamp(timeAt(e.clientX) - drag.current.grab));
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') onChange(clamp(from - step));
    else if (e.key === 'ArrowRight') onChange(clamp(from + step));
    else return;
    e.preventDefault();
  };

  const left = duration ? (from / duration) * 100 : 0;
  const width = duration ? (length / duration) * 100 : 100;

  return (
    <div className={styles.picker}>
      <div
        ref={trackRef}
        className={styles.track}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        tabIndex={0}
        aria-label="游戏片段起点"
        aria-valuemin={0}
        aria-valuemax={Math.round(maxFrom)}
        aria-valuenow={Math.round(from)}
        aria-valuetext={`从 ${formatTime(from)} 开始`}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvasRef} className={styles.canvas} />
        <div className={styles.window} style={{ left: `${left}%`, width: `${width}%` }}>
          <span className={styles.handle} />
          <span className={styles.handle} />
        </div>
      </div>
      <div className={styles.scale}>
        <span className="num">0:00</span>
        <span className="num">{formatTime(duration)}</span>
      </div>
    </div>
  );
}
