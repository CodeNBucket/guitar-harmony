/**
 * Runs the full engine over a recording and prints what it heard:
 *   npx tsx scripts/harmony/eval-file.ts path/to/file.wav
 * Non-WAV files are converted with ffmpeg (FFMPEG env var or on PATH).
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { HarmonyEngine } from '../../src/harmony/engine';
import { chordName, degreeLabel, keyName, noteName } from '../../src/harmony/theory';
import { loadNodeModel } from './node-model';

const SR = 22050;

function readAudio(path: string): Float32Array {
  let buf: Buffer;
  if (/\.wav$/i.test(path)) buf = fs.readFileSync(path);
  else {
    const ff = process.env.FFMPEG ?? 'ffmpeg';
    buf = execFileSync(ff, ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(SR), '-f', 'wav', '-'], { maxBuffer: 1 << 30 });
  }
  // minimal PCM16 / float32 WAV reader
  let o = 12, fmt = 1, ch = 1, sr = SR, bits = 16;
  while (o < buf.length) {
    const id = buf.toString('ascii', o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') { fmt = buf.readUInt16LE(o + 8); ch = buf.readUInt16LE(o + 10); sr = buf.readUInt32LE(o + 12); bits = buf.readUInt16LE(o + 22); }
    if (id === 'data') {
      const bytes = bits / 8;
      const n = Math.floor(Math.min(size, buf.length - o - 8) / (bytes * ch));
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) {
          const p = o + 8 + (i * ch + c) * bytes;
          s += fmt === 3 ? buf.readFloatLE(p) : bits === 16 ? buf.readInt16LE(p) / 32768 : buf.readInt32LE(p) / 2 ** 31;
        }
        x[i] = s / ch;
      }
      if (sr !== SR) {
        const r = sr / SR, m = Math.floor(n / r), y = new Float32Array(m);
        for (let i = 0; i < m; i++) { const p = i * r, k = Math.floor(p), f = p - k; y[i] = x[k] + ((x[k + 1] ?? x[k]) - x[k]) * f; }
        return y;
      }
      return x;
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

const path = process.argv[2];
const audio = readAudio(path);
const model = process.env.NO_POLY ? null : await loadNodeModel();
const eng = new HarmonyEngine(model);
const lines: string[] = [];
let notes = 0, wrong = 0, tension = 0;
eng.on((e) => {
  const k = eng.currentKey;
  if (e.type === 'key' && e.changed && e.state.key) lines.push(`${eng.time.toFixed(2)}  KEY → ${keyName(e.state.key)}`);
  if (e.type === 'note') {
    notes++;
    if (e.verdict === 'tension') tension++;
    if (process.env.VERBOSE || e.verdict === 'tension')
      lines.push(`${e.t.toFixed(2)}  note ${noteName(e.midi, k)} (${e.source}) ${e.degree !== null ? degreeLabel(e.degree) : ''} ${e.verdict ?? ''}`);
  }
  if (e.type === 'wrong') {
    wrong++;
    lines.push(`${e.t.toFixed(2)}  WRONG ${noteName(e.midi, k)}`);
  }
  if (e.type === 'mood') lines.push(`${eng.time.toFixed(2)}  MOOD → ${e.mood}`);
  if (e.type === 'chord') lines.push(`${e.t.toFixed(2)}  ${e.strum ? 'CHORD' : 'harmony'} ${chordName(e.chord, k)} ${e.verdict ?? ''}`);
});
const chunk = Math.round(SR * 0.13);
for (let i = 0; i < audio.length; i += chunk) {
  eng.push(audio.subarray(i, i + chunk));
  await eng.tick();
}
console.log(lines.join('\n'));
console.log(`\n${(audio.length / SR).toFixed(1)} s, ${notes} notes, ${tension} tension, ${wrong} wrong; final key ${eng.currentKey ? keyName(eng.currentKey) : 'none'}, mood ${eng.mood.state.mood ?? 'none'}`);
