import { useEffect, useRef } from 'react';
import { cssVar, fitCanvas, withAlpha } from '../lib/canvas';
import styles from './LiveCurve.module.css';

export interface CurveFeed {
  samples: { t: number; v: number }[];
  swings: { t: number; peak: number }[];
}

interface LiveCurveProps {
  feed: CurveFeed;
  threshold: number;
  /** 显示最近多少毫秒。 */
  span?: number;
}

/** 自检页的加速度模长实时曲线：虚线是阈值，圆点是识别出的挥动。 */
export function LiveCurve({ feed, threshold, span = 5000 }: LiveCurveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let colors = { accent: '', text: '', grid: '', muted: '', surface: '' };
    let colorsAt = -Infinity;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const fitted = fitCanvas(canvas);
      if (!fitted) return;
      const { ctx, width, height } = fitted;
      if (now - colorsAt > 500) {
        colors = {
          accent: cssVar(canvas, '--accent'),
          text: cssVar(canvas, '--text-3'),
          grid: cssVar(canvas, '--chart-grid'),
          muted: cssVar(canvas, '--text-2'),
          surface: cssVar(canvas, '--surface'),
        };
        colorsAt = now;
      }

      const thr = thresholdRef.current;
      const yMax = Math.max(30, thr * 2.2);
      const top = 8;
      const bottom = height - 6;
      const y = (v: number) => bottom - (Math.min(v, yMax) / yMax) * (bottom - top);
      const t0 = now - span;
      const x = (t: number) => ((t - t0) / span) * width;

      ctx.clearRect(0, 0, width, height);

      // 背景刻度
      ctx.font = '500 10px "Geist Mono Variable", ui-monospace, monospace';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 1;
      for (let v = 10; v < yMax; v += 10) {
        ctx.strokeStyle = colors.grid;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y(v)) + 0.5);
        ctx.lineTo(width, Math.round(y(v)) + 0.5);
        ctx.stroke();
        ctx.fillStyle = colors.text;
        ctx.fillText(String(v), 2, y(v) - 2);
      }

      // 曲线
      const samples = feed.samples;
      while (samples.length > 0 && samples[0]!.t < t0 - 200) samples.shift();
      if (samples.length > 1) {
        const grad = ctx.createLinearGradient(0, top, 0, bottom);
        grad.addColorStop(0, withAlpha(colors.accent, 0.38));
        grad.addColorStop(1, withAlpha(colors.accent, 0));
        ctx.beginPath();
        ctx.moveTo(x(samples[0]!.t), bottom);
        for (const s of samples) ctx.lineTo(x(s.t), y(s.v));
        ctx.lineTo(x(samples[samples.length - 1]!.t), bottom);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        samples.forEach((s, i) => (i ? ctx.lineTo(x(s.t), y(s.v)) : ctx.moveTo(x(s.t), y(s.v))));
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // 阈值线
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = colors.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y(thr)) + 0.5);
      ctx.lineTo(width, Math.round(y(thr)) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = colors.muted;
      ctx.textAlign = 'right';
      ctx.fillText(`阈值 ${thr}`, width - 4, y(thr) - 3);
      ctx.textAlign = 'left';

      // 挥动标记：新出现的会有一圈扩散
      const swings = feed.swings;
      while (swings.length > 0 && swings[0]!.t < t0 - 200) swings.shift();
      for (const s of swings) {
        const age = now - s.t;
        const sx = x(s.t);
        const sy = y(s.peak);
        if (age < 600) {
          const k = age / 600;
          ctx.beginPath();
          ctx.arc(sx, sy, 5 + k * 14, 0, Math.PI * 2);
          ctx.strokeStyle = withAlpha(colors.accent, (1 - k) * 0.8);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = colors.accent;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = colors.surface;
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [feed, span]);

  return <canvas ref={canvasRef} className={styles.canvas} aria-label="加速度实时曲线" role="img" />;
}
