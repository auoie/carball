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

/** A ghostly voice: a wordless "oooo" sliding up and down, wavering, through a vowel-like filter. */
const ghostVoice = (synth: Synth, out: AudioNode, when: number): void => {
  const at = synth.filter("bandpass", 650, 3, placed(synth, out));
  const g = synth.gain(0, at);
  const length = rand(2.2, 3.4);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.09, when + length * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, when + length);
  const base = rand(240, 330);
  const vibrato = synth.gain(9);
  synth.tone("sine", 5, vibrato, when, length + 0.1);
  for (const [type, ratio] of [["triangle", 1], ["sine", 2.01]] as const) {
    const o = synth.tone(type, base * ratio, g, when, length + 0.1);
    o.frequency.setValueAtTime(base * ratio, when);
    o.frequency.linearRampToValueAtTime(base * ratio * 1.35, when + length * 0.45);
    o.frequency.linearRampToValueAtTime(base * ratio * 0.85, when + length);
    vibrato.connect(o.frequency);
  }
};

/** Wind chimes from the shrine: a few notes of a minor pentatonic, ringing. */
const windChimes = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const scale = [880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];
  for (let i = 0, t = when; i < 3 + Math.floor(Math.random() * 3); i++, t += rand(0.12, 0.4)) {
    bell(synth, at, t, pick(scale), 0.025, 2.2, [1, 2.76, 5.4]);
  }
};

/** A gong, far off: a low bell with a long decay. */
const gong = (synth: Synth, out: AudioNode, when: number): void => {
  bell(synth, synth.filter("lowpass", 1200, 0.7, out), when, 98, 0.07, 7, [1, 1.48, 2.1, 2.9, 3.7]);
};

/** A crow's caw: a rasping burst, twice. */
const crow = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  for (const start of [0, 0.42]) {
    const t = when + start;
    const g = synth.gain(0, synth.filter("bandpass", 1300, 2.5, at));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    // The rasp: the tone pulsed 38 times a second (before the envelope, so the envelope alone sets how loud it is)
    const rasping = synth.gain(0.6, g);
    const rasp = synth.gain(0.4);
    synth.tone("square", 38, rasp, t, 0.32);
    rasp.connect(rasping.gain);
    const o = synth.tone("sawtooth", 520, rasping, t, 0.32);
    o.frequency.exponentialRampToValueAtTime(380, t + 0.3);
  }
};

/** A swell that seems to play backwards: noise rising and brightening, then cut off. */
const reverseSwell = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const length = rand(1.4, 2.4);
  const g = synth.gain(0, at);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.06, when + length);
  g.gain.linearRampToValueAtTime(0.0001, when + length + 0.04);
  const f = synth.filter("bandpass", 300, 2, g);
  f.frequency.setValueAtTime(300, when);
  f.frequency.exponentialRampToValueAtTime(2400, when + length);
  synth.noise(f, when, length + 0.1);
};

/** The serpent, far off: a long, low, wavering call gliding up and back down. */
const serpentCall = (synth: Synth, out: AudioNode, when: number): void => {
  const at = synth.filter("lowpass", 700, 2, placed(synth, out));
  const g = synth.gain(0, at);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.07, when + 1.2);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 4);
  const vibrato = synth.gain(4);
  synth.tone("sine", 3.5, vibrato, when, 4.1);
  for (const [type, ratio] of [["sawtooth", 1], ["sine", 1.5]] as const) {
    const o = synth.tone(type, 90 * ratio, g, when, 4.1);
    o.frequency.setValueAtTime(90 * ratio, when);
    o.frequency.exponentialRampToValueAtTime(150 * ratio, when + 1.5);
    o.frequency.exponentialRampToValueAtTime(70 * ratio, when + 4);
    vibrato.connect(o.frequency);
  }
};

/** Crystals chiming: a few high notes falling. */
const crystalChime = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const start = rand(2400, 3600);
  for (let i = 0; i < 4; i++) bell(synth, at, when + i * 0.09, start * 0.84 ** i, 0.018, 1.2, [1, 2.4]);
};

