// The client's network session (notes/netcode-live.md §13.0): online.ts's network core without the DOM, so the network
// tests run the production code. Updates in (assembled from their parts, applied in order), the server's
// acknowledgement and the round trip (the ping), each correction applied through the predictor and smoothed for drawing
// (each body's drawn pose keeps where it was: SyncError), the hitch watch (the server's jitter buffer reset 2 s after a
// hitch), the inputs out (the frames the server hasn't acknowledged, newest 10). The cars and the ball it smooths are
// the game's (online.ts draws them); its I/O goes through a link (the connection, or a test's).
import { Quaternion } from "three";
import type { BodyState, CarState, World } from "../engine/world";
import { Interpolated } from "../game/interpolated";
import { SyncError } from "../game/syncError";
import { length, sub } from "../math/vec";
import { fromThreeQuaternion, toThreeQuaternion } from "../render/coords";
import { NO_INPUT, Predictor, type RemoteModel } from "./predictor";
import { type InputFrame, MAX_INPUT_FRAMES, type Update } from "./protocol";
import { type CompleteUpdate, UpdateAssembler } from "./updates";

/** Update parts kept while no frame is drawn (a hidden tab): about a second's worth */
const MAX_QUEUED_UPDATES = 120;
/** A frame this long is a hitch: the server's jitter buffer is reset this long after the last one (the game:
 *  NetworkInputBuffer_TA.ClientTick, "Hitch detected!", SetTimer(2, ServerResetInputBuffer)) */
const HITCH_SECONDS = 0.1;
const HITCH_RESET_DELAY = 2;
/** Samples of server tick − client frame kept (one per update: 20 s) */
const MAX_TICK_OFFSETS = 1200;

/** A car as drawn: its interpolated state and how far its drawn pose still is from its corrected one */
export interface SmoothedCar {
  readonly state: Interpolated<CarState>;
  readonly error: SyncError;
}

/** What the session sends and when it is (the connection and the page's clock; a test's) */
export interface SessionLink {
  sendInputs(timestamp: number, first: number, frames: InputFrame[]): void;
  resetInputBuffer(): void;
  /** Milliseconds, as performance.now() */
  nowMs(): number;
}

/** The network tests' measures (§13 T3): the frames replayed in each rendered frame and how far each body's state moved
 *  (the cars the server's states held; the ball at every replay) */
export interface SessionMetrics {
  readonly depths: number[];
  readonly localErrors: number[];
  readonly remoteErrors: number[];
  readonly ballErrors: number[];
  /** Updates applied (complete or flushed), and when (ms) */
  readonly applied: number[];
}

interface Captured {
  readonly cars: ReadonlyMap<number, CarState>;
  readonly ball: BodyState;
  readonly ballSpawns: number;
}

export class NetSession {
  readonly predictor: Predictor;
  readonly ball: Interpolated<BodyState>;
  readonly ballError = new SyncError();
  /** The ball's spawn counter last tick (a reset places it: not interpolated) */
  ballSpawns: number;
  /** The server's acknowledgement in its newest update (by its tick): after this client stalled it can be ahead of this
   *  client's frames (the server moved its count on), then come back to them as it consumes them (G7) */
  ackFrame = 0;
  #ackTick = -1;
  /** The round trip, smoothed (ms) */
  ping: number | null = null;
  bufferText = "";
  /** The connection closed: nothing more is sent */
  disconnected = false;
  /** Keep the measures (the tests) */
  measure = false;
  /** Replay after each update, as before G3 (the network tests' comparison) */
  replayEachUpdate = false;
  readonly metrics: SessionMetrics = { depths: [], localErrors: [], remoteErrors: [], ballErrors: [], applied: [] };
  readonly #world: World;
  readonly #localCar: number;
  readonly #cars: ReadonlyMap<number, SmoothedCar>;
  readonly #link: SessionLink;
  readonly #updates = new UpdateAssembler();
  readonly #received: Update[] = [];
  readonly #tickOffsets: { readonly serverTick: number; readonly offset: number }[] = [];
  #hitchReset: number | null = null; // seconds until the server's input buffer is reset after a hitch
  readonly #q1 = new Quaternion();
  readonly #q2 = new Quaternion();

