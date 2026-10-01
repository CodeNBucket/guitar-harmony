import { FFT } from './fft';
import { hzToMidi } from './theory';

/**
 * The fast path: single-note pitch with instant, stable decisions.
 *
 *  - McLeod Pitch Method (normalized square difference via FFT
 *    autocorrelation). Its "clarity" says how periodic the frame is: a clean
 *    single string is ~0.95, a strummed chord or pick noise is much lower.
 *  - Spectral-flux onset detector with an adaptive threshold.
 *  - A tracker that waits until the pick transient is over and the pitch
 *    agrees across a few frames before it commits to a note (the prototype
 *    judged the noisy attack frame, which is where most misreads came from).
 */

export const SR = 22050;
export const HOP = 256; // 11.6 ms, same hop as Basic Pitch
export const WIN = 1024; // 46 ms: ~4 periods of the low E string

export interface PitchFrame {
  t: number;
  hz: number; // 0 when unpitched
  midi: number; // fractional, NaN when unpitched
  clarity: number;
  rms: number;
  flux: number;
  onset: boolean;
}

export class PitchDetector {
  private fft = new FFT(WIN * 2);
  private re = new Float64Array(WIN * 2);
  private im = new Float64Array(WIN * 2);
  private nsdf = new Float64Array(WIN);
  private minLag = Math.floor(SR / 1400);
  private maxLag = Math.ceil(SR / 70);

  /**
   * Returns [hz, clarity]. `mags` is the Hann-windowed magnitude spectrum of
   * the same frame (WIN-point FFT); it's used to reject "virtual" pitches:
   * two ringing strings share a common period an octave or a fifth below
   * both of them, which looks perfectly periodic but has no energy there.
   */
  detect(x: Float32Array, mags: Float64Array): [number, number] {
    const n = WIN;
    const { re, im } = this;
    re.fill(0);
    im.fill(0);
    let energy = 0;
    for (let i = 0; i < n; i++) {
      re[i] = x[i];
      energy += x[i] * x[i];
    }
    if (energy < 1e-7) return [0, 0];
    this.fft.transform(re, im);
    for (let i = 0; i < 2 * n; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i];
      im[i] = 0;
    }
    this.fft.transform(re, im, true);
    const scale = 1 / (2 * n);

    // m(τ) = Σ x_j² + x_{j+τ}², built incrementally
    let m = 2 * energy;
    const nsdf = this.nsdf;
    for (let tau = 0; tau < this.maxLag + 2 && tau < n; tau++) {
      if (tau > 0) m -= x[tau - 1] * x[tau - 1] + x[n - tau] * x[n - tau];
      nsdf[tau] = m > 1e-9 ? (2 * re[tau] * scale) / m : 0;
    }

    // key maxima: highest point between each positive-going and
    // negative-going zero crossing
    const peaks: number[] = [];
    let tau = this.minLag;
    while (tau < this.maxLag && nsdf[tau] > 0) tau++;
    let bestInRun = -1;
    for (; tau <= this.maxLag; tau++) {
      if (nsdf[tau] > 0) {
        if (bestInRun < 0 || nsdf[tau] > nsdf[bestInRun]) bestInRun = tau;
      } else if (bestInRun >= 0) {
        peaks.push(bestInRun);
        bestInRun = -1;
      }
    }
    if (bestInRun >= 0) peaks.push(bestInRun);
    if (!peaks.length) return [0, 0];

    let globalMax = 0;
    for (const p of peaks) globalMax = Math.max(globalMax, nsdf[p]);

    let specPeak = 0;
    const kLo = Math.floor((60 * WIN) / SR);
    const kHi = Math.floor((2500 * WIN) / SR);
    for (let k = kLo; k < kHi; k++) specPeak = Math.max(specPeak, mags[k]);
    const at = (hz: number) => {
      const k = Math.round((hz * WIN) / SR);
      return Math.max(mags[k - 1] ?? 0, mags[k] ?? 0, mags[k + 1] ?? 0);
    };
    const supported = (lag: number) => {
      const f = SR / lag;
      return Math.max(at(f), at(2 * f)) >= 0.14 * specPeak;
    };

    // shortest period that is nearly as periodic as the best one and has
    // real energy at its fundamental or octave. Preferring short periods
    // risks an octave-up error (same pitch class, harmless for judging);
    // the long-period mistake (a sub-harmonic of a chord) is a wrong note.
    const pick = peaks.find((p) => nsdf[p] >= 0.72 * globalMax && supported(p));
    if (pick === undefined) return [0, 0];

    // parabolic interpolation around the chosen lag
    const a = nsdf[pick - 1];
    const b = nsdf[pick];
    const c = nsdf[pick + 1] ?? b;
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    const lag = pick + Math.max(-0.5, Math.min(0.5, shift));
    const clarity = Math.min(1, b - 0.25 * (a - c) * shift);
    return [SR / lag, clarity];
  }
}

