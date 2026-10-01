/**
 * 20+ well-known guitar parts written out note by note (intros, riffs,
 * progressions as commonly played), performed with human timing and
 * velocities and rendered with real guitar samples (sampler.ts).
 *
 * Every song here is played CORRECTLY, so any "wrong" verdict is a false
 * alarm. Several are picked because they are full of notes outside the plain
 * scale: chromatic bass lines (Stairway), borrowed chords (Creep, Hallelujah
 * E7, Yesterday A7), blue notes (Smoke on the Water), a modulation (Romanza).
 */
import type { Hit, Kit } from './sampler';

export type Mood = 'sad' | 'tender' | 'happy' | 'energetic';

export interface Song {
  name: string;
  key: { tonic: number; mode: 'major' | 'minor' };
  mood: Mood;
  kit: Kit;
  hits: Hit[];
  seconds: number;
}

// voicings, low → high (standard tuning)
const V: Record<string, number[]> = {
  Am: [45, 52, 57, 60, 64],
  A: [45, 52, 57, 61, 64],
  A7: [45, 52, 55, 61, 64],
  Asus2: [45, 52, 57, 59, 64],
  Asus4: [45, 52, 57, 62, 64],
  A7sus4: [45, 52, 55, 62, 64],
  'A/E': [40, 45, 52, 57, 61, 64],
  Bm: [47, 54, 59, 62, 66],
  B: [47, 54, 59, 63, 66],
  B7: [47, 51, 57, 59, 66],
  Bb: [46, 53, 58, 62, 65],
  C: [48, 52, 55, 60, 64],
  Cmaj7: [48, 52, 55, 59, 64],
  Cadd9: [48, 52, 55, 62, 64],
  Cm: [48, 55, 60, 63, 67],
  C7: [48, 52, 58, 60, 64],
  'C/G': [43, 48, 52, 55, 60, 64],
  D: [50, 57, 62, 66],
  Dsus4: [50, 57, 62, 67],
  'D/F#': [42, 50, 57, 62, 66],
  Dm: [50, 57, 62, 65],
  E: [40, 47, 52, 56, 59, 64],
  E7: [40, 47, 50, 56, 59, 64],
  E7sus4: [40, 47, 52, 57, 59, 64],
  'E/G#': [44, 47, 52, 56, 59, 64],
  Em: [40, 47, 52, 55, 59, 64],
  Em7: [40, 47, 52, 55, 62, 67],
  Em7o: [40, 47, 50, 55, 59, 64],
  F: [41, 48, 53, 57, 60, 65],
  Fmaj7: [53, 57, 60, 64],
  'F#': [42, 49, 54, 58, 61, 66],
  'F#m': [42, 49, 54, 57, 61, 66],
  'F#7': [42, 49, 52, 58, 61, 66],
  G: [43, 47, 50, 55, 59, 67],
  'G/B': [47, 50, 55, 59, 67],
  G7: [43, 47, 50, 55, 59, 65],
  D6add9: [42, 45, 52, 57, 59, 64],
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 2 ** 32;
  };
}

