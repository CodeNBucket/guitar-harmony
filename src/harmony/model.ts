import { BP_WINDOW, type PitchModel } from './poly';

/**
 * Loads TF.js + Basic Pitch lazily (a separate chunk plus 0.9 MB of weights),
 * so the page paints first and single-note detection works while it loads.
 * Returns null when WebGL isn't available: the CPU backend is too slow for
 * live use, and the mono path still works on its own.
 */
export async function loadBasicPitch(): Promise<PitchModel | null> {
  try {
    const tf = await import('@tensorflow/tfjs-core');
    await import('@tensorflow/tfjs-backend-webgl');
    const ok = await tf.setBackend('webgl');
    if (!ok) return null;
    await tf.ready();
    const { BasicPitchModel } = await import('./bpmodel');
    const model = await BasicPitchModel.load(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`);
    // the first run compiles the shaders; do it before the music starts
    await model.infer(new Float32Array(BP_WINDOW));
    return model;
  } catch (err) {
    console.warn('[harmony] chord model unavailable, single notes only', err);
    return null;
  }
}
