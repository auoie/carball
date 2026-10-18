// The map's soundscape, synthesized: beds (filtered noise that breathes: wind), drones (held tones), and events
// scattered in time and across the stereo field (none on Night). Quiet, under the game.
import type { ThemeName } from "../render/themes";
import type { Synth } from "./synth";

interface Bed {
  readonly filter: BiquadFilterType;
  readonly frequency: number;
  readonly q: number;
  readonly gain: number;
  /** A slow swell: how fast (Hz), how deep (0..1), on the volume or on the filter (as a fraction of its frequency) */
  readonly lfo?: { readonly rate: number; readonly depth: number; readonly on: "gain" | "frequency" };
}

interface Drone {
  readonly type: OscillatorType;
  readonly frequencies: readonly number[];
  readonly gain: number;
  readonly lowpass: number;
}

interface Scattered {
  /** Seconds between one and the next, at random in this range */
  readonly every: readonly [number, number];
  readonly play: (synth: Synth, out: AudioNode, when: number) => void;
}

interface Recipe {
  readonly beds: readonly Bed[];
  readonly drones: readonly Drone[];
  readonly events: readonly Scattered[];
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

// --- the recipes ---

const NIGHT: Recipe = {
  beds: [{ filter: "lowpass", frequency: 350, q: 0.5, gain: 0.06, lfo: { rate: 0.05, depth: 0.5, on: "gain" } }],
  drones: [{ type: "sine", frequencies: [55, 82.5], gain: 0.012, lowpass: 400 }],
  events: [],
};

const RECIPES: Readonly<Record<ThemeName, Recipe>> = {
  night: NIGHT,
};

/** A theme's soundscape, playing into `out`; `tick` it every frame to scatter its events. */
export class Ambience {
  readonly #recipe: Recipe;
  readonly #next: number[];
  readonly #sources: AudioScheduledSourceNode[] = [];
  /** Its beds' and drones' pitch (a replay's Slomo state: RA1 §4), not their swells' */
  readonly #pitch: AudioParam[] = [];

  constructor(
    readonly synth: Synth,
    readonly out: AudioNode,
    theme: ThemeName,
  ) {
    this.#recipe = RECIPES[theme];
    const now = synth.ctx.currentTime;
    for (const bed of this.#recipe.beds) {
      const g = synth.gain(bed.gain, out);
      const f = synth.filter(bed.filter, bed.frequency, bed.q, g);
      const noise = synth.noise(f, now);
      this.#sources.push(noise);
      this.#pitch.push(noise.detune, f.detune);
      if (bed.lfo) {
        const depth = synth.gain(bed.lfo.depth * (bed.lfo.on === "gain" ? bed.gain : bed.frequency));
        depth.connect(bed.lfo.on === "gain" ? g.gain : f.frequency);
        this.#sources.push(synth.tone("sine", bed.lfo.rate, depth, now, 1e6));
      }
    }
    for (const drone of this.#recipe.drones) {
      const g = synth.gain(drone.gain, synth.filter("lowpass", drone.lowpass, 0.7, out));
      for (const f of drone.frequencies) {
        const tone = synth.tone(drone.type, f, g, now, 1e6);
        this.#sources.push(tone);
        this.#pitch.push(tone.detune);
      }
    }
    this.#next = this.#recipe.events.map((e) => now + rand(e.every[0], e.every[1]));
  }

  tick(): void {
    const now = this.synth.ctx.currentTime;
    this.#recipe.events.forEach((event, i) => {
      const due = this.#next[i] ?? Infinity;
      if (now < due) return;
      // (a long stall, say a hidden tab, skips what was missed rather than playing it all at once)
      if (now - due < 1) event.play(this.synth, this.out, now + 0.05);
      this.#next[i] = now + rand(event.every[0], event.every[1]);
    });
  }

  /** Its pitch, cents (a replay's state) */
  detune(cents: number): void {
    const now = this.synth.ctx.currentTime;
    for (const p of this.#pitch) p.setTargetAtTime(cents, now, 0.05);
  }

  dispose(): void {
    for (const s of this.#sources) s.stop();
  }
}
