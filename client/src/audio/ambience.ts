// Each theme's soundscape, synthesized: beds (filtered noise that breathes: wind, rain, rustling leaves, a crowd),
// drones (held tones), and events scattered in time and across the stereo field (birdsong, owls, a distant bell,
// flying traffic, a music box). Quiet, under the game.
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
const pick = <T>(list: readonly T[]): T => {
  const item = list[Math.floor(Math.random() * list.length)];
  if (item === undefined) throw new Error("empty list");
  return item;
};

// --- event sounds ---

/** A note with a bell-like decay (a fundamental and two quieter overtones). */
function bell(synth: Synth, out: AudioNode, when: number, frequency: number, peak: number, decay: number, partials = [1, 2, 3.01]): void {
  partials.forEach((ratio, i) => {
    const g = synth.gain(0, out);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak / (1 + i * 1.6), when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay / (1 + i * 0.5));
    synth.tone("sine", frequency * ratio, g, when, decay + 0.1);
  });
}

/** A short pitched blip: a tone gliding from one pitch to another under a quick envelope. */
function blip(synth: Synth, out: AudioNode, when: number, type: OscillatorType, from: number, to: number, peak: number, decay: number): void {
  const g = synth.gain(0, out);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  const o = synth.tone(type, from, g, when, decay + 0.05);
  o.frequency.exponentialRampToValueAtTime(to, when + decay * 0.8);
}

/** Puts an event somewhere left or right. */
function placed(synth: Synth, out: AudioNode): AudioNode {
  const pan = new StereoPannerNode(synth.ctx, { pan: rand(-0.9, 0.9) });
  pan.connect(out);
  return pan;
}

const birdChirps = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const base = rand(2400, 4200);
  const count = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    const up = Math.random() < 0.6;
    blip(synth, at, when + i * rand(0.08, 0.14), "sine", base * (up ? 0.8 : 1.2), base * (up ? 1.25 : 0.75), 0.04, 0.08);
  }
};

const birdTrill = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const base = rand(3000, 4500);
  for (let i = 0; i < 12; i++) blip(synth, at, when + i * 0.045, "sine", base, base * 1.12, 0.025, 0.04);
};

const woodpecker = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const g = synth.gain(0.12, at);
  const knock = synth.filter("bandpass", 1700, 5, g);
  for (let i = 0; i < 10; i++) {
    const hit = synth.gain(0, knock);
    const t = when + i * 0.06;
    hit.gain.setValueAtTime(0.0001, t);
    hit.gain.linearRampToValueAtTime(1, t + 0.002);
    hit.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    synth.noise(hit, t, 0.04);
  }
};

const flyby = (synth: Synth, out: AudioNode, when: number): void => {
  const pan = new StereoPannerNode(synth.ctx, { pan: -1 });
  pan.connect(out);
  const direction = Math.random() < 0.5 ? 1 : -1;
  pan.pan.setValueAtTime(-direction, when);
  pan.pan.linearRampToValueAtTime(direction, when + 2.4);
  const g = synth.gain(0, pan);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.1, when + 1.2);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 2.4);
  const f = synth.filter("bandpass", 400, 1.2, g);
  f.frequency.setValueAtTime(400, when);
  f.frequency.exponentialRampToValueAtTime(1500, when + 1.2); // (the pitch rises then falls as it passes)
  f.frequency.exponentialRampToValueAtTime(320, when + 2.4);
  synth.noise(f, when, 2.5);
};

const siren = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const g = synth.gain(0, synth.filter("lowpass", 1400, 0.7, at));
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.02, when + 1.5);
  g.gain.linearRampToValueAtTime(0.0001, when + 6);
  const wail = synth.gain(150);
  synth.tone("sine", 0.45, wail, when, 6.1);
  const o = synth.tone("sine", 800, g, when, 6.1);
  wail.connect(o.frequency);
};

const squelch = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const g = synth.gain(0, at);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.11, when + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.45);
  const f = synth.filter("bandpass", 250, 9, g);
  f.frequency.setValueAtTime(250, when);
  f.frequency.exponentialRampToValueAtTime(900, when + 0.15);
  f.frequency.exponentialRampToValueAtTime(280, when + 0.45);
  synth.noise(f, when, 0.5);
};

const groan = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const g = synth.gain(0, synth.filter("lowpass", 280, 4, at));
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.06, when + 1);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 3);
  const o = synth.tone("sawtooth", 74, g, when, 3.1);
  o.frequency.exponentialRampToValueAtTime(50, when + 3);
};

/** A few music-box notes from a pentatonic scale. */
const musicBox = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];
  let step = Math.floor(Math.random() * 4);
  const count = 4 + Math.floor(Math.random() * 4);
  for (let i = 0, t = when; i < count; i++, t += pick([0.2, 0.2, 0.4])) {
    step = Math.min(scale.length - 1, Math.max(0, step + pick([-2, -1, 1, 1, 2])));
    bell(synth, at, t, scale[step] ?? 523.25, 0.045, 1.4);
  }
};

const sparkle = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  [2093, 2637, 3136, 3951, 4186].forEach((f, i) => { bell(synth, at, when + i * 0.045, f, 0.02, 0.4, [1]); });
};

/** A short, bouncy tune on a soft square wave: a bar of quavers in a major key. */
const plucky = (synth: Synth, out: AudioNode, when: number): void => {
  const at = synth.filter("lowpass", 2000, 0.7, out);
  const scale = [392, 440, 493.88, 523.25, 587.33, 659.25, 783.99];
  let step = 3;
  for (let i = 0; i < 8; i++) {
    step = Math.min(scale.length - 1, Math.max(0, step + pick([-2, -1, 1, 2, 0])));
    blip(synth, at, when + i * 0.15, "square", scale[step] ?? 523.25, scale[step] ?? 523.25, 0.045, 0.14);
  }
};

