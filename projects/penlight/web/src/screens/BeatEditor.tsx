import {
  averageBpm,
  beatTime,
  buildBeatMap,
  MIN_SELECTION_SECONDS,
  nearestBar,
  nearestBeat,
  recommendSelection,
  rescaleRange,
  shiftMap,
  spliceMap,
  tempoSections,
  type TempoSection,
} from '@linjie/penlight-core';
import { Drum, Hand, Minus, Pause, Play, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { BeatStrip } from '../components/BeatStrip';
import { Button, IconButton, pressSpring } from '../components/Button';
import { Card } from '../components/Card';
import { Notice } from '../components/Notice';
import { Reveal, Screen } from '../components/Screen';
import { Spinner } from '../components/Spinner';
import { TrimWaveform, type Range } from '../components/TrimWaveform';
import { startGame } from '../game/start';
import { EditorPlayer, unlockAudio } from '../lib/audio';
import { formatBpm, formatTime, signedMs } from '../lib/format';
import { barNumber, snapToBar, songForUpload } from '../lib/upload';
import { useHoldRepeat } from '../lib/useHoldRepeat';
import { backTo, showToast, updateUpload, useStore, type UploadState } from '../store';
import styles from './BeatEditor.module.css';

const NUDGE = 0.01;

function fmtPrecise(t: number): string {
  const s = Math.max(0, t);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function BeatEditor() {
  const upload = useStore((s) => s.upload);
  const live = useRef(upload);
  live.current = upload;

  const buffer = upload?.song.buffer;
  const player = useMemo(
    () => (buffer ? new EditorPlayer(buffer, () => live.current!.map, () => live.current!.downbeat) : null),
    [buffer],
  );
  const [playing, setPlaying] = useState(false);
  const [metronome, setMetronome] = useState(true);
  const [edge, setEdge] = useState<'start' | 'end' | null>(null);
  const [section, setSection] = useState<number | null>(null);
  const [tapping, setTapping] = useState(false);
  const [starting, setStarting] = useState(false);
  const cursor = useRef(upload?.selection.start ?? 0);
  const timeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!player) return;
    player.onended = () => setPlaying(false);
    return () => player.stop();
  }, [player]);

  useEffect(() => {
    if (player) player.metronome = metronome;
  }, [player, metronome]);

  useEffect(() => {
    if (!upload) backTo('songs');
  }, [upload]);

  // 播放时间只改文字，不触发重渲染
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const p = player?.position();
      if (timeRef.current) timeRef.current.textContent = formatTime(p ?? cursor.current);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player]);

  const nudgeEarlier = useHoldRepeat(() => shift(-NUDGE));
  const nudgeLater = useHoldRepeat(() => shift(NUDGE));

  if (!upload || !player) return null;
  const u = upload;
  const { song, map, selection } = u;
  const now = () => player.position() ?? cursor.current;

  const sections = tempoSections(map).filter((s) => s.endTime > 0 && s.startTime < song.duration);
  const varying = sections.length > 1;
  const activeSection = varying && section !== null ? sections[section] : undefined;
  const inSelection = map.times.filter((t) => t >= selection.start && t <= selection.end);
  const selectionBpm = averageBpm(inSelection.length > 2 ? { times: inSelection } : map);

  function patch(p: Partial<UploadState>, edit = false) {
    updateUpload(edit ? { ...p, edited: true } : p);
  }

  function shift(seconds: number) {
    const c = useStore.getState().upload;
    if (c) patch({ map: shiftMap(c.map, seconds), downbeat: c.downbeat + seconds }, true);
  }

  const playFrom = (t: number, until?: number) => {
    void unlockAudio();
    cursor.current = Math.max(0, t);
    player.play(cursor.current, until);
    setPlaying(true);
  };

  const togglePlay = () => {
    if (playing) {
      cursor.current = now();
      player.stop();
      setPlaying(false);
    } else {
      playFrom(cursor.current);
    }
  };

  const seek = (t: number) => {
    cursor.current = t;
    if (playing) playFrom(t);
  };

  const setSelection = (r: Range) => patch({ selection: r });

  const markStart = () => {
    const s = snapToBar(u, now(), 'start');
    let end = selection.end;
    if (end - s < MIN_SELECTION_SECONDS) end = Math.min(song.duration, snapToBar(u, s + 60, 'end'));
    setSelection({ start: s, end });
    showToast(`开头设在 ${fmtPrecise(s)}（第 ${barNumber(u, s)} 小节）`);
  };

  const markEnd = () => {
    const e = snapToBar(u, now(), 'end');
    if (e - selection.start < MIN_SELECTION_SECONDS) {
      showToast(`片段至少 ${MIN_SELECTION_SECONDS} 秒，结尾要在 ${fmtPrecise(selection.start + MIN_SELECTION_SECONDS)} 之后`);
      return;
    }
    setSelection({ start: selection.start, end: e });
    showToast(`结尾设在 ${fmtPrecise(e)}`);
  };

  const nudgeEdge = (which: 'start' | 'end', dir: -1 | 1) => {
    const t = which === 'start' ? selection.start : selection.end;
    const bar = nearestBar(map, Math.min(t, song.duration - 0.01), u.downbeat) + dir * 4;
    let next = beatTime(map, bar);
    if (which === 'end' && next > song.duration) next = song.duration;
    if (next < 0) return;
    const r = which === 'start' ? { start: next, end: selection.end } : { start: selection.start, end: next };
    if (r.end - r.start < MIN_SELECTION_SECONDS) return;
    setSelection(r);
    playFrom(which === 'start' ? r.start : Math.max(0, r.end - 4), which === 'start' ? r.start + 4 : r.end);
  };

  const rescale = (mode: 'half' | 'double') => {
    const range = activeSection ?? { startBeat: 0, endBeat: map.times.length - 1 };
    patch({ map: rescaleRange(map, range.startBeat, range.endBeat, mode) }, true);
    setSection(null);
  };

  const setDownbeat = () => {
    const t = beatTime(map, nearestBeat(map, now()).index);
    patch({ downbeat: t, downbeatManual: true });
    showToast('已把这一拍设为小节第一拍，片段起止会按新的小节线对齐');
  };

  const applyTaps = (taps: number[]) => {
    const built = buildBeatMap(taps, { duration: song.duration, pad: 0 });
    const gaps = taps.slice(1).map((t, i) => t - taps[i]!);
    const p = gaps.sort((a, b) => a - b)[gaps.length >> 1]!;
    patch({ map: spliceMap(map, built.times, taps[0]! - 0.3 * p, taps[taps.length - 1]! + 0.3 * p) }, true);
    showToast(`已用你敲的 ${taps.length} 拍替换这一段的节拍`);
  };

  const preview = (where: 'start' | 'middle' | 'end') => {
    if (where === 'start') playFrom(selection.start - 2, selection.start + 6);
    else if (where === 'middle') {
      const m = (selection.start + selection.end) / 2;
      playFrom(m - 4, m + 4);
    } else playFrom(selection.end - 8, selection.end);
  };

  const start = async () => {
    player.stop();
    setPlaying(false);
    setStarting(true);
    await startGame(songForUpload(u));
    setStarting(false);
  };

  const length = selection.end - selection.start;
  const bars = Math.round((beatTimeIndex(selection.end) - beatTimeIndex(selection.start)) / 4);
  function beatTimeIndex(t: number) {
    return nearestBeat(map, t).index;
  }

  return (
    <Screen
      title="选段和节拍"
      footer={
        <>
          <div className={styles.player}>
            <IconButton icon={playing ? Pause : Play} label={playing ? '暂停' : '播放'} variant="filled" onClick={togglePlay} className={styles.playBtn} />
            <span ref={timeRef} className={`${styles.time} num`}>
              0:00
            </span>
            <Button size="sm" variant="secondary" onClick={markStart}>
              设为开头
            </Button>
            <Button size="sm" variant="secondary" onClick={markEnd}>
              设为结尾
            </Button>
          </div>
          <Button variant="primary" size="lg" block icon={Play} loading={starting} onClick={start}>
            用这段开始
          </Button>
        </>
      }
    >
      <Reveal>
        <div className={styles.song}>
          <p className={styles.songTitle}>{song.title}</p>
          <p className={styles.songMeta}>
            <span className="num">{formatTime(song.duration)}</span>
            <span>·</span>
            <span>{varying ? `变速 ${sections.length} 段` : <><span className="num">{formatBpm(averageBpm(map))}</span> BPM</>}</span>
            {u.analysis === 'partial' && (
              <span className={styles.analyzing}>
                <Spinner size={12} /> 正在分析后半段节拍
              </span>
            )}
          </p>
        </div>
      </Reveal>

      <AnimatePresence initial={false}>
        {u.pendingFull && (
          <motion.div key="pending" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <Notice
              title="整首歌的节拍分析完了"
              actions={
                <>
                  <Button size="sm" variant="primary" onClick={() => patch({ map: u.pendingFull!, detected: u.pendingFull!, pendingFull: null, edited: false })}>
                    换成完整结果
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => patch({ pendingFull: null })}>
                    保留我的修改
                  </Button>
                </>
              }
            >
              你已经改过节拍，所以没有自动替换。完整结果对后半段更准，换上后你的修改会丢掉。
            </Notice>
          </motion.div>
        )}
        {u.analysis === 'failed' && (
          <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Notice tone="warning" title="后半段节拍没分析完">
              90 秒之后的节拍按前面的速度往后推算。如果后面对不上，可以用「跟着敲」手动标。
            </Notice>
          </motion.div>
        )}
      </AnimatePresence>

      <Reveal>
        <Card
          title="游戏片段"
          aside={
            <span className="num">
              {formatTime(length)} · {bars} 小节
            </span>
          }
        >
          <p className={styles.hint}>播放时听到想要的地方，点下面的「设为开头」「设为结尾」，会自动对齐到小节线。也可以直接拖两头的圆点。</p>
          <TrimWaveform
            peaks={song.peaks}
            duration={song.duration}
            selection={selection}
            minLength={MIN_SELECTION_SECONDS}
            onChange={setSelection}
            snap={(t, e) => snapToBar(u, t, e)}
            describe={(t) => `${fmtPrecise(t)} · 第 ${barNumber(u, t)} 小节`}
            onNudge={nudgeEdge}
            onSeek={seek}
            position={() => player.position()}
          />
          <div className={styles.edges}>
            {(['start', 'end'] as const).map((which) => {
              const t = which === 'start' ? selection.start : selection.end;
              const open = edge === which;
              return (
                <button
                  key={which}
                  type="button"
                  className={styles.edge}
                  data-open={open || undefined}
                  data-edge={which}
                  aria-expanded={open}
                  onClick={() => setEdge(open ? null : which)}
                >
                  <span className={styles.edgeLabel}>{which === 'start' ? '开头' : '结尾'}</span>
                  <span className={`${styles.edgeTime} num`}>{fmtPrecise(t)}</span>
                  <span className={styles.edgeBar}>第 {barNumber(u, Math.min(t, song.duration - 0.01))} 小节</span>
                </button>
              );
            })}
          </div>
          <AnimatePresence initial={false}>
            {edge && (
              <motion.div
                key={edge}
                className={styles.stepper}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              >
                <div className={styles.stepperInner}>
                  <Button size="sm" variant="secondary" icon={Minus} onClick={() => nudgeEdge(edge, -1)}>
                    前移一小节
                  </Button>
                  <Button size="sm" variant="secondary" icon={Plus} onClick={() => nudgeEdge(edge, 1)}>
                    后移一小节
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className={styles.quick}>
            <Button
              size="sm"
              variant="ghost"
              icon={Sparkles}
              onClick={() => setSelection(recommendSelection(map, song.env, u.downbeat, song.duration, 60))}
            >
              推荐副歌
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelection({ start: snapToBar(u, 0, 'start'), end: song.duration })}>
              整首
            </Button>
          </div>
        </Card>
      </Reveal>

      <Reveal>
        <Card
          title="速度"
          aside={
            u.edited ? (
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => patch({ map: u.detected, edited: false })}>
                还原
              </Button>
            ) : undefined
          }
        >
          {varying ? (
            <>
              <p className={styles.hint}>这首歌中途变速，节拍已经按段对齐。某一段听起来快了一倍或慢了一半，就选中那一段再点 ½ 或 ×2。</p>
              <TempoStrip sections={sections} duration={song.duration} selected={section} onSelect={setSection} />
            </>
          ) : null}
          <div className={styles.tempo}>
            <motion.button type="button" className={styles.factor} onClick={() => rescale('half')} whileTap={{ scale: 0.92 }} transition={pressSpring} aria-label="速度减半">
              ½
            </motion.button>
            <div className={styles.bpm}>
              <AnimatedNumber value={activeSection ? activeSection.bpm : selectionBpm} format={formatBpm} className={`${styles.bpmValue} num`} />
              <span className={styles.bpmUnit}>{activeSection ? '所选这段 BPM' : varying ? '片段平均 BPM' : 'BPM'}</span>
            </div>
            <motion.button type="button" className={styles.factor} onClick={() => rescale('double')} whileTap={{ scale: 0.92 }} transition={pressSpring} aria-label="速度加倍">
              ×2
            </motion.button>
          </div>
          {!varying && <p className={styles.hint}>识别结果常常差一倍。试听时咔哒声比鼓点密一倍就点 ½，稀一半就点 ×2。</p>}
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
              <AnimatedNumber value={(map.times[0]! - u.detected.times[0]!) * 1000} format={signedMs} duration={0.25} className={`${styles.shiftValue} num`} />
              <span className={styles.shiftUnit}>ms</span>
            </div>
            <motion.button type="button" className={styles.step} aria-label="推后 10 毫秒" whileTap={{ scale: 0.92 }} transition={pressSpring} {...nudgeLater}>
              <Plus size={18} strokeWidth={2.4} aria-hidden />
              <span className="num">10 ms</span>
            </motion.button>
          </div>
          <p className={styles.hint}>咔哒声整体比鼓点早就往后推，晚就往前提。按住可以连续调。</p>
          <div className={styles.row2}>
            <Button size="sm" variant="secondary" icon={Drum} onClick={setDownbeat}>
              这一拍是小节第一拍
            </Button>
            <Button size="sm" variant="secondary" icon={Hand} onClick={() => { player.stop(); setPlaying(false); setTapping(true); }}>
              跟着敲
            </Button>
          </div>
          <p className={styles.hint}>高音的咔哒声是小节第一拍。不对的话，播放到正确的第一拍时点左边按钮。自动识别完全对不上时，用「跟着敲」手动标这一段的拍子。</p>
        </Card>
      </Reveal>

      <Reveal>
        <Card
          title="对拍试听"
          aside={
            <button type="button" className={styles.toggle} data-on={metronome || undefined} onClick={() => setMetronome((m) => !m)} aria-pressed={metronome}>
              节拍器{metronome ? '开' : '关'}
            </button>
          }
        >
          <BeatStrip
            buffer={song.buffer}
            map={map}
            downbeat={u.downbeat}
            center={() => player.position() ?? cursor.current}
            playing={() => player.playing}
          />
          <div className={styles.previewButtons}>
            <Button size="sm" variant="secondary" onClick={() => preview('start')}>
              听开头
            </Button>
            <Button size="sm" variant="secondary" onClick={() => preview('middle')}>
              听中段
            </Button>
            <Button size="sm" variant="secondary" onClick={() => preview('end')}>
              听结尾
            </Button>
          </div>
          <p className={styles.hint}>开头、中段、结尾的咔哒声都和鼓点重合，说明整段不会越打越偏。</p>
        </Card>
      </Reveal>

      <AnimatePresence>
        {tapping && (
          <TapAlong
            buffer={song.buffer}
            selection={selection}
            onClose={() => setTapping(false)}
            onDone={(taps) => {
              setTapping(false);
              applyTaps(taps);
            }}
          />
        )}
      </AnimatePresence>
    </Screen>
  );
}

