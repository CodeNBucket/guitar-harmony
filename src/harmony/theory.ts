/**
 * Music theory bits the visualizer needs: note names, keys, scale degrees,
 * chord naming and the in-key / tension / wrong judgment.
 *
 * Pitch classes are 0..11 with 0 = C. MIDI note numbers everywhere else.
 */

export type Mode = 'major' | 'minor';
export type Verdict = 'key' | 'tension' | 'wrong';

export interface Key {
  tonic: number; // pitch class
  mode: Mode;
}

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Keys that are conventionally spelled with flats. */
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb
const FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]); // Dm Gm Cm Fm Bbm Ebm

export const pc = (midi: number) => ((Math.round(midi) % 12) + 12) % 12;

export function usesFlats(key: Key | null): boolean {
  if (!key) return false;
  return key.mode === 'major' ? FLAT_MAJOR.has(key.tonic) : FLAT_MINOR.has(key.tonic);
}

export function pcName(p: number, key: Key | null = null): string {
  return (usesFlats(key) ? FLAT_NAMES : SHARP_NAMES)[((p % 12) + 12) % 12];
}

export function noteName(midi: number, key: Key | null = null): string {
  const m = Math.round(midi);
  return `${pcName(m, key)}${Math.floor(m / 12) - 1}`;
}

export function keyName(key: Key, lang: 'en' | 'tr' = 'en'): string {
  const mode =
    lang === 'tr' ? (key.mode === 'major' ? 'majör' : 'minör') : key.mode;
  return `${pcName(key.tonic, key)} ${mode}`;
}

export const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

/**
 * Key profiles (Albrecht & Shanahan 2013, derived from a pop/rock corpus;
 * they separate relative major/minor better than Krumhansl-Kessler on
 * guitar music). Index 0 = tonic.
 */
export const PROFILE: Record<Mode, number[]> = {
  major: [0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.08, 0.008, 0.081],
  minor: [0.22, 0.006, 0.104, 0.123, 0.019, 0.103, 0.012, 0.214, 0.062, 0.022, 0.061, 0.052],
};

/** Semitones above the tonic that sound "in key", per mode. */
const IN_KEY: Record<Mode, Set<number>> = {
  // Ionian
  major: new Set([0, 2, 4, 5, 7, 9, 11]),
  // natural minor + the leading tone (harmonic minor's raised 7th is everywhere in rock)
  minor: new Set([0, 2, 3, 5, 7, 8, 10, 11]),
};

/** Outside the scale but idiomatic (blue notes, mixolydian 7th, dorian 6th). */
const TENSION: Record<Mode, Set<number>> = {
  major: new Set([10, 3]),
  minor: new Set([9, 6]),
};

export function degreeOf(midiOrPc: number, key: Key): number {
  return (pc(midiOrPc) - key.tonic + 12) % 12;
}

export function judgePc(p: number, key: Key): Verdict {
  const d = degreeOf(p, key);
  if (IN_KEY[key.mode].has(d)) return 'key';
  if (TENSION[key.mode].has(d)) return 'tension';
  return 'wrong';
}

/** Short scale-degree label for the HUD ("1", "♭3", "5"...). */
const DEGREE_LABEL = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'];
export const degreeLabel = (d: number) => DEGREE_LABEL[((d % 12) + 12) % 12];

// ---------------------------------------------------------------- chords

export interface ChordQuality {
  id: string;
  /** suffix printed after the root: "", "m", "7"... */
  suffix: string;
  intervals: number[];
}

