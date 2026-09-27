import { AlertTriangle, Info, XCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './Notice.module.css';

type Tone = 'info' | 'warning' | 'danger';

const ICONS: Record<Tone, LucideIcon> = { info: Info, warning: AlertTriangle, danger: XCircle };

interface NoticeProps {
  tone?: Tone;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}

export function Notice({ tone = 'info', title, children, actions }: NoticeProps) {
  const Icon = ICONS[tone];
  return (
    <div className={styles.notice} data-tone={tone} role={tone === 'info' ? 'status' : 'alert'}>
      <Icon size={18} strokeWidth={2.2} className={styles.icon} aria-hidden />
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        {children && <div className={styles.text}>{children}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}
