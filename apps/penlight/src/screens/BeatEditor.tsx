import {
  beatPeriod,
  chartFromSegment,
  doubleGrid,
  halveGrid,
  shiftGrid,
} from '@linjie/penlight-core';
import { Minus, Play, Plus, RotateCcw, Square } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { BeatStrip } from '../components/BeatStrip';
import { Button, pressSpring } from '../components/Button';
import { Card } from '../components/Card';
import { Reveal, Screen } from '../components/Screen';
import { SegmentPicker } from '../components/SegmentPicker';
import { startGame } from '../game/start';
import { gridOf } from '../lib/analyze';
import { MetronomePreview, unlockAudio } from '../lib/audio';
import { formatBpm, formatTime, signedMs } from '../lib/format';
import { useHoldRepeat } from '../lib/useHoldRepeat';
import { backTo, updateUpload, useStore } from '../store';
import styles from './BeatEditor.module.css';

const PREVIEW_SPAN = 8;
const NUDGE = 0.01;

type PreviewSpot = 'start' | 'middle';

export function BeatEditor() {
  const upload = useStore((s) => s.upload);
  const [spot, setSpot] = useState<PreviewSpot>('start');
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);

  const gridRef = useRef(upload?.grid);
  gridRef.current = upload?.grid;

  const buffer = upload?.song.buffer;
  const preview = useMemo(
    () => (buffer ? new MetronomePreview(buffer, () => gridRef.current!) : null),
    [buffer],
  );

  useEffect(() => {
    if (!preview) return;
    preview.onended = () => setPlaying(false);
    return () => preview.stop();
  }, [preview]);

  // 没有歌（比如刷新后）就回到选歌页
  useEffect(() => {
    if (!upload) backTo('songs');
  }, [upload]);

  const nudgeEarlier = useHoldRepeat(() => nudge(-NUDGE));
  const nudgeLater = useHoldRepeat(() => nudge(NUDGE));

  if (!upload || !preview) return null;

  const { song, grid, segmentFrom, segmentLength } = upload;
  const detected = gridOf(song.detected);
  const period = beatPeriod(grid);
  let shift = (grid.firstBeat - detected.firstBeat) % period;
  if (shift > period / 2) shift -= period;
  if (shift < -period / 2) shift += period;
  const modified = grid.bpm !== detected.bpm || Math.abs(shift) > 1e-6;

  function nudge(seconds: number) {
    const current = useStore.getState().upload;
    if (current) updateUpload({ grid: shiftGrid(current.grid, seconds) });
  }

  const previewFrom = (s: PreviewSpot) =>
    s === 'start'
      ? segmentFrom
      : Math.max(0, Math.min(song.duration - PREVIEW_SPAN, segmentFrom + segmentLength / 2 - PREVIEW_SPAN / 2));

  const togglePreview = (s: PreviewSpot) => {
    if (playing && spot === s) {
      preview.stop();
      setPlaying(false);
      return;
    }
    void unlockAudio();
    setSpot(s);
    preview.start(previewFrom(s), PREVIEW_SPAN);
    setPlaying(true);
  };

  const onSegment = (from: number) => {
    if (playing) {
      preview.stop();
      setPlaying(false);
    }
    updateUpload({ segmentFrom: from });
  };

  const start = async () => {
    preview.stop();
    setPlaying(false);
    setStarting(true);
    await startGame({
      key: `upload:${song.title}`,
      title: song.title,
      buffer: song.buffer,
      chart: chartFromSegment({ grid, from: segmentFrom, length: segmentLength, duration: song.duration }),
    });
    setStarting(false);
  };

  const position = () => preview.position();

  return (
    <Screen
      title="校对节拍"
      footer={
        <Button variant="primary" size="lg" block icon={Play} loading={starting} onClick={start}>
          用这段开始
        </Button>
      }
    >
      <Reveal>
        <div className={styles.song}>
          <p className={styles.songTitle}>{song.title}</p>
          <p className={styles.songMeta}>
            <span className="num">{formatTime(song.duration)}</span>
            <span>·</span>
            <span>识别结果 <span className="num">{formatBpm(detected.bpm)}</span> BPM</span>
          </p>
        </div>
      </Reveal>

      <Reveal>
        <Card
          title="速度"
          aside={
            <AnimatePresence>
              {modified && (
                <motion.span initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}>
                  <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => updateUpload({ grid: detected })}>
                    还原
                  </Button>
                </motion.span>
              )}
            </AnimatePresence>
          }
        >
          <div className={styles.tempo}>
            <motion.button
              type="button"
              className={styles.factor}
              onClick={() => updateUpload({ grid: halveGrid(grid) })}
              whileTap={{ scale: 0.92 }}
              transition={pressSpring}
              aria-label="速度减半"
            >
              ½
            </motion.button>
            <div className={styles.bpm}>
              <AnimatedNumber value={grid.bpm} format={formatBpm} className={`${styles.bpmValue} num`} />
              <span className={styles.bpmUnit}>BPM</span>
            </div>
            <motion.button
              type="button"
              className={styles.factor}
              onClick={() => updateUpload({ grid: doubleGrid(grid) })}
              whileTap={{ scale: 0.92 }}
              transition={pressSpring}
              aria-label="速度加倍"
            >
              ×2
            </motion.button>
          </div>
          <p className={styles.hint}>识别结果常常差一倍。试听时咔哒声比鼓点密一倍就点 ½，稀一半就点 ×2。</p>
        </Card>
      </Reveal>

      <Reveal>
        <Card title="拍子位置">
          <div className={styles.nudge}>
            <motion.button type="button" className={styles.step} aria-label="提前 10 毫秒" whileTap={{ scale: 0.92 }} transition={pressSpring} {...nudgeEarlier}>
              <Minus size={18} strokeWidth={2.4} aria-hidden />
              <span className="num">10 ms</span>
            </motion.button>
            <div className={styles.shift}>
              <AnimatedNumber value={shift * 1000} format={signedMs} duration={0.25} className={`${styles.shiftValue} num`} />
              <span className={styles.shiftUnit}>ms</span>
            </div>
            <motion.button type="button" className={styles.step} aria-label="推后 10 毫秒" whileTap={{ scale: 0.92 }} transition={pressSpring} {...nudgeLater}>
              <Plus size={18} strokeWidth={2.4} aria-hidden />
              <span className="num">10 ms</span>
            </motion.button>
          </div>
          <p className={styles.hint}>咔哒声整体比鼓点早就往后推，晚就往前提。按住可以连续调。</p>
        </Card>
      </Reveal>

      <Reveal>
        <Card title="节拍器叠加原曲">
          <BeatStrip buffer={song.buffer} grid={grid} from={previewFrom(spot)} span={PREVIEW_SPAN} position={position} />
          <div className={styles.previewButtons}>
            {(['start', 'middle'] as const).map((s) => {
              const active = playing && spot === s;
              return (
                <Button key={s} variant={active ? 'primary' : 'secondary'} icon={active ? Square : Play} onClick={() => togglePreview(s)}>
                  {active ? '停止' : s === 'start' ? '试听开头' : '试听中段'}
                </Button>
              );
            })}
          </div>
          <p className={styles.hint}>开头和中段都对得上，说明整首歌不会越打越偏。</p>
        </Card>
      </Reveal>

      <Reveal>
        <Card
          title="游戏片段"
          aside={
            <span className="num">
              {formatTime(segmentFrom)}–{formatTime(segmentFrom + segmentLength)}
            </span>
          }
        >
          <SegmentPicker
            peaks={song.peaks}
            duration={song.duration}
            from={segmentFrom}
            length={segmentLength}
            onChange={onSegment}
            position={position}
          />
          <p className={styles.hint}>拖动高亮区域选一段 {Math.round(segmentLength)} 秒，建议选副歌。节拍只分析了前 90 秒，后面按同样的速度延伸。</p>
        </Card>
      </Reveal>
    </Screen>
  );
}
