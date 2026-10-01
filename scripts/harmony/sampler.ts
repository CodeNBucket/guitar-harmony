/**
 * Test-only sampler built from real recorded guitar notes (the
 * tonejs-instruments sample packs, CC-BY 3.0; not committed). Fetch them with:
 *
 *   git clone --depth 1 --filter=blob:none --sparse \
 *     https://github.com/nbrosowsky/tonejs-instruments.git /tmp/tji
 *   (cd /tmp/tji && git sparse-checkout set samples/guitar-acoustic \
 *     samples/guitar-nylon samples/guitar-electric)
 *   export GUITAR_SAMPLES=/tmp/tji/samples
 *
 * Each target note uses the nearest recorded note, resampled by at most a
 * few semitones, so the audio keeps a real string's attack, body resonance
 * and inharmonic overtones.
 */
import fs from 'node:fs';
import path from 'node:path';

export const SR = 22050;
export type Kit = 'guitar-acoustic' | 'guitar-nylon' | 'guitar-electric';

const NOTE: Record<string, number> = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 };

function readWav(file: string): Float32Array {
  const b = fs.readFileSync(file);
  let o = 12;
  let sr = 44100;
  let ch = 1;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') {
      ch = b.readUInt16LE(o + 10);
      sr = b.readUInt32LE(o + 12);
    }
    if (id === 'data') {
      const n = Math.floor(size / 2 / ch);
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = b.readInt16LE(o + 8 + i * 2 * ch) / 32768;
      // to 22.05 kHz (linear is fine after the sample's own band limit)
      const r = sr / SR;
      const m = Math.floor(n / r);
      const y = new Float32Array(m);
      for (let i = 0; i < m; i++) {
        const p = i * r;
        const k = Math.floor(p);
        y[i] = x[k] + ((x[k + 1] ?? x[k]) - x[k]) * (p - k);
      }
      return y;
    }
    o += 8 + size + (size & 1);
  }
  throw new Error(`no data in ${file}`);
}

const cache = new Map<Kit, { midi: number; x: Float32Array }[]>();

function kit(k: Kit) {
  let s = cache.get(k);
  if (s) return s;
  const dir = path.join(process.env.GUITAR_SAMPLES ?? '/tmp/claude-0/tji/samples', k);
  s = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.wav'))
    .map((f) => {
      const m = /^([A-G]s?)(\d)\.wav$/.exec(f)!;
      return { midi: 12 * (Number(m[2]) + 1) + NOTE[m[1]], x: readWav(path.join(dir, f)) };
    })
    .sort((a, b) => a.midi - b.midi);
  cache.set(k, s);
  return s;
}

export interface Hit {
  midi: number;
  t: number;
  dur: number;
  vel: number;
}

/** mixes one note into out (22.05 kHz) */
export function play(out: Float32Array, k: Kit, h: Hit) {
  const samples = kit(k);
  let best = samples[0];
  for (const s of samples) if (Math.abs(s.midi - h.midi) < Math.abs(best.midi - h.midi)) best = s;
  const ratio = 2 ** ((h.midi - best.midi) / 12);
  const start = Math.floor(h.t * SR);
  const len = Math.min(Math.floor((h.dur + 0.12) * SR), Math.floor(best.x.length / ratio) - 1);
  const rel = Math.floor(h.dur * SR);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const p = i * ratio;
    const k2 = Math.floor(p);
    let v = best.x[k2] + (best.x[k2 + 1] - best.x[k2]) * (p - k2);
    if (i > rel) v *= Math.exp(-(i - rel) / (0.03 * SR)); // fretting hand lets go
    if (start + i >= 0) out[start + i] += v * h.vel;
  }
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Renders hits like a phone on a table: small room reverb, a little hiss
 * and hum, band-limited mic, random overall level.
 */
export function renderReal(k: Kit, hits: Hit[], seconds: number, seed = 1): Float32Array {
  const rand = rng(seed);
  const dry = new Float32Array(Math.floor(seconds * SR));
  for (const h of hits) play(dry, k, h);
  // room: sparse exponentially decaying echoes
  const out = new Float32Array(dry.length);
  const taps: [number, number][] = [[0, 1]];
  for (let i = 0; i < 24; i++) {
    const d = 0.008 + rand() * 0.25;
    taps.push([Math.floor(d * SR), 0.22 * Math.exp(-d / 0.09) * (rand() > 0.5 ? 1 : -1)]);
  }
  for (const [d, g] of taps) for (let i = d; i < out.length; i++) out[i] += dry[i - d] * g;
  // mic: high-pass ~90 Hz, gentle low-pass, hiss + 50 Hz hum
  let hp = 0;
  let prev = 0;
  let lp = 0;
  const a = Math.exp((-2 * Math.PI * 90) / SR);
  for (let i = 0; i < out.length; i++) {
    hp = a * (hp + out[i] - prev);
    prev = out[i];
    lp = lp * 0.25 + hp * 0.75;
    out[i] = lp + (rand() * 2 - 1) * 0.0025 + 0.002 * Math.sin((2 * Math.PI * 50 * i) / SR);
  }
  let mx = 0;
  for (const v of out) mx = Math.max(mx, Math.abs(v));
  const gain = (0.25 + 0.6 * rand()) / (mx || 1);
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}
