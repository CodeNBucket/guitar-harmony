import { KeyTracker, type KeyState } from './key';
import { MoodTracker, type Mood } from './mood';
import { MonoAnalyzer, type MonoEvent, type PitchFrame } from './pitch';
import { BP_MIDI0, BP_PITCHES, PolyTracker, type PitchModel, type PolyEvent } from './poly';
import {
  type Chord,
  type Key,
  type Verdict,
  degreeOf,
  judgeChord,
  judgePc,
  nameChord,
  pc,
} from './theory';

/**
 * Glue between the detectors and the visuals.
 *
 * Two note sources run side by side:
 *  - mono (MPM): ~50 ms after the pick, only for clean single notes;
 *  - poly (Basic Pitch): ~250 ms behind, catches chords and ringing arpeggio
 *    notes the mono path can't separate, and confirms mono notes.
 * A poly note that repeats a mono note is folded into it, so the scene gets
 * each played note once, as early as it can be trusted.
 */

export type Source = 'mono' | 'poly';

export interface NoteEvent {
  type: 'note';
  id: number;
  midi: number;
  t: number;
  source: Source;
  velocity: number;
  /**
   * null until the key is locked. A note that looks wrong starts as null too:
   * it is only reported (as a separate 'wrong' event) once it has held long
   * enough and nothing explains it.
   */
  verdict: Verdict | null;
  /** semitones above the tonic, null until the key is locked */
  degree: number | null;
}

export interface ChordEvent {
  type: 'chord';
  t: number;
  chord: Chord;
  verdict: Verdict | null;
  /** true for a strum (attacked together), false for an arpeggio's harmony */
  strum: boolean;
}

export type HarmonyEvent =
  | NoteEvent
  | { type: 'noteoff'; id: number; t: number }
  | ChordEvent
  | { type: 'key'; state: KeyState; changed: boolean }
  | { type: 'wrong'; id: number; midi: number; t: number }
  /** a pick attack, before its pitch is known: for instant visual feedback */
  | { type: 'attack'; t: number; strength: number }
  | { type: 'mood'; mood: Mood | null; scores: Record<Mood, number> }
  | { type: 'streak'; value: number; best: number };

interface Sounding {
  id: number;
  midi: number;
  t: number;
  source: Source;
  weight: number;
  polyId?: number;
  monoId?: number;
  confirmed: boolean;
  end?: number;
}

interface Suspect {
  s: Sounding;
  t: number;
}

const MONO_TRUST = 0.84; // clarity above which a mono note is judged at once
const POLY_TRUST = 0.42; // Basic Pitch note probability needed for a verdict
const STRUM_GAP = 0.07; // seconds: attacks closer than this belong to one strum
const HARMONY_HALFLIFE = 0.9;
/** without the chord model: seconds a suspicious note must be heard to count */
const WRONG_HOLD = 0.3;
/** shorter than this is a blip, never a mistake */
const MIN_WRONG = 0.08;
/** chord-model note probability (×1.4) a mistake needs: rules out faint ghosts */
const WRONG_MIN_WEIGHT = 0.5;
/** seconds after the key locks or changes before anything can be wrong */
const KEY_GRACE = 4;
/** with the poly model on, wait this long for it to confirm the note */
const WRONG_WAIT_POLY = 0.7;
/** intervals of a string's 3rd, 5th, 6th and 7th harmonics above its fundamental */
const GHOSTS = [19, 28, 31, 34];

export class HarmonyEngine {
  readonly key = new KeyTracker();
  readonly mood = new MoodTracker();
  private mono: MonoAnalyzer;
  private poly: PolyTracker | null = null;
  private listeners = new Set<(e: HarmonyEvent) => void>();
  private sounding = new Map<number, Sounding>();
  private recent: Sounding[] = []; // note-ons of the last ~0.5 s, for fusion
  private nextId = 1;
  private lockedKey: Key | null = null;
  private streak = 0;
  private bestStreak = 0;
  private strum: { t: number; last: number; notes: { midi: number; w: number }[] } | null = null;
  private harmonyEnergy = new Float64Array(12);
  private harmonyT = 0;
  private harmonyName = '';
  private harmonyRun = 0;
  private lastFrameT = 0;
  private polyOffset = 0;
  private lastStart = new Map<number, number>();
  private suspects: Suspect[] = [];
  /** note starts of the last few seconds, for passing-tone checks */
  private history: { midi: number; t: number }[] = [];
  /** chords named in the last few seconds (strums and arpeggio harmony) */
  private chordLog: { pcs: number[]; t: number; strum: boolean }[] = [];
  private keySince = 0;
  /** latest level for meters, 0..1 */
  level = 0;

