// The game's sound: effects for what happens (src/audio/detect.ts), placed where it happens around the camera; every
// car's engine, boost and supersonic wind; the arena theme's ambience; the kickoff countdown and goals. All of it is
// synthesized in the browser (src/audio/synth.ts, src/audio/ambience.ts).
//
// Browsers only let a page make sound after the player interacts with it, so the audio starts on the first key press
// or click; it pauses while the tab is hidden.
import type { CameraView } from "../camera/carballCamera";
import type { CarState } from "../engine/world";
import { type Vec3, cross, dot, length, normalize, sub, vec3 } from "../math/vec";
import type { ThemeName } from "../render/themes";
import type { AudioSettings } from "../settings/settings";
import { Ambience } from "./ambience";
import { type ReplayMoves, type SoundEvent, SoundDetector, type SoundWorld, replayMoveEvents } from "./detect";
import {
  LiveReplayState,
  type MixOffsets,
  type ReplayState,
  dbGain,
  inCameraView,
  inCameraViewDb,
  inCameraViewLpf,
  pickupDb,
  smoothInCameraView,
  wwiseFilterHz,
} from "./replayMix";
import { CarVoice, Synth, type MenuCue } from "./synth";

export interface AudioFrame {
  readonly world: SoundWorld;
  /** The player's car (its engine plays up close, the others where they are) */
  readonly localCar: number | null;
  /** The player's throttle, 0..1 (other cars' is guessed from their speed) */
  readonly throttle: number;
  /** Simulated seconds since the last frame (0: no physics ticks this frame) */
  readonly simulated: number;
  readonly camera: CameraView;
  /** The impacts' and landings' sounds this frame (game/impactTriggers.ts) */
  readonly triggered?: readonly SoundEvent[];
}

export interface AudioStats {
  readonly state: AudioContextState;
  readonly played: Readonly<Record<string, number>>;
  readonly cars: number;
  /** Whose cars the voices follow: the live world's or a goal replay's */
  readonly mode: "live" | "replay";
  /** The voices boosting now */
  readonly boosting: number;
  /** The LiveReplay state (RA1 §4: none outside a replay) */
  readonly replayState: ReplayState;
}

/** A goal replay's frame for its sounds (src/game/replayPlayback.ts) */
export interface ReplayAudio {
  /** The live sounds kept at the recorded frames it moved past: heard again (RA1 §1, §8, §9) */
  readonly sounds: readonly SoundEvent[];
  /** Where it is: PreScore, Slomo, PostGoal */
  readonly state: ReplayState;
  /** Real seconds since its last frame */
  readonly seconds: number;
}

/** What a car's voice follows (the live world's cars, or a goal replay's recorded ones) */
export type VoiceCar = Pick<CarState, "pos" | "vel" | "boosting" | "supersonic" | "demoed">;

/** Where a car's voice is: right by the camera (the player's car), or out in the arena. */
interface Voiced {
  readonly voice: CarVoice;
  readonly panner: PannerNode | null;
  demoed: boolean;
  /** In a replay, its Replay_InCameraView, smoothed (1 as it starts: the game's reset at Countdown) */
  inView: number;
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
  // (the ambient bus's replay mix: RA1 §4)
  readonly #ambientMix: GainNode;
  readonly #ambientLpf: BiquadFilterNode;
  readonly #ambientHpf: BiquadFilterNode;
  readonly #ambience: Ambience;
  readonly #liveReplay = new LiveReplayState();
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
    this.#ambientHpf = this.#synth.filter("highpass", 1, 0.707, this.#ambienceBus);
    this.#ambientLpf = this.#synth.filter("lowpass", ctx.sampleRate / 2, 0.707, this.#ambientHpf);
    this.#ambientMix = this.#synth.gain(1, this.#ambientLpf);
    this.#ambience = new Ambience(this.#synth, this.#ambientMix, theme);

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

