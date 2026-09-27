import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  aside?: ReactNode;
  flush?: boolean;
}

export function Card({ title, aside, flush, className, children, ...rest }: CardProps) {
  return (
    <div className={[styles.card, flush && styles.flush, className].filter(Boolean).join(' ')} {...rest}>
      {(title || aside) && (
        <div className={styles.head}>
          {title && <h2 className={styles.title}>{title}</h2>}
          {aside && <div className={styles.aside}>{aside}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
