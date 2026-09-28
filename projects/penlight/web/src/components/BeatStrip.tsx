import { beatTime, firstBeatAtOrAfter, isBarLine, type BeatMap } from '@linjie/penlight-core';
import { useEffect, useMemo, useRef } from 'react';
import { computePeaks } from '../lib/audio';
import { cssVar, fitCanvas, withAlpha } from '../lib/canvas';
import styles from './BeatStrip.module.css';

interface BeatStripProps {
  buffer: AudioBuffer;
  map: BeatMap;
  downbeat: number;
  /** 窗口中心（歌曲时间），每帧读取。播放时跟着播放位置走，波形向左滚动。 */
  center: () => number;
  /** 正在播放时返回播放位置，用来画中间的游标。 */
  playing: () => boolean;
  span?: number;
}

const PER_SECOND = 160;

/** 一小段波形叠加节拍线，小节线更粗。播放时波形滚动，经过游标的拍线会亮一下。 */
export function BeatStrip({ buffer, map, downbeat, center, playing, span = 6 }: BeatStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ map, downbeat, center, playing });
  live.current = { map, downbeat, center, playing };

  const detail = useMemo(() => computePeaks(buffer, Math.ceil(buffer.duration * PER_SECOND)), [buffer]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let colors = { wave: '', accent: '', text: '' };
    let colorsAt = -Infinity;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const fitted = fitCanvas(canvas);
      if (!fitted) return;
      const { ctx, width, height } = fitted;
      if (now - colorsAt > 500) {
        colors = { wave: cssVar(canvas, '--chart-muted'), accent: cssVar(canvas, '--accent'), text: cssVar(canvas, '--text') };
        colorsAt = now;
      }
      const { map: m, downbeat: d, center: c, playing: p } = live.current;
      const mid = c();
      const from = mid - span / 2;
      const x = (t: number) => ((t - from) / span) * width;
      ctx.clearRect(0, 0, width, height);

      // 每一列固定对应一段时间，滚动时只平移位置，不重新取样，柱子高度不会闪
      const colW = 2;
      const perCol = span / (width / colW);
      const binsPerCol = Math.max(1, Math.round(perCol * PER_SECOND));
      const colDur = binsPerCol / PER_SECOND;
      ctx.fillStyle = colors.wave;
      for (let c = Math.floor(Math.max(0, from) / colDur); ; c++) {
        const t = c * colDur;
        if (t > from + span || t > buffer.duration) break;
        let v = 0;
        for (let k = c * binsPerCol; k < (c + 1) * binsPerCol && k < detail.length; k++) v = Math.max(v, detail[k]!);
        const h = Math.max(1, v * (height / 2 - 8));
        ctx.fillRect(x(t), height / 2 - h, colW * 0.75, h * 2);
      }

      for (let i = firstBeatAtOrAfter(m, from); ; i++) {
        const t = beatTime(m, i);
        if (t > from + span) break;
        const bx = Math.round(x(t)) + 0.5;
        const bar = isBarLine(m, i, d);
        const since = p() ? mid - t : Infinity;
        const glow = since >= 0 && since < 0.25 ? 1 - since / 0.25 : 0;
        ctx.strokeStyle = withAlpha(colors.accent, (bar ? 0.85 : 0.45) + glow * 0.15);
        ctx.lineWidth = (bar ? 2.5 : 1.25) + glow * 1.5;
        ctx.beginPath();
        ctx.moveTo(bx, bar ? 2 : 10);
        ctx.lineTo(bx, height - (bar ? 2 : 10));
        ctx.stroke();
      }

      if (p()) {
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width / 2, height);
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [detail, buffer, span]);

  return <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label="波形与节拍线" />;
}
