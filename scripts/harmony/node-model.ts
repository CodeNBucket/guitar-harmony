import fs from 'node:fs';
import path from 'node:path';
import * as tf from '@tensorflow/tfjs-core';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { BasicPitchModel } from '../../src/harmony/bpmodel';
import type { PitchModel } from '../../src/harmony/poly';

export async function loadNodeModel(): Promise<BasicPitchModel> {
  setWasmPaths(path.resolve('node_modules/@tensorflow/tfjs-backend-wasm/dist') + '/');
  await tf.setBackend(process.env.TF_BACKEND ?? 'wasm');
  const dir = path.resolve('public/models/basic-pitch');
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'));
  const weights = json.weightsManifest.flatMap((g: { weights: unknown[] }) => g.weights);
  const bins = json.weightsManifest.flatMap((g: { paths: string[] }) => g.paths).map((p: string) => fs.readFileSync(path.join(dir, p)));
  const data = Buffer.concat(bins);
  const handler = tf.io.fromMemory({
    modelTopology: json.modelTopology,
    weightSpecs: weights,
    weightData: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    format: json.format,
    generatedBy: json.generatedBy,
    convertedBy: json.convertedBy,
    signature: json.signature,
    userDefinedMetadata: json.userDefinedMetadata,
  });
  return BasicPitchModel.load(handler);
}

/**
 * Disk cache for model outputs, so re-running the judgment logic over the same
 * audio doesn't re-run the network. Keyed by a hash of the window's samples;
 * probabilities are stored as bytes.
 */
export function cached(model: PitchModel, dir = process.env.BP_CACHE ?? '/tmp/claude-0/bpcache'): PitchModel {
  fs.mkdirSync(dir, { recursive: true });
  return {
    async infer(w: Float32Array) {
      let h = 2166136261;
      for (let i = 0; i < w.length; i += 7) {
        h ^= Math.round(w[i] * 1e6);
        h = Math.imul(h, 16777619);
      }
      const file = path.join(dir, `${(h >>> 0).toString(16)}-${w.length}.bin`);
      if (fs.existsSync(file)) {
        const b = fs.readFileSync(file);
        const n = b.readUInt16LE(0);
        const size = n * 88;
        const frames = new Float32Array(size);
        const onsets = new Float32Array(size);
        for (let i = 0; i < size; i++) {
          frames[i] = b[2 + i] / 255;
          onsets[i] = b[2 + size + i] / 255;
        }
        return { frames, onsets, n };
      }
      const out = await model.infer(w);
      const size = out.n * 88;
      const b = Buffer.alloc(2 + 2 * size);
      b.writeUInt16LE(out.n, 0);
      for (let i = 0; i < size; i++) {
        b[2 + i] = Math.round(Math.min(1, Math.max(0, out.frames[i])) * 255);
        b[2 + size + i] = Math.round(Math.min(1, Math.max(0, out.onsets[i])) * 255);
      }
      fs.writeFileSync(file, b);
      return out;
    },
  };
}
