// Client prediction and rollback, as the game does it (notes/netcode.md): the client simulates ahead with its own
// inputs and keeps the world after every frame. When the server's state for one of its frames arrives, it loads its
// own world at that frame, puts in the server's state, and replays to the present with the inputs it recorded.
// Other cars drive with the server's last known inputs, their axes fading to zero over 0.1 s (InputFadeTime).
//
// Because the engine is deterministic and snapshots restore exactly, a correction changes nothing unless the
// prediction was actually wrong (another car did something unexpected, or the server repeated an input).
import type { CarControls, World } from "../engine/world";
import { BIT_AIR_PITCH_SAFETY, BIT_BOOST, BIT_HANDBRAKE, BIT_JUMP, type InputFrame, dequantizeAxis } from "./protocol";

/** How far back a correction can reach (MaxClientReplayFrames = 1 s) */
export const HISTORY_FRAMES = 120;
/** Other cars' replicated axes fade to zero over this many frames (RBVehicleHistory_TA.InputFadeTime 0.1 s) */
export const INPUT_FADE_FRAMES = 12;

export const NO_INPUT: InputFrame = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, dodgeForward: 0, bits: 0 };

/** The controls the server applies for an input frame (dequantized exactly as on the server). */
export function inputControls(f: InputFrame): CarControls {
  return {
    throttle: dequantizeAxis(f.throttle),
    steer: dequantizeAxis(f.steer),
    pitch: dequantizeAxis(f.pitch),
    yaw: dequantizeAxis(f.yaw),
    roll: dequantizeAxis(f.roll),
    dodgeForward: dequantizeAxis(f.dodgeForward),
    jump: (f.bits & BIT_JUMP) !== 0,
    boost: (f.bits & BIT_BOOST) !== 0,
    handbrake: (f.bits & BIT_HANDBRAKE) !== 0,
    airPitchSafety: (f.bits & BIT_AIR_PITCH_SAFETY) !== 0,
  };
}

interface RecordedFrame {
  frame: number;
  snapshot: Uint8Array; // the world after this frame
  input: InputFrame; // the local player's input for this frame
  /** The server's network states for after this frame, applied on top (put back when an older correction replays
   *  through this frame, so it can't undo them: an older update or a late part still applies, NR-6) */
  server?: readonly Uint8Array[];
}

interface RemoteBase {
  readonly controls: CarControls; // as the server last sent them
  readonly frame: number; // the client frame they belong to
}

export interface PredictorStats {
  corrections: number;
  resimulatedFrames: number;
  ignoredOld: number;
  /** The server was ahead of this client (it fell behind real time): its state was taken as the present */
  resyncs: number;
  /** Corrections that changed the local car's present state: the server disagreed with its prediction */
  localMispredictions: number;
}

export class Predictor {
  readonly #world: World;
  readonly #localCar: number;
  #frame: number;
  #oldest: number; // corrections may not reach before this frame (history before a world reload is invalid)
  readonly #history: (RecordedFrame | undefined)[] = new Array<RecordedFrame | undefined>(HISTORY_FRAMES + 8);
  readonly #remote = new Map<number, RemoteBase>();
  readonly stats: PredictorStats = { corrections: 0, resimulatedFrames: 0, ignoredOld: 0, resyncs: 0, localMispredictions: 0 };

  /** `world` already holds the state after `frame`. */
  constructor(world: World, localCarId: number, frame: number) {
    this.#world = world;
    this.#localCar = localCarId;
    this.#frame = frame;
    this.#oldest = frame;
    this.#record(frame, NO_INPUT);
  }

  /** The last simulated frame */
  get frame(): number {
    return this.#frame;
  }

