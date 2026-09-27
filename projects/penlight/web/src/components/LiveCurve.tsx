import { useEffect, useRef } from 'react';
import { cssVar, fitCanvas, withAlpha } from '../lib/canvas';
import styles from './LiveCurve.module.css';

export interface CurveFeed {
  /** 检测器投影到主轴后的有符号信号。 */
  samples: { t: number; v: number }[];
  /** 识别出的挥动，dir 区分去程和回程。 */
  swings: { t: number; dir: 0 | 1 }[];
  /** 当前门槛（正值）。 */
  gate: number;
}

interface LiveCurveProps {
  feed: CurveFeed;
  /** 显示最近多少毫秒。 */
  span?: number;
}

/**
 * 自检页的实时曲线。来回挥动时曲线在中线上下摆动，
 * 虚线是门槛，竖线是识别出的挥动（两种颜色分别是两个方向）。
 */
export function LiveCurve({ feed, span = 4000 }: LiveCurveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let colors = { accent: '', other: '', grid: '', muted: '', text: '' };
    let colorsAt = -Infinity;
    let scale = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const fitted = fitCanvas(canvas);
      if (!fitted) return;
      const { ctx, width, height } = fitted;
      if (now - colorsAt > 500) {
        colors = {
          accent: cssVar(canvas, '--accent'),
          other: cssVar(canvas, '--stick-pink'),
          grid: cssVar(canvas, '--chart-grid'),
          muted: cssVar(canvas, '--text-2'),
          text: cssVar(canvas, '--text-3'),
        };
        colorsAt = now;
      }

      const samples = feed.samples;
      const t0 = now - span;
      while (samples.length > 0 && samples[0]!.t < t0 - 200) samples.shift();
      const swings = feed.swings;
      while (swings.length > 0 && swings[0]!.t < t0 - 200) swings.shift();

      // 纵轴随信号大小平滑缩放，至少能看到门槛的 2 倍
      let peak = 0;
      for (const s of samples) peak = Math.max(peak, Math.abs(s.v));
      const target = Math.max(feed.gate * 2, peak * 1.15, 1);
      scale = scale ? scale + (target - scale) * (target > scale ? 0.3 : 0.04) : target;

      const mid = height / 2;
      const half = height / 2 - 8;
      const y = (v: number) => mid - (Math.max(-scale, Math.min(scale, v)) / scale) * half;
      const x = (t: number) => ((t - t0) / span) * width;

      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.grid;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(mid) + 0.5);
      ctx.lineTo(width, Math.round(mid) + 0.5);
      ctx.stroke();

      // 门槛
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = colors.muted;
      for (const g of [feed.gate, -feed.gate]) {
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y(g)) + 0.5);
        ctx.lineTo(width, Math.round(y(g)) + 0.5);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.font = '500 10px "Geist Mono Variable", ui-monospace, monospace';
      ctx.fillStyle = colors.text;
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'right';
      ctx.fillText(`门槛 ${Math.round(feed.gate)}`, width - 4, y(feed.gate) - 3);
      ctx.textAlign = 'left';

      // 挥动标记
      for (const s of swings) {
        const age = now - s.t;
        const color = s.dir === 0 ? colors.accent : colors.other;
        const sx = Math.round(x(s.t)) + 0.5;
        ctx.strokeStyle = withAlpha(color, age < 500 ? 0.9 - (age / 500) * 0.5 : 0.4);
        ctx.lineWidth = age < 500 ? 2 : 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, 6);
        ctx.lineTo(sx, height - 6);
        ctx.stroke();
      }

      // 曲线
      if (samples.length > 1) {
        ctx.beginPath();
        samples.forEach((s, i) => (i ? ctx.lineTo(x(s.t), y(s.v)) : ctx.moveTo(x(s.t), y(s.v))));
        ctx.strokeStyle = colors.muted;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // 新出现的挥动在中线上扩散一圈
      for (const s of swings) {
        const age = now - s.t;
        const color = s.dir === 0 ? colors.accent : colors.other;
        const sx = x(s.t);
        if (age < 600) {
          const k = age / 600;
          ctx.beginPath();
          ctx.arc(sx, mid, 5 + k * 14, 0, Math.PI * 2);
          ctx.strokeStyle = withAlpha(color, (1 - k) * 0.8);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(sx, mid, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [feed, span]);

  return <canvas ref={canvasRef} className={styles.canvas} aria-label="传感器实时曲线" role="img" />;
}
