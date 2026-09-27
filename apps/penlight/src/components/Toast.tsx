import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import { dismissToast, useStore } from '../store';
import styles from './Toast.module.css';

export function Toast() {
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(dismissToast, 3600);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <div className={styles.region} aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className={styles.toast}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={dismissToast}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
