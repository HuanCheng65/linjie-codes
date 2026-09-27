import type { Density } from '@linjie/penlight-core';
import { motion } from 'motion/react';
import styles from './DensityStrip.module.css';

export const DENSITY_LABEL: Record<Density, string> = {
  half: '半拍一下',
  beat: '每拍一下',
  two: '两拍一下',
  sparse: '很稀',
  none: '没挥',
};

const HEIGHT: Record<Density, number> = { half: 1, beat: 0.72, two: 0.46, sparse: 0.22, none: 0 };
const ORDER: Density[] = ['half', 'beat', 'two', 'sparse', 'none'];

/** 每小节一根柱子，高度和颜色深浅表示这一小节挥得多密。 */
export function DensityStrip({ timeline }: { timeline: Density[] }) {
  const used = ORDER.filter((d) => timeline.includes(d));
  return (
    <div className={styles.wrap}>
      <div className={styles.bars} role="img" aria-label={`每小节的挥动密度：${timeline.map((d) => DENSITY_LABEL[d]).join('，')}`}>
        {timeline.map((d, i) => (
          <div key={i} className={styles.slot} title={`第 ${i + 1} 小节 · ${DENSITY_LABEL[d]}`}>
            <motion.span
              className={styles.bar}
              data-level={d}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              style={{ height: `${Math.max(HEIGHT[d], 0.08) * 100}%`, originY: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28, delay: 0.2 + i * 0.025 }}
            />
          </div>
        ))}
      </div>
      <div className={styles.axis}>
        <span>开头</span>
        <span>结尾</span>
      </div>
      <div className={styles.legend}>
        {used.map((d) => (
          <span key={d}>
            <i data-level={d} /> {DENSITY_LABEL[d]}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 一句话概括整局的打法。 */
export function summarizeDensity(timeline: Density[]): string {
  const active = timeline.filter((d) => d !== 'none');
  if (active.length === 0) return '几乎没挥';
  const counts = new Map<Density, number>();
  for (const d of active) counts.set(d, (counts.get(d) ?? 0) + 1);
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return n / active.length >= 0.75 ? DENSITY_LABEL[top] : '有快有慢';
}
