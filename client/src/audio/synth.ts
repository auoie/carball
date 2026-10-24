// Procedural sounds (Web Audio): every effect is synthesized from oscillators, noise and filters; nothing is
// downloaded. One-shots play into the node they're given (a panner, to place them); voices (engine, boost,
// supersonic) run continuously and are steered each frame. Everything takes a BaseAudioContext, so the same sounds can
// be rendered offline to check them.

/** Ramps a gain up to `peak` over `attack` and back down to silence over `decay` (exponentially, as sounds fade). */
function envelope(param: AudioParam, when: number, attack: number, peak: number, decay: number): void {
  param.setValueAtTime(0.0001, when);
  param.linearRampToValueAtTime(Math.max(0.0001, peak), when + attack);
  param.exponentialRampToValueAtTime(0.0001, when + attack + decay);
}

/** An explosion's roar and boom peaks (the demolition's) */
export const EXPLOSION = { roar: 0.42, boom: 0.5 } as const;
/** The goal's: about 4.7 dB under the demolition's at its loudest (K-weighted), most of it the sub-bass boom's (-8 dB),
 *  the roar's a little (-2.9 dB), so the fanfare stays clear (the user's "a little" quieter, 2026-10-24) */
export const GOAL_EXPLOSION = { roar: 0.3, boom: 0.2 } as const;

/** The menus' cues (MENU-18) */
export type MenuCue = "move" | "select" | "confirm" | "back" | "tab";

export class Synth {
  readonly #noise: AudioBuffer;

