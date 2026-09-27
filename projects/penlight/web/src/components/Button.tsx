import type { LucideIcon } from 'lucide-react';
import { motion, type HTMLMotionProps } from 'motion/react';
import type { ReactNode } from 'react';
import styles from './Button.module.css';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  trailingIcon?: LucideIcon;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}

export const press = { scale: 0.97 };
export const pressSpring = { type: 'spring', stiffness: 600, damping: 30 } as const;

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  trailingIcon: Trailing,
  loading = false,
  block = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const iconSize = size === 'sm' ? 16 : 18;
  return (
    <motion.button
      type="button"
      className={[styles.button, styles[variant], styles[size], block && styles.block, className]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      whileTap={disabled || loading ? undefined : press}
      transition={pressSpring}
      {...rest}
    >
      {loading ? <Spinner size={iconSize} /> : Icon && <Icon size={iconSize} strokeWidth={2.2} aria-hidden />}
      {children && <span className={styles.label}>{children}</span>}
      {Trailing && !loading && <Trailing size={iconSize} strokeWidth={2.2} aria-hidden className={styles.trailing} />}
    </motion.button>
  );
}

interface IconButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  icon: LucideIcon;
  label: string;
  variant?: 'plain' | 'filled';
}

export function IconButton({ icon: Icon, label, variant = 'plain', className, ...rest }: IconButtonProps) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      className={[styles.icon, styles[`icon-${variant}`], className].filter(Boolean).join(' ')}
      whileTap={{ scale: 0.9 }}
      transition={pressSpring}
      {...rest}
    >
      <Icon size={20} strokeWidth={2} aria-hidden />
    </motion.button>
  );
}