/** A gust: wind rising and falling, its pitch sweeping. */
const gust = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const length = rand(2.5, 4.5);
  const g = synth.gain(0, at);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.09, when + length * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, when + length);
  const f = synth.filter("bandpass", 500, 5, g);
  f.frequency.setValueAtTime(400, when);
  f.frequency.exponentialRampToValueAtTime(rand(800, 1300), when + length * 0.45);
  f.frequency.exponentialRampToValueAtTime(350, when + length);
  synth.noise(f, when, length + 0.1);
};

/** Ice cracking somewhere: a sharp snap, then a low groan. */
const iceCrack = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const snap = synth.gain(0, synth.filter("highpass", 1800, 0.7, at));
  snap.gain.setValueAtTime(0.0001, when);
  snap.gain.linearRampToValueAtTime(0.05, when + 0.003);
  snap.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
  synth.noise(snap, when, 0.1);
  const creak = synth.gain(0, synth.filter("lowpass", 220, 3, at));
  creak.gain.setValueAtTime(0.0001, when + 0.05);
  creak.gain.linearRampToValueAtTime(0.04, when + 0.25);
  creak.gain.exponentialRampToValueAtTime(0.0001, when + 1.2);
  const o = synth.tone("sawtooth", 95, creak, when + 0.05, 1.2);
  o.frequency.exponentialRampToValueAtTime(60, when + 1.2);
};

/** The ice bird, high above: a clear, glassy cry, gliding down. */
const iceCry = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  for (const [start, from, to] of [[0, 1900, 1500], [0.55, 2100, 1300]] as const) {
    const t = when + start;
    const g = synth.gain(0, at);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    for (const ratio of [1, 2.01]) {
      const o = synth.tone("sine", from * ratio, g, t, 0.65);
      o.frequency.exponentialRampToValueAtTime(to * ratio, t + 0.6);
    }
  }
};

/** A crystal singing: a slow swell of two slightly detuned tones (they beat), fading over seconds, like a struck
 *  singing bowl. */
const singingCrystal = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const f = pick([392, 440, 523.25, 587.33, 659.25]);
  const g = synth.gain(0, at);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.035, when + 0.9);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 6);
  for (const [ratio, detune] of [[1, 0], [1, 3], [2.76, 0]] as const) {
    const o = synth.tone("sine", f * ratio, g, when, 6.1);
    o.detune.value = detune;
  }
};

/** Water dripping into the pool, echoing off the crater walls. */
const drip = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const f = rand(900, 1400);
  [0, 0.22, 0.44].forEach((delay, i) => { blip(synth, at, when + delay, "sine", f, f * 1.6, 0.05 / (1 + i * 2.2), 0.09); });
};

/** The station's radio: a short burst of beeps, far off. */
const radio = (synth: Synth, out: AudioNode, when: number): void => {
  const at = synth.filter("bandpass", 1800, 3, placed(synth, out));
  for (let i = 0; i < 3; i++) blip(synth, at, when + i * 0.13, "square", 1760, 1760, 0.012, 0.07);
};

/** A temple bell, struck once, ringing long. */
const templeBell = (synth: Synth, out: AudioNode, when: number): void => {
  bell(synth, synth.filter("lowpass", 3000, 0.7, placed(synth, out)), when, pick([196, 220, 261.63]), 0.06, 6, [1, 2.0, 2.76, 4.07]);
};

/** A choir swelling, far off: a wordless chord through a vowel-like filter. */
const choir = (synth: Synth, out: AudioNode, when: number): void => {
  const at = synth.filter("bandpass", 800, 1.5, out);
  const length = rand(4, 6);
  const g = synth.gain(0, at);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.035, when + length * 0.45);
  g.gain.linearRampToValueAtTime(0.0001, when + length);
  const root = pick([220, 246.94, 196]);
  for (const ratio of [1, 1.26, 1.5, 2]) {
    for (const detune of [-8, 8]) {
      const o = synth.tone("sawtooth", root * ratio, g, when, length + 0.1);
      o.detune.value = detune;
    }
  }
};

