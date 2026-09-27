import type { GameResult } from '@linjie/penlight-core';
import { ChevronDown, Hand, ListMusic, RotateCcw, Trophy, Waves } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { Histogram } from '../components/Histogram';
import { Reveal, Screen } from '../components/Screen';
import { startGame } from '../game/start';
import { signedMs } from '../lib/format';
import { backTo, useStore } from '../store';
import styles from './Result.module.css';

/** 结算页的一行小字。 */
function tagline(score: number): string {
  if (score >= 95) return '奇迹和魔法都是存在的。';
  if (score >= 85) return '今天的你，闪闪发光。';
  if (score >= 70) return '节奏已经很稳了，再来一局？';
  if (score >= 50) return '副歌再来一遍的话，一定可以。';
  return '没关系，打 call 最重要的是开心。';
}

const fmtScore = (v: number) => v.toFixed(1);
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Result() {
  const last = useStore((s) => s.lastResult);
  const current = useStore((s) => s.current);
  const nickname = useStore((s) => s.nickname);
  const [details, setDetails] = useState(false);
  const [starting, setStarting] = useState(false);

  if (!last) return null;
  const r = last.result;
  const isBest = last.previousBest === null ? r.score > 0 : r.score > last.previousBest;

  const again = async () => {
    if (!current) return;
    setStarting(true);
    await startGame(current, { replace: true });
    setStarting(false);
  };

  return (
    <Screen
      title="本局结果"
      onBack={() => backTo('songs')}
      footer={
        <div className={styles.actions}>
          <Button variant="secondary" size="lg" icon={ListMusic} onClick={() => backTo('songs')}>
            换首歌
          </Button>
          <Button variant="primary" size="lg" icon={RotateCcw} loading={starting} onClick={again} disabled={!current}>
            再来一局
          </Button>
        </div>
      }
    >
      <Reveal>
        <div className={styles.hero}>
          <div className={styles.heroGlow} aria-hidden />
          <p className={styles.song}>
            {nickname && <span className={styles.nick}>{nickname}</span>}
            <span className={styles.songTitle}>{last.songTitle}</span>
          </p>
          <div className={styles.score}>
            <AnimatedNumber value={r.score} from={0} duration={1.4} format={fmtScore} className={`${styles.scoreValue} num`} />
            <span className={styles.scoreUnit}>分</span>
          </div>
          <div className={styles.chips}>
            <Chip icon={Waves} tone="accent">
              {r.style === 'half' ? '每两拍一下' : '每拍一下'}
            </Chip>
            {last.inputMode === 'tap' && <Chip icon={Hand}>点屏幕</Chip>}
            <AnimatePresence>
              {isBest && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22, delay: 1.3 }}
                >
                  <Chip icon={Trophy} tone="accent">
                    新纪录
                  </Chip>
                </motion.span>
              )}
            </AnimatePresence>
            {!isBest && last.previousBest !== null && (
              <Chip>
                最佳 <span className="num">{fmtScore(last.previousBest)}</span>
              </Chip>
            )}
          </div>
          <motion.p
            className={styles.tagline}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5, duration: 0.6 }}
          >
            {tagline(r.score)}
          </motion.p>
        </div>
      </Reveal>

      <Reveal className={styles.stats}>
        <Stat label="命中" value={`${r.hits}`} unit={`/ ${r.expected}`} sub={`覆盖率 ${pct(r.coverage)}`} />
        <Stat
          label="平均偏差"
          value={r.meanAbsDeviationMs === null ? '—' : String(Math.round(r.meanAbsDeviationMs))}
          unit="ms"
          sub={driftText(r)}
        />
        <Stat label="多余挥动" value={String(r.extras)} unit="下" sub={`系数 ×${r.extrasFactor.toFixed(2)}`} />
        <Stat
          label="个人偏移"
          value={signedMs(r.offsetMs)}
          unit="ms"
          sub={r.calibrationFallback ? '校准不足，按 0 计' : `校准有效 ${r.calibrationSamples} 下`}
          warn={r.calibrationFallback}
        />
      </Reveal>

      <Reveal>
        <Card title="偏差分布" aside={<span className="num">减去个人偏移后</span>}>
          <Histogram swings={r.swings} windowMs={r.windowMs} beatMs={r.beatMs} />
        </Card>
      </Reveal>

      <Reveal>
        <Card flush>
          <button type="button" className={styles.detailsToggle} onClick={() => setDetails((d) => !d)} aria-expanded={details}>
            <span>计分明细</span>
            <motion.span animate={{ rotate: details ? 180 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
              <ChevronDown size={18} aria-hidden />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {details && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 38 }}
                className={styles.detailsBody}
              >
                <dl className={styles.formula}>
                  <div>
                    <dt>覆盖率</dt>
                    <dd className="num">{r.coverage.toFixed(3)}</dd>
                  </div>
                  <div>
                    <dt>× 准确度</dt>
                    <dd className="num">{r.accuracy.toFixed(3)}</dd>
                  </div>
                  <div>
                    <dt>× 多余挥动系数</dt>
                    <dd className="num">{r.extrasFactor.toFixed(3)}</dd>
                  </div>
                  <div className={styles.total}>
                    <dt>× 100 =</dt>
                    <dd className="num">{fmtScore(r.score)}</dd>
                  </div>
                </dl>
                <p className={styles.note}>
                  判定窗口 ±<span className="num">{Math.round(r.windowMs)}</span> ms，单次命中得分 1 − (|偏差| / 窗口)
                  <sup>1.5</sup>，准确度取平均。多余挥动系数 = max(0.5, 1 − 0.5 × 多余 / 应打)。
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </Reveal>
    </Screen>
  );
}

function driftText(r: GameResult): string {
  if (r.meanDeviationMs === null) return '没有命中';
  const d = Math.round(r.meanDeviationMs);
  if (Math.abs(d) < 5) return '早晚很均衡';
  return d > 0 ? `整体偏晚 ${d} ms` : `整体偏早 ${-d} ms`;
}

function Stat({ label, value, unit, sub, warn }: { label: string; value: string; unit: string; sub: string; warn?: boolean }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>
        <span className="num">{value}</span>
        <span className={styles.statUnit}>{unit}</span>
      </span>
      <span className={styles.statSub} data-warn={warn || undefined}>
        {sub}
      </span>
    </div>
  );
}
