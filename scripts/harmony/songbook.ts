import { strum, type SynthNote } from './synth';

/**
 * Twenty well-known progressions and melodic idioms, played correctly, for the
 * "no false alarms" test (eval-songs.ts). Chord progressions and scale idioms
 * only: no copied melodies. Several deliberately use notes outside the plain
 * scale that are still right: harmonic/melodic minor, secondary dominants,
 * borrowed chords, blue notes, chromatic passing runs.
 */

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUAL: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  dim: [0, 3, 6],
  add9: [0, 4, 7, 14],
};

/** "F#m7" → { root pc, intervals } */
function parse(name: string) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(name)!;
  let root = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  root = (root + 12) % 12;
  return { root, iv: QUAL[m[3]] ?? QUAL[''] };
}

/** a playable-ish guitar voicing: bass on E2..D#3, chord tones above */
function voicing(name: string): number[] {
  const { root, iv } = parse(name);
  const bass = 40 + ((root - 4 + 12) % 12);
  const upper = iv.map((i) => {
    let m = bass + 12 + i;
    while (m > 67) m -= 12;
    return m;
  });
  // root in the bass, fifth above it, like real open and barre shapes
  return [bass, bass + 7, ...upper.sort((a, b) => a - b)].filter(
    (v, i, a) => a.indexOf(v) === i,
  );
}

type Style = 'strum' | 'arp' | 'ballad' | 'waltz';

function progression(chords: string[], style: Style, reps = 2): { notes: SynthNote[]; seconds: number } {
  const notes: SynthNote[] = [];
  let t = 0.3;
  for (let r = 0; r < reps; r++)
    for (const c of chords) {
      const v = voicing(c);
      if (style === 'strum') {
        for (let i = 0; i < 8; i++) {
          notes.push(...strum(i % 2 ? v.slice(2) : v, t, 0.28, i % 2 === 0));
          t += 0.25;
        }
      } else if (style === 'waltz') {
        notes.push({ midi: v[0], t, dur: 1.4, vel: 0.7 });
        const up = v.slice(2);
        for (let i = 0; i < 5; i++) notes.push({ midi: up[[0, 1, 2, 1, 2][i] % up.length], t: t + 0.25 * (i + 1), dur: 0.6, vel: 0.5 });
        t += 1.5;
      } else {
        const step = style === 'ballad' ? 0.45 : 0.28;
        const seq = [v[0], ...v.slice(2), v[v.length - 2], v[2]];
        for (const m of seq) {
          notes.push({ midi: m, t, dur: style === 'ballad' ? 1.3 : 0.7, vel: 0.5 + 0.2 * ((m * 37) % 10) / 10 });
          t += step;
        }
      }
    }
  return { notes, seconds: t + 1.5 };
}

function melody(midis: number[], step: number, reps = 2, backing?: string[]): { notes: SynthNote[]; seconds: number } {
  const notes: SynthNote[] = [];
  let t = 0.3;
  for (let r = 0; r < reps; r++) {
    midis.forEach((m, i) => {
      notes.push({ midi: m, t: t + i * step, dur: step * 1.1, vel: 0.65 });
    });
    if (backing) {
      const each = (midis.length * step) / backing.length;
      backing.forEach((c, i) => notes.push({ midi: voicing(c)[0], t: t + i * each, dur: each, vel: 0.55 }));
    }
    t += midis.length * step;
  }
  return { notes, seconds: t + 1.5 };
}

export interface TestSong {
  name: string;
  notes: SynthNote[];
  seconds: number;
}

