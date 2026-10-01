import type { Mood } from '../mood';
import type { Key, Verdict } from '../theory';
import { DAWN, type RGB, type World, hueFor, lerpWorld, noteColor, worldFor, worldForMood } from './palette';
import { FULLSCREEN_VS, PARTICLE_FS, PARTICLE_VS, POST_FS, RAYS_FS, WORLD_FS } from './shaders';

/**
 * The cinematic layer. Everything musical arrives through a few calls:
 * setKey, setMood, note, noteOff, chord, wrongNote, streak (plus level for
 * the input meter). Playing builds "flow" (brighter sun, more light and
 * life); a wrong note brings a short, mild storm (clouds, wind, rain, and
 * lightning only if the mistakes pile up).
 * New worlds only need a palette in palette.ts; new effects hook into the
 * same calls.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: RGB;
  alpha: number;
  /** 0 glow, 1 leaf/petal, 2 shard, 3 raindrop, 4 star, 5 halo ring */
  kind: 0 | 1 | 2 | 3 | 4 | 5;
  rot: number;
  vr: number;
  /** note orbs follow their note and fade after note-off */
  noteId?: number;
  released?: boolean;
  heldFor?: number;
  gravity: number;
  flicker: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  s: number;
  color: RGB;
}

const MAX_PARTICLES = 2400;
const FLOATS = 10; // x y size r g b a kind rot pad

export interface SceneOptions {
  /** render scale of the world pass, adapted at runtime */
  quality?: number;
  /** ambient only (the deck teaser): fewer particles, no input meter */
  teaser?: boolean;
  /** the world follows setMood; setKey only tints it (the live app) */
  moodDriven?: boolean;
}

export class HarmonyScene {
  private gl: WebGL2RenderingContext;
  private progWorld: WebGLProgram;
  private progRays: WebGLProgram;
  private progPost: WebGLProgram;
  private progPart: WebGLProgram;
  private quad: WebGLVertexArrayObject;
  private partVao: WebGLVertexArrayObject;
  private partBuf: WebGLBuffer;
  private partData = new Float32Array(MAX_PARTICLES * FLOATS);
  private fbWorld: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
  private fbMask: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
  private fbRays: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
  private uni = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private raf = 0;
  private last = 0;
  private t0 = performance.now();
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private quality: number;
  private frameTimes: number[] = [];

