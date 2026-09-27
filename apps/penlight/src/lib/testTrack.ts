import {
  TEST_TRACK_BPM,
  TEST_TRACK_DURATION,
  TEST_TRACK_FIRST_BEAT,
} from '@linjie/penlight-core';

/**
 * 内置测试曲：用 Web Audio 离线合成，拍点和谱面完全一致。
 * 四踩底鼓 + 八分反拍镲 + 八度贝斯，和弦走 IV–V–iii–vi。
 */

const SR = 44100;
const BEAT = 60 / TEST_TRACK_BPM;
const beatAt = (i: number) => TEST_TRACK_FIRST_BEAT + i * BEAT;
const barAt = (bar: number, beat = 0) => beatAt(bar * 4 + beat);
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

type ChordName = 'F' | 'G' | 'Em' | 'Am' | 'Dm' | 'C';
const CHORDS: Record<ChordName, { bass: number; notes: number[] }> = {
  F: { bass: 41, notes: [53, 57, 60, 64] },
  G: { bass: 43, notes: [55, 59, 62, 65] },
  Em: { bass: 40, notes: [52, 55, 59, 62] },
  Am: { bass: 45, notes: [57, 60, 64, 67] },
  Dm: { bass: 38, notes: [50, 53, 57, 60] },
  C: { bass: 36, notes: [60, 64, 67, 72] },
};

const LOOP: ChordName[] = ['F', 'G', 'Em', 'Am'];
/** 每小节的和弦，下标是小节号。第 0 小节是预备拍。 */
const BARS: (ChordName | null)[] = [
  null,
  'F', 'G',
  ...LOOP, ...LOOP,
  'Dm', 'Em', 'F', 'G',
  ...LOOP, ...LOOP,
  ...LOOP, 'F', 'G',
  'C',
];

/** 副歌旋律：[小节内拍位, MIDI 音高, 时值（拍）] */
const CHORUS: [number, number, number][][] = [
  [[0, 72, 1], [1, 69, 0.5], [1.5, 72, 0.5], [2, 77, 1], [3, 76, 1]],
  [[0, 74, 1.5], [1.5, 71, 0.5], [2, 74, 1], [3, 79, 1]],
  [[0, 76, 1], [1, 74, 0.5], [1.5, 71, 0.5], [2, 67, 1], [3, 71, 1]],
  [[0, 72, 1.5], [1.5, 71, 0.5], [2, 69, 2]],
  [[0, 69, 0.5], [0.5, 72, 0.5], [1, 77, 1], [2, 76, 0.5], [2.5, 77, 0.5], [3, 79, 1]],
  [[0, 81, 1.5], [1.5, 79, 0.5], [2, 77, 1], [3, 74, 1]],
  [[0, 76, 1], [1, 79, 1], [2, 83, 1], [3, 81, 0.5], [3.5, 79, 0.5]],
  [[0, 81, 3.5]],
];

const VERSE = { from: 3, to: 10 };
const PRE = { from: 11, to: 14 };
const CHORUS1 = { from: 15, to: 22 };
const CHORUS2 = { from: 23, to: 28 };
const FINAL_BAR = 29;