export function songbook(): TestSong[] {
  const s = (name: string, x: { notes: SynthNote[]; seconds: number }): TestSong => ({ name, ...x });
  return [
    // Stairway-style intro: chromatic bass A G# G F# F
    s('stairway intro (Am, chromatic bass)', {
      ...(() => {
        const bars: [number, number[]][] = [
          [57, [60, 64, 69]], [56, [71, 64, 71]], [55, [72, 64, 72]], [54, [62, 57, 66]],
          [53, [64, 60, 57]], [55, [59, 62, 67]], [57, [60, 64, 69]], [57, [60, 64, 60]],
        ];
        const notes: SynthNote[] = [];
        let t = 0.3;
        for (let r = 0; r < 3; r++)
          for (const [b, up] of bars) {
            notes.push({ midi: b, t, dur: 1.1, vel: 0.7 });
            up.forEach((m, i) => notes.push({ midi: m, t: t + 0.3 * (i + 1), dur: 0.7, vel: 0.6 }));
            t += 1.2;
          }
        return { notes, seconds: t + 1.5 };
      })(),
    }),
    s('rising-sun style (Am C D F / Am E, 6/8)', progression(['Am', 'C', 'D', 'F', 'Am', 'C', 'E', 'E'], 'waltz')),
    s('hotel-california style (Bm F# A E G D Em F#)', progression(['Bm', 'F#', 'A', 'E', 'G', 'D', 'Em', 'F#'], 'arp')),
    s('four-chord pop (C G Am F)', progression(['C', 'G', 'Am', 'F'], 'strum')),
    s('heaven’s-door style (G D Am / G D C)', progression(['G', 'D', 'Am', 'Am', 'G', 'D', 'C', 'C'], 'strum')),
    s('let-it-be style (C G Am F C G F C)', progression(['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'C'], 'ballad')),
    s('wonderwall style (Em7 G Dsus4 A7sus4)', progression(['Em7', 'G', 'Dsus4', 'A7'], 'strum')),
    s('canon in D (D A Bm F#m G D G A)', progression(['D', 'A', 'Bm', 'F#m', 'G', 'D', 'G', 'A'], 'arp')),
    s('12-bar blues in E (E7 A7 B7)', progression(['E7', 'E7', 'E7', 'E7', 'A7', 'A7', 'E7', 'E7', 'B7', 'A7', 'E7', 'B7'], 'strum', 1)),
    s('creep style (G B C Cm)', progression(['G', 'B', 'C', 'Cm'], 'strum')),
    s('hallelujah style (C Am C Am F G C G, 6/8)', progression(['C', 'Am', 'C', 'Am', 'F', 'G', 'C', 'G'], 'waltz')),
    s('wish-you-were-here style (C D Am G)', progression(['C', 'D', 'Am', 'G', 'D', 'C', 'Am', 'G'], 'strum')),
    s('andalusian cadence (Am G F E)', progression(['Am', 'G', 'F', 'E'], 'arp', 3)),
    s('jazz ii-V-I (Dm7 G7 Cmaj7 A7)', progression(['Dm7', 'G7', 'Cmaj7', 'A7'], 'ballad')),
    s('nothing-else-matters style (Em arpeggio)', progression(['Em', 'Em', 'D', 'C', 'Em', 'Em', 'G', 'D'], 'arp')),
    // melodies
    s('D major scale runs', melody([62, 64, 66, 67, 69, 71, 73, 74, 73, 71, 69, 67, 66, 64, 62, 57], 0.2, 3, ['D', 'A'])),
    s('A harmonic/melodic minor line (F# G#)', melody([57, 59, 60, 62, 64, 66, 68, 69, 67, 65, 64, 62, 60, 59, 57, 56, 57], 0.25, 2, ['Am', 'E'])),
    s('minor pentatonic + blue note in G', melody([55, 58, 60, 61, 62, 65, 67, 65, 62, 61, 60, 58, 55], 0.22, 3, ['Gm', 'C'])),
    s('chromatic passing run in F#m', melody([66, 69, 71, 73, 74, 75, 76, 74, 73, 71, 69, 68, 66], 0.18, 3, ['F#m', 'C#'])),
    s('slow ballad melody in G (secondary dominant E7)', melody([67, 71, 74, 72, 71, 69, 68, 69, 71, 67, 66, 67], 0.5, 2, ['G', 'E7', 'Am', 'D'])),
  ];
}
