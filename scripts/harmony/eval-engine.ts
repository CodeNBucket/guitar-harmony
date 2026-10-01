import { HarmonyEngine, type HarmonyEvent } from '../../src/harmony/engine';
import { chordName, keyName, noteName } from '../../src/harmony/theory';
import { loadNodeModel } from './node-model';
import { SR, render } from './synth';
import { chordsAmCGEm, happyStrum, romanticArp, stairwayIntro, stairwayLike, wrongNotes } from './songs';

const model = process.env.NO_POLY ? null : await loadNodeModel();
const songs = { stairway: stairwayLike(), stairway2: stairwayIntro(), happy: happyStrum(), romantic: romanticArp(), chords: chordsAmCGEm(), wrong: wrongNotes() };
for (const [name, song] of Object.entries(songs)) {
  if (process.env.ONLY && process.env.ONLY !== name) continue;
  const audio = render(song.notes, song.seconds, 5);
  const eng = new HarmonyEngine(model);
  const log: string[] = [];
  let lockT = -1;
  const wrongs: string[] = [];
  const chords: string[] = [];
  eng.on((e: HarmonyEvent) => {
    if (e.type === 'key' && e.changed && e.state.key) {
      if (lockT < 0) lockT = eng.time;
      log.push(`key ${keyName(e.state.key)} @${eng.time.toFixed(1)}s`);
    }
    if (e.type === 'chord') chords.push(`${e.strum ? '' : '~'}${chordName(e.chord)}@${e.t.toFixed(1)}`);
    if (e.type === 'wrong') wrongs.push(`${noteName(e.midi)}@${e.t.toFixed(2)}`);
    if (e.type === 'mood') log.push(`mood ${e.mood} @${eng.time.toFixed(1)}s`);
  });
  const chunk = Math.round(SR * 0.15);
  for (let i = 0; i < audio.length; i += chunk) {
    eng.push(audio.subarray(i, i + chunk));
    await eng.tick();
  }
  console.log(`\n== ${name}: ${log.join(', ') || 'no key'}`);
  const sc = eng.mood.state.scores;
  console.log(`  mood scores: sad ${sc.sad.toFixed(2)} happy ${sc.happy.toFixed(2)} romantic ${sc.romantic.toFixed(2)}`);
  console.log(`  best guess at end: ${eng.key.state.best ? keyName(eng.key.state.best) : '-'} conf ${eng.key.state.confidence.toFixed(2)}`);
  console.log(`  chords: ${chords.join(' ')}`);
  console.log(`  wrong flags: ${wrongs.join(' ') || 'none'}`);
  if ('wrongAt' in song) console.log(`  truth wrong at: ${(song as { wrongAt: number[] }).wrongAt.map((t) => t.toFixed(2)).join(' ')}`);
}