  constructor(readonly ctx: BaseAudioContext) {
    // Two seconds of white noise, shared by every noisy sound
    const length = Math.floor(ctx.sampleRate * 2);
    this.#noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.#noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  // --- building blocks ---

  gain(value: number, to?: AudioNode): GainNode {
    const g = new GainNode(this.ctx, { gain: value });
    if (to) g.connect(to);
    return g;
  }

  filter(type: BiquadFilterType, frequency: number, q: number, to: AudioNode): BiquadFilterNode {
    const f = new BiquadFilterNode(this.ctx, { type, frequency, Q: q });
    f.connect(to);
    return f;
  }

  /** An oscillator into `to`, from `when` for `duration` seconds. */
  tone(type: OscillatorType, frequency: number, to: AudioNode, when: number, duration: number): OscillatorNode {
    const o = new OscillatorNode(this.ctx, { type, frequency });
    o.connect(to);
    o.start(when);
    o.stop(when + duration);
    return o;
  }

  /** Noise into `to`, from `when` (for `duration` seconds, or looping until stopped). */
  noise(to: AudioNode, when: number, duration?: number): AudioBufferSourceNode {
    const s = new AudioBufferSourceNode(this.ctx, { buffer: this.#noise, loop: duration === undefined });
    s.connect(to);
    s.start(when, Math.random() * 1.4);
    if (duration !== undefined) s.stop(when + duration);
    return s;
  }

  /** A tone whose pitch slides from `from` to `to` Hz, shaped by an envelope. */
  #sweep(type: OscillatorType, from: number, to: number, glide: number, out: AudioNode, when: number, peak: number, decay: number): void {
    const g = this.gain(0, out);
    envelope(g.gain, when, 0.003, peak, decay);
    const o = this.tone(type, from, g, when, decay + 0.05);
    o.frequency.setValueAtTime(from, when);
    o.frequency.exponentialRampToValueAtTime(to, when + glide);
  }

  /** A burst of filtered noise, its filter sliding from `from` to `to` Hz. */
  #burst(type: BiquadFilterType, from: number, to: number, q: number, out: AudioNode, when: number, attack: number, peak: number, decay: number): void {
    const g = this.gain(0, out);
    envelope(g.gain, when, attack, peak, decay);
    const f = this.filter(type, from, q, g);
    f.frequency.setValueAtTime(from, when);
    f.frequency.exponentialRampToValueAtTime(to, when + attack + decay);
    this.noise(f, when, attack + decay + 0.05);
  }

  // --- gameplay one-shots ---

  /** A car hitting the ball: a deep, punchy thump with a crack on top, brighter the harder (0..1). */
  ballHit(out: AudioNode, when: number, strength: number): void {
    const s = Math.min(1, Math.max(0, strength));
    this.#sweep("sine", 150 + 70 * s, 46, 0.14, out, when, 0.2 + 0.45 * s, 0.38);
    this.#sweep("triangle", 440, 150, 0.05, out, when, 0.1 + 0.22 * s, 0.09);
    this.#burst("lowpass", 1400 + 4200 * s, 900, 0.7, out, when, 0.001, 0.1 + 0.3 * s, 0.05);
  }

  /** The ball bouncing off the arena: a softer, rounder thud. */
  ballBounce(out: AudioNode, when: number, strength: number): void {
    const s = Math.min(1, Math.max(0, strength));
    this.#sweep("sine", 115, 44, 0.2, out, when, 0.12 + 0.5 * s, 0.32);
    this.#burst("lowpass", 900, 300, 0.7, out, when, 0.002, 0.05 + 0.22 * s, 0.06);
  }

  /** A jump: a quick upward whoosh with a pop (`pitch` higher for a second jump). */
  jump(out: AudioNode, when: number, pitch = 1): void {
    this.#burst("bandpass", 500 * pitch, 1700 * pitch, 1.4, out, when, 0.012, 0.42, 0.2);
    this.#sweep("sine", 230 * pitch, 430 * pitch, 0.05, out, when, 0.16, 0.09);
  }

  /** A dodge: a swooping whoosh as the car flips, and a low whoomp. */
  flip(out: AudioNode, when: number): void {
    this.#burst("bandpass", 2300, 450, 1.1, out, when, 0.06, 0.36, 0.42);
    this.#sweep("sine", 150, 65, 0.25, out, when, 0.16, 0.3);
  }

  /** Touching down on the wheels: a soft, rounded thump with a little squish of the tyres, as hard as the landing. */
  land(out: AudioNode, when: number, strength: number): void {
    const s = Math.min(1, Math.max(0, strength));
    this.#sweep("sine", 110, 44, 0.12, out, when, 0.16 + 0.45 * s, 0.22);
    this.#sweep("triangle", 200, 120, 0.08, out, when, 0.04 + 0.1 * s, 0.1);
    this.#burst("lowpass", 450, 180, 0.7, out, when, 0.004, 0.04 + 0.12 * s, 0.05);
  }

  /** The body hitting the arena (a pogo off the nose, a roof landing): a warm "thock", a low thump with two soft,
   *  musical knocks (a fifth apart) and a tap on top. */
  impact(out: AudioNode, when: number, strength: number): void {
    const s = Math.min(1, Math.max(0, strength));
    this.#sweep("sine", 165, 58, 0.08, out, when, 0.2 + 0.5 * s, 0.2);
    for (const f of [329.6, 493.9]) this.#sweep("sine", f, f * 0.97, 0.12, out, when, 0.05 + 0.11 * s, 0.17);
    this.#burst("bandpass", 1300, 900, 1.2, out, when, 0.001, 0.06 + 0.16 * s, 0.025);
  }

  /** Picking up boost: a bright two-note blip for a small pad, a rising arpeggio with a shimmer for a big one. */
  pad(out: AudioNode, when: number, big: boolean): void {
    if (!big) {
      [1046.5, 1568].forEach((f, i) => {
        this.#sweep("sine", f, f, 0.01, out, when + i * 0.05, 0.13, 0.16);
      });
      return;
    }
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.#sweep("triangle", f, f, 0.01, out, when + i * 0.055, 0.17, 0.42);
    });
    this.#burst("highpass", 6000, 9000, 0.7, out, when, 0.05, 0.05, 0.35);
  }

  /** Two cars colliding: a metallic clank and a thud. */
  bump(out: AudioNode, when: number, strength: number): void {
    const s = Math.min(1, Math.max(0, strength));
    const metal = this.gain(0, this.filter("bandpass", 950, 2.2, out));
    envelope(metal.gain, when, 0.002, 0.12 + 0.3 * s, 0.2);
    this.tone("square", 173, metal, when, 0.3);
    this.tone("square", 259, metal, when, 0.3);
    this.#burst("lowpass", 2600, 800, 0.7, out, when, 0.001, 0.1 + 0.3 * s, 0.04);
    this.#sweep("sine", 105, 48, 0.12, out, when, 0.2 + 0.4 * s, 0.17);
  }

  /** An explosion: a crunchy roar sweeping down, and a sub-bass boom (`size` 1: a goal); `level` the roar's and the
   *  boom's peaks */
  explosion(out: AudioNode, when: number, size: number, level: { readonly roar: number; readonly boom: number } = EXPLOSION): void {
    const roar = this.gain(0, out);
    envelope(roar.gain, when, 0.006, level.roar, 1.3 * size);
    const shaper = new WaveShaperNode(this.ctx, { curve: softClip(2.5), oversample: "2x" });
    shaper.connect(roar);
    const f = this.filter("lowpass", 5200, 0.8, shaper);
    f.frequency.setValueAtTime(5200, when);
    f.frequency.exponentialRampToValueAtTime(140, when + 1.3 * size);
    this.noise(f, when, 1.5 * size);
    this.#sweep("sine", 75, 28, 0.6 * size, out, when, level.boom, 1.0 * size);
  }

  /** A goal: the explosion, quieter than a demolition's (GOAL_EXPLOSION), then a short brassy fanfare. */
  goal(out: AudioNode, when: number, explosion: { readonly roar: number; readonly boom: number } = GOAL_EXPLOSION): void {
    this.explosion(out, when, 1, explosion);
    const notes: [number, number, number][] = [
      [392, 0.25, 0.12],
      [523.25, 0.37, 0.12],
      [659.25, 0.49, 0.12],
      [783.99, 0.61, 0.85],
    ];
    for (const [f, start, length] of notes) this.#brass(out, when + start, f, length);
  }

  /** A demolition: a smaller explosion and a crunch. */
  demo(out: AudioNode, when: number): void {
    this.explosion(out, when, 0.65);
    this.bump(out, when, 0.5);
  }

  /** A flip reset: two quick, bright bell notes rising, with a sparkle. */
  flipReset(out: AudioNode, when: number): void {
    [1318.5, 1975.5].forEach((f, i) => {
      this.#sweep("sine", f, f, 0.01, out, when + i * 0.07, 0.14, 0.35);
      this.#sweep("sine", f * 2.01, f * 2.01, 0.01, out, when + i * 0.07, 0.04, 0.2);
    });
    this.#burst("highpass", 7000, 9500, 0.7, out, when, 0.03, 0.04, 0.3);
  }

  /** A chat line's notification (UI_Notification_ChatMessage): a soft two-note tick */
  chatMessage(out: AudioNode, when: number): void {
    this.#sweep("sine", 1046.5, 1046.5, 0.005, out, when, 0.07, 0.08);
    this.#sweep("sine", 1568, 1568, 0.005, out, when + 0.06, 0.09, 0.07);
  }

  /** The kickoff countdown: a beep for each second, a longer, higher one for go. */
  beep(out: AudioNode, when: number, go: boolean): void {
    const f = go ? 1318.5 : 880;
    this.#sweep("sine", f, f, 0.01, out, when, 0.22, go ? 0.55 : 0.16);
    this.#sweep("triangle", f * 2, f * 2, 0.01, out, when, 0.04, go ? 0.4 : 0.1);
  }

  /** A search starts: two soft notes rising */
  searchStart(out: AudioNode, when: number): void {
    this.#sweep("sine", 660, 660, 0.01, out, when, 0.12, 0.12);
    this.#sweep("sine", 990, 990, 0.01, out, when + 0.09, 0.12, 0.16);
  }

  /** A search cancelled: two soft notes falling */
  searchCancel(out: AudioNode, when: number): void {
    this.#sweep("sine", 880, 880, 0.01, out, when, 0.1, 0.1);
    this.#sweep("sine", 587, 587, 0.01, out, when + 0.08, 0.1, 0.14);
  }

  /** The menus (MENU-18: the game's own cues' places, our own sounds): the focus moved or a value stepped, a tiny high
   *  tick; a press, a short rising blip; a question's answer or a notice's OK, two rising notes; back, a short falling
   *  one; a tab, a soft double click */
  menu(out: AudioNode, when: number, cue: MenuCue): void {
    if (cue === "move") this.#sweep("triangle", 2600, 2300, 0.01, out, when, 0.025, 0.03);
    else if (cue === "select") this.#sweep("sine", 880, 1320, 0.04, out, when, 0.07, 0.1);
    else if (cue === "confirm") {
      this.#sweep("sine", 880, 880, 0.035, out, when, 0.06, 0.08);
      this.#sweep("sine", 1320, 1320, 0.035, out, when + 0.07, 0.09, 0.12);
    } else if (cue === "back") this.#sweep("sine", 990, 620, 0.05, out, when, 0.07, 0.1);
    else {
      this.#sweep("triangle", 1500, 1300, 0.01, out, when, 0.05, 0.04);
      this.#burst("bandpass", 3000, 1800, 1.5, out, when + 0.02, 0.005, 0.03, 0.06);
    }
  }

  /** The clock's last ten seconds (SFX_UI_Countdown_EndCounter's place): a short, dry tick, lower than the kickoff's */
  endCounter(out: AudioNode, when: number): void {
    this.#sweep("square", 740, 700, 0.03, out, when, 0.07, 0.07);
    this.#sweep("sine", 1480, 1480, 0.01, out, when, 0.05, 0.05);
  }

  /** The clock's announcements (the Overtime and Remaining_60sec / _30sec cues' places): overtime a rising brass call,
   *  one minute left two notes up, 30 seconds three */
  announcement(out: AudioNode, when: number, kind: "overtime" | "oneMinute" | "thirtySeconds"): void {
    if (kind === "overtime") {
      this.#brass(out, when, 392, 0.14);
      this.#brass(out, when + 0.16, 523.25, 0.4);
      return;
    }
    const notes = kind === "oneMinute" ? [659.25, 987.75] : [659.25, 830.6, 987.75];
    notes.forEach((f, i) => {
      this.#sweep("triangle", f, f, 0.01, out, when + i * 0.12, 0.16, 0.18);
    });
  }

  /** A brass note: two detuned saws through a filter that opens as it sounds, with vibrato on long notes. */
  #brass(out: AudioNode, when: number, frequency: number, length: number): void {
    const g = this.gain(0, out);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(0.09, when + 0.025);
    g.gain.setValueAtTime(0.09, when + length);
    g.gain.exponentialRampToValueAtTime(0.0001, when + length + 0.25);
    const f = this.filter("lowpass", 900, 1.5, g);
    f.frequency.setValueAtTime(900, when);
    f.frequency.linearRampToValueAtTime(2600, when + 0.08);
    const vibrato = this.gain(length > 0.3 ? 5 : 0);
    this.tone("sine", 5.5, vibrato, when, length + 0.3);
    for (const detune of [-6, 6]) {
      const o = this.tone("sawtooth", frequency, f, when, length + 0.3);
      o.detune.value = detune;
      vibrato.connect(o.frequency);
    }
  }
}

