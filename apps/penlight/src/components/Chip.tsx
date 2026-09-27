import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './Chip.module.css';

interface ChipProps {
  icon?: LucideIcon;
  tone?: 'neutral' | 'accent' | 'warning';
  children: ReactNode;
}

export function Chip({ icon: Icon, tone = 'neutral', children }: ChipProps) {
  return (
    <span className={styles.chip} data-tone={tone}>
      {Icon && <Icon size={14} strokeWidth={2.2} aria-hidden />}
      {children}
    </span>
  );
}
