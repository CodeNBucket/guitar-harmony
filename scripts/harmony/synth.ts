/**
 * Test-only guitar synth (extended Karplus-Strong) so the detectors can be
 * checked with known ground truth before real recordings arrive. Includes the
 * things that break naive detectors: pick noise, strong harmonics, strings
 * ringing into each other, strum spread and background hiss.
 */
import fs from 'node:fs';

export const SR = 22050;

export interface SynthNote {
  midi: number;
  t: number;
  dur: number;
  vel?: number;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function pluck(out: Float32Array, n: SynthNote, rand: () => number) {
  const f0 = 440 * 2 ** ((n.midi - 69) / 12);
  const period = SR / f0;
  const N = Math.floor(period);
  const frac = period - N;
  const vel = n.vel ?? 0.8;
  const line = new Float32Array(N + 2);
  // pick-position comb: excite with noise minus a delayed copy (pluck ~1/5 of string)
  const pickPos = Math.max(1, Math.floor(N * (0.13 + 0.1 * rand())));
  const exc = new Float32Array(N + 2);
  for (let i = 0; i < N + 2; i++) exc[i] = rand() * 2 - 1;
  for (let i = 0; i < N + 2; i++) line[i] = exc[i] - (i >= pickPos ? exc[i - pickPos] : 0);
  // smooth the excitation (softer pick → fewer highs)
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < N + 2; i++) line[i] = 0.5 * (line[i] + line[i - 1]);
  let mx = 0;
  for (const v of line) mx = Math.max(mx, Math.abs(v));
  for (let i = 0; i < line.length; i++) line[i] *= vel / (mx || 1);

  const start = Math.floor(n.t * SR);
  const len = Math.floor((n.dur + 0.08) * SR);
  // loss per period so that the note decays ~40 dB over ~2.5 s (low strings ring longer)
  const decay = Math.pow(0.01, 1 / ((2.8 - (n.midi - 40) / 40) * f0));
  // fractional delay via first-order allpass
  const ap = (1 - frac) / (1 + frac);
  let apPrev = 0;
  let apOut = 0;
  let idx = 0;
  let lp = 0;
  const release = Math.floor(n.dur * SR);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const cur = line[idx];
    const nxt = line[(idx + 1) % N];
    let y = decay * (0.5 * (cur + nxt));
    // allpass tuning
    const a = ap * y + apPrev - ap * apOut;
    apPrev = y;
    apOut = a;
    y = a;
    if (i > release) y *= 0.992; // damped by the fretting hand
    line[idx] = y;
    idx = (idx + 1) % N;
    lp = lp * 0.35 + cur * 0.65;
    out[start + i] += lp * 0.5;
  }
  // pick click
  for (let i = 0; i < 90 && start + i < out.length; i++) out[start + i] += (rand() * 2 - 1) * 0.12 * vel * Math.exp(-i / 20);
}

export function render(notes: SynthNote[], seconds: number, seed = 7, noise = 0.004): Float32Array {
  const out = new Float32Array(Math.floor(seconds * SR));
  const rand = rng(seed);
  for (const n of notes) pluck(out, n, rand);
  for (let i = 0; i < out.length; i++) out[i] += (rand() * 2 - 1) * noise;
  // crude body resonance: gentle peak around 100-200 Hz via a leaky integrator mix
  let s = 0;
  for (let i = 0; i < out.length; i++) {
    s = s * 0.97 + out[i] * 0.03;
    out[i] = out[i] * 0.85 + s * 1.2;
  }
  let mx = 0;
  for (const v of out) mx = Math.max(mx, Math.abs(v));
  for (let i = 0; i < out.length; i++) out[i] *= 0.7 / (mx || 1);
  return out;
}

/** Standard-tuning chord shapes (MIDI, low to high). */
export const SHAPES: Record<string, number[]> = {
  Am: [45, 52, 57, 60, 64],
  C: [48, 52, 55, 60, 64],
  G: [43, 47, 50, 55, 59, 67],
  Em: [40, 47, 52, 55, 59, 64],
  D: [50, 57, 62, 66],
  F: [41, 48, 53, 57, 60, 65],
  E: [40, 47, 52, 56, 59, 64],
  Dm: [50, 57, 62, 65],
  Fmaj7: [41, 48, 52, 57, 64],
  G7: [43, 47, 50, 55, 59, 65],
};

export function strum(shape: number[], t: number, dur: number, down = true, spread = 0.012): SynthNote[] {
  const order = down ? shape : [...shape].reverse();
  return order.map((midi, i) => ({ midi, t: t + i * spread, dur, vel: 0.55 + 0.1 * Math.sin(i) }));
}

export function writeWav(path: string, x: Float32Array, sr = SR) {
  const buf = Buffer.alloc(44 + x.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + x.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(path, buf);
}
