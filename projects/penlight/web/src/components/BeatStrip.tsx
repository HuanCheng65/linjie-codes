import { beatTime, firstBeatAtOrAfter, type BeatGrid } from '@linjie/penlight-core';
import { useEffect, useMemo, useRef } from 'react';
import { cssVar, fitCanvas, withAlpha } from '../lib/canvas';
import styles from './BeatStrip.module.css';

interface BeatStripProps {
  buffer: AudioBuffer;
  grid: BeatGrid;
  from: number;
  span: number;
  /** 返回当前播放位置（歌曲时间），不在播放时返回 null。 */
  position: () => number | null;
}

const COLUMNS = 480;

/** 一小段波形叠加节拍线。播放时游标扫过，经过的拍线会亮一下。 */
export function BeatStrip({ buffer, grid, from, span, position }: BeatStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const positionRef = useRef(position);
  positionRef.current = position;

  const peaks = useMemo(() => {
    const out = new Float32Array(COLUMNS);
    const sr = buffer.sampleRate;
    const start = Math.floor(from * sr);
    const per = Math.max(1, Math.floor((span * sr) / COLUMNS));
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const stride = Math.max(1, Math.floor(per / 64));
    let max = 0;
    for (let c = 0; c < COLUMNS; c++) {
      let m = 0;
      const s0 = start + c * per;
      for (let i = s0; i < s0 + per && i < buffer.length; i += stride) {
        for (const ch of channels) m = Math.max(m, Math.abs(ch[i]!));
      }
      out[c] = m;
      max = Math.max(max, m);
    }
    if (max > 0) for (let c = 0; c < COLUMNS; c++) out[c]! /= max;
    return out;
  }, [buffer, from, span]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let colors = { wave: '', accent: '', text: '', grid: '' };
    let colorsAt = -Infinity;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const fitted = fitCanvas(canvas);
      if (!fitted) return;
      const { ctx, width, height } = fitted;
      if (now - colorsAt > 500) {
        colors = {
          wave: cssVar(canvas, '--chart-muted'),
          accent: cssVar(canvas, '--accent'),
          text: cssVar(canvas, '--text'),
          grid: cssVar(canvas, '--text-3'),
        };
        colorsAt = now;
      }
      ctx.clearRect(0, 0, width, height);
      const mid = height / 2;
      const x = (t: number) => ((t - from) / span) * width;

      // 波形
      const colW = width / COLUMNS;
      ctx.fillStyle = colors.wave;
      for (let c = 0; c < COLUMNS; c++) {
        const h = Math.max(1, peaks[c]! * (height / 2 - 6));
        ctx.fillRect(c * colW, mid - h, Math.max(1, colW - 0.5), h * 2);
      }

      // 节拍线
      const g = gridRef.current;
      const pos = positionRef.current();
      for (let i = firstBeatAtOrAfter(g, from); ; i++) {
        const t = beatTime(g, i);
        if (t > from + span) break;
        const bx = Math.round(x(t)) + 0.5;
        const sinceHit = pos === null ? Infinity : pos - t;
        const glow = sinceHit >= 0 && sinceHit < 0.25 ? 1 - sinceHit / 0.25 : 0;
        ctx.strokeStyle = withAlpha(colors.accent, 0.55 + glow * 0.45);
        ctx.lineWidth = 1.5 + glow * 1.5;
        ctx.beginPath();
        ctx.moveTo(bx, 4);
        ctx.lineTo(bx, height - 4);
        ctx.stroke();
        ctx.fillStyle = colors.accent;
        ctx.beginPath();
        ctx.arc(bx, 4, 2.5 + glow * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 游标
      if (pos !== null && pos >= from && pos <= from + span) {
        const px = Math.round(x(pos)) + 0.5;
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [peaks, from, span]);

  return <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label="波形与节拍线" />;
}