  // musical state (targets and smoothed values)
  private key: Key | null = null;
  private world: World = DAWN;
  private fromWorld: World = DAWN;
  private toWorld: World = DAWN;
  private worldT = 1;
  private hue = 0;
  private hueTarget = 0;
  private reveal = 0;
  private revealTarget = 0.15;
  private pulse = 0;
  private storm = 0;
  private flash = 0;
  private attackGlow = 0;
  private recentNotes: { midi: number; t: number }[] = [];
  private bolt = 0;
  private boltX = 0.5;
  private boltSeed = 0;
  private wind = 0.15;
  private gust = 0;
  private flow = 0;
  private lastNoteT = -99;
  private rainAcc = 0;
  private mood: Mood | null = null;
  private streakN = 0;
  private streakS = 0;
  private levelS = 0;
  private levelIn = 0;
  private scroll = 0;
  private fireflyTimer = 0;
  private leafTimer = 0;
  private shake: [number, number] = [0, 0];
  private running = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: SceneOptions = {},
  ) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this.quality = opts.quality ?? 0.75;
    this.progWorld = this.program(FULLSCREEN_VS, WORLD_FS);
    this.progRays = this.program(FULLSCREEN_VS, RAYS_FS);
    this.progPost = this.program(FULLSCREEN_VS, POST_FS);
    this.progPart = this.program(PARTICLE_VS, PARTICLE_FS);

    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const p of [this.progWorld, this.progRays, this.progPost]) {
      const loc = gl.getAttribLocation(p, 'aPos');
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
    }

    this.partVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.partVao);
    this.partBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.partData.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS * 4;
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(this.progPart, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
    };
    attr('aPos', 2, 0);
    attr('aSize', 1, 2);
    attr('aColor', 4, 3);
    attr('aKind', 1, 7);
    attr('aRot', 1, 8);
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------ public API

  setKey(key: Key | null, confidence: number) {
    const changed = (key?.tonic ?? -1) !== (this.key?.tonic ?? -1) || key?.mode !== this.key?.mode;
    this.revealTarget = key ? 1 : 0.12 + 0.45 * Math.min(1, confidence);
    if (!changed) return;
    this.key = key;
    this.hueTarget = hueFor(key);
    if (this.opts.moodDriven) {
      if (key) this.pulse = Math.max(this.pulse, 0.6);
      return;
    }
    this.goTo(worldFor(key));
    if (key) {
      // the moment the key is found: a big bloom
      this.pulse = 1.4;
      this.addRing(0.5, 0.3, [1, 0.9, 0.7], 1.2);
    }
  }

  /** the world for a mood: null goes back to the undecided foggy dawn */
  setMood(mood: Mood | null) {
    if (mood === this.mood) return;
    this.mood = mood;
    this.goTo(worldForMood(mood));
    if (mood) {
      this.pulse = 1.4;
      this.addRing(0.5, 0.3, [1, 0.9, 0.75], 1.1);
    }
  }

  /**
   * A pick attack, ~25 ms after it happens and before the pitch is known:
   * the whole world answers at once (a swell of light and a breath of wind),
   * so every stroke feels heard. No particles here: one note, one shape.
   */
  attack(strength: number) {
    const s = Math.max(0.25, Math.min(1, strength));
    this.pulse = Math.max(this.pulse, 0.45 + 0.55 * s);
    this.gust = Math.min(1, this.gust + 0.18 * s);
    this.attackGlow = Math.min(1.2, this.attackGlow + 0.6 * s);
  }

  /** a confirmed wrong note: a lightning strike and a short storm */
  wrongNote() {
    this.storm = Math.min(1, this.storm + 0.38);
    this.gust = Math.min(1, this.gust + 0.5);
    this.flow *= 0.8;
    this.flash = 1;
    this.bolt = 1;
    this.boltX = 0.15 + 0.7 * Math.random();
    this.boltSeed = Math.random() * 100;
  }

  private goTo(w: World) {
    this.fromWorld = this.world;
    this.toWorld = w;
    this.worldT = 0;
  }

  note(e: { id: number; midi: number; degree: number | null; verdict: Verdict | null; velocity: number }) {
    if (e.verdict === 'wrong') this.wrongNote();
    // one played note, one shape: the detectors sometimes also report its
    // octave or other overtones a moment later; those don't get their own
    const now = performance.now() / 1000;
    this.recentNotes = this.recentNotes.filter((r) => now - r.t < 0.3);
    const twin = this.recentNotes.some((r) => [0, 12, 19, 24, 28, 31].includes(Math.abs(e.midi - r.midi)));
    this.recentNotes.push({ midi: e.midi, t: now });
    if (twin && e.verdict !== 'wrong') {
      this.pulse = Math.max(this.pulse, 0.2);
      return;
    }
    // colour by the world, not by right/wrong: the scene only says "I hear you"
    const color: RGB =
      e.verdict === 'wrong' ? [0.55, 0.6, 0.7] : this.opts.moodDriven ? this.pitchColor(e.midi) : noteColor(e.degree, e.verdict);
    const x = 0.06 + 0.88 * Math.min(1, Math.max(0, (e.midi - 38) / 50));
    const y = 0.2 + 0.12 * Math.random();
    const v = 0.4 + 0.6 * Math.min(1, e.velocity);
    const wrong = e.verdict === 'wrong';
    const teaser = this.opts.teaser ? 0.6 : 1;
    this.lastNoteT = performance.now() / 1000;
    if (!wrong) this.flow = Math.min(1, this.flow + 0.045 * (1 - this.flow) + 0.01);
    this.gust = Math.min(1, this.gust + 0.12 * v);

    // the note's orb: stays while the note rings
    this.spawn({
      x,
      y: y + 0.05,
      vx: 0,
      vy: 0.035,
      life: 0,
      maxLife: 6,
      size: (70 + 70 * v) * (e.midi < 52 ? 1.35 : 1) * this.dpr,
      color,
      alpha: 0.9,
      // low strings: a big soft glow; middle: a halo; high: a spinning star
      kind: e.midi < 52 ? 0 : e.midi < 64 ? 5 : 4,
      rot: Math.random() * 6.28,
      vr: e.midi >= 64 ? (Math.random() < 0.5 ? -1.2 : 1.2) : 0,
      noteId: e.id,
      gravity: 0,
      flicker: 0,
    });
    // a wrong note speaks through the storm, not through its own colour
    if (wrong) return;
    // a ripple from the note: higher notes to the right
    this.addRing(x, y + 0.05, color, 0.45 + 0.4 * v);
    // sparks rising like embers / fireflies
    const n = Math.round((3 + 4 * v) * teaser);
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.3 + 0.4 * Math.random());
      const s = 0.02 + Math.random() * 0.06 * v;
      this.spawn({
        x: x + (Math.random() - 0.5) * 0.01,
        y: y + 0.05,
        vx: Math.cos(a) * s * 0.5,
        vy: Math.sin(a) * s,
        life: 0,
        maxLife: 1.2 + Math.random() * 1.2,
        size: (4 + Math.random() * 6) * this.dpr,
        color: mixRGB(color, [1, 1, 1], Math.random() * 0.25),
        alpha: 0.75,
        kind: 0,
        rot: 0,
        vr: 0,
        gravity: 0.02,
        flicker: Math.random() * 6,
      });
    }
    // a few leaves / petals carried off by the wind (not over open water)
    const leaves = Math.round((0.5 + 1.5 * v) * teaser * (1 - this.world.sea));
    for (let i = 0; i < leaves; i++) this.spawnLeaf(x, y + 0.06, color, 0.6);
    this.pulse = Math.max(this.pulse, 0.25 * v);
  }

  noteOff(id: number) {
    for (const p of this.particles) if (p.noteId === id) p.released = true;
  }

  chord(e: { verdict: Verdict | null; rootDegree: number | null; strum: boolean }) {
    const color = this.opts.moodDriven ? this.worldNoteColor(60) : noteColor(e.rootDegree, e.verdict);
    // chord names are too unreliable to punish; only wrong notes bring the storm
    if (e.verdict === 'wrong') return;
    if (!e.strum) {
      this.pulse = Math.max(this.pulse, 0.35);
      return;
    }
    this.pulse = Math.max(this.pulse, 1);
    this.addRing(0.5, 0.26, color, 1);
    // blossom: petals burst across the whole width
    const n = this.opts.teaser ? 18 : 40;
    const petals = Math.round(n * (1 - 0.7 * this.world.sea));
    for (let i = 0; i < petals; i++) this.spawnLeaf(Math.random(), 0.15 + Math.random() * 0.25, color, 1.2);
    this.gust = Math.min(1, this.gust + 0.3);
  }

  streak(n: number) {
    this.streakN = n;
  }

  level(v: number) {
    this.levelIn = v;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
  }

  // ------------------------------------------------------------ internals

  private get dpr() {
    return Math.min(2, window.devicePixelRatio || 1);
  }

  private spawn(p: Particle) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  /**
   * Every note name has its own colour, taken from the world's palette so it
   * always belongs there: moonlit blues and violets in the night forest,
   * golds and fresh greens in the sunny one, corals and lilacs at sea.
   */
  private pitchColor(midi: number): RGB {
    const pal = PALETTES[this.mood ?? 'none'];
    const f = ((((Math.round(midi) * 7) % 12) + 12) % 12) / 12; // circle of fifths: neighbours differ
    const pos = f * pal.length;
    const i = Math.floor(pos);
    return mixRGB(pal[i % pal.length], pal[(i + 1) % pal.length], pos - i);
  }

  /** note colours that belong to the current world, brighter up the neck */
  private worldNoteColor(midi: number): RGB {
    const w = this.world;
    const hi = Math.min(1, Math.max(0, (midi - 40) / 40));
    const base = mixRGB(w.glow, w.sun, 0.3 + 0.5 * hi);
    // moonlit forest: cool fireflies; day: warm gold; sea: rosy gold
    const tint: RGB = w.night > 0.5 && w.sea < 0.5 ? [0.7, 1, 0.8] : w.sea > 0.5 ? [1, 0.82, 0.7] : [1, 0.92, 0.6];
    return mixRGB(base, tint, 0.45);
  }

  private spawnLeaf(x: number, y: number, color: RGB, strength: number) {
    const meadow = this.world.meadow;
    // forest: pale green-gold leaves; meadow: blossom petals tinted by the note
    const base: RGB = mixRGB([0.75, 0.95, 0.55], [1, 0.8, 0.88], meadow);
    this.spawn({
      x,
      y,
      vx: 0.02 + Math.random() * 0.08 * strength,
      vy: 0.03 + Math.random() * 0.1 * strength,
      life: 0,
      maxLife: 3 + Math.random() * 3,
      size: (9 + Math.random() * 10) * this.dpr,
      color: mixRGB(base, color, 0.55),
      alpha: 0.55,
      kind: 1,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 3,
      gravity: -0.03,
      flicker: 0,
    });
  }

  private addRing(x: number, y: number, color: RGB, s: number) {
    this.rings.push({ x, y, r: 0.02, s, color });
    if (this.rings.length > 8) this.rings.shift();
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
    return p;
  }

  private u(p: WebGLProgram, name: string) {
    let m = this.uni.get(p);
    if (!m) this.uni.set(p, (m = new Map()));
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(p, name));
    return m.get(name)!;
  }

  private target(w: number, h: number, existing: typeof this.fbWorld) {
    const gl = this.gl;
    if (existing && existing.w === w && existing.h === h) return existing;
    if (existing) {
      gl.deleteFramebuffer(existing.fb);
      gl.deleteTexture(existing.tex);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h };
  }

  private resize() {
    const c = this.canvas;
    const w = Math.max(1, Math.round(c.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(c.clientHeight * this.dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const q = this.quality;
    this.fbWorld = this.target(Math.max(1, Math.round(w * q)), Math.max(1, Math.round(h * q)), this.fbWorld);
    this.fbMask = this.target(Math.max(1, Math.round(w / 6)), Math.max(1, Math.round(h / 6)), this.fbMask);
    this.fbRays = this.target(Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(h / 3)), this.fbRays);
  }

  private adaptQuality(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 40) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 1 / 45 && this.quality > 0.4) this.quality = Math.max(0.4, this.quality - 0.1);
    else if (avg < 1 / 58 && this.quality < 0.9) this.quality = Math.min(0.9, this.quality + 0.05);
  }

  private update(dt: number) {
    // world blend
    if (this.worldT < 1) {
      this.worldT = Math.min(1, this.worldT + dt / 2.8);
      const e = this.worldT * this.worldT * (3 - 2 * this.worldT);
      this.world = lerpWorld(this.fromWorld, this.toWorld, e);
    }
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    this.hue += (this.hueTarget - this.hue) * k(0.8);
    this.reveal += (this.revealTarget - this.reveal) * k(this.revealTarget > this.reveal ? 0.9 : 0.4);
    this.pulse *= Math.exp(-dt * 1.6);
    // the storm passes in a few seconds; lightning is a flicker
    this.storm *= Math.exp(-dt * 0.32);
    this.flash *= Math.exp(-dt * 5);
    this.attackGlow *= Math.exp(-dt * 6);
    this.bolt *= Math.exp(-dt * 2.8);
    if (this.storm > 0.6 && Math.random() < dt * 0.35) this.flash = 0.7 + 0.3 * Math.random();
    this.gust *= Math.exp(-dt * 0.9);
    this.wind += (Math.min(1, 0.12 + 0.15 * this.flow + 0.35 * this.gust + 0.8 * this.storm) - this.wind) * k(1.2);
    // flow fades slowly while playing pauses
    const idle = performance.now() / 1000 - this.lastNoteT;
    if (idle > 3) this.flow = Math.max(0, this.flow - dt * (idle > 10 ? 0.06 : 0.02));
    const glowTarget = this.opts.moodDriven ? this.flow : Math.min(1, this.streakN / 24);
    this.streakS += (glowTarget - this.streakS) * k(1.5);
    this.levelS += (this.levelIn - this.levelS) * k(10);
    this.scroll += dt * (0.012 + 0.05 * this.streakS + 0.04 * this.levelS);
    // lightning jolts the frame a little
    const jolt = this.flash * 0.006;
    this.shake = [(Math.random() - 0.5) * jolt, (Math.random() - 0.5) * jolt];

    // ambient fireflies (forest) / pollen (meadow), more with a streak
    this.fireflyTimer -= dt;
    const rate = (0.6 + 7 * this.streakS) * this.reveal * (this.opts.teaser ? 0.6 : 1) * (1 - 0.8 * this.storm);
    if (this.fireflyTimer <= 0 && rate > 0.05) {
      this.fireflyTimer = 1 / rate;
      const warm: RGB = mixRGB([0.75, 1, 0.55], [1, 0.92, 0.6], this.world.meadow);
      this.spawn({
        x: Math.random(),
        y: 0.05 + Math.random() * 0.4,
        vx: (Math.random() - 0.5) * 0.02,
        vy: (Math.random() - 0.3) * 0.02,
        life: 0,
        maxLife: 4 + Math.random() * 4,
        size: (5 + Math.random() * 8) * this.dpr,
        color: warm,
        alpha: 0.8,
        kind: 0,
        rot: 0,
        vr: 0,
        gravity: 0,
        flicker: 2 + Math.random() * 4,
      });
    }
    // drifting leaves in the forest even when quiet, more in the wind
    this.leafTimer -= dt;
    if (this.leafTimer <= 0 && this.reveal > 0.5 && this.world.sea < 0.5) {
      this.leafTimer = (1.2 + Math.random() * 2) / (1 + 3 * this.wind);
      this.spawnLeaf(-0.02, 0.5 + Math.random() * 0.4, [0.9, 0.8, 0.5], 0.5 + this.wind);
    }
    // rain while the storm lasts
    if (this.storm > 0.12) {
      this.rainAcc += dt * this.storm * 160 * (this.opts.teaser ? 0.4 : 1);
      while (this.rainAcc >= 1) {
        this.rainAcc--;
        const vx = -0.15 - 0.35 * this.wind;
        const vy = -1.3 - Math.random() * 0.4;
        this.spawn({
          x: Math.random() * 1.3 - 0.05,
          y: 1.02 + Math.random() * 0.1,
          vx,
          vy,
          life: 0,
          maxLife: 1.2,
          size: (22 + Math.random() * 14) * this.dpr,
          color: [0.75, 0.82, 0.95],
          alpha: 0.3 + 0.4 * this.storm,
          kind: 3,
          rot: Math.atan2(vx, -vy),
          vr: 0,
          gravity: 0,
          flicker: 0,
        });
      }
    } else this.rainAcc = 0;

    const t = (performance.now() - this.t0) / 1000;
    const alive: Particle[] = [];
    for (const p of this.particles) {
      if (p.noteId !== undefined && !p.released) {
        p.life = Math.min(p.life + dt, 0.5); // held orbs don't age
        p.y += p.vy * dt * 0.3;
        p.heldFor = (p.heldFor ?? 0) + dt;
        if (p.heldFor > 5) p.released = true; // missed note-off
      } else {
        p.life += dt;
      }
      if (p.life >= p.maxLife || (p.released && p.life > 1.2)) continue;
      if (p.kind === 3) {
        // rain falls straight through the wind field
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > -0.05) alive.push(p);
        continue;
      }
      // wind: a slow swirl field, pushed sideways by gusts and storms
      const wx = Math.sin(p.y * 7 + t * 0.6) * 0.03 + 0.015 + 0.12 * this.wind * this.wind;
      const wy = Math.cos(p.x * 6 + t * 0.5) * 0.02;
      p.vx += (wx - p.vx) * dt * 0.8;
      p.vy += (wy + p.gravity - p.vy * 0.2) * dt * (p.kind === 2 ? 3 : 0.8);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.released) p.alpha *= Math.exp(-dt * 3);
      alive.push(p);
    }
    this.particles = alive;

    for (const r of this.rings) {
      r.r += dt * (0.55 + r.r * 0.6);
      r.s *= Math.exp(-dt * 1.4);
    }
    this.rings = this.rings.filter((r) => r.s > 0.02 && r.r < 2);
  }

  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.adaptQuality(dt);
    this.update(dt);
    this.resize();
    const gl = this.gl;
    const w = this.world;
    const t = (now - this.t0) / 1000;
    const aspect = this.canvas.width / this.canvas.height;
    gl.bindVertexArray(this.quad);
    gl.disable(gl.BLEND);

    const setWorld = (p: WebGLProgram, maskOnly: number, fb: { w: number; h: number }) => {
      gl.useProgram(p);
      gl.uniform2f(this.u(p, 'uRes'), fb.w, fb.h);
      gl.uniform1f(this.u(p, 'uTime'), t);
      gl.uniform1f(this.u(p, 'uScroll'), this.scroll);
      gl.uniform3fv(this.u(p, 'uSkyTop'), w.skyTop);
      gl.uniform3fv(this.u(p, 'uSkyHor'), w.skyHorizon);
      gl.uniform3fv(this.u(p, 'uSun'), w.sun);
      gl.uniform3fv(this.u(p, 'uGlow'), w.glow);
      gl.uniform3fv(this.u(p, 'uFog'), w.fog);
      gl.uniform3fv(this.u(p, 'uFar'), w.far);
      gl.uniform3fv(this.u(p, 'uNear'), w.near);
      gl.uniform1f(this.u(p, 'uMeadow'), w.meadow);
      gl.uniform1f(this.u(p, 'uNight'), w.night);
      gl.uniform1f(this.u(p, 'uReveal'), this.reveal);
      gl.uniform1f(this.u(p, 'uPulse'), this.pulse);
      gl.uniform1f(this.u(p, 'uStreak'), this.streakS);
      gl.uniform1f(this.u(p, 'uLevel'), this.levelS);
      gl.uniform2f(this.u(p, 'uSunPos'), w.sunX, w.sunY);
      gl.uniform1f(this.u(p, 'uHue'), this.hue);
      gl.uniform1f(this.u(p, 'uMaskOnly'), maskOnly);
      gl.uniform1f(this.u(p, 'uSea'), w.sea);
      gl.uniform1f(this.u(p, 'uWind'), this.wind);
      gl.uniform1f(this.u(p, 'uStorm'), this.storm);
      gl.uniform1f(this.u(p, 'uFlash'), this.flash);
      gl.uniform1f(this.u(p, 'uBolt'), this.bolt);
      gl.uniform1f(this.u(p, 'uBoltX'), this.boltX);
      gl.uniform1f(this.u(p, 'uBoltSeed'), this.boltSeed);
    };

    // 1. world
    const fw = this.fbWorld!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fw.fb);
    gl.viewport(0, 0, fw.w, fw.h);
    setWorld(this.progWorld, 0, fw);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. silhouette mask + rays
    const fm = this.fbMask!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fm.fb);
    gl.viewport(0, 0, fm.w, fm.h);
    setWorld(this.progWorld, 1, fm);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const fr = this.fbRays!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fr.fb);
    gl.viewport(0, 0, fr.w, fr.h);
    gl.useProgram(this.progRays);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fm.tex);
    gl.uniform1i(this.u(this.progRays, 'uMask'), 0);
    gl.uniform2f(this.u(this.progRays, 'uSunPos'), w.sunX, w.sunY);
    gl.uniform1f(
      this.u(this.progRays, 'uStrength'),
      (0.22 + 0.4 * this.streakS + 0.5 * this.pulse) * (0.3 + 0.7 * this.reveal) * (1 - 0.5 * w.night) * (1 - 0.45 * (1 - w.night) * w.meadow) * (1 - 0.85 * this.storm),
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. particles, additive, into the world buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, fw.fb);
    gl.viewport(0, 0, fw.w, fw.h);
    const n = this.fillParticles(t);
    if (n > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.progPart);
      gl.uniform2f(this.u(this.progPart, 'uRes'), fw.w, fw.h);
      gl.uniform2f(this.u(this.progPart, 'uShake'), 0, 0);
      gl.bindVertexArray(this.partVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.partData, 0, n * FLOATS);
      gl.drawArrays(gl.POINTS, 0, n);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.quad);
    }

    // 4. post to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const pp = this.progPost;
    gl.useProgram(pp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fw.tex);
    gl.uniform1i(this.u(pp, 'uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fr.tex);
    gl.uniform1i(this.u(pp, 'uRays'), 1);
    gl.uniform2f(this.u(pp, 'uRes'), this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u(pp, 'uTime'), t);
    gl.uniform1f(this.u(pp, 'uWrong'), this.storm);
    gl.uniform1f(this.u(pp, 'uAttack'), this.attackGlow);
    gl.uniform2f(this.u(pp, 'uShake'), this.shake[0], this.shake[1]);
    gl.uniform1f(this.u(pp, 'uReveal'), this.reveal);
    gl.uniform3fv(this.u(pp, 'uRayCol'), mixRGB(w.glow, w.sun, 0.4));
    const rings = new Float32Array(36);
    const ringCols = new Float32Array(27);
    this.rings.forEach((r, i) => {
      rings.set([r.x, r.y, r.r, r.s], i * 4);
      ringCols.set(r.color, i * 3);
    });
    gl.uniform4fv(this.u(pp, 'uRings[0]'), rings);
    gl.uniform3fv(this.u(pp, 'uRingCol[0]'), ringCols);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    void aspect;
  }

  private fillParticles(t: number): number {
    const d = this.partData;
    let n = 0;
    const scale = this.quality; // particles are drawn into the scaled world buffer
    for (const p of this.particles) {
      if (n >= MAX_PARTICLES) break;
      const lifeT = p.life / p.maxLife;
      let a = p.alpha;
      if (p.noteId === undefined || p.released) a *= Math.min(1, p.life * 8) * (1 - lifeT) ** 1.4;
      else a *= Math.min(1, p.life * 8);
      if (p.flicker > 0) a *= 0.55 + 0.45 * Math.sin(t * p.flicker + p.x * 50);
      if (a <= 0.003) continue;
      const o = n * FLOATS;
      d[o] = p.x;
      d[o + 1] = p.y;
      d[o + 2] = p.size * scale * (p.noteId !== undefined ? 1 + 0.15 * Math.sin(t * 5 + p.x * 9) : 1);
      d[o + 3] = p.color[0];
      d[o + 4] = p.color[1];
      d[o + 5] = p.color[2];
      d[o + 6] = a;
      d[o + 7] = p.kind;
      d[o + 8] = p.rot;
      d[o + 9] = 0;
      n++;
    }
    return n;
  }
}

function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** four anchor colours per world; the 12 note names are spread between them */
const PALETTES: Record<Mood | 'none', RGB[]> = {
  // moonlit forest: moon silver, cyan, teal, violet
  sad: [
    [0.78, 0.86, 1.0],
    [0.45, 0.85, 1.0],
    [0.4, 1.0, 0.8],
    [0.68, 0.55, 1.0],
  ],
  // sunny forest: sun gold, warm orange, leaf green, sky blue
  happy: [
    [1.0, 0.72, 0.1],
    [1.0, 0.42, 0.08],
    [0.35, 0.85, 0.1],
    [0.15, 0.55, 1.0],
  ],
  // sea at sunset: coral, peach gold, rose, lilac
  romantic: [
    [1.0, 0.5, 0.45],
    [1.0, 0.78, 0.5],
    [1.0, 0.55, 0.75],
    [0.75, 0.6, 1.0],
  ],
  // before a world is chosen: soft dawn tones
  none: [
    [0.85, 0.88, 1.0],
    [0.7, 0.82, 0.95],
    [0.95, 0.85, 0.75],
    [0.8, 0.75, 0.95],
  ],
};