export class OnsetDetector {
  private fft = new FFT(WIN);
  private re = new Float64Array(WIN);
  private im = new Float64Array(WIN);
  private win = new Float64Array(WIN);
  private prev = new Float64Array(WIN / 2);
  /** linear magnitude spectrum of the last frame */
  readonly mags = new Float64Array(WIN / 2);
  private history: number[] = [];
  private lastOnset = -1;
  private pendingPeak: { t: number; v: number; thr: number } | null = null;
  private prevFlux = 0;

  constructor() {
    for (let i = 0; i < WIN; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));
  }

  /**
   * Feeds one frame, returns the time of an onset confirmed on the previous
   * frame (one frame of look-ahead for peak picking), or null.
   */
  push(x: Float32Array, t: number, rms: number, noiseFloor: number): { flux: number; onsetT: number | null } {
    const { re, im } = this;
    for (let i = 0; i < WIN; i++) {
      re[i] = x[i] * this.win[i];
      im[i] = 0;
    }
    this.fft.transform(re, im);
    for (let k = 0; k < WIN / 2; k++) this.mags[k] = Math.hypot(re[k], im[k]);
    let flux = 0;
    // log-compressed magnitude, 60 Hz .. 6 kHz, half-wave rectified difference
    const lo = Math.floor((60 * WIN) / SR);
    const hi = Math.floor((6000 * WIN) / SR);
    for (let k = lo; k < hi; k++) {
      const mag = Math.log1p(100 * this.mags[k]);
      const d = mag - this.prev[k];
      if (d > 0) flux += d;
      this.prev[k] = mag;
    }
    flux /= hi - lo;

    const h = this.history;
    h.push(flux);
    if (h.length > 24) h.shift();
    const sorted = [...h].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const thr = median * 1.6 + 0.035;

    let onsetT: number | null = null;
    // confirm the pending peak if this frame is lower (peak = local max)
    if (this.pendingPeak) {
      if (flux < this.pendingPeak.v) {
        onsetT = this.pendingPeak.t;
        this.lastOnset = onsetT;
      }
      if (flux < this.pendingPeak.v || t - this.pendingPeak.t > 0.05) this.pendingPeak = null;
    }
    if (
      flux > thr &&
      flux > this.prevFlux &&
      rms > noiseFloor * 2.5 &&
      t - this.lastOnset > 0.06 &&
      (!this.pendingPeak || flux > this.pendingPeak.v)
    ) {
      this.pendingPeak = { t, v: flux, thr };
    }
    this.prevFlux = flux;
    return { flux, onsetT };
  }
}

export interface MonoNote {
  id: number;
  midi: number;
  /** cents off the equal-tempered note, averaged over the settle frames */
  cents: number;
  t: number;
  clarity: number;
  velocity: number;
  /** true when triggered by a pitch change without a pick attack */
  legato: boolean;
}

export type MonoEvent =
  | { type: 'on'; note: MonoNote }
  | { type: 'off'; note: MonoNote; t: number }
  /** an attack happened but no single stable pitch came out (chord, mute, noise) */
  | { type: 'unpitched'; t: number; rms: number };

const SETTLE = 0.022; // ignore the first ~2 frames after the attack
const AGREE = 3; // frames that must agree
const AGREE_CENTS = 0.35;
const MIN_CLARITY = 0.8;
const PENDING_TIMEOUT = 0.22;

/**
 * Turns the per-frame pitch estimates + onsets into note events.
 * Guitar range only (D2 drop tuning .. ~E6).
 */
export class MonoTracker {
  private pending: { t: number; midis: number[]; clar: number[]; rms: number } | null = null;
  private active: MonoNote | null = null;
  private activePeakRms = 0;
  private lowFrames = 0;
  private changeRun: number[] = [];
  private idleRun: number[] = [];
  private nextId = 1;

  get current() {
    return this.active;
  }

