import {
  SENSITIVITY_THRESHOLDS,
  SwingDetector,
  thresholdForSensitivity,
} from '@linjie/penlight-core';
import { ArrowRight, Hand, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { LiveCurve, type CurveFeed } from '../components/LiveCurve';
import { Notice } from '../components/Notice';
import { Reveal, Screen } from '../components/Screen';
import { Segmented } from '../components/Segmented';
import {
  isEmbedded,
  isIOS,
  MotionSource,
  requestMotionPermission,
} from '../lib/motion';
import {
  navigate,
  setInputMode,
  setMotionPermission,
  setSensitivity,
  useStore,
} from '../store';
import styles from './SensorCheck.module.css';

type Status = 'waiting' | 'live' | 'silent';

const NO_DATA_MS = 2000;

const LEVELS = SENSITIVITY_THRESHOLDS.map((thr, i) => ({ value: i + 1, label: String(i + 1), hint: String(thr) }));

export function SensorCheck() {
  const permission = useStore((s) => s.motionPermission);
  const sensitivity = useStore((s) => s.sensitivity);
  const threshold = thresholdForSensitivity(sensitivity);

  const feed = useMemo<CurveFeed>(() => ({ samples: [], swings: [] }), []);
  const [detector] = useState(() => new SwingDetector({ threshold }));
  detector.threshold = threshold;

  const [status, setStatus] = useState<Status>('waiting');
  const [rate, setRate] = useState(0);
  const [count, setCount] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const flashRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (permission !== 'granted') return;
    const source = new MotionSource();
    const startedAt = performance.now();
    let lastAt = 0;
    source.start(({ t, magnitude }) => {
      lastAt = performance.now();
      feed.samples.push({ t, v: magnitude });
      const swing = detector.push(t, magnitude);
      if (swing) {
        feed.swings.push(swing);
        setCount((c) => c + 1);
        flashRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 480,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
        });
      }
    });
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (lastAt && now - lastAt < NO_DATA_MS) {
        setStatus('live');
        setRate(Math.round(source.sampleRate));
      } else if (now - startedAt > NO_DATA_MS) {
        setStatus('silent');
      }
    }, 250);
    return () => {
      source.stop();
      window.clearInterval(timer);
      detector.reset();
    };
  }, [permission, attempt, detector, feed]);

  const retry = async () => {
    if (permission !== 'granted') setMotionPermission(await requestMotionPermission());
    setStatus('waiting');
    setAttempt((a) => a + 1);
  };

  const useTap = () => {
    setInputMode('tap');
    navigate('songs');
  };

  const next = () => {
    setInputMode('motion');
    navigate('songs');
  };

  const silentReasons = [
    !window.isSecureContext && '页面不是用 HTTPS 打开的，浏览器不给传感器数据。请换成 https:// 开头的地址。',
    isEmbedded() && '页面被嵌在别的网页里，传感器被外层页面挡住了。请直接在浏览器里打开本页地址。',
    navigator.maxTouchPoints === 0 && '这台设备看起来是电脑，通常没有运动传感器。',
    '在系统设置里检查浏览器有没有「动作与方向」权限。',
  ].filter(Boolean) as string[];

  return (
    <Screen
      title="传感器自检"
      footer={
        status === 'live' ? (
          <Button variant="primary" size="lg" block trailingIcon={ArrowRight} onClick={next}>
            下一步：选歌
          </Button>
        ) : (
          <Button variant="secondary" size="lg" block icon={Hand} onClick={useTap}>
            改用点屏幕
          </Button>
        )
      }
    >
      <AnimatePresence initial={false}>
        {permission === 'denied' && (
          <Collapse key="denied">
            <Notice
              tone="danger"
              title="传感器权限被拒绝了"
              actions={
                <Button size="sm" variant="secondary" icon={RotateCcw} onClick={retry}>
                  重新申请
                </Button>
              }
            >
              {isIOS()
                ? '同一个页面里被拒绝后不会再弹窗。请到「设置 › Safari › 高级 › 网站数据」删掉本站数据，再重新打开这个页面。'
                : '请在浏览器的网站设置里允许「动作与方向」，然后点重新申请。'}
            </Notice>
          </Collapse>
        )}
        {permission === 'unsupported' && (
          <Collapse key="unsupported">
            <Notice tone="warning" title="这个浏览器不支持运动传感器">
              可以改用点屏幕模式：跟着拍子点屏幕任意位置，判定规则完全一样。
            </Notice>
          </Collapse>
        )}
        {permission === 'granted' && status === 'silent' && (
          <Collapse key="silent">
            <Notice
              tone="warning"
              title="2 秒内没有收到传感器数据"
              actions={
                <Button size="sm" variant="secondary" icon={RotateCcw} onClick={retry}>
                  再试一次
                </Button>
              }
            >
              <ul>
                {silentReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Notice>
          </Collapse>
        )}
      </AnimatePresence>

      <Reveal>
        <div className={styles.curveCard}>
          <span ref={flashRef} className={styles.flash} aria-hidden />
          <div className={styles.curveHead}>
            <StatusPill status={permission === 'granted' ? status : 'silent'} rate={rate} />
            <span className={styles.unit}>m/s²</span>
          </div>
          <LiveCurve feed={feed} threshold={threshold} />
        </div>
      </Reveal>

      <Reveal>
        <Card title="挥动计数" aside={<CountReset onReset={() => setCount(0)} disabled={count === 0} />}>
          <div className={styles.counter}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={count}
                className={`${styles.count} num`}
                initial={{ y: 24, opacity: 0, scale: 0.9 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -24, opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 520, damping: 34 }}
              >
                {count}
              </motion.span>
            </AnimatePresence>
            <span className={styles.countUnit}>下</span>
          </div>
          <p className={styles.hint}>正常挥 20 下，看计数对不对得上；拿着手机走几步，计数不应该增加。</p>
        </Card>
      </Reveal>

      <Reveal>
        <Card title="灵敏度" aside={<span className="num">阈值 {threshold} m/s²</span>}>
          <Segmented label="灵敏度" options={LEVELS} value={sensitivity} onChange={setSensitivity} />
          <p className={styles.hint}>挥了没反应就往右调；走路也会计数就往左调。</p>
        </Card>
      </Reveal>
    </Screen>
  );
}

function StatusPill({ status, rate }: { status: Status; rate: number }) {
  const text = status === 'live' ? `正在接收 · ${rate} Hz` : status === 'waiting' ? '等待数据…' : '没有数据';
  return (
    <span className={styles.pill} data-status={status}>
      <span className={styles.dot} />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="num"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function CountReset({ onReset, disabled }: { onReset: () => void; disabled: boolean }) {
  return (
    <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onReset} disabled={disabled}>
      清零
    </Button>
  );
}

function Collapse({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0, marginBottom: -16 }}
      animate={{ height: 'auto', opacity: 1, marginBottom: 0 }}
      exit={{ height: 0, opacity: 0, marginBottom: -16 }}
      transition={{ type: 'spring', stiffness: 380, damping: 36 }}
      style={{ overflow: 'hidden' }}
    >
      {children}
    </motion.div>
  );
}
