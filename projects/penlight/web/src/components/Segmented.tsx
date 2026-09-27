import { motion } from 'motion/react';
import { useId } from 'react';
import styles from './Segmented.module.css';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
}

interface SegmentedProps<T extends string | number> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}

export function Segmented<T extends string | number>({ options, value, onChange, label }: SegmentedProps<T>) {
  const id = useId();
  return (
    <div className={styles.group} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={styles.option}
            data-active={active || undefined}
            onClick={() => onChange(o.value)}
          >
            {active && (
              <motion.span
                layoutId={`${id}-thumb`}
                className={styles.thumb}
                transition={{ type: 'spring', stiffness: 520, damping: 38 }}
              />
            )}
            <span className={styles.text}>
              <span className={styles.label}>{o.label}</span>
              {o.hint && <span className={styles.hint}>{o.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
