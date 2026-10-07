// The game's sound: effects for what happens (src/audio/detect.ts), placed where it happens around the camera; every
// car's engine, boost and supersonic wind; the arena theme's ambience; the kickoff countdown and goals. All of it is
// synthesized in the browser (src/audio/synth.ts, src/audio/ambience.ts).
//
// Browsers only let a page make sound after the player interacts with it, so the audio starts on the first key press
// or click; it pauses while the tab is hidden.
import type { CameraView } from "../camera/rlCamera";
import { type Vec3, cross, dot, normalize, sub, vec3 } from "../math/vec";
import type { ThemeName } from "../render/themes";
import type { AudioSettings } from "../settings/settings";
import { Ambience } from "./ambience";
import { type SoundEvent, SoundDetector, type SoundWorld } from "./detect";
import { CarVoice, Synth } from "./synth";

export interface AudioFrame {
  readonly world: SoundWorld;
  /** The player's car (its engine plays up close, the others where they are) */
  readonly localCar: number | null;
  /** The player's throttle, 0..1 (other cars' is guessed from their speed) */
  readonly throttle: number;
  /** Simulated seconds since the last frame (0: no physics ticks this frame) */
  readonly simulated: number;
  readonly camera: CameraView;
}

export interface AudioStats {
  readonly state: AudioContextState;
  readonly played: Readonly<Record<string, number>>;
  readonly cars: number;
}

/** Where a car's voice is: right by the camera (the player's car), or out in the arena. */
interface Voiced {
  readonly voice: CarVoice;
  readonly panner: PannerNode | null;
  demoed: boolean;
}

/** The game's frame (z up) to Three.js's right-handed frame (y up), as the renderer draws it. */
const toRightHanded = (v: Vec3): Vec3 => vec3(v.x, v.z, v.y);

export class GameAudio {
  readonly #ctx = new AudioContext({ latencyHint: "interactive" });
  readonly #synth = new Synth(this.#ctx);
  readonly #master: GainNode;
  readonly #effects: GainNode;
  readonly #cars: GainNode;
  readonly #ambienceBus: GainNode;
  readonly #ambience: Ambience;
  readonly #detector = new SoundDetector();
  readonly #voices = new Map<number, Voiced>();
  readonly #played: Record<string, number> = {};
  readonly #abort = new AbortController();
  #unlocked = false;
  // The camera's position and axes (right-handed), for placing sounds around the listener
  #eye = vec3(0, 0, 0);
  #right = vec3(1, 0, 0);
  #up = vec3(0, 1, 0);
  #back = vec3(0, 0, 1);