function TempoStrip({
  sections,
  duration,
  selected,
  onSelect,
}: {
  sections: TempoSection[];
  duration: number;
  selected: number | null;
  onSelect: (i: number | null) => void;
}) {
  return (
    <div className={styles.tempoStrip} role="radiogroup" aria-label="速度分段">
      {sections.map((s, i) => {
        const a = Math.max(0, s.startTime);
        const b = Math.min(duration, s.endTime);
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={selected === i}
            className={styles.tempoSeg}
            data-on={selected === i || undefined}
            style={{ flexGrow: Math.max(0.12, (b - a) / duration) }}
            onClick={() => onSelect(selected === i ? null : i)}
          >
            <span className="num">{formatBpm(s.bpm)}</span>
            <span className={`${styles.tempoRange} num`}>
              {formatTime(a)}–{formatTime(b)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 跟着音乐在屏幕上敲拍子，敲出来的拍点替换这一段的节拍。 */
function TapAlong({
  buffer,
  selection,
  onClose,
  onDone,
}: {
  buffer: AudioBuffer;
  selection: Range;
  onClose: () => void;
  onDone: (taps: number[]) => void;
}) {
  const [player] = useState(() => new EditorPlayer(buffer, () => ({ times: [0, 1] }), () => 0));
  const [running, setRunning] = useState(false);
  const [taps, setTaps] = useState<number[]>([]);
  const padRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    player.metronome = false;
    player.onended = () => setRunning(false);
    return () => player.stop();
  }, [player]);

  const begin = () => {
    void unlockAudio();
    setTaps([]);
    player.play(Math.max(0, selection.start - 4), selection.end);
    setRunning(true);
  };

  const tap = (e: PointerEvent) => {
    const pos = player.position();
    if (pos === null) return;
    const t = pos - (performance.now() - e.timeStamp) / 1000;
    setTaps((list) => [...list, t]);
    padRef.current?.animate([{ transform: 'scale(0.97)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  };

  const finish = () => {
    player.stop();
    if (taps.length < 8) {
      showToast('至少要敲 8 下');
      return;
    }
    onDone(taps);
  };

  return (
    <motion.div
      className={styles.tapSheet}
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={{ type: 'spring', stiffness: 380, damping: 36 }}
    >
      <div className={styles.tapHead}>
        <h2>跟着敲拍子</h2>
        <IconButton icon={X} label="关闭" onClick={onClose} />
      </div>
      <p className={styles.hint}>从片段开头前 4 秒开始播放。听着音乐，每一拍在下面的区域点一下，一直敲到片段结束或者你想停的地方。</p>
      <button ref={padRef} type="button" className={styles.tapPad} data-running={running || undefined} onPointerDown={running ? tap : undefined} disabled={!running}>
        <span className={`${styles.tapCount} num`}>{taps.length}</span>
        <span>{running ? '每拍点一下' : taps.length ? '敲完了' : '先点下面的「开始播放」'}</span>
      </button>
      <div className={styles.tapActions}>
        <Button variant="secondary" size="lg" icon={running ? Pause : Play} onClick={running ? () => { player.stop(); setRunning(false); } : begin}>
          {running ? '停止' : taps.length ? '重新敲' : '开始播放'}
        </Button>
        <Button variant="primary" size="lg" onClick={finish} disabled={taps.length < 8}>
          用这 {taps.length} 拍
        </Button>
      </div>
    </motion.div>
  );
}
