/**
 * Detection test, the other half of eval-songs.ts: the same 20 songs with
 * obvious mistakes dropped in (a clearly out-of-key note, held ~0.6 s, three
 * per song). Prints how many were caught, how many correct notes were flagged,
 * and why the missed ones were let off.
 *   npm run harmony:mistakes          (ONLY=<substring> to pick songs)
 */
import { HarmonyEngine } from '../../src/harmony/engine';
import { noteName } from '../../src/harmony/theory';
import { loadNodeModel } from './node-model';
import { SR, render } from './synth';
import { songbook } from './songbook';

/** the key each song is in: tonic pitch class and mode, same order as songbook() */
const KEYS: [number, 'major' | 'minor'][] = [
  [9, 'minor'], [9, 'minor'], [11, 'minor'], [0, 'major'], [7, 'major'],
  [0, 'major'], [7, 'major'], [2, 'major'], [4, 'major'], [7, 'major'],
  [0, 'major'], [7, 'major'], [9, 'minor'], [0, 'major'], [4, 'minor'],
  [2, 'major'], [9, 'minor'], [7, 'minor'], [6, 'minor'], [7, 'major'],
];

const model = process.env.NO_POLY ? null : await loadNodeModel();
let planted = 0;
let caught = 0;
let falseAlarms = 0;
const why: Record<string, number> = {};
const songs = songbook();
for (let si = 0; si < songs.length; si++) {
  const song = songs[si];
  if (process.env.ONLY && !song.name.includes(process.env.ONLY)) continue;
  const [tonic, mode] = KEYS[si];
  // out of key and not a blue note: ♭2 and ♯4/♭6 in major, ♭2 and the major 3rd in minor
  const bad = mode === 'major' ? [1, 6, 8] : [1, 4, 1];
  const times = [7, 11.5, 16].filter((t) => t < song.seconds - 2);
  const mistakes = times.map((t, i) => {
    let midi = 60 + ((tonic + bad[i]) % 12);
    if (midi < 62) midi += 12;
    return { midi, t, dur: 0.6, vel: 0.85 };
  });
  const audio = render([...song.notes, ...mistakes], song.seconds, 5);
  const eng = new HarmonyEngine(model);
  const hits: string[] = [];
  const alarms: string[] = [];
  eng.on((e) => {
    if (e.type !== 'wrong') return;
    const m = mistakes.find((x) => Math.abs(x.t - e.t) < 0.2 && (x.midi - e.midi) % 12 === 0);
    if (m) hits.push(`${noteName(e.midi)}@${e.t.toFixed(1)}`);
    else alarms.push(`${noteName(e.midi)}@${e.t.toFixed(1)}`);
  });
  const chunk = Math.round(SR * 0.13);
  for (let i = 0; i < audio.length; i += chunk) {
    eng.push(audio.subarray(i, i + chunk));
    await eng.tick();
  }
  const got = new Set(hits.map((h) => h.split('@')[1])).size;
  planted += mistakes.length;
  caught += Math.min(got, mistakes.length);
  falseAlarms += alarms.length;
  for (const [k, v] of Object.entries(eng.forgiven)) why[k] = (why[k] ?? 0) + v;
  console.log(
    `${got >= mistakes.length && !alarms.length ? ' ok ' : 'MISS'}  ${song.name}: caught ${got}/${mistakes.length}` +
      (alarms.length ? `, false alarms ${alarms.join(' ')}` : '') +
      `  forgiven ${JSON.stringify(eng.forgiven)}`,
  );
}
console.log(`\ncaught ${caught}/${planted} planted mistakes, ${falseAlarms} false alarms`);
console.log(`forgiveness reasons (all suspicious notes): ${JSON.stringify(why)}`);
