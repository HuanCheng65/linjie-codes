import { Check, ChevronDown, Hand, ListMusic, RotateCcw, Share2, Trophy, Waves } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { DensityStrip, summarizeDensity } from '../components/DensityStrip';
import { Histogram } from '../components/Histogram';
import { Reveal, Screen } from '../components/Screen';
import { startGame } from '../game/start';
import { exportRecording } from '../lib/exportRecording';
import { backTo, showToast, useStore } from '../store';
import styles from './Result.module.css';

/** 结算页的一行小字。 */
function tagline(score: number): string {
  if (score >= 95) return '奇迹和魔法都是存在的。';
  if (score >= 85) return '今天的你，闪闪发光。';
  if (score >= 70) return '节奏已经很稳了，再来一局？';
  if (score >= 50) return '副歌再来一遍的话，一定可以。';
  return '没关系，打 call 最重要的是开心。';
}

const EXPORT_TAGS = ['正常挥', '有快有慢', '换了动作', '走路', '故意乱挥'];

const fmtScore = (v: number) => v.toFixed(1);
const pct = (v: number) => `${Math.round(v * 100)}`;

export function Result() {
  const last = useStore((s) => s.lastResult);
  const current = useStore((s) => s.current);
  const nickname = useStore((s) => s.nickname);
  const [details, setDetails] = useState(false);
  const [starting, setStarting] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);

  if (!last) return null;
  const r = last.result;
  const isBest = last.previousBest === null ? r.score >= 1 : r.score > last.previousBest;

  const again = async () => {
    if (!current) return;
    setStarting(true);
    await startGame(current, { replace: true });
    setStarting(false);
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const how = await exportRecording(last.recording, tags);
      if (how === 'downloaded') showToast('已下载，把文件发给开发者就行');
    } catch {
      showToast('导出失败，换个浏览器试试');
    } finally {
      setExporting(false);
    }
  };

  const toggleTag = (tag: string) => setTags((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]));

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
              {summarizeDensity(r.timeline)}
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
        <Stat label="同步率" value={pct(r.sync)} unit="%" sub={`命中 ${r.hits} 下`} />
        <Stat label="参与度" value={pct(r.participation)} unit="%" sub={`共 ${r.beats} 拍`} />
        <Stat
          label="平均偏差"
          value={r.meanAbsDeviationMs === null ? '—' : String(Math.round(r.meanAbsDeviationMs))}
          unit="ms"
          sub={r.offsetMs === null ? '没有命中' : `习惯${offsetText(r.offsetMs)}`}
        />
        <Stat
          label="乱挥"
          value={String(r.strays)}
          unit="下"
          sub={r.neutral ? `另有回程和花样 ${r.neutral} 下，不扣分` : '越少越好'}
          warn={r.strays > r.hits * 0.3}
        />
      </Reveal>

      <Reveal>
        <Card title="打法变化" aside={<span>每根柱子是一小节</span>}>
          <DensityStrip timeline={r.timeline} />
        </Card>
      </Reveal>

      <Reveal>
        <Card title="偏差分布" aside={<span>相对你自己的平均位置</span>}>
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
                    <dt>同步率</dt>
                    <dd className="num">{r.sync.toFixed(3)}</dd>
                  </div>
                  <div>
                    <dt>× 参与度</dt>
                    <dd className="num">{r.participation.toFixed(3)}</dd>
                  </div>
                  <div className={styles.total}>
                    <dt>× 100 =</dt>
                    <dd className="num">{fmtScore(r.score)}</dd>
                  </div>
                </dl>
                <ul className={styles.note}>
                  <li>只看每一下落在拍子里的位置，挥多挥少、快慢变化都不影响同步率。</li>
                  <li>
                    命中：这一下离你自己的平均位置在 ±<span className="num">{Math.round(r.windowMs)}</span> ms 内，越近得分越高。
                  </li>
                  <li>乱挥按 0 分算进同步率；回程和偶尔的花样动作不计分也不扣分。</li>
                  <li>参与度：挥动间隔在两拍以内算满，四拍以内算一半。</li>
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </Reveal>

      <Reveal>
        <Card title="导出本局数据">
          <p className={styles.exportHint}>传感器原始数据，发给开发者用来调检测和判定。先标一下这局是什么情况：</p>
          <div className={styles.tags}>
            {EXPORT_TAGS.map((tag) => {
              const on = tags.includes(tag);
              return (
                <motion.button
                  key={tag}
                  type="button"
                  className={styles.tag}
                  data-on={on || undefined}
                  aria-pressed={on}
                  onClick={() => toggleTag(tag)}
                  whileTap={{ scale: 0.94 }}
                >
                  <AnimatePresence initial={false}>
                    {on && (
                      <motion.span
                        className={styles.tagCheck}
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 'auto', opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                      >
                        <Check size={14} strokeWidth={3} aria-hidden />
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {tag}
                </motion.button>
              );
            })}
          </div>
          <Button variant="secondary" icon={Share2} loading={exporting} onClick={onExport} block>
            导出并发送
          </Button>
        </Card>
      </Reveal>
    </Screen>
  );
}

function offsetText(ms: number): string {
  const r = Math.round(ms);
  if (Math.abs(r) < 10) return '踩得很准';
  return r > 0 ? `偏晚 ${r} ms` : `偏早 ${-r} ms`;
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
