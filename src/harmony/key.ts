import { PROFILE, type Chord, type Key, type Mode, pc } from './theory';

/**
 * Finds the key of whatever is being played, from the notes and chords alone.
 *
 * Evidence (all decaying with a half-life so a new song can take over):
 *  - a duration-weighted pitch-class histogram, correlated against the 24
 *    rotated key profiles (the classic Krumhansl-Schmuckler idea);
 *  - which chords get played: the tonic triad with the right quality is the
 *    strongest hint separating A minor from C major (same notes!);
 *  - which notes sit in the bass.
 *
 * The best key "locks" once it has enough evidence and a clear margin over
 * every key with a different note set; switching a locked key needs a larger,
 * sustained margin so the scene doesn't flicker between worlds.
 */

export interface KeyCandidate extends Key {
  score: number;
}

export interface KeyState {
  /** locked key, null until confident */
  key: Key | null;
  /** current best guess (may differ from the locked key) */
  best: KeyCandidate | null;
  /** all 24 keys, best first (empty until there is evidence) */
  ranked: KeyCandidate[];
  /** 0..1, drives the scene fading in */
  confidence: number;
  /** how many seconds of notes the histogram holds (after decay) */
  evidence: number;
}

const MODES: Mode[] = ['major', 'minor'];

export interface KeyTrackerOptions {
  halfLife?: number; // seconds
  lockEvidence?: number;
  lockMargin?: number;
  lockHold?: number; // seconds the lock condition must hold
  switchMargin?: number;
  switchHold?: number;
}

export class KeyTracker {
  private hist = new Float64Array(12);
  private bass = new Float64Array(12);
  /** chord weight per root (0..11) × third (0 = major-ish, 1 = minor-ish) */
  private chords = new Float64Array(24);
  private lastT = 0;
  private locked: Key | null = null;
  private lockSince: number | null = null;
  private switchCand: Key | null = null;
  private switchSince: number | null = null;
  private opts: Required<KeyTrackerOptions>;
  state: KeyState = { key: null, best: null, ranked: [], confidence: 0, evidence: 0 };

  constructor(opts: KeyTrackerOptions = {}) {
    this.opts = {
      halfLife: 40,
      lockEvidence: 2.2,
      lockMargin: 0.05,
      lockHold: 0.8,
      switchMargin: 0.12,
      switchHold: 4,
      ...opts,
    };
  }

  reset() {
    this.hist.fill(0);
    this.bass.fill(0);
    this.chords.fill(0);
    this.locked = null;
    this.lockSince = null;
    this.switchCand = null;
    this.switchSince = null;
    this.state = { key: null, best: null, ranked: [], confidence: 0, evidence: 0 };
  }

  private decayTo(t: number) {
    const dt = t - this.lastT;
    if (dt <= 0) return;
    const f = 0.5 ** (dt / this.opts.halfLife);
    for (let i = 0; i < 12; i++) {
      this.hist[i] *= f;
      this.bass[i] *= f;
    }
    for (let i = 0; i < 24; i++) this.chords[i] *= f;
    this.lastT = t;
  }

  /** weight ≈ seconds the note sounded (capped), times loudness/confidence */
  addNote(midi: number, weight: number, t: number, isBass = false) {
    this.decayTo(t);
    const p = pc(midi);
    this.hist[p] += weight;
    if (isBass) this.bass[p] += weight;
  }

  addChord(chord: Chord, weight: number, t: number) {
    this.decayTo(t);
    const iv = chord.quality.intervals;
    const minorish = iv.includes(3) && !iv.includes(4);
    const majorish = iv.includes(4);
    if (minorish) this.chords[chord.root + 12] += weight;
    else if (majorish) this.chords[chord.root] += weight;
    else {
      // sus / power chords: evidence for both
      this.chords[chord.root] += weight * 0.5;
      this.chords[chord.root + 12] += weight * 0.5;
    }
    this.bass[chord.bass] += weight * 0.5;
  }

  private score(tonic: number, mode: Mode, chordTotal: number, bassTotal: number): number {
    const prof = PROFILE[mode];
    // Pearson correlation between the rotated profile and the histogram
    let mx = 0;
    let my = 0;
    for (let i = 0; i < 12; i++) {
      mx += prof[i];
      my += this.hist[(tonic + i) % 12];
    }
    mx /= 12;
    my /= 12;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < 12; i++) {
      const dx = prof[i] - mx;
      const dy = this.hist[(tonic + i) % 12] - my;
      sxy += dx * dy;
      sxx += dx * dx;
      syy += dy * dy;
    }
    const corr = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;

