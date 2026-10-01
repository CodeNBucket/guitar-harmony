import type { KeyState } from './key';
import type { Chord } from './theory';

/**
 * Guesses the mood of what is being played, to pick the world:
 *  - sad: minor, unhurried;
 *  - happy: busy or loud playing, especially in major;
 *  - romantic: slow and ringing, major or colourful chords (maj7, add9...).
 *
 * Features over the last ~10 s: attack rate (a strum counts once), major vs
 * minor from the key tracker, input level, and how often the harmony has
 * "colour" tones. Nothing is decided in the first few seconds, and a decided
 * mood only changes after the new one has clearly led for a while.
 */

export type Mood = 'sad' | 'happy' | 'romantic';
export const MOODS: Mood[] = ['sad', 'happy', 'romantic'];

const WINDOW = 10;
const COLOUR = new Set(['maj7', 'm7', '7', 'add9', 'madd9', '6', 'm6', 'sus2']);

export interface MoodState {
  mood: Mood | null;
  scores: Record<Mood, number>;
}

export class MoodTracker {
  private attacks: number[] = [];
  private chords: { t: number; colour: boolean }[] = [];
  private firstT: number | null = null;
  private notes = 0;
  private level = 0;
  private current: Mood | null = null;
  private cand: Mood | null = null;
  private candSince = 0;
  state: MoodState = { mood: null, scores: { sad: 0, happy: 0, romantic: 0 } };

  addNote(t: number) {
    if (this.firstT === null) this.firstT = t;
    this.notes++;
    const last = this.attacks[this.attacks.length - 1];
    if (last === undefined || t - last > 0.07) this.attacks.push(t);
  }

  addChord(c: Chord, t: number) {
    this.chords.push({ t, colour: COLOUR.has(c.quality.id) });
  }

  update(t: number, key: KeyState, level: number): { state: MoodState; changed: boolean } {
    this.attacks = this.attacks.filter((a) => t - a < WINDOW);
    this.chords = this.chords.filter((c) => t - c.t < WINDOW);
    this.level += (level - this.level) * 0.05;
    const played = this.firstT === null ? 0 : t - this.firstT;

    const span = Math.max(3, Math.min(WINDOW, played));
    const rate = this.attacks.length / span; // attacks per second
    const k = key.key ?? key.best;
    const minor = k ? (k.mode === 'minor' ? 1 : 0) : 0.5;
    const colour = this.chords.length ? this.chords.filter((c) => c.colour).length / this.chords.length : 0;
    // input level depends on the mic and distance, so it only nudges
    const energy = Math.min(1, Math.max(0, (rate - 2) / 3)) * 0.85 + Math.min(1, this.level) * 0.15;

    const scores: Record<Mood, number> = {
      sad: minor * 0.9 + (1 - energy) * 0.6,
      happy: (1 - minor) * 0.7 + energy * 1.0 + minor * energy * 0.3,
      romantic: (1 - minor) * 0.5 + minor * 0.15 + (1 - energy) * 0.45 + colour * 0.5,
    };
    const ranked = [...MOODS].sort((a, b) => scores[b] - scores[a]);
    const lead = ranked[0];
    const margin = scores[lead] - scores[ranked[1]];

    const prev = this.current;
    const ready = played >= 4 && this.notes >= 8 && this.attacks.length >= 4;
    if (ready && lead !== this.current) {
      const need = this.current ? 0.15 : 0.06;
      const hold = this.current ? 8 : 1.5;
      if (margin >= need) {
        if (this.cand !== lead) {
          this.cand = lead;
          this.candSince = t;
        } else if (t - this.candSince >= hold) {
          this.current = lead;
          this.cand = null;
        }
      } else this.cand = null;
    } else if (lead === this.current) this.cand = null;

    this.state = { mood: this.current, scores };
    return { state: this.state, changed: prev !== this.current };
  }
}
