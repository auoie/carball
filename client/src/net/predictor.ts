// Client prediction and rollback, as the game does it (notes/netcode.md): the client simulates ahead with its own
// inputs and keeps the world after every frame. When the server's state for one of its frames arrives, it loads its
// own world at that frame, puts in the server's state, and replays to the present with the inputs it recorded.
// Other cars as the game drives them (notes/netcode-live.md §4, the "game" model): every new frame takes their latest
// replicated throttle, steer and handbrake, and their other inputs from the frame before; when a car's state arrives
// with inputs other than those recorded for its frame, the recorded frames from there on are rewritten with them, the
// axes fading out over 0.1 s (InputFadeTime), and replayed. Their components (jump, dodge, boost, air control,
// auto-flip) don't run (the game's SimulatedProxy): those show only in the server's states. T5
// (src/net/remoteInputs.test.ts) compares it with the earlier "fade" model and with "gameComponents" (the game's rule,
// the components run on the server's jump and boost).
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

/** The game's history compare (0x140f64bf0): the handbrake, and each axis to 1e-8 */
function sameInputs(a: CarControls, b: CarControls): boolean {
  const near = (x: number, y: number): boolean => Math.abs(x - y) < 1e-8;
  return a.handbrake === b.handbrake && near(a.throttle, b.throttle) && near(a.steer, b.steer) && near(a.pitch, b.pitch) && near(a.yaw, b.yaw) && near(a.roll, b.roll);
}

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

/** How other cars are predicted (above) */
export type RemoteModel = "game" | "gameComponents" | "fade";

interface RecordedFrame {
  frame: number;
  snapshot: Uint8Array; // the world after this frame
  input: InputFrame; // the local player's input for this frame
  /** Each other car's controls for this frame (the "game" models) */
  remote: Map<number, CarControls>;
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
  /** Each other car's latest replicated controls (the server's, with the frame they belong to) */
  readonly #replicated = new Map<number, RemoteBase>();
  readonly #model: RemoteModel;
  readonly stats: PredictorStats = { corrections: 0, resimulatedFrames: 0, ignoredOld: 0, resyncs: 0, localMispredictions: 0 };
  /** The cars the last applied correction held (the network tests measure their corrections) */
  lastCars: ReadonlySet<number> = new Set();
  /** Called with each frame once the world holds its state: when first simulated, and again whenever a correction
   *  replays it (the goal replay's recording) */
  onFrame: ((frame: number) => void) | null = null;

  /** `world` already holds the state after `frame`. */
  constructor(world: World, localCarId: number, frame: number, model: RemoteModel = "game") {
    this.#world = world;
    this.#localCar = localCarId;
    this.#frame = frame;
    this.#oldest = frame;
    this.#model = model;
    this.#adoptCars(frame);
    this.#record(frame, NO_INPUT, this.#presentRemote());
  }

  /** The world's other cars (a new world): their components as the model has them, their controls the replicated ones */
  #adoptCars(frame: number): void {
    this.#replicated.clear();
    for (const car of this.#world.carIds()) {
      if (car === this.#localCar) continue;
      this.#world.setCarComponents(car, this.#model !== "game");
      this.#replicated.set(car, { controls: this.#world.carControls(car), frame });
    }
  }

