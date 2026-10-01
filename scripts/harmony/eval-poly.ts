import { PolyTracker, BP_SR } from '../../src/harmony/poly';
import { noteName } from '../../src/harmony/theory';
import { loadNodeModel } from './node-model';
import { render } from './synth';
import { stairwayLike, chordsAmCGEm } from './songs';

const model = await loadNodeModel();
for (const [name, song] of Object.entries({ stairway: stairwayLike(), chords: chordsAmCGEm() })) {
  const audio = render(song.notes, song.seconds, 3);
  const got: { t: number; midi: number; prob: number }[] = [];
  const tr = new PolyTracker(model, (e) => { if (e.type === 'on') got.push({ t: e.note.t, midi: e.note.midi, prob: e.note.prob }); }, { rightMargin: Number(process.env.RM ?? 10) });
  const t0 = performance.now();
  const chunk = Math.round(BP_SR * 0.15);
  let runs = 0;
  for (let i = 0; i < audio.length; i += chunk) { tr.push(audio.subarray(i, i + chunk)); await tr.step(); runs++; }
  const ms = (performance.now() - t0) / runs;
  let hit = 0, miss = 0; const used = new Set<number>(); const off: number[] = [];
  for (const n of song.notes) {
    const j = got.findIndex((g, k) => !used.has(k) && g.midi === n.midi && Math.abs(g.t - n.t) < 0.1);
    if (j < 0) { miss++; continue; } used.add(j); hit++; off.push(got[j].t - n.t);
  }
  const extras = got.filter((_, k) => !used.has(k));
  off.sort((a, b) => a - b);
  console.log(`${name}: ${song.notes.length} notes → hit ${hit}, missed ${miss}, extra ${extras.length}; timing median ${(off[off.length >> 1] * 1000).toFixed(0)}ms; ${ms.toFixed(0)}ms/run cpu`);
  const cls = { retrig: 0, harmonic: 0, other: 0 } as Record<string, number>;
  const others: string[] = [];
  for (const e of extras) {
    const sounding = song.notes.filter((n) => n.t - 0.05 <= e.t && e.t <= n.t + n.dur + 0.3);
    if (sounding.some((n) => n.midi === e.midi)) cls.retrig++;
    else if (sounding.some((n) => [12, 19, 24, 28, 31, -12].includes(e.midi - n.midi))) cls.harmonic++;
    else { cls.other++; others.push(`${noteName(e.midi)}@${e.t.toFixed(2)}(${e.prob.toFixed(2)})`); }
  }
  console.log('  extra classes', cls, others.join(' '));
  const missed = song.notes.filter((n) => !got.some((g) => g.midi === n.midi && Math.abs(g.t - n.t) < 0.1));
  console.log('  missed:', missed.map((n) => `${noteName(n.midi)}@${n.t.toFixed(2)}`).join(' '));
}