/** A whale's song, high above: long, gliding tones. */
const whaleSong = (synth: Synth, out: AudioNode, when: number): void => {
  const at = synth.filter("lowpass", 1200, 1, placed(synth, out));
  let t = when;
  for (let i = 0; i < 3; i++) {
    const length = rand(1.2, 2.2);
    const from = rand(180, 420);
    const g = synth.gain(0, at);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + length * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    const o = synth.tone("sine", from, g, t, length + 0.05);
    o.frequency.exponentialRampToValueAtTime(from * rand(0.6, 1.6), t + length);
    t += length * 0.8;
  }
};

/** A gull's cry: "kee-ow", gliding down, two or three times. */
const gull = (synth: Synth, out: AudioNode, when: number): void => {
  const at = synth.filter("bandpass", 2200, 1.5, placed(synth, out));
  for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
    const t = when + i * 0.38;
    const g = synth.gain(0, at);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    const o = synth.tone("triangle", 1800, g, t, 0.35);
    o.frequency.exponentialRampToValueAtTime(950, t + 0.3);
  }
};

/** A splash: a leaper back into the sea, far off. */
const splash = (synth: Synth, out: AudioNode, when: number): void => {
  const at = placed(synth, out);
  const g = synth.gain(0, synth.filter("bandpass", 1400, 0.8, at));
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.06, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.6);
  synth.noise(g, when, 0.7);
};

/** The volcano rumbling, deep and far. */
const rumble = (synth: Synth, out: AudioNode, when: number): void => {
  const length = rand(2.5, 4);
  const g = synth.gain(0, synth.filter("lowpass", 90, 1, out));
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.25, when + length * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, when + length);
  synth.noise(g, when, length + 0.1);
};

/** A diver's call across the water: a long, wavering, haunting "oooo-ooo", rising then falling. */
const lakeCall = (synth: Synth, out: AudioNode, when: number): void => {
  const at = synth.filter("lowpass", 1600, 0.7, placed(synth, out));
  const notes: [number, number, number, number][] = [
    [0, 1.4, 520, 700],
    [1.5, 1.8, 700, 560],
  ];
  for (const [start, length, from, to] of notes) {
    const t = when + start;
    const g = synth.gain(0, at);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    const vibrato = synth.gain(8);
    synth.tone("sine", 5, vibrato, t, length + 0.1);
    const o = synth.tone("sine", from, g, t, length + 0.1);
    o.frequency.exponentialRampToValueAtTime(to, t + length);
    vibrato.connect(o.frequency);
  }
};

