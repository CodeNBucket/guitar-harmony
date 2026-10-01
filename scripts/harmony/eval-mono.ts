import { MonoAnalyzer } from '../../src/harmony/pitch';
import { noteName } from '../../src/harmony/theory';
import { render } from './synth';
import { stairwayLike, wrongNotes } from './songs';

for (const [name, song] of Object.entries({ stairway: stairwayLike(), wrong: wrongNotes() })) {
  const audio = render(song.notes, song.seconds, 3);
  const got: { t: number; midi: number; clarity: number; legato: boolean }[] = [];
  const unp: number[] = [];
  const an = new MonoAnalyzer((e) => {
    if (e.type === 'on') got.push({ t: e.note.t, midi: e.note.midi, clarity: e.note.clarity, legato: e.note.legato });
    if (e.type === 'unpitched') unp.push(e.t);
  });
  for (let i = 0; i < audio.length; i += 512) an.push(audio.subarray(i, i + 512));
  // match truth → detections within 60 ms
  let hit = 0, octave = 0, wrongPitch = 0, miss = 0;
  const used = new Set<number>();
  const lat: number[] = [];
  for (const n of song.notes) {
    const j = got.findIndex((g, k) => !used.has(k) && Math.abs(g.t - n.t) < 0.07);
    if (j < 0) { miss++; continue; }
    used.add(j);
    const d = got[j].midi - n.midi;
    if (d === 0) hit++; else if (d % 12 === 0) { octave++; console.log(`  oct ${noteName(n.midi)} got ${noteName(got[j].midi)} @${n.t.toFixed(2)}`); } else { wrongPitch++; console.log(`  ${name}: truth ${noteName(n.midi)} got ${noteName(got[j].midi)} @${n.t.toFixed(2)} clar ${got[j].clarity.toFixed(2)}`); }
    lat.push(got[j].t - n.t);
  }
  const extra = got.length - used.size;
  console.log(`${name}: ${song.notes.length} notes → hit ${hit}, octave ${octave}, wrong pitch ${wrongPitch}, missed ${miss}, extra ${extra}, unpitched ${unp.length}; onset err median ${(lat.sort((a,b)=>a-b)[lat.length>>1]*1000).toFixed(0)}ms`);
}