  constructor(theme: ThemeName) {
    const ctx = this.#ctx;
    // A gentle limiter at the end, so a pile-up of sounds never clips
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -10, knee: 6, ratio: 12, attack: 0.003, release: 0.25 });
    limiter.connect(ctx.destination);
    this.#master = this.#synth.gain(0, limiter);
    this.#effects = this.#synth.gain(1, this.#master);
    this.#cars = this.#synth.gain(1, this.#master);
    this.#ambienceBus = this.#synth.gain(1, this.#master);
    this.#ambience = new Ambience(this.#synth, this.#ambienceBus, theme);

    const signal = this.#abort.signal;
    const unlock = (): void => {
      this.#unlocked = true;
      void ctx.resume();
    };
    for (const type of ["pointerdown", "keydown"] as const) window.addEventListener(type, unlock, { capture: true, signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) void ctx.suspend();
        else if (this.#unlocked) void ctx.resume();
      },
      { signal },
    );
  }

  /** Volumes (0..1, on a curve that sounds even) and mute. */
  apply(settings: AudioSettings, muted: boolean): void {
    const now = this.#ctx.currentTime;
    const curve = (v: number): number => v * v;
    this.#master.gain.setTargetAtTime(muted ? 0 : curve(settings.master), now, 0.05);
    this.#effects.gain.setTargetAtTime(curve(settings.effects), now, 0.05);
    this.#cars.gain.setTargetAtTime(curve(settings.cars), now, 0.05);
    this.#ambienceBus.gain.setTargetAtTime(curve(settings.ambience), now, 0.05);
  }

  /** Once per animation frame, after the camera has moved. */
  frame(f: AudioFrame): void {
    this.#listen(f.camera);
    for (const event of this.#detector.update(f.world, f.simulated)) this.#play(event);
    this.#steerVoices(f);
    this.#ambience.tick();
  }

  /** A goal: the explosion and fanfare, up close. */
  goal(): void {
    this.#count("goal");
    this.#synth.goal(this.#effects, this.#ctx.currentTime + 0.01);
  }

  /** The kickoff countdown: `secondsLeft` 3, 2, 1, then 0 for go. */
  countdown(secondsLeft: number): void {
    this.#count(secondsLeft === 0 ? "go" : "countdown");
    this.#synth.beep(this.#effects, this.#ctx.currentTime + 0.01, secondsLeft === 0);
  }

  get stats(): AudioStats {
    return { state: this.#ctx.state, played: { ...this.#played }, cars: this.#voices.size };
  }

  dispose(): void {
    this.#abort.abort();
    this.#ambience.dispose();
    for (const { voice } of this.#voices.values()) voice.dispose();
    void this.#ctx.close();
  }

  #count(kind: string): void {
    this.#played[kind] = (this.#played[kind] ?? 0) + 1;
  }

  #listen(camera: CameraView): void {
    this.#eye = toRightHanded(camera.position);
    const forward = normalize(toRightHanded(camera.forward), vec3(0, 0, -1));
    this.#right = normalize(cross(forward, toRightHanded(camera.up)), vec3(1, 0, 0));
    this.#up = cross(this.#right, forward);
    this.#back = vec3(-forward.x, -forward.y, -forward.z);
  }

  /** A panner at `at` (the game's frame), in the listener's own frame: the listener stays at the origin, facing -z. */
  #place(panner: PannerNode, at: Vec3): void {
    const d = sub(toRightHanded(at), this.#eye);
    const now = this.#ctx.currentTime;
    panner.positionX.setTargetAtTime(dot(d, this.#right), now, 0.02);
    panner.positionY.setTargetAtTime(dot(d, this.#up), now, 0.02);
    panner.positionZ.setTargetAtTime(dot(d, this.#back), now, 0.02);
  }

  #panner(at: Vec3, to: AudioNode): PannerNode {
    const panner = new PannerNode(this.#ctx, {
      panningModel: "equalpower",
      distanceModel: "inverse",
      refDistance: 1500,
      rolloffFactor: 1.2,
      maxDistance: 30000,
    });
    // (set at once for a one-shot; voices then follow their car)
    const d = sub(toRightHanded(at), this.#eye);
    panner.positionX.value = dot(d, this.#right);
    panner.positionY.value = dot(d, this.#up);
    panner.positionZ.value = dot(d, this.#back);
    panner.connect(to);
    return panner;
  }

  #play(event: SoundEvent): void {
    this.#count(event.kind);
    const when = this.#ctx.currentTime + 0.005;
    const out = this.#panner(event.at, this.#effects);
    const s = this.#synth;
    switch (event.kind) {
      case "ballHit":
        s.ballHit(out, when, event.strength);
        break;
      case "ballBounce":
        s.ballBounce(out, when, event.strength);
        break;
      case "jump":
        s.jump(out, when);
        break;
      case "doubleJump":
        s.jump(out, when, 1.35);
        break;
      case "flip":
        s.flip(out, when);
        break;
      case "land":
        s.land(out, when, event.strength);
        break;
      case "pad":
        s.pad(out, when, event.big);
        break;
      case "bump":
        s.bump(out, when, event.strength);
        break;
      case "demo":
        s.demo(out, when);
        break;
    }
  }

  #steerVoices(f: AudioFrame): void {
    for (const [id, voiced] of this.#voices) {
      if (!f.world.cars.has(id)) {
        voiced.voice.dispose();
        this.#voices.delete(id);
      }
    }
    for (const [id, car] of f.world.cars) {
      let voiced = this.#voices.get(id);
      if (!voiced) {
        const voice = new CarVoice(this.#synth);
        const panner = id === f.localCar ? null : this.#panner(car.pos, this.#cars);
        voice.output.connect(panner ?? this.#cars);
        voiced = { voice, panner, demoed: false };
        this.#voices.set(id, voiced);
      }
      if (car.demoed !== voiced.demoed) {
        voiced.demoed = car.demoed;
        if (car.demoed) voiced.voice.silence();
        else voiced.voice.unsilence();
      }
      if (voiced.panner) this.#place(voiced.panner, car.pos);
      const speed = Math.hypot(car.vel.x, car.vel.y, car.vel.z);
      const local = id === f.localCar;
      // Other cars' throttle isn't known here: guess from their speed
      const throttle = local ? f.throttle : Math.min(1, speed / 1400) * 0.7;
      voiced.voice.set(speed, throttle, car.boosting, car.supersonic, local ? 1 : 0.8);
    }
  }
}
