import type { Mood } from '../mood';
import type { Key, Verdict } from '../theory';

/**
 * The worlds. The live app picks one by the mood of the playing: sad → a
 * misty forest under the moon, happy → a sunny forest in full daylight,
 * romantic → the sea at sunset. (The deck teaser still picks by major/minor.)
 * The tonic nudges the hue around the circle of fifths, so A minor and
 * E minor are related but not identical forests.
 */

export type RGB = [number, number, number];

export interface World {
  skyTop: RGB;
  skyHorizon: RGB;
  sun: RGB;
  glow: RGB;
  fog: RGB;
  far: RGB;
  near: RGB;
  /** 0 = spruce forest, 1 = open meadow with round trees */
  meadow: number;
  /** 1 = night sky (stars, moon, aurora), 0 = day */
  night: number;
  /** 1 = open sea below the horizon instead of the near hills */
  sea: number;
  sunX: number;
  sunY: number;
}

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const FOREST: World = {
  skyTop: hex('#040a17'),
  skyHorizon: hex('#1c3a52'),
  sun: hex('#f2f6ff'),
  glow: hex('#5f8fbf'),
  fog: hex('#355269'),
  far: hex('#1f3a4d'),
  near: hex('#02070b'),
  meadow: 0,
  night: 1,
  sea: 0,
  sunX: 0.7,
  sunY: 0.7,
};

export const MEADOW: World = {
  skyTop: hex('#3566b0'),
  skyHorizon: hex('#ffc288'),
  sun: hex('#fff4d2'),
  glow: hex('#ffab4a'),
  fog: hex('#f2c39a'),
  far: hex('#8a9d86'),
  near: hex('#0f2614'),
  meadow: 1,
  night: 0,
  sea: 0,
  sunX: 0.27,
  sunY: 0.5,
};

/** before a key is found: a cold, foggy dawn with nothing in focus */
export const DAWN: World = {
  skyTop: hex('#0a0e16'),
  skyHorizon: hex('#2a333f'),
  sun: hex('#b9c4d1'),
  glow: hex('#3f4a57'),
  fog: hex('#343d48'),
  far: hex('#28313b'),
  near: hex('#07090c'),
  meadow: 0.15,
  night: 0.6,
  sea: 0,
  sunX: 0.5,
  sunY: 0.52,
};

/** happy: a bright, leafy forest at midday */
export const SUNNY: World = {
  skyTop: hex('#2b73cf'),
  skyHorizon: hex('#a6d6ff'),
  sun: hex('#fffbea'),
  glow: hex('#ffd36b'),
  fog: hex('#8cc3d2'),
  far: hex('#4a8c66'),
  near: hex('#123a1b'),
  meadow: 1,
  night: 0,
  sea: 0,
  sunX: 0.74,
  sunY: 0.72,
};

/** romantic: the sea at sunset, the sun sitting on the horizon */
export const SEA: World = {
  skyTop: hex('#2b1d5e'),
  skyHorizon: hex('#ff9b86'),
  sun: hex('#fff1c9'),
  glow: hex('#ff7d6a'),
  fog: hex('#e79aa8'),
  far: hex('#5b3c6e'),
  near: hex('#1a1030'),
  meadow: 0.3,
  night: 0.2,
  sea: 1,
  sunX: 0.5,
  sunY: 0.42,
};

export function worldForMood(mood: Mood | null): World {
  if (mood === 'happy') return SUNNY;
  if (mood === 'romantic') return SEA;
  if (mood === 'sad') return FOREST;
  return DAWN;
}

export function worldFor(key: Key | null): World {
  if (!key) return DAWN;
  return key.mode === 'minor' ? FOREST : MEADOW;
}

/** hue rotation in radians for a tonic: circle-of-fifths position, ±~25° */
export function hueFor(key: Key | null): number {
  if (!key) return 0;
  const fifths = (key.tonic * 7) % 12; // C=0 G=1 D=2 ...
  const centred = ((fifths + 6) % 12) - 6; // -6..5, A minor/C major near 0
  return (centred / 6) * 0.25;
}

export function lerpWorld(a: World, b: World, t: number): World {
  const l = (x: number, y: number) => x + (y - x) * t;
  const lc = (x: RGB, y: RGB): RGB => [l(x[0], y[0]), l(x[1], y[1]), l(x[2], y[2])];
  return {
    skyTop: lc(a.skyTop, b.skyTop),
    skyHorizon: lc(a.skyHorizon, b.skyHorizon),
    sun: lc(a.sun, b.sun),
    glow: lc(a.glow, b.glow),
    fog: lc(a.fog, b.fog),
    far: lc(a.far, b.far),
    near: lc(a.near, b.near),
    meadow: l(a.meadow, b.meadow),
    night: l(a.night, b.night),
    sea: l(a.sea, b.sea),
    sunX: l(a.sunX, b.sunX),
    sunY: l(a.sunY, b.sunY),
  };
}

/** note colour by scale degree (semitones above the tonic) and verdict */
export function noteColor(degree: number | null, verdict: Verdict | null): RGB {
  if (verdict === 'wrong') return [1.0, 0.16, 0.1];
  if (verdict === 'tension') return [0.72, 0.52, 1.0];
  if (degree === null) return [0.78, 0.86, 1.0];
  switch (degree) {
    case 0:
      return [1.0, 0.8, 0.32]; // tonic: gold
    case 7:
      return [0.42, 0.9, 1.0]; // fifth: cyan
    case 3:
    case 4:
      return [1.0, 0.48, 0.66]; // third: rose
    default:
      return [0.7, 1.0, 0.72]; // other scale tones: spring green
  }
}