  constructor(model: PitchModel | null) {
    this.mono = new MonoAnalyzer((e, f) => this.onMono(e, f));
    this.mono.onAttack = (t, rms) =>
      this.emit({ type: 'attack', t, strength: Math.min(1, rms / Math.max(0.01, this.mono.noiseFloor * 25)) });
    if (model) this.attachModel(model);
  }

  /** plug the chord model in once it has loaded (single notes work before) */
  attachModel(model: PitchModel) {
    if (this.poly) return;
    // the tracker's clock starts at zero now: shift its times onto ours
    const off = this.time;
    this.polyOffset = off;
    this.poly = new PolyTracker(
      model,
      (e) => {
        if (e.type === 'on') this.onPoly({ type: 'on', note: { ...e.note, t: e.note.t + off } });
        else if (e.type === 'off') this.onPoly({ type: 'off', note: { ...e.note, t: e.note.t + off }, t: e.t + off });
      },
      { rightMargin: 4 },
    );
  }

  on(fn: (e: HarmonyEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: HarmonyEvent) {
    for (const fn of this.listeners) fn(e);
  }

  get time() {
    return this.mono.time;
  }

  get currentKey() {
    return this.lockedKey;
  }

  get hasPoly() {
    return this.poly !== null;
  }

  /** 22.05 kHz mono samples */
  push(samples: Float32Array) {
    this.mono.push(samples);
    this.poly?.push(samples);
    const f = this.mono.last;
    if (f) this.level = Math.min(1, this.level * 0.8 + Math.min(1, f.rms * 8) * 0.2);
  }

  /** Call every ~120-200 ms: runs the poly model and refreshes the key. */
  async tick() {
    if (this.poly) {
      await this.poly.step();
      // a strum is complete once the settled timeline has moved past it
      if (this.strum && this.poly.settledTime + this.polyOffset - this.strum.last > STRUM_GAP) this.closeStrum();
    }
    this.refreshKey(this.time);
    this.judgeSuspects(this.time);
  }

  reset() {
    this.key.reset();
    this.lockedKey = null;
    this.streak = 0;
    this.sounding.clear();
    this.recent = [];
    this.suspects = [];
    this.history = [];
    this.harmonyEnergy.fill(0);
    this.emit({ type: 'key', state: this.key.state, changed: true });
    this.emit({ type: 'streak', value: 0, best: this.bestStreak });
  }

  // ------------------------------------------------------------- sources

  private onMono(e: MonoEvent, f: PitchFrame) {
    this.lastFrameT = f.t;
    if (e.type === 'on') {
      const n = e.note;
      const trusted = n.clarity >= MONO_TRUST;
      const s = this.startNote(n.midi, n.t, 'mono', n.velocity, trusted);
      s.monoId = n.id;
      // without the poly model, mono is the only key evidence
      if (!this.poly) this.key.addNote(n.midi, 0.25, n.t, this.isBass(n.midi));
    } else if (e.type === 'off') {
      const s = [...this.sounding.values()].find((x) => x.monoId === e.note.id);
      // the mono path ends a note at the next attack even if it rings on;
      // once the poly path has confirmed it, poly decides when it stops
      if (s && s.polyId === undefined) {
        if (!this.poly) this.key.addNote(s.midi, Math.min(2, e.t - s.t), e.t, this.isBass(s.midi));
        this.endNote(s, e.t);
      }
    }
  }

  private onPoly(e: PolyEvent) {
    if (e.type === 'frame') return;
    if (e.type === 'off') {
      const s = [...this.sounding.values()].find((x) => x.polyId === e.note.id);
      if (s) {
        this.key.addNote(s.midi, Math.min(2, e.t - s.t) * s.weight, e.t, this.isBass(s.midi));
        this.endNote(s, e.t);
      }
      return;
    }
    const n = e.note;
    const weight = Math.min(1, n.prob * 1.4);
    this.key.addNote(n.midi, 0.25 * weight, n.t, this.isBass(n.midi));
    this.addToStrum(n.midi, n.t, weight);
    this.addHarmony(n.midi, n.t, weight);

    // fold into a mono note of the same pitch (any octave) played just before
    const twin = this.recent.find(
      (r) => r.source === 'mono' && r.polyId === undefined && pc(r.midi) === pc(n.midi) && Math.abs(r.t - n.t) < 0.09,
    );
    if (twin) {
      twin.polyId = n.id;
      twin.confirmed = true;
      twin.weight = weight;
      return;
    }
    // a string that is already ringing, re-detected: not a new note
    const ringing = [...this.sounding.values()].find((s) => s.midi === n.midi);
    if (ringing && n.onsetProb < 0.75) return;
    const prevStart = this.lastStart.get(n.midi);
    if (prevStart !== undefined && n.t - prevStart < 0.5 && n.onsetProb < 0.85) return;
    // overtone ghosts of a louder ringing string (12th, 17th, 19th...)
    const ghost = [...this.sounding.values()].some(
      (s) => (GHOSTS.includes(n.midi - s.midi) || n.midi - s.midi === 12) && n.prob < 0.55 && s.t <= n.t + 0.03,
    );
    if (ghost) return;
    const s = this.startNote(n.midi, n.t, 'poly', weight, n.prob >= POLY_TRUST);
    s.polyId = n.id;
    s.weight = weight;
  }

  // ------------------------------------------------------------- notes

  private startNote(midi: number, t: number, source: Source, velocity: number, trusted: boolean): Sounding {
    const s: Sounding = { id: this.nextId++, midi, t, source, weight: 1, confirmed: false };
    this.lastStart.set(midi, t);
    this.sounding.set(s.id, s);
    this.recent.push(s);
    this.recent = this.recent.filter((r) => t - r.t < 0.6);

    this.history.push({ midi, t });
    this.history = this.history.filter((h) => t - h.t < 3);
    this.mood.addNote(t);

    const key = this.lockedKey;
    const raw = key ? judgePc(pc(midi), key) : null;
    let verdict = trusted ? raw : null;
    // every out-of-key note is a suspect, trusted or not: the judge below
    // decides with the chord model's confirmation, not the first frames
    if (raw === 'wrong') {
      // not yet: most "wrong" notes on a real guitar are detector slips,
      // passing tones or chord tones of a borrowed chord
      this.suspects.push({ s, t });
      verdict = null;
    }
    this.emit({
      type: 'note',
      id: s.id,
      midi,
      t,
      source,
      velocity,
      verdict,
      degree: key ? degreeOf(midi, key) : null,
    });
    if (verdict) this.bumpStreak(verdict);
    return s;
  }

  private endNote(s: Sounding, t: number) {
    s.end = t;
    this.sounding.delete(s.id);
    this.emit({ type: 'noteoff', id: s.id, t });
  }

  private isBass(midi: number) {
    if (midi > 55) return false;
    for (const s of this.sounding.values()) if (s.midi < midi) return false;
    return true;
  }

  private bumpStreak(v: Verdict) {
    if (v === 'wrong') this.streak = 0;
    else this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.emit({ type: 'streak', value: this.streak, best: this.bestStreak });
  }

  // ------------------------------------------------------------- chords

  private addToStrum(midi: number, t: number, w: number) {
    // a strum is a run of attacks with small gaps, at most ~0.2 s long
    if (this.strum && (t - this.strum.last > STRUM_GAP || t - this.strum.t > 0.2)) this.closeStrum();
    if (!this.strum) this.strum = { t, last: t, notes: [] };
    this.strum.last = Math.max(this.strum.last, t);
    this.strum.notes.push({ midi, w });
  }

  private closeStrum() {
    const s = this.strum;
    this.strum = null;
    if (!s) return;
    // drop overtone ghosts: a weak note a 12th/17th/19th above another
    const notes = s.notes.filter(
      (n) => n.w >= 0.7 || !s.notes.some((m) => m !== n && GHOSTS.includes(n.midi - m.midi)),
    );
    const pcs = new Set(notes.map((n) => pc(n.midi)));
    if (pcs.size < 3) return;
    const energy = new Array(12).fill(0);
    for (const n of notes) energy[pc(n.midi)] += n.w;
    const bass = pc(Math.min(...notes.map((n) => n.midi)));
    const chord = nameChord(energy, bass);
    if (!chord) return;
    this.key.addChord(chord, 1, s.t);
    this.mood.addChord(chord, s.t);
    this.logChord(chord.pcs, s.t, true);
    const verdict = this.lockedKey ? judgeChord(chord, this.lockedKey) : null;
    this.emit({ type: 'chord', t: s.t, chord, verdict, strum: true });
    this.harmonyName = `${chord.root}:${chord.quality.id}`;
  }

  /** decaying pitch-class energy of recent notes → the harmony of an arpeggio */
  private addHarmony(midi: number, t: number, w: number) {
    const f = 0.5 ** ((t - this.harmonyT) / HARMONY_HALFLIFE);
    for (let i = 0; i < 12; i++) this.harmonyEnergy[i] *= f;
    this.harmonyT = t;
    this.harmonyEnergy[pc(midi)] += w;
    const e = Array.from(this.harmonyEnergy);
    let lowest = Infinity;
    for (const s of this.sounding.values()) if (s.t > t - 1.2) lowest = Math.min(lowest, s.midi);
    lowest = Math.min(lowest, midi);
    const chord = nameChord(e, pc(lowest));
    if (!chord || chord.score < 0.5) return;
    // identity ignores the bass so a walking arpeggio doesn't flicker names
    const k = `${chord.root}:${chord.quality.id}`;
    if (k === this.harmonyName) return;
    this.harmonyRun = k === this._pendingHarmony ? this.harmonyRun + 1 : 1;
    this._pendingHarmony = k;
    // needs two supporting notes before the name changes
    if (this.harmonyRun >= 2 && (!this.strum || this.strum.notes.length < 3)) {
      this.harmonyName = k;
      this.key.addChord(chord, 0.5, t);
      this.mood.addChord(chord, t);
      this.logChord(chord.pcs, t, false);
      const verdict = this.lockedKey ? judgeChord(chord, this.lockedKey) : null;
      this.emit({ type: 'chord', t, chord, verdict, strum: false });
    }
  }
  private _pendingHarmony = '';

  // ------------------------------------------------------------- wrong notes

  /** why suspicious notes were let off, for tuning (eval scripts print it) */
  readonly forgiven: Record<string, number> = {};

  /** optional debug hook: every suspicious note and why it was let off */
  trace: ((midi: number, t: number, why: string) => void) | null = null;

  private forgive(reason: string, s: Sounding) {
    this.forgiven[reason] = (this.forgiven[reason] ?? 0) + 1;
    this.trace?.(s.midi, s.t, reason);
  }

  private logChord(pcs: number[], t: number, strum: boolean) {
    this.chordLog.push({ pcs, t, strum });
    this.chordLog = this.chordLog.filter((c) => t - c.t < 5);
  }

  private judgeSuspects(now: number) {
    const key = this.lockedKey;
    const keep: Suspect[] = [];
    for (const x of this.suspects) {
      const { s } = x;
      const heard = (s.end ?? now) - s.t;
      if (!key) {
        this.forgive('no key', s);
        continue;
      }
      // a blip: the detector, or a finger brushing a string. (Longer notes
      // count even if the tracker ended them early: in strumming the next
      // stroke cuts every note's measured length short.)
      if (s.end !== undefined && heard < MIN_WRONG) {
        this.forgive('short', s);
        continue;
      }
      // with the chord model on, give it time to confirm the note
      const wait = this.poly ? WRONG_WAIT_POLY : WRONG_HOLD;
      if (now - s.t < wait) {
        keep.push(x);
        continue;
      }
      const why = this.whyNotWrong(s, key);
      if (why) {
        this.forgive(why, s);
        continue;
      }
      this.emit({ type: 'wrong', id: s.id, midi: s.midi, t: s.t });
      this.bumpStreak('wrong');
    }
    this.suspects = keep;
  }

  /** null when the note really is wrong, otherwise the reason it is fine */
  private whyNotWrong(s: Sounding, key: Key): string | null {
    const p = pc(s.midi);
    // with the chord model on, a mono-only note it never confirmed is a misread
    if (this.poly && s.polyId === undefined) return 'unconfirmed';
    if (this.poly && s.weight < WRONG_MIN_WEIGHT) return 'faint';
    // without it, the mono tracker's length is all we have
    if (!this.poly && (s.end ?? this.time) - s.t < WRONG_HOLD) return 'short';
    // still wrong in the key now? (the lock may have moved since)
    if (judgePc(p, key) !== 'wrong') return 'key moved';
    // fits the key the tracker is leaning towards (a modulation in progress)
    const best = this.key.state.best;
    if (best && judgePc(p, best) !== 'wrong') return 'other key';
    // an overtone of a lower string still ringing (A3's 5th harmonic is C♯6):
    // high or faint notes an octave, 12th, 17th... above a recent note
    const ringing = this.history.filter((h) => h.t < s.t - 0.01 && s.t - h.t < 2);
    if ((s.midi >= 76 || s.weight < 0.8) && ringing.some((h) => [12, 19, 24, 28, 31, 34].includes(s.midi - h.midi)))
      return 'overtone';
    // the key was only just found (or changed): it may still be the wrong one
    if (s.t - this.keySince < KEY_GRACE) return 'new key';
    // a tone of a chord played around it (secondary dominants, borrowed chords).
    // An arpeggio's harmony is named from its recent notes, so a wrong note
    // would name its own "chord": only harmony named before the note counts.
    // Likewise a note strummed along with a chord shapes its name: the chord
    // must also have been played apart from this note (strums repeat, slips don't).
    const around = (c: { t: number; strum: boolean }) =>
      c.strum ? c.t > s.t - 2 && c.t < s.t + 1.5 && Math.abs(c.t - s.t) > 0.12 : c.t > s.t - 1.5 && c.t < s.t - 0.03;
    if (this.chordLog.some((c) => around(c) && c.pcs.includes(p))) return 'chord tone';
    // chromatic passing tone: part of a stepwise run through it in one direction
    // (a slip one fret off and back is a real mistake, so neighbours still count)
    const before = this.history.filter((h) => h.t < s.t - 0.02 && s.t - h.t < 0.8).map((h) => h.midi - s.midi);
    const after = this.history.filter((h) => h.t > s.t + 0.02 && h.t - s.t < 0.8).map((h) => h.midi - s.midi);
    const up = before.some((d) => d === -1 || d === -2) && after.some((d) => d === 1 || d === 2);
    const down = before.some((d) => d === 1 || d === 2) && after.some((d) => d === -1 || d === -2);
    if (up || down) return 'passing';
    // leading tone: resolves up a semitone into the key (G♯→A in G major)
    if (after.some((d) => d === 1) && judgePc(p + 1, key) === 'key') return 'leading tone';
    // the 3rd or 7th of a dominant chord built on the bass being played (E7 in
    // G), but not on the tonic: C♯ over an A bass in A minor is the classic mistake
    const bass = this.history.filter((h) => h.midi < 55 && h.t <= s.t + 0.05 && s.t - h.t < 2);
    const low = bass.length ? Math.min(...bass.filter((h) => s.t - h.t < 1.2).map((h) => h.midi), Infinity) : null;
    if (low !== null && pc(low) !== key.tonic && judgePc(low, key) === 'key') {
      const iv = (p - pc(low) + 12) % 12;
      if (iv === 4 || iv === 10) return 'dominant';
    }
    return null;
  }

  // ------------------------------------------------------------- key

  private refreshKey(t: number) {
    const st = this.key.update(t);
    const prev = this.lockedKey;
    const changed = !!st.key && (!prev || prev.tonic !== st.key.tonic || prev.mode !== st.key.mode);
    if (changed) {
      // relative major/minor share every note: the streak survives that flip
      const relative =
        !!prev && prev.mode !== st.key!.mode && (prev.tonic - st.key!.tonic + 12) % 12 === (prev.mode === 'major' ? 3 : 9);
      if (!relative) this.streak = 0;
      this.lockedKey = st.key;
      this.keySince = t;
    }
    this.emit({ type: 'key', state: st, changed });
    const m = this.mood.update(t, st, this.level);
    if (m.changed) this.emit({ type: 'mood', mood: m.state.mood, scores: m.state.scores });
  }

  /** for debugging overlays: the model's current 88-key activations */
  static pitchRange() {
    return { lo: BP_MIDI0, hi: BP_MIDI0 + BP_PITCHES - 1 };
  }

  get lastFrameTime() {
    return this.lastFrameT;
  }
}
