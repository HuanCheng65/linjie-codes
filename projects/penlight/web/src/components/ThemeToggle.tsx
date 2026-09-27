import { Monitor, Moon, Sun } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { setTheme, useStore, type ThemePref } from '../store';
import { pressSpring } from './Button';
import styles from './ThemeToggle.module.css';

const NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemePref, string> = { system: '跟随系统', light: '浅色', dark: '深色' };
const ICON = { system: Monitor, light: Sun, dark: Moon };

export function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const Icon = ICON[theme];
  return (
    <motion.button
      type="button"
      className={styles.toggle}
      onClick={() => setTheme(NEXT[theme])}
      aria-label={`主题：${LABEL[theme]}，点按切换`}
      title={`主题：${LABEL[theme]}`}
      whileTap={{ scale: 0.9 }}
      transition={pressSpring}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={theme}
          className={styles.icon}
          initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
          <Icon size={19} strokeWidth={2} aria-hidden />
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