export async function renderTestTrack(): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(TEST_TRACK_DURATION * SR), SR);

  const noise = ctx.createBuffer(1, SR, SR);
  const nd = noise.getChannelData(0);
  let seed = 39;
  for (let i = 0; i < nd.length; i++) {
    seed = (seed * 16807) % 2147483647;
    nd[i] = (seed / 2147483647) * 2 - 1;
  }

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.12;
  const master = ctx.createGain();
  master.gain.value = 0.72;
  master.connect(comp).connect(ctx.destination);

  // 和声与贝斯走一条随底鼓闪避的总线，听起来更有律动。
  const duck = ctx.createGain();
  duck.connect(master);
  for (let i = 4; i <= FINAL_BAR * 4; i++) {
    const t = beatAt(i);
    duck.gain.setValueAtTime(0.5, t);
    duck.gain.linearRampToValueAtTime(1, t + BEAT * 0.7);
  }

  // 主旋律的附点八分延迟
  const delay = ctx.createDelay(1);
  delay.delayTime.value = BEAT * 0.75;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const delayTone = ctx.createBiquadFilter();
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 2600;
  const delayOut = ctx.createGain();
  delayOut.gain.value = 0.28;
  delay.connect(delayTone).connect(feedback).connect(delay);
  delayTone.connect(delayOut).connect(master);

  const panner = (pan: number, dest: AudioNode) => {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(dest);
    return p;
  };

  const noiseHit = (t: number, dest: AudioNode, type: BiquadFilterType, freq: number, q: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f).connect(dest);
    src.start(t, Math.random() * 0.5);
    return src;
  };

  const env = (t: number, peak: number, attack: number, decay: number, dest: AudioNode) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  };

  const kick = (t: number, level = 1) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    o.connect(env(t, 0.95 * level, 0.002, 0.34, master));
    o.start(t);
    o.stop(t + 0.4);
    noiseHit(t, env(t, 0.12 * level, 0.001, 0.012, master), 'highpass', 3500, 0.7).stop(t + 0.03);
  };

  const clap = (t: number, level = 1) => {
    const out = panner(0.05, master);
    for (const [dt, peak, decay] of [[0, 0.3, 0.01], [0.011, 0.28, 0.012], [0.022, 0.34, 0.16]] as const) {
      noiseHit(t + dt, env(t + dt, peak * level, 0.001, decay, out), 'bandpass', 1400, 0.9).stop(t + dt + decay + 0.02);
    }
    const body = ctx.createOscillator();
    body.frequency.setValueAtTime(220, t);
    body.frequency.exponentialRampToValueAtTime(160, t + 0.05);
    body.connect(env(t, 0.14 * level, 0.001, 0.07, out));
    body.start(t);
    body.stop(t + 0.1);
  };

  const hat = (t: number, open: boolean, level = 1) => {
    const decay = open ? 0.16 : 0.035;
    noiseHit(t, env(t, (open ? 0.1 : 0.12) * level, 0.001, decay, panner(-0.25, master)), 'highpass', 7500, 0.6).stop(t + decay + 0.02);
  };

  const crash = (t: number) => {
    noiseHit(t, env(t, 0.16, 0.002, 1.8, panner(0.3, master)), 'highpass', 4200, 0.4).stop(t + 2);
  };

  const stick = (t: number, high: boolean) => {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = high ? 1650 : 1250;
    o.connect(env(t, 0.5, 0.001, 0.05, master));
    o.start(t);
    o.stop(t + 0.08);
  };

  const bassNote = (t: number, midi: number, dur: number) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(260, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26, t + 0.006);
    g.gain.setValueAtTime(0.26, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(duck);
    o.start(t);
    o.stop(t + dur + 0.02);
  };

  const padChord = (t: number, notes: number[], dur: number, level = 1) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.055 * level, t + 0.06);
    g.gain.setValueAtTime(0.055 * level, t + dur - 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    f.connect(g).connect(duck);
    notes.forEach((n, k) => {
      for (const detune of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(n);
        o.detune.value = detune;
        o.connect(panner(detune < 0 ? -0.35 + k * 0.05 : 0.35 - k * 0.05, f));
        o.start(t);
        o.stop(t + dur + 0.3);
      }
    });
  };

  const pluck = (t: number, midi: number) => {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = hz(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3800, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.18);
    o.connect(f).connect(env(t, 0.05, 0.002, 0.2, panner(0.4, master)));
    o.start(t);
    o.stop(t + 0.25);
  };

  const leadNote = (t: number, midi: number, dur: number, level = 1) => {
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.1 * level, t + 0.012);
    out.gain.setValueAtTime(0.085 * level, t + Math.max(0.02, dur - 0.05));
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 4200;
    f.connect(out);
    out.connect(master);
    out.connect(delay);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(dur > 0.6 ? 14 : 0, t + Math.min(dur, 0.5));
    vibrato.connect(depth);
    for (const [type, detune] of [['square', 0], ['sawtooth', 7]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(midi);
      o.detune.value = detune;
      depth.connect(o.detune);
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    vibrato.start(t);
    vibrato.stop(t + dur + 0.1);
  };

  // 预备拍
  for (let i = 0; i < 4; i++) stick(beatAt(i), i === 0);

  for (let bar = 1; bar <= CHORUS2.to; bar++) {
    const chord = CHORDS[BARS[bar]!];
    const inPre = bar >= PRE.from && bar <= PRE.to;
    const inChorus = bar >= CHORUS1.from;

    for (let b = 0; b < 4; b++) {
      const t = barAt(bar, b);
      kick(t, bar === PRE.to && b >= 2 ? 0.8 : 1);
      if (b % 2 === 1) clap(t, bar < VERSE.from ? 0.8 : 1);
      if (bar >= VERSE.from) {
        hat(t + BEAT / 2, inChorus, inChorus ? 1 : 0.85);
        if (inChorus) hat(t, false, 0.45);
      }
      // 八度跳跃的八分贝斯
      bassNote(t, chord.bass, BEAT * 0.45);
      bassNote(t + BEAT / 2, chord.bass + 12, BEAT * 0.4);
    }

    if (bar >= VERSE.from) padChord(barAt(bar), chord.notes, BEAT * 4, inChorus ? 1.2 : 1);

    if (bar >= VERSE.from && bar <= VERSE.to) {
      const arp = [...chord.notes, chord.notes[1]! + 12, chord.notes[2]! + 12, chord.notes[3]! + 12, chord.notes[2]! + 12];
      arp.forEach((n, k) => pluck(barAt(bar) + (k * BEAT) / 2, n + 12));
    }

    if (inPre && bar === PRE.to) {
      // 导歌最后一小节：军鼓加密，推进副歌
      for (let k = 0; k < 4; k++) clap(barAt(bar) + (k * BEAT) / 2, 0.35 + k * 0.08);
      for (let k = 0; k < 8; k++) clap(barAt(bar, 2) + (k * BEAT) / 4, 0.5 + k * 0.07);
    }
    if (bar === PRE.from + 2) {
      // 两小节的噪声上扬
      const t = barAt(bar);
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 2.5;
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(7000, t + BEAT * 8);
      src.connect(f).connect(env(t, 0.08, BEAT * 7.8, 0.04, panner(-0.1, master)));
      src.start(t);
      src.stop(t + BEAT * 8);
    }

    if (bar >= CHORUS1.from) {
      const phrase = bar <= CHORUS1.to ? bar - CHORUS1.from : bar - CHORUS2.from;
      for (const [pos, midi, len] of CHORUS[phrase]!) {
        const t = barAt(bar) + pos * BEAT;
        leadNote(t, midi, len * BEAT * 0.92);
        if (bar >= CHORUS2.from) leadNote(t, midi - 12, len * BEAT * 0.92, 0.55);
      }
    }
  }

  for (const bar of [VERSE.from, CHORUS1.from, CHORUS2.from]) crash(barAt(bar));

  // 收尾：一记重拍，C 大三和弦延音
  const end = barAt(FINAL_BAR);
  kick(end);
  clap(end, 0.7);
  crash(end);
  bassNote(end, CHORDS.C.bass, 1.6);
  padChord(end, CHORDS.C.notes, 1.4, 1.4);
  leadNote(end, 84, 1.3);
  leadNote(end, 72, 1.3, 0.6);

  return ctx.startRendering();
}

let cached: Promise<AudioBuffer> | null = null;

export function testTrackBuffer(): Promise<AudioBuffer> {
  cached ??= renderTestTrack().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}
