import {
  chartFromSegment,
  TEST_TRACK_BPM,
  TEST_TRACK_CHART,
  TEST_TRACK_DURATION,
} from '@linjie/penlight-core';
import { AudioWaveform, Check, FileAudio, Music2, Play, SlidersHorizontal, Upload } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Notice } from '../components/Notice';
import { Reveal, Screen } from '../components/Screen';
import { Segmented } from '../components/Segmented';
import { SongCard } from '../components/SongCard';
import { Spinner } from '../components/Spinner';
import { startGame } from '../game/start';
import { AnalyzeError, analyzeFile, gridOf, type AnalyzeStage } from '../lib/analyze';
import { formatBpm, formatTime } from '../lib/format';
import { testTrackBuffer } from '../lib/testTrack';
import {
  bestScore,
  navigate,
  SEGMENT_LENGTH,
  setInputMode,
  setUpload,
  useStore,
  type InputMode,
  type Song,
} from '../store';
import styles from './SongSelect.module.css';

const STAGES: { key: AnalyzeStage; label: string }[] = [
  { key: 'decode', label: '读取音频' },
  { key: 'prepare', label: '截取前 90 秒' },
  { key: 'detect', label: '识别节拍' },
  { key: 'fit', label: '拟合节拍网格' },
];

type Analysis =
  | { state: 'idle' }
  | { state: 'running'; stage: AnalyzeStage; name: string }
  | { state: 'error'; title: string; hint: string };

function useTestTrack() {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    testTrackBuffer().then(
      (b) => alive && setBuffer(b),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);
  return { buffer, failed };
}

