/**
 * The lo-fi player: voices the composer's notes with Web Audio. Warm keys,
 * a round bass, soft drums, vinyl crackle and a little tape wobble, all
 * through a low-pass filter so nothing is ever sharp.
 */
import { barLength, composeBar, type MusicData, type NoteEvent } from './compose';

const LOOKAHEAD_S = 0.8;
const TICK_MS = 120;
const FADE_S = 1.5;

export class LofiPlayer {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private wow!: GainNode;
  private echo!: GainNode;
  private noise!: AudioBuffer;
  private vinyl: AudioBufferSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBarAt = 0;
  private bar = 0;
  private mood: string;
  private volume = 0.5;

  constructor(private music: MusicData) {
    this.mood = music.default;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  setMood(name: string): void {
    // Takes effect at the next bar, so the change lands on the beat.
    if (this.music.moods[name] && name !== this.mood) {
      this.mood = name;
      this.bar = 0;
    }
  }

  /** 0 to 1. */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && this.playing)
      this.master.gain.setTargetAtTime(this.volume * 0.5, this.ctx.currentTime, 0.2);
  }

  /** Start (must follow a key press or tap: browsers block sound before one). */
  start(): void {
    if (this.playing) return;
    const ctx = this.ensure();
    if (!ctx) return;
    void ctx.resume();
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(this.volume * 0.5, now + FADE_S);
    this.startVinyl();
    this.nextBarAt = now + 0.1;
    this.bar = 0;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (!this.ctx || !this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + FADE_S / 2);
    const v = this.vinyl;
    this.vinyl = null;
    v?.stop(now + FADE_S);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 2400;
    warm.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.bus = ctx.createGain();
    this.bus.connect(warm).connect(comp).connect(this.master).connect(ctx.destination);

    // Tape wobble: a slow LFO that detunes every pitched voice a few cents.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    this.wow = ctx.createGain();
    this.wow.gain.value = 9;
    lfo.connect(this.wow);
    lfo.start();

    // A soft echo for the melody.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.42;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    this.echo = ctx.createGain();
    this.echo.gain.value = 0.5;
    this.echo.connect(delay).connect(feedback).connect(delay);
    delay.connect(this.bus);

    // One second of noise, reused by drums and vinyl.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  private startVinyl(): void {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.02) * 0.995;
      d[i] = brown * 0.6;
      if (Math.random() < 0.00012) d[i] += (Math.random() * 2 - 1) * 0.7; // crackle
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.18;
    src.connect(g).connect(this.bus);
    src.start();
    this.vinyl = src;
  }

  private tick(): void {
    const ctx = this.ctx!;
    while (this.nextBarAt < ctx.currentTime + LOOKAHEAD_S) {
      const mood = this.music.moods[this.mood];
      for (const e of composeBar(mood, this.bar, Math.random)) this.play(e, this.nextBarAt + e.at);
      this.nextBarAt += barLength(mood);
      this.bar++;
    }
  }

  private play(e: NoteEvent, t: number): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.value = 0;
    const end = t + e.dur;
    const tones = (types: OscillatorType[], freqs: number[], levels: number[]) => {
      types.forEach((type, i) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freqs[i];
        this.wow.connect(o.detune);
        const lvl = ctx.createGain();
        lvl.gain.value = levels[i];
        o.connect(lvl).connect(env);
        o.start(t);
        o.stop(end + 0.6);
      });
    };
    const noise = (filter: BiquadFilterType, hz: number) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = hz;
      s.connect(f).connect(env);
      s.start(t, Math.random() * 0.5);
      s.stop(t + 0.3);
    };
    const shape = (peak: number, attack: number, release: number) => {
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + attack);
      env.gain.setTargetAtTime(0, t + attack, release);
    };

    switch (e.voice) {
      case 'keys':
        tones(['sine', 'triangle'], [e.freq, e.freq * 2], [1, 0.12]);
        shape(e.vel * 0.11, 0.03, e.dur / 3);
        break;
      case 'bass':
        tones(['sine', 'triangle'], [e.freq, e.freq], [1, 0.25]);
        shape(e.vel * 0.3, 0.02, e.dur / 2.5);
        break;
      case 'lead': {
        tones(['triangle'], [e.freq], [1]);
        shape(e.vel * 0.07, 0.04, e.dur / 3);
        env.connect(this.echo);
        break;
      }
      case 'kick': {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(110, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
        o.connect(env);
        o.start(t);
        o.stop(t + 0.5);
        shape(e.vel * 0.55, 0.004, 0.09);
        break;
      }
      case 'snare':
        noise('bandpass', 1500);
        shape(e.vel * 0.22, 0.003, 0.06);
        break;
      case 'hat':
        noise('highpass', 7000);
        shape(e.vel * 0.06, 0.002, 0.018);
        break;
    }
    env.connect(this.bus);
  }
}
