/**
 * The accurate path: Spotify's Basic Pitch (Apache-2.0), a small CNN that
 * outputs per-frame note and onset probabilities for 88 keys, polyphonic.
 * The model itself lives in bpmodel.ts (TF.js, loaded lazily); this file only
 * needs something that can run a 2 s window.
 *
 * Live use: every ~130 ms we run the model on the last 2 s of audio. Frames
 * near the right edge of a window lack future context and are shaky, so a
 * frame is only "settled" once it sits rightMargin frames inside a window.
 */

export const BP_SR = 22050;
export const BP_HOP = 256;
export const BP_FPS = BP_SR / BP_HOP; // ≈ 86.13
export const BP_WINDOW = BP_SR * 2 - BP_HOP; // 43844 samples
export const BP_PITCHES = 88;
export const BP_MIDI0 = 21;

export interface PitchModel {
  /** one BP_WINDOW-sample window → frames and onsets, nFrames × 88 row-major */
  infer(window: Float32Array): Promise<{ frames: Float32Array; onsets: Float32Array; n: number }>;
}

export interface PolyNote {
  id: number;
  midi: number;
  /** seconds, stream time */
  t: number;
  /** 0..1 peak note probability, a stand-in for confidence */
  prob: number;
  onsetProb: number;
}

export type PolyEvent =
  | { type: 'on'; note: PolyNote }
  | { type: 'off'; note: PolyNote; t: number }
  | { type: 'frame'; t: number; probs: Float32Array };

export interface PolyOptions {
  onsetThreshold?: number;
  frameThreshold?: number;
  /** frames a note must hold above the frame threshold before it's reported */
  confirmFrames?: number;
  rightMargin?: number;
}

/**
 * Streams audio in, runs the model on demand, stitches the overlapping
 * windows into one settled frame timeline and tracks notes on it.
 */
export class PolyTracker {
  private ring: Float32Array;
  private total = 0;
  private settledUpTo = 0; // absolute frame index: frames < this are tracked
  /** best estimate so far per absolute frame, with how "central" it was */
  private store = new Map<number, { frames: Float32Array; onsets: Float32Array; quality: number }>();
  private active = new Map<number, { note: PolyNote; low: number; held: number; reported: boolean }>();
  private nextId = 1;
  private opts: Required<PolyOptions>;
  busy = false;

  constructor(
    private model: PitchModel,
    private onEvent: (e: PolyEvent) => void,
    opts: PolyOptions = {},
  ) {
    this.opts = { onsetThreshold: 0.5, frameThreshold: 0.3, confirmFrames: 2, rightMargin: 10, ...opts };
    this.ring = new Float32Array(BP_WINDOW + BP_SR); // 3 s
  }

  get time() {
    return this.total / BP_SR;
  }

  push(samples: Float32Array) {
    const r = this.ring;
    for (let i = 0; i < samples.length; i++) r[(this.total + i) % r.length] = samples[i];
    this.total += samples.length;
  }

  /** Run the model on the latest window (skips if a run is in flight). */
  async step(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      // windows start on a hop boundary so frames line up across runs
      const winStart = Math.floor((this.total - BP_WINDOW) / BP_HOP) * BP_HOP;
      const win = new Float32Array(BP_WINDOW);
      const r = this.ring;
      for (let i = 0; i < BP_WINDOW; i++) {
        const s = winStart + i;
        win[i] = s >= 0 && s < this.total && this.total - s <= r.length ? r[s % r.length] : 0;
      }
      const out = await this.model.infer(win);
      const f0 = winStart / BP_HOP;
      const lastValid = Math.floor(this.total / BP_HOP);
      for (let i = 0; i < out.n; i++) {
        const abs = f0 + i;
        if (abs < this.settledUpTo || abs < 0 || abs > lastValid) continue;
        const quality = Math.min(i, out.n - 1 - i);
        const prev = this.store.get(abs);
        if (!prev || quality >= prev.quality) {
          this.store.set(abs, {
            frames: out.frames.slice(i * BP_PITCHES, (i + 1) * BP_PITCHES),
            onsets: out.onsets.slice(i * BP_PITCHES, (i + 1) * BP_PITCHES),
            quality,
          });
        }
      }
      // settle frames with enough right context
      const settleTo = Math.min(lastValid, f0 + out.n) - this.opts.rightMargin;
      for (let abs = this.settledUpTo; abs < settleTo; abs++) this.track(abs);
      this.settledUpTo = Math.max(this.settledUpTo, settleTo);
      for (const k of this.store.keys()) if (k < this.settledUpTo - 2) this.store.delete(k);
    } finally {
      this.busy = false;
    }
  }

  private track(abs: number) {
    const cur = this.store.get(abs);
    if (!cur) return;
    const prev = this.store.get(abs - 1);
    const next = this.store.get(abs + 1);
    const t = abs / BP_FPS;
    const { onsetThreshold, frameThreshold, confirmFrames } = this.opts;
    this.onEvent({ type: 'frame', t, probs: cur.frames });

    for (let p = 0; p < BP_PITCHES; p++) {
      const fr = cur.frames[p];
      const on = cur.onsets[p];
      const a = this.active.get(p);
      const isPeak = on >= (prev?.onsets[p] ?? 0) && on >= (next?.onsets[p] ?? 0);
      // (ignore the first frames: the window edge at stream start fakes onsets,
      // and a second onset peak within 60 ms of the first is the same attack)
      if (
        on >= onsetThreshold &&
        isPeak &&
        fr >= frameThreshold * 0.8 &&
        t > 0.15 &&
        !(a && t - a.note.t < 0.06)
      ) {
        // new attack (re-pick of a ringing string ends the old one)
        if (a) this.end(p, t);
        this.active.set(p, {
          note: { id: this.nextId++, midi: p + BP_MIDI0, t, prob: fr, onsetProb: on },
          low: 0,
          held: 1,
          reported: false,
        });
        if (confirmFrames <= 1) this.report(p);
        continue;
      }
      if (!a) continue;
      if (fr >= frameThreshold) {
        a.low = 0;
        a.held++;
        a.note.prob = Math.max(a.note.prob, fr);
        if (!a.reported && a.held >= confirmFrames) this.report(p);
      } else if (++a.low >= 3) {
        this.end(p, t);
      }
    }
  }

  private report(p: number) {
    const a = this.active.get(p)!;
    a.reported = true;
    this.onEvent({ type: 'on', note: a.note });
  }

  private end(p: number, t: number) {
    const a = this.active.get(p);
    if (!a) return;
    this.active.delete(p);
    if (a.reported) this.onEvent({ type: 'off', note: a.note, t });
  }

  /** stream time up to which frames are final */
  get settledTime() {
    return this.settledUpTo / BP_FPS;
  }

  /** latency of settled frames behind the live audio, seconds */
  get lag() {
    return this.total / BP_SR - this.settledUpTo / BP_FPS;
  }
}
