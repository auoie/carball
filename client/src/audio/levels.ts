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
