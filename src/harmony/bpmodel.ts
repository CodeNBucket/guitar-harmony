import * as tf from '@tensorflow/tfjs-core';
import { loadGraphModel, type GraphModel } from '@tensorflow/tfjs-converter';
import type { io } from '@tensorflow/tfjs-core';
import { BP_WINDOW, type PitchModel } from './poly';

/**
 * Basic Pitch through TF.js. The caller registers a backend first
 * (webgl in the browser, wasm in the Node test scripts).
 */
export class BasicPitchModel implements PitchModel {
  private constructor(private model: GraphModel) {}

  static async load(source: string | io.IOHandler): Promise<BasicPitchModel> {
    return new BasicPitchModel(await loadGraphModel(source));
  }

  async infer(window: Float32Array) {
    if (window.length !== BP_WINDOW) throw new Error(`need ${BP_WINDOW} samples, got ${window.length}`);
    const input = tf.tensor3d(window, [1, BP_WINDOW, 1]);
    // output names from the converted model: Identity_1 = frames, Identity_2 = onsets
    const [fr, on] = this.model.execute(input, ['Identity_1', 'Identity_2']) as tf.Tensor[];
    const [frames, onsets] = (await Promise.all([fr.data(), on.data()])) as [Float32Array, Float32Array];
    const n = fr.shape[1] as number;
    tf.dispose([input, fr, on]);
    return { frames, onsets, n };
  }

  dispose() {
    this.model.dispose();
  }
}
