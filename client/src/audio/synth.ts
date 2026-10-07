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

  /** Touching down: a thud through the suspension, as hard as the landing (0..1). */
  land(out: AudioNode, when: number, strength: number): void {
    const s = Math.min(1, Math.max(0, strength));
    this.#sweep("sine", 95, 38, 0.16, out, when, 0.12 + 0.55 * s, 0.24);
    this.#burst("lowpass", 600, 200, 0.7, out, when, 0.002, 0.05 + 0.25 * s, 0.06);
    const clunk = this.gain(0, this.filter("lowpass", 700, 1, out));
    envelope(clunk.gain, when, 0.002, 0.03 + 0.1 * s, 0.06);
    this.tone("square", 150, clunk, when, 0.1);
  }

  /** Picking up boost: a bright two-note blip for a small pad, a rising arpeggio with a shimmer for a big one. */
  pad(out: AudioNode, when: number, big: boolean): void {
    if (!big) {
      [1046.5, 1568].forEach((f, i) => { this.#sweep("sine", f, f, 0.01, out, when + i * 0.05, 0.13, 0.16); });
      return;
    }
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { this.#sweep("triangle", f, f, 0.01, out, when + i * 0.055, 0.17, 0.42); });
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

  /** An explosion: a crunchy roar sweeping down, and a sub-bass boom (`size` 1: a goal). */
  explosion(out: AudioNode, when: number, size: number): void {
    const roar = this.gain(0, out);
    envelope(roar.gain, when, 0.006, 0.42, 1.3 * size);
    const shaper = new WaveShaperNode(this.ctx, { curve: softClip(2.5), oversample: "2x" });
    shaper.connect(roar);
    const f = this.filter("lowpass", 5200, 0.8, shaper);
    f.frequency.setValueAtTime(5200, when);
    f.frequency.exponentialRampToValueAtTime(140, when + 1.3 * size);
    this.noise(f, when, 1.5 * size);
    this.#sweep("sine", 75, 28, 0.6 * size, out, when, 0.5, 1.0 * size);
  }

  /** A goal: the explosion, then a short brassy fanfare. */
  goal(out: AudioNode, when: number): void {
    this.explosion(out, when, 1);
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

  /** The kickoff countdown: a beep for each second, a longer, higher one for go. */
  beep(out: AudioNode, when: number, go: boolean): void {
    const f = go ? 1318.5 : 880;
    this.#sweep("sine", f, f, 0.01, out, when, 0.22, go ? 0.55 : 0.16);
    this.#sweep("triangle", f * 2, f * 2, 0.01, out, when, 0.04, go ? 0.4 : 0.1);
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
    a?.frequency.setTargetAtTime(f, now, 0.06);
    b?.frequency.setTargetAtTime(f * 1.006, now, 0.06);
    sub?.frequency.setTargetAtTime(f / 2, now, 0.06);
    this.#pulse.frequency.setTargetAtTime(f / 2, now, 0.06);
    this.#engineFilter.frequency.setTargetAtTime(320 + 1700 * (0.35 * s + 0.65 * throttle), now, 0.08);
    this.#engine.gain.setTargetAtTime((0.04 + 0.08 * throttle + 0.05 * s) * level, now, 0.08);
    this.#boost.gain.setTargetAtTime(boosting ? 0.22 : 0, now, boosting ? 0.03 : 0.09);
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
