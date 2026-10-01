/**
 * Writes public/audio/harmony-demo.wav: a synthesized placeholder (arpeggio,
 * strummed chords, then a few wrong notes) used by the "hear a demo" button
 * until a real recording of the owner replaces it.
 */
import fs from 'node:fs';
import { render, writeWav, type SynthNote } from './synth';
import { chordsAmCGEm, stairwayLike, wrongNotes } from './songs';

const parts = [stairwayLike(), chordsAmCGEm(), wrongNotes()];
const notes: SynthNote[] = [];
let offset = 0;
for (const p of parts) {
  for (const n of p.notes) notes.push({ ...n, t: n.t + offset });
  offset += p.seconds - 0.5;
}
fs.mkdirSync('public/audio', { recursive: true });
writeWav('public/audio/harmony-demo.wav', render(notes, offset + 1, 11));
console.log(`demo: ${offset.toFixed(1)} s`);