  #slot(frame: number): number {
    return frame % this.#history.length;
  }

  #recorded(frame: number): RecordedFrame | undefined {
    const r = this.#history[this.#slot(frame)];
    return r?.frame === frame ? r : undefined;
  }

  #record(frame: number, input: InputFrame, server?: readonly Uint8Array[]): void {
    this.#history[this.#slot(frame)] = server
      ? { frame, snapshot: this.#world.saveState(), input, server }
      : { frame, snapshot: this.#world.saveState(), input };
  }

  /** Other cars' predicted controls at `frame`: the server's last values, axes fading out */
  #remoteControls(base: RemoteBase, frame: number): CarControls {
    // (a frame before the base, replayed for an older correction: the base's controls; the car's state is the
    // server's again at the base's frame)
    const keep = 1 - Math.min(1, Math.max(0, frame - base.frame) / INPUT_FADE_FRAMES);
    const c = base.controls;
    return { ...c, throttle: c.throttle * keep, steer: c.steer * keep, pitch: c.pitch * keep, yaw: c.yaw * keep, roll: c.roll * keep };
  }

  #simulate(frame: number, input: InputFrame): void {
    this.#world.setControls(this.#localCar, inputControls(input));
    for (const [car, base] of this.#remote) this.#world.setControls(car, this.#remoteControls(base, frame));
    this.#world.step();
  }

  /** One client frame with the local player's input (already quantized, as sent). */
  advance(input: InputFrame): void {
    const frame = this.#frame + 1;
    this.#simulate(frame, input);
    this.#frame = frame;
    this.#record(frame, input);
  }

  /** The input recorded for a frame (to resend), or undefined if it fell out of the history */
  inputAt(frame: number): InputFrame | undefined {
    return this.#recorded(frame)?.input;
  }

  /**
   * The server's state after this client's frame `frame` (the parts of one update). Rewinds there, applies it and
   * replays to the present. Returns the number of frames replayed (0 if the state was too old or did not apply).
   */
  correct(frame: number, states: readonly Uint8Array[]): number {
    if (frame > this.#frame) {
      this.#resync(frame, states);
      return 0;
    }
    const at = this.#recorded(frame);
    if (frame < this.#oldest || !at) {
      this.stats.ignoredOld++;
      return 0;
    }
    const present = this.#frame;
    const predicted = this.#localState();
    this.#world.loadState(at.snapshot);
    const updated = this.#applyStates(states);
    if (!updated) {
      this.#world.loadState(this.#recorded(present)?.snapshot ?? at.snapshot);
      return 0;
    }
    this.#rebase(updated, frame);
    this.#record(frame, at.input, [...(at.server ?? []), ...states]);
    for (let f = frame + 1; f <= present; f++) {
      const recorded = this.#recorded(f);
      const input = recorded?.input ?? NO_INPUT;
      this.#simulate(f, input);
      if (recorded?.server) this.#applyStates(recorded.server); // (the newer states: they win for their bodies)
      this.#record(f, input, recorded?.server);
    }
    this.stats.corrections++;
    this.stats.resimulatedFrames += present - frame;
    if (this.#localState() !== predicted) this.stats.localMispredictions++;
    return present - frame;
  }

  /** Applies an update's network states; the cars they held, or null if one didn't apply. */
  #applyStates(states: readonly Uint8Array[]): Set<number> | null {
    const cars = new Set<number>();
    for (const s of states) {
      if (!this.#world.applyNetState(s)) return null;
      for (const id of this.#world.netStateCars()) cars.add(id);
    }
    return cars;
  }

  /** The server's controls for the other cars in an update are the new basis for predicting them. Only those cars:
   *  the others in the world hold their own faded prediction, which mustn't become a new basis (their inputs would
   *  never fade out). */
  #rebase(cars: ReadonlySet<number>, frame: number): void {
    for (const car of cars) {
      const base = this.#remote.get(car);
      if (car === this.#localCar || (base && base.frame > frame)) continue; // (an older update: the newer basis stays)
      this.#remote.set(car, { controls: this.#world.carControls(car), frame });
    }
  }

  #localState(): string {
    const c = this.#world.car(this.#localCar);
    return JSON.stringify([c.pos, c.vel, c.angVel, c.rot]);
  }

  /**
   * The server's state is for a frame this client hasn't reached: it fell behind real time (a stalled tab) and the
   * server, finding no input, repeated the last one and moved its frame count on (ServerConsume). Take the server's
   * state as the present and continue from its frame.
   */
  #resync(frame: number, states: readonly Uint8Array[]): void {
    const present = this.#recorded(this.#frame);
    const updated = this.#applyStates(states);
    if (!updated) {
      if (present) this.#world.loadState(present.snapshot);
      return;
    }
    this.#rebase(updated, frame);
    this.#history.fill(undefined);
    this.#frame = frame;
    this.#oldest = frame;
    this.#record(frame, NO_INPUT);
    this.stats.resyncs++;
  }

  /**
   * The set of cars changed: the server's full world after this client's frame `frame`. Older history no longer
   * matches the world (different cars), so corrections cannot reach before it.
   */
  reload(frame: number, snapshot: Uint8Array): void {
    const present = Math.max(this.#frame, frame);
    this.#world.loadState(snapshot);
    this.#remote.clear();
    for (const car of this.#world.carIds()) {
      if (car !== this.#localCar) this.#remote.set(car, { controls: this.#world.carControls(car), frame });
    }
    const inputs = new Map<number, InputFrame>();
    for (let f = frame + 1; f <= present; f++) inputs.set(f, this.#recorded(f)?.input ?? NO_INPUT);
    this.#history.fill(undefined);
    this.#frame = frame;
    this.#oldest = frame;
    this.#record(frame, NO_INPUT);
    for (let f = frame + 1; f <= present; f++) this.advance(inputs.get(f) ?? NO_INPUT);
  }
}
