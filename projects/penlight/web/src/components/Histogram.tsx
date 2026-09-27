import type { SwingKind } from '@linjie/penlight-core';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import styles from './Histogram.module.css';

interface HistogramProps {
  swings: { kind: SwingKind; delta: number }[];
  windowMs: number;
  beatMs: number;
}

interface Bin {
  from: number;
  to: number;
  hits: number;
  others: number;
}

const W = 320;
const H = 150;
const PAD_X = 8;
const TOP = 22;
const BASE = 116;

/** 偏差分布：横轴是相对拍子的偏差（左早右晚），阴影是判定窗口。 */
export function Histogram({ swings, windowMs, beatMs }: HistogramProps) {
  const [active, setActive] = useState<number | null>(null);

  const shown = useMemo(() => swings.filter((s) => s.kind !== 'neutral'), [swings]);
  const { bins, range, outside, max } = useMemo(() => {
    const range = Math.min(beatMs / 2, Math.max(150, Math.ceil((windowMs * 1.6) / 10) * 10));
    const width = range > 200 ? 20 : 10;
    const count = Math.ceil((2 * range) / width);
    const bins: Bin[] = Array.from({ length: count }, (_, i) => ({
      from: -range + i * width,
      to: -range + (i + 1) * width,
      hits: 0,
      others: 0,
    }));
    let outside = 0;
    for (const s of shown) {
      if (Math.abs(s.delta) > range) {
        outside++;
        continue;
      }
      const i = Math.min(count - 1, Math.floor((s.delta + range) / width));
      if (s.kind === 'hit') bins[i]!.hits++;
      else bins[i]!.others++;
    }
    const max = Math.max(1, ...bins.map((b) => b.hits + b.others));
    return { bins, range, outside, max };
  }, [shown, windowMs, beatMs]);

  const x = (ms: number) => PAD_X + ((ms + range) / (2 * range)) * (W - 2 * PAD_X);
  const y = (n: number) => (n / max) * (BASE - TOP);
  const binW = x(bins[0]!.to) - x(bins[0]!.from);
  const total = shown.length;
  const hitCount = shown.filter((s) => s.kind === 'hit').length;
  const activeBin = active === null ? null : bins[active]!;

  return (
    <div className={styles.wrap}>
      <p className={styles.caption} aria-live="polite">
        {activeBin ? (
          <>
            <span className="num">
              {fmt(activeBin.from)} ~ {fmt(activeBin.to)} ms
            </span>
            <span>
              命中 <b className="num">{activeBin.hits}</b> · 乱挥 <b className="num">{activeBin.others}</b>
            </span>
          </>
        ) : (
          <>
            <span>
              共 <b className="num">{total}</b> 下，命中 <b className="num">{hitCount}</b> 下
            </span>
            {outside > 0 && <span className="num">范围外 {outside}</span>}
          </>
        )}
      </p>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.svg}
        role="img"
        aria-label={`偏差分布，共 ${total} 次挥动，命中 ${hitCount} 次`}
        onPointerLeave={() => setActive(null)}
      >
        <rect x={x(-windowMs)} y={TOP - 10} width={x(windowMs) - x(-windowMs)} height={BASE - TOP + 10} className={styles.window} rx={4} />
        <line x1={x(-windowMs)} x2={x(-windowMs)} y1={TOP - 10} y2={BASE} className={styles.windowEdge} />
        <line x1={x(windowMs)} x2={x(windowMs)} y1={TOP - 10} y2={BASE} className={styles.windowEdge} />
        <text x={x(windowMs) - 4} y={TOP - 1} className={styles.windowLabel} textAnchor="end">
          ±{Math.round(windowMs)} ms
        </text>

        {bins.map((b, i) => {
          const hitH = y(b.hits);
          const otherH = y(b.others);
          const bx = x(b.from) + 1;
          const bw = Math.max(1, binW - 2);
          const center = (b.from + b.to) / 2;
          const delay = 0.15 + (Math.abs(center) / range) * 0.35;
          return (
            <g
              key={b.from}
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive(i)}
              data-active={active === i || undefined}
              className={styles.bin}
            >
              <rect x={x(b.from)} y={0} width={binW} height={BASE} className={styles.hitArea} />
              {b.hits > 0 && (
                <motion.path
                  d={roundedTop(bx, BASE - hitH, bw, hitH, b.others > 0 ? 0 : 2)}
                  className={styles.hits}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  style={{ originY: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26, delay }}
                />
              )}
              {b.others > 0 && (
                <motion.path
                  d={roundedTop(bx, BASE - hitH - otherH - (b.hits > 0 ? 2 : 0), bw, otherH, 2)}
                  className={styles.others}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  style={{ originY: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26, delay: delay + 0.05 }}
                />
              )}
            </g>
          );
        })}

        <line x1={PAD_X} x2={W - PAD_X} y1={BASE + 0.5} y2={BASE + 0.5} className={styles.axis} />
        <line x1={x(0)} x2={x(0)} y1={TOP - 10} y2={BASE + 4} className={styles.zero} />
        <text x={PAD_X} y={BASE + 18} className={styles.tick}>
          {fmt(-range)}
        </text>
        <text x={x(0)} y={BASE + 18} className={styles.tick} textAnchor="middle">
          0
        </text>
        <text x={W - PAD_X} y={BASE + 18} className={styles.tick} textAnchor="end">
          {fmt(range)}
        </text>
        <text x={PAD_X} y={BASE + 32} className={styles.dir}>
          ← 挥早了
        </text>
        <text x={W - PAD_X} y={BASE + 32} className={styles.dir} textAnchor="end">
          挥晚了 →
        </text>
      </svg>

      <div className={styles.legend}>
        <span>
          <i className={styles.swatchHit} /> 命中
        </span>
        <span>
          <i className={styles.swatchOther} /> 乱挥
        </span>
      </div>
    </div>
  );
}

function fmt(ms: number): string {
  const r = Math.round(ms);
  return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0';
}

/** 只有顶部两个角是圆角的柱子，底部贴着基线。 */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
