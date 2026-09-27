import { PENLIGHT_COLORS, type LiveVerdict } from '@linjie/penlight-core';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ScreenFrame } from '../components/Screen';
import { exitFullscreen } from '../game/start';
import { GameSession, type Frame, type Phase } from '../game/session';
import { inkFor } from '../lib/color';
import { formatTime, signedMs } from '../lib/format';
import { eventTime } from '../lib/motion';
import { ScreenWakeLock } from '../lib/wakeLock';
import { back, finishGame, replace, showToast, useStore } from '../store';
import styles from './Play.module.css';

const PHASE_LABEL: Record<Phase | 'done', string> = {
  lead: '准备',
  countin: '预备',
  warmup: '热身 · 不计分',
  play: '跟着节奏挥',
  outro: '收尾',
  done: '完成',
};

const spring = { type: 'spring', stiffness: 460, damping: 32 } as const;

export function Play() {
  const song = useStore((s) => s.current);
  const inputMode = useStore((s) => s.inputMode);
  const sensitivity = useStore((s) => s.sensitivity);

  const [phase, setPhase] = useState<Phase | 'done'>('lead');
  const [countIn, setCountIn] = useState<number | null>(null);
  const [color, setColor] = useState(song?.chart.sections[0]?.color ?? 'teal');
  const [calibBeat, setCalibBeat] = useState(0);
  const [calibSlots, setCalibSlots] = useState<ReadonlySet<number>>(new Set());
  const [stability, setStability] = useState<number | null>(null);
  const [calibration, setCalibration] = useState<{ offsetMs: number; fallback: boolean } | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);

  const sessionRef = useRef<GameSession | null>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const numberRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!song) return;
    const wakeLock = new ScreenWakeLock();
    void wakeLock.request();

    const flash = (peak: number, duration: number) => {
      flashRef.current?.animate([{ opacity: peak }, { opacity: 0 }], {
        duration,
        easing: 'cubic-bezier(0.1, 0.6, 0.3, 1)',
      });
    };

    const onSwing = (v: LiveVerdict) => {
      const session = sessionRef.current;
      if (!session) return;
      switch (v.kind) {
        case 'hit':
          flash(0.82, 300);
          numberRef.current?.animate([{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }], {
            duration: 260,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
          });
          break;
        case 'warmup':
          flash(v.onBeat ? 0.55 : 0.3, 240);
          if (v.onBeat) setCalibSlots(new Set(session.judge.warmupBeatSlots));
          break;
        case 'miss':
          flash(0.3, 220);
          break;
        case 'ignored':
          flash(0.2, 200);
      }
      setStability(session.judge.stability());
    };

    let endTimer = 0;
    const session = new GameSession(song, {
      inputMode,
      sensitivity,
      onSwing,
      onEnd: (result, recording) => {
        finishGame(result, recording);
        setPhase('done');
        endTimer = window.setTimeout(() => replace('result'), 1100);
      },
    });
    sessionRef.current = session;
    session.start();

    let raf = 0;
    let last: Frame | null = null;
    let lastSecond = -1;
    const duration = song.chart.playUntil - song.chart.playFrom;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const f = session.frame();
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${f.progress})`;
      const remaining = Math.ceil(duration * (1 - f.progress));
      if (remaining !== lastSecond && timeRef.current) {
        lastSecond = remaining;
        timeRef.current.textContent = formatTime(remaining);
      }
      if (f.phase !== last?.phase) {
        setPhase((p) => (p === 'done' ? p : f.phase));
        if (last?.phase === 'warmup' && f.phase !== 'warmup') {
          const offset = session.judge.warmupOffset();
          setCalibration({ offsetMs: (offset ?? 0) * 1000, fallback: offset === null });
        }
      }
      if (f.countIn !== last?.countIn) setCountIn(f.countIn);
      if (f.warmupBeat !== last?.warmupBeat) setCalibBeat(f.warmupBeat);
      if (f.color !== last?.color) setColor(f.color);
      last = f;
    };
    raf = requestAnimationFrame(loop);

    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        session.input(eventTime(e.timeStamp));
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        session.stop();
        showToast('切到后台了，这一局已中止');
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(endTimer);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      session.stop();
      sessionRef.current = null;
      void wakeLock.release();
      exitFullscreen();
    };
  }, [song, inputMode, sensitivity]);

  // 退出提示几秒后自动收起
  useEffect(() => {
    if (!confirmExit) return;
    const t = window.setTimeout(() => setConfirmExit(false), 2500);
    return () => window.clearTimeout(t);
  }, [confirmExit]);

  // 校准结果显示一会儿就淡出
  useEffect(() => {
    if (!calibration) return;
    const t = window.setTimeout(() => setCalibration(null), 2800);
    return () => window.clearTimeout(t);
  }, [calibration]);

  if (!song) return null;

  const hex = PENLIGHT_COLORS[color];
  const onExit = () => {
    if (!confirmExit) {
      setConfirmExit(true);
      return;
    }
    sessionRef.current?.stop();
    back();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (inputMode !== 'tap') return;
    sessionRef.current?.input(eventTime(e.timeStamp));
  };


  return (
    <ScreenFrame transition="fade" className={styles.frame}>
      <div
        className={styles.play}
        data-ink={inkFor(hex)}
        style={{ ['--stick' as string]: hex }}
        onPointerDown={onPointerDown}
      >
        <div className={styles.sheen} aria-hidden />
        <div ref={flashRef} className={styles.flash} aria-hidden />

        <header className={styles.top}>
          <motion.button
            type="button"
            className={styles.exit}
            data-confirm={confirmExit || undefined}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onExit}
            layout
            transition={spring}
            aria-label={confirmExit ? '再点一次退出' : '退出'}
          >
            <X size={20} strokeWidth={2.4} aria-hidden />
            <AnimatePresence initial={false}>
              {confirmExit && (
                <motion.span
                  className={styles.exitLabel}
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={spring}
                >
                  再点一次退出
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
          <span className={styles.time}>
            <span ref={timeRef} className="num">
              {formatTime(song.chart.playUntil - song.chart.playFrom)}
            </span>
          </span>
        </header>

        <main className={styles.center}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={phase}
              className={styles.phase}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
            >
              {PHASE_LABEL[phase]}
            </motion.p>
          </AnimatePresence>

          <div className={styles.stageArea}>
            <AnimatePresence mode="popLayout" initial={false}>
              {phase === 'lead' && (
                <motion.p key="lead" className={styles.lead} {...fadeScale}>
                  {inputMode === 'tap' ? '跟着拍子点屏幕任意位置' : '举起手机，像挥应援棒一样挥'}
                </motion.p>
              )}
              {phase === 'countin' && countIn !== null && (
                <motion.div
                  key={`c${countIn}`}
                  className={`${styles.big} num`}
                  initial={{ opacity: 0, scale: 1.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.12 } }}
                  transition={{ type: 'spring', stiffness: 600, damping: 30 }}
                >
                  {countIn}
                </motion.div>
              )}
              {phase === 'warmup' && (
                <motion.div key="calib" className={styles.calibration} {...fadeScale}>
                  <div className={styles.dots}>
                    {Array.from({ length: 8 }, (_, i) => (
                      <motion.span
                        key={i}
                        className={styles.dot}
                        data-state={calibSlots.has(i) ? 'hit' : i < calibBeat ? 'missed' : i === calibBeat ? 'now' : 'pending'}
                        animate={{ scale: i === calibBeat ? 1.25 : 1 }}
                        transition={spring}
                      />
                    ))}
                  </div>
                  <p className={styles.caption}>先跟着挥 8 拍，快慢、动作随你</p>
                </motion.div>
              )}
              {(phase === 'play' || phase === 'outro') && (
                <motion.div key="play" className={styles.stability} {...fadeScale}>
                  <div ref={numberRef} className={`${styles.big} num`}>
                    {stability === null ? <span className={styles.placeholder} aria-label="还没有数据" /> : Math.round(stability * 100)}
                  </div>
                  <p className={styles.caption}>近 8 下稳定度</p>
                </motion.div>
              )}
              {phase === 'done' && (
                <motion.div key="done" className={styles.done} {...fadeScale}>
                  完成
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className={styles.pillSlot}>
            <AnimatePresence>
              {calibration && (
                <motion.span
                  className={styles.pill}
                  initial={{ opacity: 0, y: 12, scale: 0.92 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={spring}
                >
                  开始计分
                  {!calibration.fallback && (
                    <span className={styles.pillSub}>
                      · 偏移 <span className="num">{signedMs(calibration.offsetMs)} ms</span>
                    </span>
                  )}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </main>

        <footer className={styles.bottom}>
          <div className={styles.track}>
            <div ref={progressRef} className={styles.bar} />
          </div>
        </footer>
      </div>
    </ScreenFrame>
  );
}

const fadeScale = {
  initial: { opacity: 0, scale: 0.94 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.15 } },
  transition: { type: 'spring', stiffness: 380, damping: 30 },
} as const;
