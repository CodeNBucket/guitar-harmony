/**
 * False-alarm test: 20 songs played correctly, each rendered twice (clean, and
 * rough: louder noise, sloppier strums, longer ringing). Every 'wrong' event
 * is a false alarm. Also prints the key and mood each song ended on.
 *   npm run harmony:songs            (ONLY=<substring> to pick songs)
 */
import { HarmonyEngine } from '../../src/harmony/engine';
import { keyName, noteName } from '../../src/harmony/theory';
import { loadNodeModel } from './node-model';
import { SR, render } from './synth';
import { songbook } from './songbook';

const model = process.env.NO_POLY ? null : await loadNodeModel();
let total = 0;
let alarms = 0;
for (const song of songbook()) {
  if (process.env.ONLY && !song.name.includes(process.env.ONLY)) continue;
  for (const rough of [false, true]) {
    const notes = rough
      ? song.notes.map((n, i) => ({
          ...n,
          t: n.t + (((i * 7919) % 13) - 6) * 0.004,
          dur: n.dur * 1.4,
          vel: Math.min(1, (n.vel ?? 0.7) * (0.75 + ((i * 31) % 10) / 20)),
        }))
      : song.notes;
    const audio = render(notes, song.seconds, rough ? 11 : 5, rough ? 0.02 : 0.004);
    const eng = new HarmonyEngine(model);
    const wrongs: string[] = [];
    eng.on((e) => {
      if (e.type === 'wrong') wrongs.push(`${noteName(e.midi)}@${e.t.toFixed(1)}`);
    });
    const chunk = Math.round(SR * 0.13);
    for (let i = 0; i < audio.length; i += chunk) {
      eng.push(audio.subarray(i, i + chunk));
      await eng.tick();
    }
    total++;
    if (wrongs.length) alarms++;
    const k = eng.currentKey ? keyName(eng.currentKey) : 'no key';
    console.log(
      `${wrongs.length ? 'FAIL' : ' ok '}  ${song.name}${rough ? ' [rough]' : ''}  → ${k}, ${eng.mood.state.mood ?? 'no mood'}` +
        (wrongs.length ? `  false wrongs: ${wrongs.join(' ')}` : ''),
    );
  }
}
console.log(`\n${total - alarms}/${total} runs with zero false alarms`);