export const CHORD_QUALITIES: ChordQuality[] = [
  { id: 'maj', suffix: '', intervals: [0, 4, 7] },
  { id: 'min', suffix: 'm', intervals: [0, 3, 7] },
  { id: '7', suffix: '7', intervals: [0, 4, 7, 10] },
  { id: 'maj7', suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { id: 'm7', suffix: 'm7', intervals: [0, 3, 7, 10] },
  { id: 'mmaj7', suffix: 'm(maj7)', intervals: [0, 3, 7, 11] },
  { id: 'sus2', suffix: 'sus2', intervals: [0, 2, 7] },
  { id: 'sus4', suffix: 'sus4', intervals: [0, 5, 7] },
  { id: 'add9', suffix: 'add9', intervals: [0, 2, 4, 7] },
  { id: 'madd9', suffix: 'm(add9)', intervals: [0, 2, 3, 7] },
  { id: '6', suffix: '6', intervals: [0, 4, 7, 9] },
  { id: 'm6', suffix: 'm6', intervals: [0, 3, 7, 9] },
  { id: 'dim', suffix: 'dim', intervals: [0, 3, 6] },
  { id: 'm7b5', suffix: 'm7♭5', intervals: [0, 3, 6, 10] },
  { id: 'aug', suffix: 'aug', intervals: [0, 4, 8] },
  { id: '5', suffix: '5', intervals: [0, 7] },
];

/** Simpler, more common chords win close calls. */
const QUALITY_PRIOR: Record<string, number> = {
  maj: 0.12, min: 0.12, '5': 0.02, '7': 0.04, m7: 0.04, maj7: 0.02, sus2: 0.0, sus4: 0.0,
  add9: 0.0, madd9: 0.0, '6': -0.02, m6: -0.02, mmaj7: -0.04, dim: -0.04, m7b5: -0.04, aug: -0.08,
};

export interface Chord {
  root: number;
  quality: ChordQuality;
  /** lowest sounding pitch class, for slash chords */
  bass: number;
  /** 0..1 how well the template explains the notes */
  score: number;
  pcs: number[];
}

export function chordName(c: Chord, key: Key | null = null): string {
  const base = pcName(c.root, key) + c.quality.suffix;
  return c.bass !== c.root ? `${base}/${pcName(c.bass, key)}` : base;
}

/**
 * Name a chord from pitch-class energies (length 12, any scale) plus the
 * lowest sounding pitch class. Returns null when nothing fits well.
 *
 * Score = explained energy - penalty for missing template tones - penalty for
 * unexplained energy, plus a bonus when the bass is the root. Works for
 * strummed chords and for arpeggios (feed it the decaying energy of recent
 * notes).
 */
export function nameChord(energy: number[], bass: number | null, minTones = 3): Chord | null {
  const total = energy.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const e = energy.map((v) => v / total);
  const present = e.filter((v) => v > 0.06).length;
  if (present < minTones) return null;

  let best: Chord | null = null;
  let bestScore = -Infinity;
  for (let root = 0; root < 12; root++) {
    for (const q of CHORD_QUALITIES) {
      if (q.intervals.length < minTones && present >= 3) {
        // power chords only when there really are just two pitch classes
        continue;
      }
      let explained = 0;
      let missing = 0;
      for (const iv of q.intervals) {
        const v = e[(root + iv) % 12];
        explained += v;
        if (v < 0.04) missing += iv === 0 || iv === 7 ? 0.6 : 1;
      }
      const score =
        explained -
        0.28 * missing -
        (1 - explained) * 0.8 +
        (QUALITY_PRIOR[q.id] ?? 0) +
        (bass === root ? 0.12 : 0) -
        0.015 * q.intervals.length;
      if (score > bestScore) {
        bestScore = score;
        best = {
          root,
          quality: q,
          bass: bass ?? root,
          score: Math.max(0, Math.min(1, score)),
          pcs: q.intervals.map((iv) => (root + iv) % 12),
        };
      }
    }
  }
  if (!best || bestScore < 0.35) return null;
  return best;
}

/**
 * How a chord sits in the key: all tones diatonic → key; one outside tone
 * with a diatonic or tension root (borrowed chords, secondary dominants,
 * the major V in minor) → tension; otherwise wrong.
 */
export function judgeChord(c: Chord, key: Key): Verdict {
  let outside = 0;
  let wrong = 0;
  for (const p of c.pcs) {
    const v = judgePc(p, key);
    if (v !== 'key') outside++;
    if (v === 'wrong') wrong++;
  }
  if (outside === 0) return 'key';
  const rootV = judgePc(c.root, key);
  if (rootV === 'key' && outside <= 1) return 'tension';
  if (rootV !== 'wrong' && wrong === 0) return 'tension';
  return 'wrong';
}
