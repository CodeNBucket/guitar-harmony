/**
 * Plays every song in corpus.ts (real guitar samples) through the engine and
 * reports key accuracy and false "wrong" calls. With INJECT=1 it also drops
 * deliberate wrong notes into each song and reports how many were caught.
 *
 *   GUITAR_SAMPLES=/tmp/tji/samples npm run harmony:corpus
 *   ONLY=Creep INJECT=1 npm run harmony:corpus
 */
import { HarmonyEngine } from '../../src/harmony/engine';
import { keyName, noteName, pc } from '../../src/harmony/theory';
import { CORPUS, type Song } from './corpus';
import { cached, loadNodeModel } from './node-model';
import { SR, renderReal, type Hit } from './sampler';

/** the corpus labels four moods, the scene shows three */
const MOOD_OF: Record<string, string> = { sad: 'sad', tender: 'romantic', happy: 'happy', energetic: 'happy' };
const TICK = Number(process.env.TICK ?? 0.2);

export interface Result {
  name: string;
  truthKey: string;
  gotKey: string;
  lockAt: number | null;
  notes: number;
  falseWrong: string[];
  injected: number;
  caught: number;
  mood: string | null;
  truthMood: string;
}

/** the ♭2 of the key: wrong in any key or mode */
function injections(s: Song): Hit[] {
  const out: Hit[] = [];
  const b2 = pc(s.key.tonic + 1);
  for (const frac of [0.45, 0.65, 0.85]) {
    const t = s.seconds * frac;
    // an octave that sits inside the song's register
    const around = s.hits.filter((h) => Math.abs(h.t - t) < 2).map((h) => h.midi);
    const centre = around.length ? around.reduce((a, b) => a + b, 0) / around.length : 60;
    let m = Math.round(centre / 12) * 12 + b2;
    if (m < 50) m += 12;
    out.push({ midi: m, t, dur: 0.6, vel: 0.9 });
  }
  return out;
}

export async function runSong(s: Song, model: Awaited<ReturnType<typeof loadNodeModel>> | null, inject: boolean): Promise<Result> {
  const extra = inject ? injections(s) : [];
  const audio = renderReal(s.kit, [...s.hits, ...extra], s.seconds, s.name.length * 7 + 3);
  const eng = new HarmonyEngine(model ? cached(model) : null);
  const falseWrong: string[] = [];
  const at = process.env.AT ? Number(process.env.AT) : null;
  if (process.env.TRACE)
    eng.trace = (m, t, why) => {
      const near = at !== null ? Math.abs(t - at) < 1.5 : extra.some((x) => Math.abs(x.t - t) < 0.4);
      if (near) console.log(`   ${noteName(m)}@${t.toFixed(2)} ${why}`);
    };
  let caught = 0;
  let lockAt: number | null = null;
  eng.on((e) => {
    if (e.type === 'key' && e.changed && e.state.key && lockAt === null) lockAt = eng.time;
    const wrongAt = (t: number, label: string) => {
      const hit = extra.find((x) => Math.abs(x.t - t) < 0.35);
      if (hit) caught++;
      else falseWrong.push(`${label}@${t.toFixed(1)}`);
    };
    if (e.type === 'wrong') wrongAt(e.t, noteName(e.midi));
  });
  const chunk = Math.round(SR * TICK);
  for (let i = 0; i < audio.length; i += chunk) {
    eng.push(audio.subarray(i, i + chunk));
    await eng.tick();
  }
  const k = eng.currentKey;
  const truth = { tonic: s.key.tonic, mode: s.key.mode };
  return {
    name: s.name,
    truthKey: keyName(truth),
    gotKey: k ? keyName(k) : '—',
    lockAt,
    notes: s.hits.length,
    falseWrong,
    injected: extra.length,
    caught: Math.min(caught, extra.length),
    mood: eng.mood.state.mood,
    truthMood: s.mood,
  };
}

const isMain = process.argv[1]?.endsWith('eval-corpus.ts');
if (isMain) {
  const model = process.env.NO_POLY ? null : await loadNodeModel();
  const inject = !!process.env.INJECT;
  const only = process.env.ONLY;
  let fa = 0;
  let inj = 0;
  let cau = 0;
  let keyOk = 0;
  const [si, sn] = (process.env.SHARD ?? '0/1').split('/').map(Number);
  const songs = CORPUS.filter((s, i) => (!only || s.name.includes(only)) && i % sn === si);
  for (const s of songs) {
    const r = await runSong(s, model, inject);
    fa += r.falseWrong.length;
    inj += r.injected;
    cau += r.caught;
    const rel = r.gotKey === r.truthKey;
    if (rel) keyOk++;
    console.log(
      `${r.name.padEnd(32)} key ${r.truthKey.padEnd(9)} → ${r.gotKey.padEnd(9)}${rel ? ' ' : '✗'} lock ${r.lockAt?.toFixed(1) ?? '—'}s` +
        `  false wrong: ${r.falseWrong.length}${r.falseWrong.length ? ' ' + r.falseWrong.join(' ') : ''}` +
        (inject ? `  caught ${r.caught}/${r.injected}` : '') +
        `  mood ${r.mood ?? '—'}${r.mood === MOOD_OF[r.truthMood] ? '' : ` (label ${MOOD_OF[r.truthMood]})`}`,
    );
  }
  console.log(`\n${songs.length} songs: key right ${keyOk}/${songs.length}, false wrong ${fa}` + (inject ? `, caught ${cau}/${inj}` : ''));
}