  /** Each other car's controls as the world holds them now */
  #presentRemote(): Map<number, CarControls> {
    return new Map(this.#world.carIds().filter((car) => car !== this.#localCar).map((car) => [car, this.#world.carControls(car)]));
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

  #record(frame: number, input: InputFrame, remote: Map<number, CarControls>, server?: readonly Uint8Array[]): void {
    this.#history[this.#slot(frame)] = server
      ? { frame, snapshot: this.#world.saveState(), input, remote, server }
      : { frame, snapshot: this.#world.saveState(), input, remote };
    this.onFrame?.(frame);
  }

  /** Other cars' predicted controls at `frame`: the server's last values, axes fading out */
  #remoteControls(base: RemoteBase, frame: number): CarControls {
    // (a frame before the base, replayed for an older correction: the base's controls; the car's state is the
    // server's again at the base's frame)
    const keep = 1 - Math.min(1, Math.max(0, frame - base.frame) / INPUT_FADE_FRAMES);
    const c = base.controls;
    return { ...c, throttle: c.throttle * keep, steer: c.steer * keep, pitch: c.pitch * keep, yaw: c.yaw * keep, roll: c.roll * keep };
  }

  /** A frame: the local input, the other cars' (`recorded`: a replayed frame's, the "game" models), one step. The other
   *  cars' controls used */
  #simulate(frame: number, input: InputFrame, recorded?: ReadonlyMap<number, CarControls>): Map<number, CarControls> {
    this.#world.setControls(this.#localCar, inputControls(input));
    const used = new Map<number, CarControls>();
    if (this.#model === "fade") {
      for (const [car, base] of this.#remote) used.set(car, this.#remoteControls(base, frame));
    } else {
      for (const car of this.#world.carIds()) {
        if (car !== this.#localCar) used.set(car, recorded?.get(car) ?? this.#newFrameControls(car, frame));
      }
    }
    for (const [car, controls] of used) this.#world.setControls(car, controls);
    this.#world.step();
    return used;
  }

  /** Another car's controls on a new frame (the game's car PreAsyncTick): the replicated throttle, steer and handbrake
   *  (in full), the rest as the frame before left them (jump and boost too in "gameComponents") */
  #newFrameControls(car: number, frame: number): CarControls {
    const before = this.#recorded(frame - 1)?.remote.get(car) ?? this.#world.carControls(car);
    const replicated = this.#replicated.get(car)?.controls ?? before;
    return { ...before, ...this.#replicatedPart(replicated) };
  }

  /** What a car's replicated values set: its throttle, steer and handbrake; its boost button too, for the vehicle's
   *  throttle alone (boost held on the ground drives at full throttle: GA-1, which the game's server applies before it
   *  replicates the throttle; the Boost component is off); and its jump and dodge's forward input in "gameComponents" */
  #replicatedPart(c: CarControls): Partial<CarControls> {
    const part: Partial<CarControls> = { throttle: c.throttle, steer: c.steer, handbrake: c.handbrake, boost: c.boost };
    return this.#model === "gameComponents" ? { ...part, jump: c.jump, ...(c.dodgeForward === undefined ? {} : { dodgeForward: c.dodgeForward }) } : part;
  }

  /** One client frame with the local player's input (already quantized, as sent). */
  advance(input: InputFrame): void {
    const frame = this.#frame + 1;
    const remote = this.#simulate(frame, input);
    this.#frame = frame;
    this.#record(frame, input, remote);
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
    this.lastCars = updated;
    if (this.#model === "fade") this.#rebase(updated, frame);
    else this.#receiveRemote(updated, frame, present);
    this.#record(frame, at.input, at.remote, [...(at.server ?? []), ...states]);
    for (let f = frame + 1; f <= present; f++) {
      const recorded = this.#recorded(f);
      const input = recorded?.input ?? NO_INPUT;
      const remote = this.#simulate(f, input, recorded?.remote);
      if (recorded?.server) this.#applyStates(recorded.server); // (the newer states: they win for their bodies)
      this.#record(f, input, remote, recorded?.server);
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

  /**
   * The other cars in an update (the "game" models; the game's history compare on a car's receive): their replicated
   * values are the server's controls in it (an older update's don't replace a newer one's); the car's input now is
   * those over its present other inputs. If the frame's recorded controls differ from it (the handbrake, or any axis
   * by 1e-8), every recorded frame from there to the present gets it, the handbrake as it is, the axes fading out over
   * INPUT_FADE_FRAMES; the replay then drives them so.
   */
  #receiveRemote(cars: ReadonlySet<number>, frame: number, present: number): void {
    for (const car of cars) {
      if (car === this.#localCar) continue;
      const known = this.#replicated.get(car);
      if (known && known.frame > frame) continue;
      const server = this.#world.carControls(car);
      this.#replicated.set(car, { controls: server, frame });
      const current = { ...(this.#recorded(present)?.remote.get(car) ?? server), ...this.#replicatedPart(server) };
      const recorded = this.#recorded(frame)?.remote.get(car);
      if (recorded && sameInputs(recorded, current)) continue;
      for (let f = frame; f <= present; f++) {
        const entry = this.#recorded(f);
        if (!entry) continue;
        const keep = 1 - Math.min(1, (f - frame) / INPUT_FADE_FRAMES);
        const fade = (v: number): number => v * keep;
        entry.remote.set(car, {
          ...(entry.remote.get(car) ?? current),
          ...this.#replicatedPart(current),
          throttle: fade(current.throttle),
          steer: fade(current.steer),
          pitch: fade(current.pitch),
          yaw: fade(current.yaw),
          roll: fade(current.roll),
        });
      }
    }
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
    for (const car of updated) if (car !== this.#localCar) this.#replicated.set(car, { controls: this.#world.carControls(car), frame });
    this.#history.fill(undefined);
    this.#frame = frame;
    this.#oldest = frame;
    this.#record(frame, NO_INPUT, this.#presentRemote());
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
    this.#adoptCars(frame);
    this.#record(frame, NO_INPUT, this.#presentRemote());
    for (let f = frame + 1; f <= present; f++) this.advance(inputs.get(f) ?? NO_INPUT);
  }
}