/** A soft-clipping curve for a WaveShaper (tanh), `drive` > 1 for more grit. */
function softClip(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

/** The engine loop's share of a car's sound: half what it was (-6 dB, 2026-10-22), under the hits, goals and boost */
const ENGINE_LEVEL = 0.5;

/** A car's continuous sounds: engine, boost and the supersonic wind, steered every frame; into `output`. */
export class CarVoice {
  readonly output: GainNode;
  readonly #engine: GainNode;
  readonly #engineFilter: BiquadFilterNode;
  readonly #oscillators: OscillatorNode[];
  readonly #pulse: OscillatorNode;
  readonly #boost: GainNode;
  readonly #wind: GainNode;
  readonly #sources: AudioScheduledSourceNode[];

  constructor(readonly synth: Synth) {
    const ctx = synth.ctx;
    const now = ctx.currentTime;
    this.output = synth.gain(1);
    // Engine: two detuned saws and a sub, pulsing like cylinders firing, through a filter that opens with throttle
    this.#engine = synth.gain(0, this.output);
    // (two filters in a row: a saw's buzz falls away steeply above the cutoff, a hum rather than a rasp)
    this.#engineFilter = synth.filter("lowpass", 400, 2, synth.filter("lowpass", 1200, 0.7, this.#engine));
    const pulsing = synth.gain(0.7, this.#engineFilter);
    this.#oscillators = [
      synth.tone("sawtooth", 50, pulsing, now, 1e6),
      synth.tone("sawtooth", 50.3, pulsing, now, 1e6),
      synth.tone("sine", 25, pulsing, now, 1e6),
    ];
    const depth = synth.gain(0.3);
    depth.connect(pulsing.gain);
    this.#pulse = synth.tone("sine", 25, depth, now, 1e6);
    // Boost: a roaring hiss, fluttering, over a low rumble
    this.#boost = synth.gain(0, this.output);
    const hiss = synth.filter("bandpass", 1150, 0.8, this.#boost);
    const flutter = synth.gain(260);
    flutter.connect(hiss.frequency);
    const rumble = synth.filter("lowpass", 170, 1, synth.gain(1.6, this.#boost));
    // Supersonic: rushing wind
    this.#wind = synth.gain(0, this.output);
    const wind = synth.filter("highpass", 2400, 0.7, this.#wind);
    this.#sources = [
      ...this.#oscillators,
      this.#pulse,
      synth.tone("sine", 9, flutter, now, 1e6),
      synth.noise(hiss, now),
      synth.noise(rumble, now),
      synth.noise(wind, now),
    ];
  }

  /** Speed (uu/s), throttle (0..1), boosting, supersonic; `level` scales the engine (the local car is louder). */
  set(speed: number, throttle: number, boosting: boolean, supersonic: boolean, level: number): void {
    const now = this.synth.ctx.currentTime;
    const s = Math.min(1, speed / 2300);
    const f = 44 + 82 * s + 16 * throttle;
    const [a, b, sub] = this.#oscillators;
    // (quick to follow the throttle and boost: 90% of a change within 70 ms, a boost's start within 25 ms; they lagged
    // 180 and 70 ms, 2026-10-22)
    a?.frequency.setTargetAtTime(f, now, 0.03);
    b?.frequency.setTargetAtTime(f * 1.006, now, 0.03);
    sub?.frequency.setTargetAtTime(f / 2, now, 0.03);
    this.#pulse.frequency.setTargetAtTime(f / 2, now, 0.03);
    this.#engineFilter.frequency.setTargetAtTime(320 + 1700 * (0.35 * s + 0.65 * throttle), now, 0.03);
    this.#engine.gain.setTargetAtTime((0.04 + 0.08 * throttle + 0.05 * s) * ENGINE_LEVEL * level, now, 0.03);
    this.#boost.gain.setTargetAtTime(boosting ? 0.22 : 0, now, boosting ? 0.01 : 0.04);
    this.#wind.gain.setTargetAtTime(supersonic ? 0.09 : 0, now, 0.25);
  }

  silence(): void {
    this.output.gain.setTargetAtTime(0, this.synth.ctx.currentTime, 0.05);
  }

  unsilence(): void {
    this.output.gain.setTargetAtTime(1, this.synth.ctx.currentTime, 0.05);
  }

  dispose(): void {
    for (const s of this.#sources) s.stop();
    this.output.disconnect();
  }
}
