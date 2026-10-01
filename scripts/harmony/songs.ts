import { SHAPES, strum, type SynthNote } from './synth';

/** Arpeggio in the spirit of the Stairway intro (A minor, descending bass line). */
export function stairwayLike(): { notes: SynthNote[]; seconds: number } {
  const bars: number[][] = [
    [57, 60, 64, 69, 71, 64, 60, 71],
    [72, 64, 60, 72, 66, 62, 57, 66],
    [64, 60, 57, 60, 64, 60, 57, 55],
    [53, 57, 60, 64, 57, 53, 55, 59],
  ];
  const step = 0.3;
  const notes: SynthNote[] = [];
  let t = 0.3;
  for (let rep = 0; rep < 2; rep++)
    for (const bar of bars)
      for (const m of bar) {
        notes.push({ midi: m, t, dur: 0.55, vel: 0.6 + 0.2 * ((m * 7919 + t * 1000) % 1) });
        t += step;
      }
  return { notes, seconds: t + 1.5 };
}

/**
 * Closer to the real Stairway intro: the chromatic bass A G♯ G F♯ F under
 * the arpeggio (Am, E/G♯, C/G, D/F♯, Fmaj7, G, Am). G♯ and F♯ are correct
 * notes here and must never be flagged.
 */
export function stairwayIntro(): { notes: SynthNote[]; seconds: number } {
  const bars: [number, number[]][] = [
    [57, [60, 64, 69]],
    [56, [71, 64, 71]],
    [55, [72, 64, 72]],
    [54, [62, 57, 66]],
    [53, [64, 60, 57]],
    [55, [59, 62, 67]],
    [57, [60, 64, 69]],
    [57, [60, 64, 60]],
  ];
  const notes: SynthNote[] = [];
  let t = 0.3;
  for (let rep = 0; rep < 3; rep++)
    for (const [bass, up] of bars) {
      notes.push({ midi: bass, t, dur: 1.1, vel: 0.7 });
      for (let i = 0; i < up.length; i++) notes.push({ midi: up[i], t: t + 0.3 * (i + 1), dur: 0.7, vel: 0.55 + 0.1 * (i % 2) });
      t += 1.2;
    }
  return { notes, seconds: t + 1.5 };
}

export function chordsAmCGEm(): { notes: SynthNote[]; seconds: number; chords: { t: number; name: string }[] } {
  const prog = ['Am', 'C', 'G', 'Em', 'Am', 'F', 'C', 'G'];
  const notes: SynthNote[] = [];
  const chords: { t: number; name: string }[] = [];
  let t = 0.3;
  for (const name of prog) {
    chords.push({ t, name });
    notes.push(...strum(SHAPES[name], t, 0.9, true));
    notes.push(...strum(SHAPES[name], t + 1.0, 0.9, false));
    t += 2;
  }
  return { notes, seconds: t + 1, chords };
}

/** A minor melody with deliberate wrong notes (B♭ = ♭2, C♯ = major 3rd) sprinkled in. */
export function wrongNotes(): { notes: SynthNote[]; seconds: number; wrongAt: number[] } {
  const seq = [57, 60, 64, 62, 60, 59, 57, 64, 58, 57, 60, 61, 64, 69, 70, 69, 67, 64];
  const wrong = new Set([58, 61, 70]);
  const notes: SynthNote[] = [];
  const wrongAt: number[] = [];
  let t = 0.3;
  for (const m of seq) {
    notes.push({ midi: m, t, dur: 0.35, vel: 0.75 });
    if (wrong.has(m)) wrongAt.push(t);
    t += 0.4;
  }
  return { notes, seconds: t + 1, wrongAt };
}

/** Upbeat G-C-D-G strumming, eighth notes: should read as happy. */
export function happyStrum(): { notes: SynthNote[]; seconds: number } {
  const notes: SynthNote[] = [];
  let t = 0.3;
  for (let rep = 0; rep < 2; rep++)
    for (const name of ['G', 'C', 'D', 'G']) {
      for (let i = 0; i < 8; i++) {
        notes.push(...strum(SHAPES[name], t, 0.3, i % 2 === 0));
        t += 0.25;
      }
    }
  return { notes, seconds: t + 1 };
}

/** Slow, ringing C major arpeggio over Cmaj7 Am7 Fmaj7 G: should read as romantic. */
export function romanticArp(): { notes: SynthNote[]; seconds: number } {
  const shapes = [
    [48, 55, 59, 64, 59, 55],
    [45, 52, 55, 60, 55, 52],
    [41, 48, 52, 57, 52, 48],
    [43, 50, 55, 59, 55, 50],
  ];
  const notes: SynthNote[] = [];
  let t = 0.3;
  for (let rep = 0; rep < 2; rep++)
    for (const s of shapes)
      for (const m of s) {
        notes.push({ midi: m, t, dur: 1.4, vel: 0.5 });
        t += 0.5;
      }
  return { notes, seconds: t + 1.5 };
}
