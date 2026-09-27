import { PENLIGHT_COLORS, type PenlightColor } from '@linjie/penlight-core';
import { motion, useAnimationControls } from 'motion/react';
import { useEffect, useState } from 'react';
import styles from './Penlight.module.css';

const CYCLE: PenlightColor[] = ['teal', 'pink', 'blue', 'yellow', 'purple', 'orange'];

/** 首页的应援棒：跟着 80 BPM 左右轻轻摆动，点一下换颜色。 */
export function Penlight() {
  const [index, setIndex] = useState(0);
  const flash = useAnimationControls();
  const color = PENLIGHT_COLORS[CYCLE[index % CYCLE.length]!];

  useEffect(() => {
    const t = window.setInterval(() => setIndex((i) => i + 1), 3000);
    return () => window.clearInterval(t);
  }, [index]);

  const next = () => {
    setIndex((i) => i + 1);
    void flash.start({ opacity: [0.9, 0], transition: { duration: 0.5, ease: [0.2, 0, 0, 1] } });
  };

  return (
    <div className={styles.stage} style={{ ['--c' as string]: color }}>
      <div className={styles.halo} aria-hidden />
      <motion.button
        type="button"
        className={styles.stick}
        aria-label="换个颜色"
        onClick={next}
        animate={{ rotate: [-9, 9] }}
        transition={{ rotate: { duration: 0.75, repeat: Infinity, repeatType: 'mirror', ease: [0.45, 0, 0.55, 1] } }}
        whileTap={{ scale: 0.96 }}
      >
        <span className={styles.glow} aria-hidden />
        <span className={styles.tube} aria-hidden>
          <motion.span className={styles.flash} animate={flash} />
        </span>
        <span className={styles.handle} aria-hidden>
          <span className={styles.button} />
        </span>
      </motion.button>
      <div className={styles.floor} aria-hidden />
    </div>
  );
}
