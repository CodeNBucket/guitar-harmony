/**
 * Audio in: microphone or a recording, delivered as 22.05 kHz mono chunks.
 *
 * The AudioContext runs at the device rate (asking for 22.05 kHz breaks mic
 * input in some browsers), two low-pass biquads stop aliasing, an
 * AudioWorklet copies raw blocks out and the main thread resamples.
 */

export const TARGET_SR = 22050;

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(512); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('harmony-tap', Tap);
`;

/** streaming linear resampler (input is already low-passed) */
class Resampler {
  private pos = 0; // fractional read position into the virtual stream
  private prev = 0;
  constructor(private ratio: number) {}
  process(x: Float32Array): Float32Array {
    const out: number[] = [];
    // positions are relative to x[0]; prev is sample index -1
    while (this.pos < x.length - 1) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const a = i < 0 ? this.prev : x[i];
      const b = x[i + 1];
      out.push(a + (b - a) * f);
      this.pos += this.ratio;
    }
    this.pos -= x.length;
    this.prev = x[x.length - 1];
    return Float32Array.from(out);
  }
}

export type InputKind = 'mic' | 'file';

export class AudioInput {
  readonly ctx: AudioContext;
  private tap: AudioWorkletNode | null = null;
  private chain: BiquadFilterNode[] = [];
  private source: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private resampler: Resampler;
  private ready: Promise<void>;
  kind: InputKind | null = null;
  /** fires when a file finishes playing */
  onEnded: (() => void) | null = null;

  constructor(private onSamples: (x: Float32Array) => void) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.resampler = new Resampler(this.ctx.sampleRate / TARGET_SR);
    this.ready = this.setup();
  }

  private async setup() {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.tap = new AudioWorkletNode(this.ctx, 'harmony-tap', { numberOfInputs: 1, numberOfOutputs: 0 });
    this.tap.port.onmessage = (e: MessageEvent<Float32Array>) => this.onSamples(this.resampler.process(e.data));
    const lp1 = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: 9500, Q: 0.54 });
    const lp2 = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: 9500, Q: 1.31 });
    lp1.connect(lp2).connect(this.tap);
    this.chain = [lp1, lp2];
  }

  async startMic() {
    await this.ready;
    this.stop();
    await this.ctx.resume();
    // guitar needs the raw signal: phone-call processing eats sustained notes
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const src = this.ctx.createMediaStreamSource(this.stream);
    src.connect(this.chain[0]);
    this.source = src;
    this.kind = 'mic';
  }

  async startBuffer(buf: AudioBuffer) {
    await this.ready;
    this.stop();
    await this.ctx.resume();
    const src = new AudioBufferSourceNode(this.ctx, { buffer: buf });
    src.connect(this.ctx.destination);
    src.connect(this.chain[0]);
    src.onended = () => {
      if (this.source === src) {
        this.source = null;
        this.kind = null;
        this.onEnded?.();
      }
    };
    src.start();
    this.source = src;
    this.kind = 'file';
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  stop() {
    if (this.source) {
      const s = this.source;
      this.source = null;
      if (s instanceof AudioBufferSourceNode) {
        s.onended = null;
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      s.disconnect();
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.kind = null;
  }

  close() {
    this.stop();
    // React dev mode and hot reloads can close twice
    if (this.ctx.state !== 'closed') void this.ctx.close().catch(() => {});
  }
}