export function SongSelect() {
  const upload = useStore((s) => s.upload);
  const inputMode = useStore((s) => s.inputMode);
  const sensitivity = useStore((s) => s.sensitivity);
  const permission = useStore((s) => s.motionPermission);
  const [selected, setSelected] = useState<'test' | 'upload'>(upload ? 'upload' : 'test');
  const [analysis, setAnalysis] = useState<Analysis>({ state: 'idle' });
  const [starting, setStarting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const test = useTestTrack();

  const testBest = bestScore('test');
  const uploadKey = upload ? `upload:${upload.song.title}` : '';
  const uploadBest = upload ? bestScore(uploadKey) : null;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setAnalysis({ state: 'running', stage: 'decode', name: file.name });
    try {
      const song = await analyzeFile(file, (stage) => setAnalysis({ state: 'running', stage, name: file.name }));
      setUpload({
        song,
        grid: gridOf(song.detected),
        segmentFrom: 0,
        segmentLength: Math.min(SEGMENT_LENGTH, song.duration),
      });
      setSelected('upload');
      setAnalysis({ state: 'idle' });
      navigate('editor');
    } catch (error) {
      const e = error instanceof AnalyzeError ? error : new AnalyzeError('分析失败', String(error));
      setAnalysis({ state: 'error', title: e.message, hint: e.hint });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onMode = (mode: InputMode) => {
    setInputMode(mode);
    if (mode === 'motion' && permission !== 'granted') navigate('sensor');
  };

  const song: Song | null =
    selected === 'test'
      ? test.buffer && { key: 'test', title: '内置测试曲', buffer: test.buffer, chart: TEST_TRACK_CHART }
      : upload && {
          key: uploadKey,
          title: upload.song.title,
          buffer: upload.song.buffer,
          chart: chartFromSegment({
            grid: upload.grid,
            from: upload.segmentFrom,
            length: upload.segmentLength,
            duration: upload.song.duration,
          }),
        };

  const start = async () => {
    if (!song) return;
    setStarting(true);
    await startGame(song);
    setStarting(false);
  };

  const running = analysis.state === 'running';

  return (
    <Screen
      title="选歌"
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          icon={Play}
          loading={starting || (selected === 'test' && !test.buffer && !test.failed)}
          disabled={!song || running}
          onClick={start}
        >
          开始游戏
        </Button>
      }
    >
      <Reveal>
        <div className={styles.list} role="radiogroup" aria-label="歌曲">
          <SongCard
            icon={AudioWaveform}
            title="内置测试曲"
            selected={selected === 'test'}
            onSelect={() => setSelected('test')}
            meta={
              <>
                <span className="num">{TEST_TRACK_BPM} BPM</span>
                <span className={styles.sep} />
                <span className="num">{formatTime(TEST_TRACK_DURATION)}</span>
                <span className={styles.sep} />
                <span className={`${styles.chords} num`}>F G Em Am</span>
                {testBest !== null && <Best score={testBest} />}
              </>
            }
          />

          <AnimatePresence initial={false}>
            {upload && (
              <motion.div
                key="upload"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              >
                <SongCard
                  icon={Music2}
                  title={upload.song.title}
                  selected={selected === 'upload'}
                  onSelect={() => setSelected('upload')}
                  meta={
                    <>
                      <span className="num">{formatBpm(upload.grid.bpm)} BPM</span>
                      <span className={styles.sep} />
                      <span className="num">
                        {formatTime(upload.segmentFrom)}–{formatTime(upload.segmentFrom + upload.segmentLength)}
                      </span>
                      {uploadBest !== null && <Best score={uploadBest} />}
                    </>
                  }
                  footer={
                    <>
                      <span>节拍不准？</span>
                      <Button size="sm" variant="secondary" icon={SlidersHorizontal} onClick={() => navigate('editor')}>
                        校对节拍
                      </Button>
                    </>
                  }
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Reveal>

      {test.failed && selected === 'test' && (
        <Notice tone="danger" title="测试曲没能生成">
          这个浏览器的 Web Audio 不完整。换成最新版 Chrome 或 Safari 再试。
        </Notice>
      )}

      <Reveal>
        <motion.button
          type="button"
          className={styles.drop}
          data-busy={running || undefined}
          disabled={running}
          onClick={() => fileRef.current?.click()}
          whileTap={running ? undefined : { scale: 0.985 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {running ? (
              <motion.div
                key="progress"
                className={styles.progress}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <p className={styles.fileName}>
                  <FileAudio size={16} aria-hidden />
                  <span>{analysis.name}</span>
                </p>
                <ol className={styles.stages}>
                  {STAGES.map((s, i) => {
                    const current = STAGES.findIndex((x) => x.key === analysis.stage);
                    const state = i < current ? 'done' : i === current ? 'active' : 'todo';
                    return (
                      <li key={s.key} data-state={state}>
                        <span className={styles.stageIcon}>
                          {state === 'done' ? <Check size={14} strokeWidth={3} /> : state === 'active' ? <Spinner size={14} /> : null}
                        </span>
                        {s.label}
                        {state === 'active' && s.key === 'detect' && <span className={styles.stageNote}>手机上要十几秒</span>}
                      </li>
                    );
                  })}
                </ol>
                <div className={styles.shimmer} aria-hidden />
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                className={styles.dropIdle}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <span className={styles.dropIcon}>
                  <Upload size={20} strokeWidth={2} aria-hidden />
                </span>
                <span className={styles.dropTitle}>{upload ? '换一首歌' : '上传歌曲'}</span>
                <span className={styles.dropHint}>mp3、m4a、wav 都行，自动识别 BPM</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg"
          className="visually-hidden"
          tabIndex={-1}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </Reveal>

      <AnimatePresence initial={false}>
        {analysis.state === 'error' && (
          <motion.div
            key="err"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <Notice
              tone="danger"
              title={analysis.title}
              actions={
                <Button size="sm" variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>
                  重新选择文件
                </Button>
              }
            >
              {analysis.hint}
            </Notice>
          </motion.div>
        )}
      </AnimatePresence>

      <Reveal>
        <Card title="输入方式">
          <Segmented
            label="输入方式"
            value={inputMode}
            onChange={onMode}
            options={[
              { value: 'motion', label: '挥动手机', hint: `灵敏度 ${sensitivity}` },
              { value: 'tap', label: '点屏幕', hint: '电脑可按空格' },
            ]}
          />
          {inputMode === 'motion' && (
            <Button size="sm" variant="ghost" icon={SlidersHorizontal} onClick={() => navigate('sensor')} className={styles.tune}>
              调整灵敏度
            </Button>
          )}
        </Card>
      </Reveal>
    </Screen>
  );
}

function Best({ score }: { score: number }) {
  return (
    <>
      <span className={styles.sep} />
      <span className={styles.best}>
        最佳 <span className="num">{score.toFixed(1)}</span>
      </span>
    </>
  );
}