  frame(f: PitchFrame, noiseFloor: number): MonoEvent[] {
    const out: MonoEvent[] = [];
    const pitched = f.clarity >= MIN_CLARITY && f.midi >= 37 && f.midi <= 90;

    if (f.onset) {
      if (this.active) {
        out.push({ type: 'off', note: this.active, t: f.t });
        this.active = null;
      }
      this.pending = { t: f.t, midis: [], clar: [], rms: f.rms };
      this.idleRun = [];
    }

    if (this.pending) {
      const p = this.pending;
      p.rms = Math.max(p.rms, f.rms);
      if (f.t - p.t >= SETTLE && pitched) {
        p.midis.push(f.midi);
        p.clar.push(f.clarity);
      }
      const n = p.midis.length;
      if (n >= AGREE) {
        const last = p.midis.slice(-AGREE);
        const med = median(last);
        if (last.every((m) => Math.abs(m - med) <= AGREE_CENTS)) {
          out.push(this.start(med, avg(p.clar.slice(-AGREE)), p.t, p.rms, false));
          this.pending = null;
        }
      }
      if (this.pending && f.t - p.t > PENDING_TIMEOUT) {
        out.push({ type: 'unpitched', t: p.t, rms: p.rms });
        this.pending = null;
      }
      return out;
    }

    if (this.active) {
      const a = this.active;
      this.activePeakRms = Math.max(this.activePeakRms, f.rms);
      // note off: level fell away or pitch vanished for a while
      const quiet = f.rms < this.activePeakRms * 0.06 || f.rms < noiseFloor * 2;
      this.lowFrames = quiet || f.clarity < 0.5 ? this.lowFrames + 1 : 0;
      if (this.lowFrames >= (quiet ? 3 : 9)) {
        out.push({ type: 'off', note: a, t: f.t });
        this.active = null;
        this.lowFrames = 0;
        return out;
      }
      // legato change (hammer-on, pull-off, slide): a different, stable pitch
      if (pitched && Math.abs(f.midi - a.midi) > 0.6) {
        this.changeRun.push(f.midi);
        if (this.changeRun.length >= 4) {
          const last = this.changeRun.slice(-4);
          const med = median(last);
          if (last.every((m) => Math.abs(m - med) <= AGREE_CENTS)) {
            out.push({ type: 'off', note: a, t: f.t });
            out.push(this.start(med, f.clarity, f.t - 3 * (HOP / SR), f.rms, true));
            this.changeRun = [];
          } else this.changeRun.shift();
        }
      } else this.changeRun = [];
      return out;
    }

    // idle: catch soft notes the onset detector missed
    if (pitched && f.rms > noiseFloor * 4 && f.clarity >= 0.9) {
      this.idleRun.push(f.midi);
      if (this.idleRun.length >= 4) {
        const last = this.idleRun.slice(-4);
        const med = median(last);
        if (last.every((m) => Math.abs(m - med) <= AGREE_CENTS)) {
          out.push(this.start(med, f.clarity, f.t - 3 * (HOP / SR), f.rms, true));
          this.idleRun = [];
        } else this.idleRun.shift();
      }
    } else this.idleRun = [];
    return out;
  }

  private start(midiF: number, clarity: number, t: number, rms: number, legato: boolean): MonoEvent {
    const midi = Math.round(midiF);
    this.active = {
      id: this.nextId++,
      midi,
      cents: Math.round((midiF - midi) * 100),
      t,
      clarity,
      velocity: Math.min(1, rms * 6),
      legato,
    };
    this.activePeakRms = rms;
    this.lowFrames = 0;
    this.changeRun = [];
    return { type: 'on', note: this.active };
  }
}

/**
 * Streaming front end: accepts 22.05 kHz samples in any chunk size and runs
 * pitch + onset + tracking once per hop.
 */
export class MonoAnalyzer {
  private buf = new Float32Array(WIN);
  private filled = 0;
  private sinceHop = 0;
  private frameIndex = 0;
  private pitch = new PitchDetector();
  private onset = new OnsetDetector();
  readonly tracker = new MonoTracker();
  noiseFloor = 0.002;
  /** latest frame, for meters */
  last: PitchFrame | null = null;
  private delayed: PitchFrame | null = null;
  private frame = new Float32Array(WIN);

  /** every pick attack, as soon as the onset detector confirms it (~25 ms) */
  onAttack: ((t: number, rms: number) => void) | null = null;

  constructor(private onEvent: (e: MonoEvent, f: PitchFrame) => void) {}

  get time() {
    return (this.frameIndex * HOP) / SR;
  }

  push(samples: Float32Array) {
    // ring buffer; each hop copies the latest WIN samples out in order
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.filled % WIN] = samples[i];
      this.filled++;
      if (++this.sinceHop >= HOP && this.filled >= WIN) {
        this.sinceHop = 0;
        this.processFrame();
      }
    }
  }

  private processFrame() {
    const x = this.frame;
    const start = this.filled % WIN;
    x.set(this.buf.subarray(start), 0);
    x.set(this.buf.subarray(0, start), WIN - start);
    // frame time = centre of the analysis window
    const t = (this.frameIndex * HOP + WIN / 2) / SR;
    this.frameIndex++;
    let e = 0;
    for (let i = 0; i < WIN; i++) e += x[i] * x[i];
    const rms = Math.sqrt(e / WIN);
    // slow-rising, fast-falling noise floor
    this.noiseFloor = rms < this.noiseFloor ? this.noiseFloor * 0.9 + rms * 0.1 : this.noiseFloor * 1.0015;
    this.noiseFloor = Math.max(this.noiseFloor, 0.0004);

    const { flux, onsetT } = this.onset.push(x, t, rms, this.noiseFloor);
    const [hz, clarity] = rms > this.noiseFloor * 1.5 ? this.pitch.detect(x, this.onset.mags) : [0, 0];
    const cur: PitchFrame = {
      t,
      hz,
      midi: hz > 0 ? hzToMidi(hz) : NaN,
      clarity,
      rms,
      flux,
      onset: false,
    };
    // the onset detector confirms a peak one frame late: mark it on the
    // delayed frame so the tracker sees the attack in order
    const prev = this.delayed;
    this.delayed = cur;
    if (!prev) return;
    if (onsetT !== null) {
      prev.onset = true;
      this.onAttack?.(onsetT, Math.max(prev.rms, cur.rms));
    }
    this.last = prev;
    for (const ev of this.tracker.frame(prev, this.noiseFloor)) this.onEvent(ev, prev);
  }
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}
function avg(a: number[]) {
  return a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
}