    // tonic chord and dominant chord support
    let chordBonus = 0;
    if (chordTotal > 0.5) {
      // a couple of chords shouldn't outvote the whole note histogram
      const norm = Math.max(chordTotal, 4);
      const tonicChord = this.chords[tonic + (mode === 'minor' ? 12 : 0)];
      const wrongQuality = this.chords[tonic + (mode === 'minor' ? 0 : 12)];
      const dominant = this.chords[(tonic + 7) % 12]; // V major in both modes
      chordBonus = (0.45 * tonicChord + 0.12 * dominant - 0.25 * wrongQuality) / norm;
    }
    const bassBonus = bassTotal > 0.3 ? (0.25 * this.bass[tonic]) / bassTotal : 0;
    return corr + chordBonus + bassBonus;
  }

  /** share of the decayed note histogram held by one pitch class, 0..1 */
  share(p: number): number {
    const total = this.hist.reduce((a, b) => a + b, 0);
    return total > 0 ? this.hist[((p % 12) + 12) % 12] / total : 0;
  }

  update(t: number): KeyState {
    this.decayTo(t);
    const evidence = this.hist.reduce((a, b) => a + b, 0);
    const chordTotal = this.chords.reduce((a, b) => a + b, 0);
    const bassTotal = this.bass.reduce((a, b) => a + b, 0);
    if (evidence < 0.2) {
      this.state = { key: this.locked, best: null, ranked: [], confidence: this.locked ? this.state.confidence : 0, evidence };
      return this.state;
    }

    const cands: KeyCandidate[] = [];
    for (const mode of MODES)
      for (let tonic = 0; tonic < 12; tonic++)
        cands.push({ tonic, mode, score: this.score(tonic, mode, chordTotal, bassTotal) });
    cands.sort((a, b) => b.score - a.score);
    const best = cands[0];
    // strongest rival with a different note set (relative major/minor share one)
    const relTonic = (k: Key) => (k.mode === 'major' ? (k.tonic + 9) % 12 : (k.tonic + 3) % 12);
    const rival = cands.find(
      (c) => !(c.tonic === best.tonic && c.mode === best.mode) && !(c.mode !== best.mode && c.tonic === relTonic(best)),
    )!;
    const margin = best.score - rival.score;

    const o = this.opts;
    if (!this.locked) {
      const ok = evidence >= o.lockEvidence && margin >= o.lockMargin && best.score > 0.45;
      if (ok) {
        if (this.lockSince === null) this.lockSince = t;
        if (t - this.lockSince >= o.lockHold) this.locked = { tonic: best.tonic, mode: best.mode };
      } else this.lockSince = null;
    } else {
      const cur = cands.find((c) => c.tonic === this.locked!.tonic && c.mode === this.locked!.mode)!;
      const isRelative = best.mode !== this.locked.mode && best.tonic === relTonic(this.locked);
      // relative major/minor share every note: only a clear shift of the
      // tonal centre (chords, bass) should flip it, so demand the full margin
      const need = isRelative ? o.switchMargin * 1.2 : o.switchMargin;
      if (best !== cur && best.score - cur.score >= need) {
        if (!this.switchCand || this.switchCand.tonic !== best.tonic || this.switchCand.mode !== best.mode) {
          this.switchCand = { tonic: best.tonic, mode: best.mode };
          this.switchSince = t;
        } else if (t - (this.switchSince ?? t) >= o.switchHold) {
          this.locked = this.switchCand;
          this.switchCand = null;
          this.switchSince = null;
        }
      } else {
        this.switchCand = null;
        this.switchSince = null;
      }
    }

    const confidence = Math.max(
      0,
      Math.min(1, (Math.min(1, evidence / (o.lockEvidence * 2)) * Math.min(1, margin / (o.lockMargin * 2.5))) ** 0.7),
    );
    this.state = {
      key: this.locked,
      best,
      ranked: cands,
      confidence: this.locked ? Math.max(confidence, 0.55) : Math.min(confidence, 0.5),
      evidence,
    };
    return this.state;
  }
}