/** small DSL: a cursor in beats, humanized output in seconds */
class Take {
  hits: Hit[] = [];
  beat = 0;
  private r: () => number;
  constructor(
    private bpm: number,
    seed: number,
  ) {
    this.r = rng(seed);
  }
  private sec(b: number) {
    return 0.4 + (b * 60) / this.bpm + (this.r() - 0.5) * 0.024;
  }
  private vel(base = 0.7) {
    return Math.max(0.2, Math.min(1, base + (this.r() - 0.5) * 0.25));
  }
  /** single notes: [midi, beats] (midi 0 = rest); ring = extra beats of sustain */
  mel(notes: [number, number][], ring = 0.2) {
    for (const [m, b] of notes) {
      if (m) this.hits.push({ midi: m, t: this.sec(this.beat), dur: ((b + ring) * 60) / this.bpm, vel: this.vel(0.75) });
      this.beat += b;
    }
    return this;
  }
  /** arpeggio over a voicing: pattern of string indices, each `step` beats; notes ring to the end */
  arp(chord: string, pattern: number[], step = 0.5) {
    const v = V[chord];
    const total = pattern.length * step;
    pattern.forEach((si, i) => {
      const m = v[Math.min(si, v.length - 1)];
      const b = this.beat + i * step;
      this.hits.push({ midi: m, t: this.sec(b), dur: ((total - i * step + 0.3) * 60) / this.bpm, vel: this.vel(0.65) });
    });
    this.beat += total;
    return this;
  }
  /** strums: rhythm of [beats, 'D'|'U'|'x'(muted, skipped)] */
  strum(chord: string, rhythm: [number, 'D' | 'U'][] = [[1, 'D'], [1, 'D'], [1, 'D'], [1, 'D']]) {
    const v = V[chord];
    for (const [b, dir] of rhythm) {
      const t0 = this.sec(this.beat);
      const strings = dir === 'D' ? v : [...v].reverse().slice(0, Math.max(3, v.length - 2));
      const spread = 0.008 + this.r() * 0.01;
      const base = dir === 'D' ? 0.7 : 0.5;
      strings.forEach((m, i) =>
        this.hits.push({ midi: m, t: t0 + i * spread, dur: (b * 60) / this.bpm + 0.05, vel: this.vel(base) }),
      );
      this.beat += b;
    }
    return this;
  }
  rest(b: number) {
    this.beat += b;
    return this;
  }
  get seconds() {
    return 0.4 + (this.beat * 60) / this.bpm + 2;
  }
}

const EIGHTS: [number, 'D' | 'U'][] = [
  [1, 'D'], [0.5, 'D'], [0.5, 'U'], [0.5, 'U'], [0.5, 'D'], [1, 'U'],
];

function song(
  name: string,
  tonic: number,
  mode: 'major' | 'minor',
  mood: Mood,
  kit: Kit,
  bpm: number,
  build: (t: Take) => void,
  seed = 1,
): Song {
  const t = new Take(bpm, seed);
  build(t);
  return { name, key: { tonic, mode }, mood, kit, hits: t.hits, seconds: t.seconds };
}