const crickets = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  for (let c = 0; c < 3; c++) {
    const t = when + c * 0.32;
    const g = synth.gain(0, at);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.012, t + 0.01);
    g.gain.setValueAtTime(0.012, t + 0.18);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.22);
    const chirp = synth.gain(0, g);
    const rate = synth.gain(1);
    synth.tone("square", 30, rate, t, 0.25);
    rate.connect(chirp.gain);
    synth.tone("sine", 4400, chirp, t, 0.25);
  }
};

/** An owl: a low "hoo", then "hoo-hoo". */
const owl = (synth: Synth, out: AudioNode, when: number): void => {
  const at = synth.filter("lowpass", 900, 0.7, placed(synth, out));
  for (const [start, length] of [[0, 0.45], [0.75, 0.22], [1.05, 0.4]] as const) {
    const t = when + start;
    const g = synth.gain(0, at);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    const o = synth.tone("sine", 375, g, t, length + 0.05);
    o.frequency.exponentialRampToValueAtTime(330, t + length);
  }
};

/** A distant bell tolling: inharmonic partials with a long decay. */
const toll = (synth: Synth, out: AudioNode, when: number): void => {
  const at = synth.filter("lowpass", 2500, 0.7, out);
  bell(synth, at, when, 196, 0.06, 5, [1, 2, 2.4, 3, 4.2]);
};

// --- the recipes ---

const breeze: Bed = { filter: "lowpass", frequency: 500, q: 0.5, gain: 0.05, lfo: { rate: 0.07, depth: 0.6, on: "gain" } };

const RECIPES: Readonly<Record<ThemeName, Recipe>> = {
  night: {
    beds: [{ filter: "lowpass", frequency: 350, q: 0.5, gain: 0.06, lfo: { rate: 0.05, depth: 0.5, on: "gain" } }],
    drones: [{ type: "sine", frequencies: [55, 82.5], gain: 0.012, lowpass: 400 }],
    events: [],
  },
  meadow: {
    beds: [
      breeze,
      // A crowd murmuring in the stands
      { filter: "bandpass", frequency: 550, q: 0.8, gain: 0.07, lfo: { rate: 0.25, depth: 0.3, on: "gain" } },
    ],
    drones: [],
    events: [{ every: [1.5, 5], play: birdChirps }],
  },
  forest: {
    beds: [
      breeze,
      // Leaves rustling
      { filter: "highpass", frequency: 2600, q: 0.5, gain: 0.025, lfo: { rate: 0.15, depth: 0.8, on: "gain" } },
    ],
    drones: [],
    events: [
      { every: [0.8, 3], play: birdChirps },
      { every: [4, 10], play: birdTrill },
      { every: [15, 30], play: woodpecker },
    ],
  },
  city: {
    beds: [
      { filter: "highpass", frequency: 1800, q: 0.5, gain: 0.035 }, // rain
      { filter: "lowpass", frequency: 120, q: 0.7, gain: 0.07, lfo: { rate: 0.03, depth: 0.3, on: "gain" } }, // the city's hum
    ],
    drones: [{ type: "sawtooth", frequencies: [55, 82.4], gain: 0.012, lowpass: 380 }],
    events: [
      { every: [4, 10], play: flyby },
      { every: [20, 45], play: siren },
    ],
  },
  infested: {
    beds: [{ filter: "bandpass", frequency: 300, q: 2, gain: 0.05, lfo: { rate: 0.06, depth: 0.5, on: "frequency" } }],
    drones: [{ type: "sine", frequencies: [41, 43.5], gain: 0.02, lowpass: 200 }],
    events: [
      { every: [3, 8], play: squelch },
      { every: [10, 22], play: groan },
    ],
  },
  kawaii: {
    beds: [{ ...breeze, gain: 0.03 }],
    drones: [],
    events: [
      { every: [3, 6], play: musicBox },
      { every: [6, 12], play: sparkle },
    ],
  },
  platformer: {
    beds: [{ ...breeze, gain: 0.05 }],
    drones: [],
    events: [
      { every: [7, 14], play: plucky },
      { every: [3, 8], play: birdChirps },
    ],
  },
  haunted: {
    beds: [
      // Wind howling, its pitch wandering
      { filter: "bandpass", frequency: 480, q: 6, gain: 0.16, lfo: { rate: 0.08, depth: 0.45, on: "frequency" } },
      { filter: "lowpass", frequency: 250, q: 0.5, gain: 0.06 },
    ],
    drones: [],
    events: [
      { every: [0.6, 1.8], play: crickets },
      { every: [10, 22], play: owl },
      { every: [25, 50], play: toll },
    ],
  },
};

/** A theme's soundscape, playing into `out`; `tick` it every frame to scatter its events. */
export class Ambience {
  readonly #recipe: Recipe;
  readonly #next: number[];
  readonly #sources: AudioScheduledSourceNode[] = [];

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
      this.#sources.push(synth.noise(f, now));
      if (bed.lfo) {
        const depth = synth.gain(bed.lfo.depth * (bed.lfo.on === "gain" ? bed.gain : bed.frequency));
        depth.connect(bed.lfo.on === "gain" ? g.gain : f.frequency);
        this.#sources.push(synth.tone("sine", bed.lfo.rate, depth, now, 1e6));
      }
    }
    for (const drone of this.#recipe.drones) {
      const g = synth.gain(drone.gain, synth.filter("lowpass", drone.lowpass, 0.7, out));
      for (const f of drone.frequencies) this.#sources.push(synth.tone(drone.type, f, g, now, 1e6));
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

  dispose(): void {
    for (const s of this.#sources) s.stop();
  }
}