  /** Once per animation frame, after the camera has moved; the sounds it played (a replay hears some again: the
   *  recorder keeps them) */
  frame(f: AudioFrame): SoundEvent[] {
    this.#setMode("live");
    this.#listen(f.camera);
    const played = [...this.#detector.update(f.world, f.simulated), ...(f.triggered ?? [])];
    for (const event of played) this.#play(event);
    this.#steerVoices(f.world.cars, f.localCar, f.throttle);
    this.#mixAmbience();
    this.#ambience.tick();
    return played;
  }

  /** A goal replay's frame (RA1, SND-19): the voices follow the replayed cars (engine and boost; every car a remote one
   *  where it is, the replay camera the listener; no Ignition, no supersonic loop: SND-3, RA1 §2), and go back to the
   *  live cars after it. Its cars' jumps, double jumps and dodges are heard at each car from the replay's camera (SND-9),
   *  and the live impacts, landings, bumps, pickups and demolitions of the frames it moves past again (the game's replay
   *  bodies collide again: RA1 §1). Each car's sounds by how far in front of the camera it is (Replay_InCameraView,
   *  §3); the buses by the LiveReplay state (§4), with the swoops at its start and round its slow motion (§6) */
  replayFrame(cars: ReadonlyMap<number, VoiceCar & ReplayMoves>, camera: CameraView, replay: ReplayAudio): void {
    this.#setMode("replay");
    this.#listen(camera);
    this.#setReplayState(replay.state);
    this.#steerVoices(cars, null, 0, { camera, seconds: replay.seconds });
    for (const event of replayMoveEvents(this.#replayMoves, cars)) this.#playReplayed(event);
    for (const event of replay.sounds) this.#playReplayed(event);
    this.#mixAmbience();
    this.#ambience.tick();
  }

  /** Each replayed car's last state (the replay's jumps and dodges found between frames) */
  readonly #replayMoves = new Map<number, ReplayMoves>();

  #mode: "live" | "replay" = "live";
  #boosting = 0;

  /** The voices start over when they change over between the live cars and a replay's (the player's car is up close
   *  live, out in the arena in a replay); a replay starts with SwoopOut, and ends (or is skipped) with SloMo_End and the
   *  LiveReplay state back to None (RA1 §6) */
  #setMode(mode: "live" | "replay"): void {
    if (mode === this.#mode) return;
    this.#mode = mode;
    for (const { voice } of this.#voices.values()) voice.dispose();
    this.#voices.clear();
    // (a replay's cars start afresh: nothing found between its first frame and the last replay's)
    this.#replayMoves.clear();
    this.#swoop(mode === "replay" ? "swoopOut" : "sloMoEnd");
    if (mode === "live") this.#liveReplay.set("none", this.#ctx.currentTime);
  }

  /** The LiveReplay state; SloMo_Start entering slow motion, SloMo_End leaving it (RA1 §6) */
  #setReplayState(state: ReplayState): void {
    const before = this.#liveReplay.state;
    if (state === before) return;
    if (state === "slomo") this.#swoop("sloMoStart");
    else if (before === "slomo") this.#swoop("sloMoEnd");
    this.#liveReplay.set(state, this.#ctx.currentTime);
  }

  /** The replay's swoops: 2D, the UI's (RA1 §6) */
  #swoop(kind: "swoopOut" | "sloMoStart" | "sloMoEnd"): void {
    this.#count(kind);
    this.#synth[kind](this.#effects, this.#ctx.currentTime + 0.005);
  }

  /** The ambient bus by the LiveReplay state (its volume, pitch and filters, back to none after a replay) */
  #mixAmbience(): void {
    const now = this.#ctx.currentTime;
    const m = this.#liveReplay.offsets("ambient", now);
    this.#ambientMix.gain.setTargetAtTime(dbGain(m.db), now, 0.03);
    this.#ambientLpf.frequency.setTargetAtTime(wwiseFilterHz("lpf", m.lpf) ?? this.#ctx.sampleRate / 2, now, 0.03);
    this.#ambientHpf.frequency.setTargetAtTime(wwiseFilterHz("hpf", m.hpf) ?? 1, now, 0.03);
    this.#ambience.detune(m.cents);
  }

  /** A goal: the explosion and fanfare, up close. */
  goal(): void {
    this.#count("goal");
    this.#synth.goal(this.#effects, this.#ctx.currentTime + 0.01);
  }

  /** A goal replay's goal: its explosion again, not the horn (that plays only as the live goal's state starts: RA1 §7) */
  replayGoal(): void {
    this.#count("replayGoal");
    this.#synth.explosion(this.#effects, this.#ctx.currentTime + 0.01, 1);
  }

  /** A car exploding that the world's demolitions don't show (a player who left): the demolition's sound at `at`. */
  demolition(at: Vec3): void {
    this.#play({ kind: "demo", at });
  }

  /** A chat line with a sender's name, one's own too (CHAT-17: the HUD's CHATMESSAGE event) */
  chatMessage(): void {
    this.#count("chat");
    this.#synth.chatMessage(this.#effects, this.#ctx.currentTime + 0.005);
  }

  /** A flip reset: live, the player's car's, a chime up close (2D); in a replay (`at`: the replayed car's place), heard
   *  from the replay's camera as the jumps and dodges are (3D, a remote car's: SND-9, the user's report 2026-10-18) */
  flipReset(at: Vec3 | null = null): void {
    this.#count("flipReset");
    this.#synth.flipReset(at ? this.#panner(at, this.#effects) : this.#effects, this.#ctx.currentTime + 0.005);
  }

  /** The kickoff countdown: `secondsLeft` 3, 2, 1, then 0 for go. */
  countdown(secondsLeft: number): void {
    this.#count(secondsLeft === 0 ? "go" : "countdown");
    this.#synth.beep(this.#effects, this.#ctx.currentTime + 0.01, secondsLeft === 0);
  }

  /** A search starts (START_MATCH_SEARCH's place, MM-12: our own sound) */
  searchStart(): void {
    this.#count("searchStart");
    this.#synth.searchStart(this.#effects, this.#ctx.currentTime + 0.01);
  }

  /** The menus' cues (MENU-18: our own sounds) */
  menu(cue: MenuCue): void {
    this.#count(`menu-${cue}`);
    this.#synth.menu(this.#effects, this.#ctx.currentTime + 0.005, cue);
  }

  /** Cancel Search (the menus' CANCEL, MM-12: our own sound) */
  searchCancel(): void {
    this.#count("searchCancel");
    this.#synth.searchCancel(this.#effects, this.#ctx.currentTime + 0.01);
  }

  /** One of the clock's last ten seconds (HT-7: its own cue, not the kickoff's) */
  endCounter(): void {
    this.#count("endCounter");
    this.#synth.endCounter(this.#effects, this.#ctx.currentTime + 0.01);
  }

  /** "Overtime!", "One Minute Remaining!", "30 Seconds Remaining!" (HT-7: each its own cue, whatever the setting) */
  announcement(kind: "overtime" | "oneMinute" | "thirtySeconds"): void {
    this.#count(kind);
    this.#synth.announcement(this.#effects, this.#ctx.currentTime + 0.01, kind);
  }

  get stats(): AudioStats {
    return {
      state: this.#ctx.state,
      played: { ...this.#played },
      cars: this.#voices.size,
      mode: this.#mode,
      boosting: this.#boosting,
      replayState: this.#liveReplay.state,
    };
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

  /** `flat`: placed, no quieter with distance (a replay's demolition, its pickups' own curve: RA1 §8, §9) */
  #panner(at: Vec3, to: AudioNode, flat = false): PannerNode {
    const panner = new PannerNode(this.#ctx, {
      panningModel: "equalpower",
      distanceModel: "inverse",
      refDistance: 1500,
      rolloffFactor: flat ? 0 : 1.2,
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
      case "impact":
        s.impact(out, when, event.strength);
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

  /** A replay's one-shot (RA1): at `at`, through its bus's state offsets and its car's Replay_InCameraView (volume and
   *  low-pass, Wwise's filter values added), the pitch set while the synth makes it */
  #playReplayed(event: SoundEvent): void {
    const now = this.#ctx.currentTime;
    const when = now + 0.005;
    const s = this.#synth;
    const state = (group: Parameters<LiveReplayState["offsets"]>[0]): MixOffsets => this.#liveReplay.offsets(group, now);
    const NONE: MixOffsets = { db: 0, cents: 0, lpf: 0, hpf: 0 };
    const car = (id: number): number => this.#voices.get(id)?.inView ?? 1;
    // (a car's: its InCameraView on top of its bus's offsets)
    const onCar = (id: number, bus: MixOffsets): MixOffsets => {
      const x = car(id);
      return { ...bus, db: bus.db + inCameraViewDb(x), lpf: bus.lpf + inCameraViewLpf(x) };
    };
    this.#count(event.kind);
    switch (event.kind) {
      case "ballHit":
      case "ballBounce": {
        const m = state("ball");
        const out = this.#mixed(event.at, m);
        s.detune = m.cents;
        if (event.kind === "ballHit") s.ballHit(out, when, event.strength);
        else s.ballBounce(out, when, event.strength);
        s.detune = 0;
        break;
      }
      case "jump":
        s.jump(this.#mixed(event.at, onCar(event.car, NONE)), when);
        break;
      case "doubleJump":
        s.jump(this.#mixed(event.at, onCar(event.car, NONE)), when, 1.35);
        break;
      case "flip":
        s.flip(this.#mixed(event.at, onCar(event.car, NONE)), when);
        break;
      case "land":
        s.land(this.#mixed(event.at, onCar(event.car, state("carImpact"))), when, event.strength);
        break;
      case "impact":
        s.impact(this.#mixed(event.at, onCar(event.car, state("carImpact"))), when, event.strength);
        break;
      case "bump":
        s.bump(this.#mixed(event.at, onCar(event.car, state("carImpact"))), when, event.strength);
        break;
      case "pad": {
        // (another car's pickup: its own distance curve, silent in slow motion and after the goal: §8)
        const db = pickupDb(length(sub(toRightHanded(event.at), this.#eye))) + state("pickup").db;
        if (db > -90) s.pad(this.#mixed(event.at, { ...NONE, db }, true), when, event.big);
        break;
      }
      case "demo":
        s.demo(this.#mixed(event.at, NONE, true), when, false); // (the explosion alone, flat: §9)
        break;
    }
  }

  /** A one-shot's way out: its volume and filters, then placed */
  #mixed(at: Vec3, m: MixOffsets, flat = false): AudioNode {
    let head: AudioNode = this.#panner(at, this.#effects, flat);
    const hpf = wwiseFilterHz("hpf", m.hpf);
    const lpf = wwiseFilterHz("lpf", m.lpf);
    if (hpf !== null) head = this.#synth.filter("highpass", hpf, 0.707, head);
    if (lpf !== null) head = this.#synth.filter("lowpass", lpf, 0.707, head);
    return m.db === 0 ? head : this.#synth.gain(dbGain(m.db), head);
  }

  /** `replay`: the replay camera and the frame's real seconds (each car's InCameraView, the state's engine and boost
   *  offsets; no supersonic loop) */
  #steerVoices(
    cars: ReadonlyMap<number, VoiceCar>,
    localCar: number | null,
    localThrottle: number,
    replay: { readonly camera: CameraView; readonly seconds: number } | null = null,
  ): void {
    for (const [id, voiced] of this.#voices) {
      if (!cars.has(id)) {
        voiced.voice.dispose();
        this.#voices.delete(id);
      }
    }
    this.#boosting = 0;
    for (const [id, car] of cars) {
      let voiced = this.#voices.get(id);
      if (!voiced) {
        const voice = new CarVoice(this.#synth);
        const panner = id === localCar ? null : this.#panner(car.pos, this.#cars);
        voice.output.connect(panner ?? this.#cars);
        voiced = { voice, panner, demoed: false, inView: 1 };
        this.#voices.set(id, voiced);
      }
      if (car.demoed !== voiced.demoed) {
        voiced.demoed = car.demoed;
        if (car.demoed) voiced.voice.silence();
        else voiced.voice.unsilence();
      }
      if (voiced.panner) this.#place(voiced.panner, car.pos);
      const speed = Math.hypot(car.vel.x, car.vel.y, car.vel.z);
      const local = id === localCar;
      // Other cars' throttle isn't known here: guess from their speed
      const throttle = local ? localThrottle : Math.min(1, speed / 1400) * 0.7;
      voiced.voice.set(speed, throttle, car.boosting, car.supersonic && !replay, local ? 1 : 0.8);
      if (car.boosting && !car.demoed) this.#boosting++;
      if (replay) {
        voiced.inView = smoothInCameraView(voiced.inView, inCameraView(car.pos, replay.camera.position, replay.camera.forward), replay.seconds);
        const now = this.#ctx.currentTime;
        const engine = this.#liveReplay.offsets("engine", now);
        const boost = this.#liveReplay.offsets("boost", now);
        const db = inCameraViewDb(voiced.inView);
        const lpf = inCameraViewLpf(voiced.inView);
        voiced.voice.mix({
          engine: { gain: dbGain(db + engine.db), cutoff: wwiseFilterHz("lpf", lpf + engine.lpf) },
          boost: { gain: dbGain(db + boost.db), cutoff: wwiseFilterHz("lpf", lpf + boost.lpf), cents: boost.cents },
        });
      }
    }
  }
}