export const CORPUS: Song[] = [
  song('Stairway to Heaven (intro)', 9, 'minor', 'sad', 'guitar-nylon', 72, (t) => {
    for (let rep = 0; rep < 2; rep++) {
      // bar 1: A3 C E A | G#3 B E C  (descending bass under the melody)
      t.mel([[57, 0.5], [60, 0.5], [64, 0.5], [69, 0.5], [56, 0.5], [71, 0.5], [64, 0.5], [60, 0.5]], 1);
      t.mel([[72, 0.5], [64, 0.5], [60, 0.5], [72, 0.5], [55, 0.5], [66, 0.5], [62, 0.5], [57, 0.5]], 1);
      t.mel([[54, 0.5], [62, 0.5], [57, 0.5], [66, 0.5], [53, 0.5], [64, 0.5], [60, 0.5], [57, 0.5]], 1);
      t.mel([[60, 0.5], [64, 0.5], [60, 0.5], [57, 0.5], [43, 0.25], [47, 0.25], [45, 0.5], [45, 0.5], [0, 1]], 1);
    }
    t.arp('C', [0, 2, 4, 3], 0.5).arp('D', [0, 1, 3, 2], 0.5).arp('Fmaj7', [0, 1, 3, 2], 0.5).arp('Am', [0, 2, 4, 3], 0.5);
    t.arp('C', [0, 2, 4, 3], 0.5).arp('G/B', [0, 2, 4, 3], 0.5).arp('Am', [0, 2, 4, 3, 2, 1, 0, 2], 0.5);
  }),
  song('Nothing Else Matters (intro)', 4, 'minor', 'sad', 'guitar-acoustic', 69, (t) => {
    const p = (a: number, b: number, c: number) => t.mel([[40, 0.5], [55, 0.5], [59, 0.5], [a, 0.5], [59, 0.5], [55, 0.5]], 1.5).mel([[b, 0.5], [c, 0.5]], 0.5);
    for (let i = 0; i < 3; i++) {
      p(64, 59, 55);
      p(64, 59, 55);
      t.mel([[40, 0.5], [54, 0.5], [59, 0.5], [62, 0.5], [59, 0.5], [54, 0.5], [40, 1]], 1.5);
    }
    t.arp('C', [0, 2, 3, 4, 3, 2], 0.5).arp('A7sus4', [0, 2, 3, 4, 3, 2], 0.5).arp('D', [0, 1, 2, 3, 2, 1], 0.5).arp('Em', [0, 3, 4, 5, 4, 3], 0.5);
  }),
  song('House of the Rising Sun', 9, 'minor', 'sad', 'guitar-acoustic', 116, (t) => {
    const six = [0, 2, 3, 4, 3, 2];
    for (let r = 0; r < 2; r++)
      for (const c of ['Am', 'C', 'D', 'F', 'Am', 'C', 'E', 'E', 'Am', 'C', 'D', 'F', 'Am', 'E', 'Am', 'E'])
        t.arp(c, six, 0.5);
  }),
  song('Hotel California (intro)', 11, 'minor', 'sad', 'guitar-acoustic', 74, (t) => {
    const seq = ['Bm', 'F#', 'A', 'E', 'G', 'D', 'Em', 'F#'];
    for (let r = 0; r < 2; r++) for (const c of seq) t.arp(c, [0, 2, 3, 4, 3, 2, 3, 4], 0.5);
  }),
  song('Wonderwall', 4, 'minor', 'energetic', 'guitar-acoustic', 87, (t) => {
    for (let r = 0; r < 4; r++) for (const c of ['Em7', 'G', 'Dsus4', 'A7sus4']) t.strum(c, EIGHTS);
    for (const c of ['C', 'D', 'Em7', 'Em7', 'C', 'D', 'G', 'G']) t.strum(c, EIGHTS);
  }),
  song('Wish You Were Here', 7, 'major', 'tender', 'guitar-acoustic', 60, (t) => {
    // the riff over G, then the verse chords
    t.mel([[43, 0.5], [59, 0.5], [55, 0.5], [59, 0.5], [45, 0.5], [60, 0.5], [57, 0.5], [59, 0.5]], 1);
    t.mel([[47, 0.5], [59, 0.5], [55, 0.5], [59, 0.5], [45, 0.25], [48, 0.25], [45, 0.5], [43, 1]], 1);
    for (let r = 0; r < 2; r++) for (const c of ['C', 'D', 'Am', 'G', 'D', 'C', 'Am', 'G']) t.strum(c, [[1, 'D'], [0.5, 'D'], [0.5, 'U'], [1, 'U'], [1, 'D']]);
  }),
  song("Knockin' on Heaven's Door", 7, 'major', 'tender', 'guitar-acoustic', 68, (t) => {
    for (let r = 0; r < 3; r++) for (const c of ['G', 'D', 'Am', 'Am', 'G', 'D', 'C', 'C']) t.strum(c, EIGHTS);
  }),
  song('Let It Be', 0, 'major', 'tender', 'guitar-acoustic', 72, (t) => {
    for (let r = 0; r < 3; r++) for (const c of ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'C']) t.strum(c, [[1, 'D'], [1, 'D'], [0.5, 'D'], [0.5, 'U'], [1, 'D']]);
  }),
  song('Hallelujah', 0, 'major', 'sad', 'guitar-nylon', 56, (t) => {
    const six = [0, 2, 3, 4, 3, 2];
    for (const c of ['C', 'Am', 'C', 'Am', 'F', 'G', 'C', 'G', 'C', 'F', 'G', 'Am', 'F', 'G', 'E7', 'E7', 'Am', 'Am', 'F', 'F', 'Am', 'Am', 'F', 'F', 'C', 'G', 'C', 'C'])
      t.arp(c, six, 0.5);
  }),
  song('Creep', 7, 'major', 'sad', 'guitar-electric', 92, (t) => {
    for (let r = 0; r < 4; r++) for (const c of ['G', 'B', 'C', 'Cm']) t.arp(c, [0, 2, 3, 4, 3, 2, 3, 4], 0.5);
  }),
  song('Yesterday', 5, 'major', 'sad', 'guitar-acoustic', 96, (t) => {
    for (let r = 0; r < 2; r++)
      for (const c of ['F', 'F', 'Em7o', 'A7', 'Dm', 'Dm', 'Bb', 'C7', 'F', 'F', 'Dm', 'G', 'Bb', 'F', 'F', 'F'])
        t.strum(c, [[1, 'D'], [1, 'D'], [1, 'D'], [1, 'D']]);
  }),
  song("Sweet Child O' Mine (riff)", 2, 'major', 'energetic', 'guitar-electric', 125, (t) => {
    const riff = (root: number) =>
      t.mel([[root, 0.5], [74, 0.5], [69, 0.5], [67, 0.5], [79, 0.5], [69, 0.5], [78, 0.5], [69, 0.5]], 0.6);
    for (let r = 0; r < 3; r++) {
      riff(62); riff(62);
      riff(64); riff(64);
      riff(67); riff(67);
      riff(62); riff(62);
    }
  }),
  song('Smoke on the Water (riff)', 7, 'minor', 'energetic', 'guitar-electric', 112, (t) => {
    const pc5 = (r: number, b: number) => {
      const s = t.beat;
      t.mel([[r, 0]], b);
      t.beat = s;
      t.mel([[r + 5, b]], 0.1);
    };
    for (let r = 0; r < 3; r++) {
      pc5(55, 1); pc5(58, 1); pc5(60, 1.5); t.rest(0.5);
      pc5(55, 1); pc5(58, 1); pc5(61, 0.5); pc5(60, 2); t.rest(0.5);
      pc5(55, 1); pc5(58, 1); pc5(60, 1.5); t.rest(0.5);
      pc5(58, 1); pc5(55, 3);
    }
  }),
  song('Seven Nation Army (riff)', 4, 'minor', 'energetic', 'guitar-electric', 120, (t) => {
    for (let r = 0; r < 6; r++) t.mel([[52, 1.5], [52, 0.5], [55, 0.75], [52, 0.75], [50, 0.5], [48, 2], [47, 2]], 0.1);
  }),
  song('A Horse with No Name', 4, 'minor', 'tender', 'guitar-acoustic', 122, (t) => {
    for (let r = 0; r < 8; r++) {
      t.strum('Em', EIGHTS);
      t.strum('D6add9', EIGHTS);
    }
  }),
  song('Zombie', 4, 'minor', 'energetic', 'guitar-electric', 84, (t) => {
    for (let r = 0; r < 4; r++) for (const c of ['Em', 'C', 'G', 'D/F#']) t.strum(c, EIGHTS);
  }),
  song('Canon in D', 2, 'major', 'tender', 'guitar-nylon', 66, (t) => {
    for (let r = 0; r < 2; r++)
      for (const c of ['D', 'A', 'Bm', 'F#m', 'G', 'D', 'G', 'A']) t.arp(c, [0, 1, 2, 3, 2, 1, 2, 3], 0.5);
  }),
  song('Romanza (Spanish Romance)', 4, 'minor', 'sad', 'guitar-nylon', 150, (t) => {
    const trip = (top: number, mid: number[], bass: number) => {
      const s = t.beat;
      t.mel([[bass, 0]], 3);
      t.beat = s;
      t.mel([[top, 1], [mid[0], 1], [mid[1], 1]], 0.5);
    };
    // melody on top of the triplet arpeggio (Em, then Am / B7 / Em)
    for (const [top, bass] of [[71, 40], [71, 40], [71, 40], [69, 40], [67, 40], [67, 40], [66, 40], [67, 40], [71, 40], [71, 40], [76, 40], [76, 40]] as [number, number][])
      trip(top, [59, 55], bass);
    for (const [top, bass] of [[76, 45], [74, 45], [72, 45], [72, 45], [71, 47], [69, 47], [67, 47], [69, 47], [71, 40], [71, 40]] as [number, number][])
      trip(top, top > 72 ? [60, 57] : [63, 59], bass);
  }),
  song('Tears in Heaven', 9, 'major', 'sad', 'guitar-nylon', 80, (t) => {
    for (let r = 0; r < 2; r++)
      for (const c of ['A', 'E/G#', 'F#m', 'A/E', 'D/F#', 'E7sus4', 'E7', 'A', 'A', 'E/G#', 'F#m', 'A/E', 'D/F#', 'E7sus4', 'E7', 'A'])
        t.arp(c, [0, 2, 3, 4], 0.5);
  }),
  song('Dust in the Wind', 0, 'major', 'sad', 'guitar-acoustic', 100, (t) => {
    const travis = [0, 4, 1, 3, 0, 4, 1, 3];
    for (let r = 0; r < 2; r++)
      for (const c of ['C', 'Cmaj7', 'Cadd9', 'C', 'Asus2', 'Asus4', 'Am', 'Am', 'G/B', 'Am', 'D/F#', 'G', 'G/B', 'Am', 'Am', 'Am'])
        t.arp(c, travis, 0.5);
  }),
  song('Greensleeves', 9, 'minor', 'sad', 'guitar-nylon', 96, (t) => {
    const m: [number, number][] = [
      [57, 1], [60, 2], [62, 1], [64, 1.5], [66, 0.5], [64, 1], [62, 2], [59, 1], [55, 1.5], [57, 0.5], [59, 1],
      [60, 2], [57, 1], [57, 1.5], [56, 0.5], [57, 1], [59, 2], [56, 1], [52, 2], [57, 1],
      [60, 2], [62, 1], [64, 1.5], [66, 0.5], [64, 1], [62, 2], [59, 1], [55, 1.5], [57, 0.5], [59, 1],
      [60, 1.5], [59, 0.5], [57, 1], [56, 1.5], [54, 0.5], [56, 1], [57, 3],
    ];
    t.mel(m, 0.3);
  }),
  song('Blackbird', 7, 'major', 'happy', 'guitar-acoustic', 94, (t) => {
    const dyad = (lo: number, hi: number, b: number) => {
      const s = t.beat;
      t.mel([[lo, 0]], b);
      t.beat = s;
      t.mel([[hi, b]], 0.2);
    };
    for (let r = 0; r < 2; r++) {
      dyad(43, 67, 1); dyad(55, 67, 0.5); dyad(45, 69, 1); dyad(55, 67, 0.5);
      dyad(47, 71, 1); dyad(55, 67, 0.5); dyad(48, 72, 1); dyad(55, 67, 0.5);
      dyad(49, 73, 1); dyad(55, 67, 0.5); dyad(50, 74, 1); dyad(54, 66, 1); dyad(52, 67, 1); dyad(51, 66, 1); dyad(50, 66, 2);
    }
  }),
  song('Brown Eyed Girl', 7, 'major', 'happy', 'guitar-acoustic', 148, (t) => {
    for (let r = 0; r < 4; r++) for (const c of ['G', 'C', 'G', 'D']) t.strum(c, EIGHTS);
    for (const c of ['C', 'D', 'G', 'Em', 'C', 'D', 'G', 'D']) t.strum(c, EIGHTS);
  }),
];
