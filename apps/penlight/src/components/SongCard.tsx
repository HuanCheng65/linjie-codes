import { Check, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { pressSpring } from './Button';
import styles from './SongCard.module.css';

interface SongCardProps {
  icon: LucideIcon;
  title: string;
  meta: ReactNode;
  selected: boolean;
  onSelect: () => void;
  footer?: ReactNode;
}

export function SongCard({ icon: Icon, title, meta, selected, onSelect, footer }: SongCardProps) {
  return (
    <div className={styles.card} data-selected={selected || undefined}>
      <motion.button
        type="button"
        role="radio"
        aria-checked={selected}
        className={styles.main}
        onClick={onSelect}
        whileTap={{ scale: 0.985 }}
        transition={pressSpring}
      >
        <span className={styles.tile}>
          <Icon size={22} strokeWidth={2} aria-hidden />
        </span>
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>
          <span className={styles.meta}>{meta}</span>
        </span>
        <span className={styles.radio} aria-hidden>
          <AnimatePresence initial={false}>
            {selected && (
              <motion.span
                className={styles.radioFill}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 28 }}
              >
                <Check size={14} strokeWidth={3} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </motion.button>
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}