  /** `world` holds the state after `frame`; `cars`: the cars drawn, by id (the session smooths them); `model`: how other
   *  cars are predicted (the game's; the network tests compare others) */
  constructor(world: World, localCar: number, frame: number, cars: ReadonlyMap<number, SmoothedCar>, link: SessionLink, model: RemoteModel = "game") {
    this.#world = world;
    this.#localCar = localCar;
    this.#cars = cars;
    this.#link = link;
    this.predictor = new Predictor(world, localCar, frame, model);
    this.ball = new Interpolated(world.ball());
    this.ballSpawns = world.ballSpawnCount();
  }

  /** An update part arrived (a hidden tab doesn't draw frames: only the newest second of them is kept, not a backlog to
   *  replay at once) */
  receive(update: Update): void {
    this.#received.push(update);
    if (this.#received.length > MAX_QUEUED_UPDATES) this.#received.splice(0, this.#received.length - MAX_QUEUED_UPDATES);
  }

  /** Each frame: the updates received since the last, staged, then one replay and one smoothing for all (G3: a burst
   *  of updates costs one resim, not one each) */
  applyUpdates(): void {
    const updates: CompleteUpdate[] = [];
    for (const part of this.#received.splice(0)) updates.push(...this.#updates.add(part));
    updates.push(...this.#updates.flush()); // (a part was lost: the others still apply)
    if (updates.length === 0) return;
    const pre = this.#capture();
    let depth = 0;
    for (const update of updates) {
      this.#stageUpdate(update);
      if (this.replayEachUpdate) depth += this.predictor.resimulate();
    }
    depth += this.predictor.resimulate();
    if (this.measure) this.metrics.depths.push(depth);
    this.#smooth(pre);
  }

  #stageUpdate(update: CompleteUpdate): void {
    const u = update.update;
    if (u.serverTick > this.#ackTick) {
      this.ackFrame = u.ackFrame;
      this.#ackTick = u.serverTick;
    }
    this.bufferText = `buffer ${String(u.bufferSize)}/${String(u.bufferTarget)}`;
    if (u.ackFrame > 0) {
      this.#tickOffsets.push({ serverTick: u.serverTick, offset: u.serverTick - u.ackFrame });
      if (this.#tickOffsets.length > MAX_TICK_OFFSETS) this.#tickOffsets.splice(0, this.#tickOffsets.length - MAX_TICK_OFFSETS);
    }
    if (u.echoTimestamp > 0) {
      const rtt = ((Math.round(this.#link.nowMs()) - u.echoTimestamp) >>> 0) - u.echoDelay;
      if (rtt >= 0 && rtt < 10_000) this.ping = this.ping === null ? rtt : this.ping + (rtt - this.ping) * 0.1;
    }
    if (this.measure) this.metrics.applied.push(this.#link.nowMs());
    this.predictor.stage(u.ackFrame, update.states);
  }

  /** The client frame a server tick corresponds to (from the acknowledgements' offsets) */
  frameAt(serverTick: number): number {
    let best = this.#tickOffsets.at(-1);
    for (const sample of this.#tickOffsets) {
      if (!best || Math.abs(sample.serverTick - serverTick) < Math.abs(best.serverTick - serverTick)) best = sample;
    }
    return serverTick - (best?.offset ?? 0);
  }

  /** A server correction, smoothed for drawing: each body's drawn pose keeps where it was and glides to the corrected
   *  one (SyncError); the interpolation's previous tick moves with the correction, so nothing jumps. A resync (the
   *  server's state ahead of this client) is smoothed the same way, as the game smooths every correction. */
  correct(frame: number, states: readonly Uint8Array[]): void {
    const pre = this.#capture();
    const depth = this.predictor.correct(frame, states);
    if (this.measure) this.metrics.depths.push(depth);
    this.#smooth(pre);
  }

  /** The set of cars changed: the server's full world after this client's `frame` (`syncCars`: the drawn cars follow
   *  the world's; those in both are smoothed from where they were drawn, as any correction) */
  reload(frame: number, snapshot: Uint8Array, syncCars: () => void): void {
    const pre = this.#capture();
    this.predictor.reload(frame, snapshot);
    syncCars();
    this.#smooth(pre);
  }

  /** Each body's present state, before a correction or reload */
  #capture(): Captured {
    return {
      cars: new Map([...this.#cars.keys()].map((id) => [id, this.#world.car(id)])),
      ball: this.#world.ball(),
      ballSpawns: this.#world.ballSpawnCount(),
    };
  }

  /** The world's present state changed from `pre`: carry the difference in each body's drawn pose */
  #smooth(pre: Captured): void {
    for (const [id, entry] of this.#cars) {
      const before = pre.cars.get(id);
      if (!before) continue; // (a car new in the world: drawn from its state)
      const after = this.#world.car(id);
      const moved = sub(before.pos, after.pos);
      // A new placement (a kickoff, a respawn: in the game a new actor) is drawn at once; every other correction,
      // however large, is smoothed (notes/netcode-audit.md NR-2)
      if (before.demoed || after.demoed || before.spawnCount !== after.spawnCount) {
        entry.error.clear();
        entry.state.previous = after;
      } else {
        // (each car the server's state held: the correction of its prediction)
        if (this.measure && this.predictor.lastCars.has(id)) (id === this.#localCar ? this.metrics.localErrors : this.metrics.remoteErrors).push(length(moved));
        entry.error.accumulate(before, after);
        // The previous tick moves with the correction, rotation included (prev' = post pre^-1 prev, as the game's
        // OldRBState): the drawn pose stays where it was
        const turn = toThreeQuaternion(after.rot, this.#q1).multiply(toThreeQuaternion(before.rot, this.#q2).invert());
        const prevRot = fromThreeQuaternion(turn.multiply(toThreeQuaternion(entry.state.previous.rot, this.#q2)));
        entry.state.previous = { ...entry.state.previous, pos: sub(entry.state.previous.pos, moved), rot: prevRot };
      }
      entry.state.current = after;
    }
    const ball = this.#world.ball();
    const moved = sub(pre.ball.pos, ball.pos);
    const teleport = this.#world.ballSpawnCount() !== pre.ballSpawns;
    if (teleport) {
      this.ballError.clear();
      this.ball.previous = ball;
    } else {
      if (this.measure) this.metrics.ballErrors.push(length(moved));
      // As a car's (NR-1): the error keeps the drawn pose, rotation included; the previous tick moves with the correction
      this.ballError.accumulate(pre.ball, ball);
      const turn = toThreeQuaternion(ball.rot, this.#q1).multiply(toThreeQuaternion(pre.ball.rot, this.#q2).invert());
      const prevRot = fromThreeQuaternion(turn.multiply(toThreeQuaternion(this.ball.previous.rot, this.#q2)));
      this.ball.previous = { ...this.ball.previous, pos: sub(this.ball.previous.pos, moved), rot: prevRot };
    }
    this.ball.current = ball;
    this.ballSpawns = this.#world.ballSpawnCount();
  }

  /** After a hitch the gap inflated the server's jitter buffer (one 300 ms gap: 7 -> 18 frames, ~40 s to come back):
   *  2 s after the last hitch the server resets it. `rawSeconds`: the frame's time */
  watchHitches(rawSeconds: number): void {
    const frameSeconds = Math.max(0, rawSeconds);
    if (frameSeconds > HITCH_SECONDS) this.#hitchReset = HITCH_RESET_DELAY;
    else if (this.#hitchReset !== null) {
      this.#hitchReset -= frameSeconds;
      if (this.#hitchReset <= 0) {
        this.#hitchReset = null;
        this.#link.resetInputBuffer();
      }
    }
  }

  /** The frames the server has not acknowledged yet, newest 10 at most (an acknowledgement past this client's frames, the
   *  server's count moved on while it stalled, acknowledges none of them: the newest 10) */
  sendInputs(): void {
    if (this.disconnected) return;
    const last = this.predictor.frame;
    const acked = this.ackFrame <= last ? this.ackFrame : 0;
    let first = Math.max(acked + 1, last - MAX_INPUT_FRAMES + 1);
    while (first <= last && !this.predictor.inputAt(first)) first++; // (history before a world reload is gone)
    const frames: InputFrame[] = [];
    for (let f = first; f <= last; f++) frames.push(this.predictor.inputAt(f) ?? NO_INPUT);
    if (frames.length > 0) this.#link.sendInputs(Math.round(this.#link.nowMs()), first, frames);
  }
}
