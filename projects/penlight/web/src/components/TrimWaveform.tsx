import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cssVar, fitCanvas, withAlpha } from '../lib/canvas';
import styles from './TrimWaveform.module.css';

export interface Range {
  start: number;
  end: number;
}

interface TrimWaveformProps {
  peaks: Float32Array;
  duration: number;
  selection: Range;
  minLength: number;
  onChange: (range: Range) => void;
  /** 把时间对齐到小节线。 */
  snap: (t: number, edge: 'start' | 'end') => number;
  /** 拖动时气泡里显示的文字。 */
  describe: (t: number) => string;
  /** 键盘或按钮微调：往前 / 往后一个小节。 */
  onNudge: (edge: 'start' | 'end', dir: -1 | 1) => void;
  onSeek: (t: number) => void;
  position: () => number | null;
}

type Drag =
  | { kind: 'start' | 'end' }
  | { kind: 'move'; downX: number; from: Range }
  | { kind: 'pending'; downX: number; inside: boolean; from: Range };

const HANDLE_HIT = 26;

/**
 * 整首歌的波形，高亮选中的片段。
 * 拖两头的把手改起止，拖中间整体平移，点其他地方跳到那里播放。起止都会吸附到小节线。
 */
export function TrimWaveform(props: TrimWaveformProps) {
  const { peaks, duration, selection } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const live = useRef(props);
  live.current = props;
  const [bubble, setBubble] = useState<{ edge: 'start' | 'end'; text: string } | null>(null);
  const lastSnap = useRef<number | null>(null);

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
      const { selection: sel, position } = live.current;
      ctx.clearRect(0, 0, width, height);
      const bar = 2;
      const gap = 1;
      const n = Math.floor(width / (bar + gap));
      const mid = height / 2;
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n) * duration;
        // 一根柱子覆盖好几段时取平均，避免只抽其中一段造成忽高忽低
        const a = Math.min(peaks.length - 1, Math.floor((i / n) * peaks.length));
        const b = Math.min(peaks.length, Math.max(a + 1, Math.floor(((i + 1) / n) * peaks.length)));
        let p = 0;
        for (let k = a; k < b; k++) p += peaks[k]!;
        p /= b - a;
        const h = Math.max(1.5, p * (height / 2 - 6));
        const inside = t >= sel.start && t <= sel.end;
        ctx.fillStyle = inside ? colors.accent : withAlpha(colors.muted, 0.9);
        ctx.fillRect(i * (bar + gap), mid - h, bar, h * 2);
      }
      const pos = position();
      if (pos !== null) {
        const x = Math.round((pos / duration) * width) + 0.5;
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

  const width = () => wrapRef.current!.getBoundingClientRect().width;
  const timeAt = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration));
  };
  const xOf = (t: number) => (t / duration) * width();

  const feel = (value: number) => {
    if (lastSnap.current !== null && Math.abs(lastSnap.current - value) > 1e-6) navigator.vibrate?.(6);
    lastSnap.current = value;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = wrapRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ds = Math.abs(x - xOf(selection.start));
    const de = Math.abs(x - xOf(selection.end));
    lastSnap.current = null;
    if (Math.min(ds, de) <= HANDLE_HIT) {
      const edge = ds <= de ? 'start' : 'end';
      drag.current = { kind: edge };
      setBubble({ edge, text: props.describe(edge === 'start' ? selection.start : selection.end) });
      return;
    }
    const t = timeAt(e.clientX);
    drag.current = { kind: 'pending', downX: e.clientX, inside: t > selection.start && t < selection.end, from: selection };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const { snap, minLength, onChange, describe } = live.current;
    const sel = live.current.selection;
    if (d.kind === 'pending') {
      if (d.inside && Math.abs(e.clientX - d.downX) > 6) {
        drag.current = { kind: 'move', downX: d.downX, from: d.from };
        setBubble({ edge: 'start', text: describe(sel.start) });
      }
      return;
    }
    const t = timeAt(e.clientX);
    if (d.kind === 'start') {
      const s = Math.min(snap(t, 'start'), sel.end - minLength);
      if (s !== sel.start && sel.end - s >= minLength) onChange({ start: s, end: sel.end });
      feel(s);
      setBubble({ edge: 'start', text: describe(Math.max(0, s)) });
    } else if (d.kind === 'end') {
      const en = Math.max(snap(t, 'end'), sel.start + minLength);
      if (en !== sel.end && en <= duration) onChange({ start: sel.start, end: en });
      feel(en);
      setBubble({ edge: 'end', text: describe(en) });
    } else if (d.kind === 'move') {
      const len = d.from.end - d.from.start;
      const dt = ((e.clientX - d.downX) / width()) * duration;
      let s = snap(Math.max(0, d.from.start + dt), 'start');
      if (s + len > duration) s = snap(duration - len, 'start');
      const en = Math.min(duration, s + len);
      if (s !== sel.start) onChange({ start: s, end: en });
      feel(s);
      setBubble({ edge: 'start', text: describe(s) });
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setBubble(null);
    if (d?.kind === 'pending') live.current.onSeek(timeAt(e.clientX));
  };

  const onHandleKey = (edge: 'start' | 'end') => (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') props.onNudge(edge, -1);
    else if (e.key === 'ArrowRight') props.onNudge(edge, 1);
    else return;
    e.preventDefault();
  };

  const left = (selection.start / duration) * 100;
  const right = (selection.end / duration) * 100;
  const bubbleAt = bubble ? (bubble.edge === 'start' ? left : right) : 0;

  return (
    <div
      ref={wrapRef}
      className={styles.wrap}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className={styles.track}>
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden />
        <div className={styles.dim} style={{ left: 0, width: `${left}%` }} />
        <div className={styles.dim} style={{ left: `${right}%`, right: 0 }} />
        <div className={styles.window} style={{ left: `${left}%`, width: `${right - left}%` }} />
      </div>
      {(['start', 'end'] as const).map((edge) => (
        <div
          key={edge}
          className={styles.handle}
          data-edge={edge}
          data-active={bubble?.edge === edge || undefined}
          style={{ left: `${edge === 'start' ? left : right}%` }}
          role="slider"
          tabIndex={0}
          aria-label={edge === 'start' ? '片段开头' : '片段结尾'}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(edge === 'start' ? selection.start : selection.end)}
          aria-valuetext={props.describe(edge === 'start' ? selection.start : selection.end)}
          onKeyDown={onHandleKey(edge)}
        >
          <span className={styles.line} />
          <span className={styles.grip} />
        </div>
      ))}
      <AnimatePresence>
        {bubble && (
          <motion.div
            className={styles.bubble}
            style={{ left: `clamp(60px, ${bubbleAt}%, calc(100% - 60px))` }}
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          >
            {bubble.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