/** A frog somewhere in the reeds: a soft, low "rr-bit", two short purrs. */
const croak = (synth: Synth, out: AudioNode, when: number): void => {
  const at = synth.filter("lowpass", 520, 0.7, placed(synth, out));
  const pitch = rand(105, 135);
  for (const [start, length] of [[0, 0.11], [0.16, 0.08]] as const) {
    const t = when + start;
    const g = synth.gain(0, at);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.022, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    // The purr: the tone pulsed 30 times a second, between a fifth and all of its level (before the envelope, so
    // the envelope alone sets how loud it is)
    const purr = synth.gain(0.6, g);
    const pulse = synth.gain(0.4);
    synth.tone("square", 30, pulse, t, length + 0.02);
    pulse.connect(purr.gain);
    synth.tone("sawtooth", pitch, purr, t, length + 0.02);
  }
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
  lake: {
    beds: [
      // Water lapping at the deck's pillars, softly
      { filter: "lowpass", frequency: 450, q: 0.6, gain: 0.03, lfo: { rate: 0.35, depth: 0.6, on: "gain" } },
      { ...breeze, gain: 0.03 },
    ],
    drones: [],
    events: [
      { every: [1.5, 4], play: birdChirps },
      { every: [14, 28], play: lakeCall },
      { every: [12, 24], play: croak },
      { every: [9, 18], play: splash },
      { every: [35, 60], play: whaleSong }, // (the guardian, far out)
    ],
  },
  island: {
    beds: [
      // Surf: waves rolling in and breaking, about every eight seconds
      { filter: "lowpass", frequency: 700, q: 0.5, gain: 0.07, lfo: { rate: 0.12, depth: 0.75, on: "gain" } },
      { filter: "highpass", frequency: 2500, q: 0.5, gain: 0.015, lfo: { rate: 0.12, depth: 0.8, on: "gain" } },
      breeze,
    ],
    drones: [],
    events: [
      { every: [2, 6], play: birdChirps },
      { every: [6, 14], play: gull },
      { every: [8, 16], play: splash },
      { every: [25, 50], play: rumble },
    ],
  },
  temple: {
    beds: [
      // Wind at the summit, gentle
      { filter: "bandpass", frequency: 650, q: 3, gain: 0.07, lfo: { rate: 0.07, depth: 0.4, on: "frequency" } },
      { filter: "highpass", frequency: 5000, q: 0.5, gain: 0.008, lfo: { rate: 0.1, depth: 0.8, on: "gain" } },
    ],
    drones: [{ type: "triangle", frequencies: [110, 164.81, 220], gain: 0.01, lowpass: 900 }], // (an open, still chord)
    events: [
      { every: [14, 28], play: templeBell },
      { every: [12, 22], play: choir },
      { every: [18, 34], play: whaleSong },
      { every: [7, 14], play: sparkle },
    ],
  },
  crater: {
    beds: [
      { filter: "lowpass", frequency: 140, q: 0.7, gain: 0.07, lfo: { rate: 0.04, depth: 0.4, on: "gain" } }, // the crater's hum
      { filter: "highpass", frequency: 5200, q: 0.5, gain: 0.01, lfo: { rate: 0.09, depth: 0.8, on: "gain" } }, // a shimmer
    ],
    drones: [{ type: "sine", frequencies: [65.4, 98, 130.8], gain: 0.014, lowpass: 500 }], // (the crystals resonating)
    events: [
      { every: [5, 11], play: singingCrystal },
      { every: [3, 8], play: drip },
      { every: [15, 30], play: radio },
      { every: [6, 12], play: crystalChime },
    ],
  },
  summit: {
    beds: [
      // The blizzard: a howl wandering in pitch over a rushing roar
      { filter: "bandpass", frequency: 520, q: 6, gain: 0.16, lfo: { rate: 0.09, depth: 0.45, on: "frequency" } },
      { filter: "lowpass", frequency: 900, q: 0.5, gain: 0.06, lfo: { rate: 0.13, depth: 0.5, on: "gain" } },
      { filter: "highpass", frequency: 3500, q: 0.5, gain: 0.015 }, // snow hissing
    ],
    drones: [],
    events: [
      { every: [3, 7], play: gust },
      { every: [14, 30], play: iceCrack },
      { every: [18, 35], play: iceCry },
    ],
  },
  dimension: {
    beds: [
      { filter: "lowpass", frequency: 160, q: 0.7, gain: 0.07, lfo: { rate: 0.05, depth: 0.4, on: "gain" } }, // the void's hum
      { filter: "highpass", frequency: 4200, q: 0.5, gain: 0.012, lfo: { rate: 0.11, depth: 0.8, on: "gain" } }, // a shimmer
    ],
    drones: [{ type: "sine", frequencies: [41.2, 61.7, 82.4], gain: 0.018, lowpass: 400 }], // (open fifths)
    events: [
      { every: [5, 10], play: reverseSwell },
      { every: [16, 30], play: serpentCall },
      { every: [4, 9], play: crystalChime },
    ],
  },
  ghosts: {
    beds: [
      // An eerie wind over the mountain, wandering in pitch
      { filter: "bandpass", frequency: 380, q: 4, gain: 0.12, lfo: { rate: 0.06, depth: 0.4, on: "frequency" } },
      { filter: "lowpass", frequency: 220, q: 0.5, gain: 0.05 },
    ],
    // Two low tones a little apart, slowly beating
    drones: [{ type: "sine", frequencies: [55, 57.5], gain: 0.025, lowpass: 300 }],
    events: [
      { every: [6, 14], play: ghostVoice },
      { every: [8, 16], play: windChimes },
      { every: [30, 55], play: gong },
      { every: [12, 25], play: crow },
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
