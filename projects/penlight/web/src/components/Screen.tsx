import { ChevronLeft } from 'lucide-react';
import { motion, type Variants } from 'motion/react';
import { useContext, useState, type ReactNode } from 'react';
import { DirectionContext } from './Direction';
import { back } from '../store';
import { IconButton } from './Button';
import styles from './Screen.module.css';

const slide: Variants = {
  enter: (dir: number) => ({ x: dir > 0 ? 48 : -48, opacity: 0 }),
  center: {
    x: 0,
    opacity: 1,
    transition: {
      x: { type: 'spring', stiffness: 360, damping: 36, mass: 0.9 },
      opacity: { duration: 0.24, ease: [0.2, 0, 0, 1] },
    },
  },
  exit: (dir: number) => ({
    x: dir > 0 ? -32 : 48,
    opacity: 0,
    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
  }),
};

const fade: Variants = {
  enter: { opacity: 0, scale: 1.02 },
  center: { opacity: 1, scale: 1, transition: { duration: 0.45, ease: [0.2, 0, 0, 1] } },
  exit: { opacity: 0, transition: { duration: 0.3, ease: [0.4, 0, 1, 1] } },
};

export const revealGroup: Variants = {
  enter: {},
  center: { transition: { staggerChildren: 0.045, delayChildren: 0.06 } },
};

export const revealItem: Variants = {
  enter: { opacity: 0, y: 14 },
  center: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 320, damping: 30 } },
};

interface ScreenFrameProps {
  children: ReactNode;
  transition?: 'slide' | 'fade';
  className?: string;
}

/** 页面切换动画的外壳。AnimatePresence 通过 custom 传入方向。 */
export function ScreenFrame({ children, transition = 'slide', className }: ScreenFrameProps) {
  const direction = useContext(DirectionContext);
  return (
    <motion.section
      className={[styles.frame, className].filter(Boolean).join(' ')}
      custom={direction}
      variants={transition === 'slide' ? slide : fade}
      initial="enter"
      animate="center"
      exit="exit"
    >
      {children}
    </motion.section>
  );
}

interface ScreenProps {
  title?: string;
  /** 默认显示返回按钮。 */
  onBack?: (() => void) | null;
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function Screen({ title, onBack = back, headerLeft, headerRight, footer, children }: ScreenProps) {
  const [raised, setRaised] = useState(false);
  return (
    <ScreenFrame>
      <header className={styles.header} data-raised={raised || undefined}>
        <div className={styles.headerInner}>
          <div className={styles.headerSide}>
            {onBack ? <IconButton icon={ChevronLeft} label="返回" onClick={onBack} /> : headerLeft}
          </div>
          {title ? <h1 className={styles.title}>{title}</h1> : <span />}
          <div className={`${styles.headerSide} ${styles.headerRight}`}>{headerRight}</div>
        </div>
      </header>
      <div className={styles.scroll} onScroll={(e) => setRaised(e.currentTarget.scrollTop > 4)}>
        <motion.div className={styles.content} variants={revealGroup}>
          {children}
        </motion.div>
      </div>
      {footer && (
        <motion.footer className={styles.footer} variants={revealItem}>
          <div className={styles.footerInner}>{footer}</div>
        </motion.footer>
      )}
    </ScreenFrame>
  );
}

export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={revealItem}>
      {children}
    </motion.div>
  );
}
