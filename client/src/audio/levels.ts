// How loud a theme's ambience is, for the browser tests: renders some of it offline (with Math.random seeded, so the
// same events play every time) and reports its peak, and its loudness in half-second windows: the median, and the
// loudest. A sound that sticks out far above the rest (an event built too loud) shows as loudest >> median.
import type { ThemeName } from "../render/themes";
import { seededRandom } from "../render/themes/random";
import { Ambience } from "./ambience";
import { Synth } from "./synth";

export interface AmbienceLevels {
  readonly peak: number;
  readonly median: number;
  readonly loudest: number;
}

const RATE = 22050;

export async function ambienceLevels(theme: ThemeName, seconds: number, seed = 1): Promise<AmbienceLevels> {
  const ctx = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  const random = Math.random;
  Math.random = seededRandom(seed);
  try {
    const ambience = new Ambience(new Synth(ctx), ctx.destination, theme);
    // Ticked every tenth of a second, as the game does each frame
    for (let t = 0.1; t < seconds; t += 0.1) {
      ctx
        .suspend(t)
        .then(() => {
          ambience.tick();
          return ctx.resume();
        })
        .catch(() => undefined);
    }
    const data = (await ctx.startRendering()).getChannelData(0);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    const window = RATE / 2;
    const levels: number[] = [];
    for (let i = 0; i + window <= data.length; i += window) {
      let energy = 0;
      for (let k = i; k < i + window; k++) energy += (data[k] ?? 0) ** 2;
      levels.push(Math.sqrt(energy / window));
    }
    levels.sort((a, b) => a - b);
    return { peak, median: levels[Math.floor(levels.length / 2)] ?? 0, loudest: levels[levels.length - 1] ?? 0 };
  } finally {
    Math.random = random;
  }
}

/** The one-shots whose tone the browser tests measure: the replay's swoops (air alone: RA1 §6's places, the user's
 *  "ploop" report of 2026-10-18), and a ball hit for contrast (a thump with a pitched body) */
export type MeasuredSound = "swoopOut" | "sloMoStart" | "sloMoEnd" | "ballHit";

/** How tonal a one-shot is: rendered offline (Math.random seeded), the strongest ridge in its spectrum (40-2000 Hz,
 *  10.8 Hz bins, frames 11.6 ms apart): a bin's power over the median of the bins round it, held three frames running
 *  within ±2 bins (a tone or a pitch glide keeps its peak from frame to frame; noise's peaks don't), in dB, the sound's
 *  loud frames only. A tone stands 20 dB and more above its neighbours; noise, even band-passed, under 10 */
export async function soundTonality(sound: MeasuredSound, seed = 1): Promise<number> {
  const seconds = 1;
  const ctx = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  const random = Math.random;
  Math.random = seededRandom(seed);
  let data: Float32Array;
  try {
    const synth = new Synth(ctx);
    if (sound === "ballHit") synth.ballHit(ctx.destination, 0.01, 0.8);
    else synth[sound](ctx.destination, 0.01);
    data = (await ctx.startRendering()).getChannelData(0);
  } finally {
    Math.random = random;
  }
  const N = 2048;
  const HOP = 256;
  const lo = Math.floor((40 * N) / RATE);
  const hi = Math.ceil((2000 * N) / RATE);
  const cos = Float64Array.from({ length: N }, (_, n) => Math.cos((2 * Math.PI * n) / N));
  const sin = Float64Array.from({ length: N }, (_, n) => Math.sin((2 * Math.PI * n) / N));
  const window = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * (cos[i] ?? 0));
  const frames: { readonly ratio: Float64Array; readonly energy: number }[] = [];
  const power = new Float64Array(hi + 1);
  for (let start = 0; start + N <= data.length; start += HOP) {
    let energy = 0;
    for (let k = lo; k <= hi; k++) {
      let re = 0;
      let im = 0;
      for (let n = 0; n < N; n++) {
        const v = (data[start + n] ?? 0) * (window[n] ?? 0);
        const at = (k * n) % N;
        re += v * (cos[at] ?? 0);
        im -= v * (sin[at] ?? 0);
      }
      power[k] = re * re + im * im;
      energy += power[k] ?? 0;
    }
    // (each bin over the median of its neighbours within 16 bins, its own peak's ±3 left out)
    const ratio = new Float64Array(hi + 1);
    for (let k = lo; k <= hi; k++) {
      const around: number[] = [];
      for (let j = Math.max(lo, k - 16); j <= Math.min(hi, k + 16); j++) if (Math.abs(j - k) > 3) around.push(power[j] ?? 0);
      around.sort((x, y) => x - y);
      const median = around[Math.floor(around.length / 2)] ?? 0;
      ratio[k] = median > 0 ? (power[k] ?? 0) / median : 0;
    }
    frames.push({ ratio, energy });
  }
  const loudest = Math.max(...frames.map((f) => f.energy));
  const near = (f: Float64Array, k: number): number => Math.max(f[k - 2] ?? 0, f[k - 1] ?? 0, f[k] ?? 0, f[k + 1] ?? 0, f[k + 2] ?? 0);
  let worst = 1;
  for (let i = 1; i + 1 < frames.length; i++) {
    const [before, mid, after] = [frames[i - 1], frames[i], frames[i + 1]];
    if (!before || !mid || !after || mid.energy < loudest * 0.05) continue; // (the sound's body, not its tail)
    for (let k = lo; k <= hi; k++) worst = Math.max(worst, Math.min(near(before.ratio, k), mid.ratio[k] ?? 0, near(after.ratio, k)));
  }
  return 10 * Math.log10(worst);
}
