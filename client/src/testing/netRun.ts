// A 1v1 over a simulated network path, in process (notes/netcode-live.md §13.0): the client's network core as it runs
// in the game (src/net/session.ts: the predictor, corrections and their smoothing, the inputs sent, the ping) against
// a server built from the same parts as the real one: the engine, its input buffer (serverConsume.ts, the Rust one's
// port), updates every other tick with the actors due at the game's rates (server/src/replication.rs), the compact
// network state. The local player and a server-side bot both chase the ball, so they meet it and each other.
import type createEngine from "@engine/carball_engine.mjs";
import { type BodyState, type CarState, World } from "../engine/world";
import { Interpolated } from "../game/interpolated";
import { SyncError } from "../game/syncError";
import { type RemoteModel, inputControls } from "../net/predictor";
import { BIT_BOOST, BIT_JUMP, type InputFrame, type Update, quantizeAxis } from "../net/protocol";
import { NetSession, type SmoothedCar } from "../net/session";
import { NetSim, Pcg32, type Profile } from "./netsim";
import { ServerConsume } from "./serverConsume";
import { UPDATE_HEADER_BYTES } from "../net/netStats";

type Engine = Awaited<ReturnType<typeof createEngine>>;

const TICK = 1 / 120;
/** An update datagram's bytes before its state (protocol 24: net/netStats.ts UPDATE_HEADER_BYTES) */
const UPDATE_HEADER = UPDATE_HEADER_BYTES;

/** count, mean, median, 95th and 99th percentiles, largest */
export interface Summary {
  readonly count: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export function summary(values: readonly number[]): Summary {
  if (values.length === 0) return { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  return { count: values.length, mean, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) ?? 0 };
}

/** A car's input for a frame (120 a second): `player` 0 is the client's (its world: the client's prediction), the
 *  others the server's (its world) */
export type Driver = (player: number, frame: number, world: World, car: number) => InputFrame;

export interface NetRunResult {
  /** How far each correction moved the local car's, the bot's and the ball's present state (uu), after the warm-up */
  readonly local: Summary;
  readonly remote: Summary;
  readonly ball: Summary;
  /** Replays (one a rendered frame at most: G3) */
  readonly corrections: number;
  /** Updates applied (each staged into the history; one replay takes every update of its frame) */
  readonly updates: number;
  /** Corrections that changed the local car's present state */
  readonly localMispredictions: number;
  /** Frames replayed in each rendered frame that had updates */
  readonly depth: Summary;
  /** The client's smoothed round trip at the end (ms) */
  readonly ping: number | null;
  /** The server's input buffer: its target at the end, and per tick of the measured span */
  readonly buffer: { readonly target: number; readonly under: number; readonly over: number; readonly repeated: number; readonly zeroed: number; readonly neverConsumed: number; readonly ticks: number };
  /** Downstream, what the client received a second (KB, the update datagrams) */
  readonly downKBps: number;
  /** The server's input buffer target each second (from the start) and the resets it got */
  readonly bufferTargets: readonly number[];
  readonly resets: number;
  /** States applied at the present, not replayed (G5, G7) */
  readonly direct: number;
  /** Local mispredictions in the run's last 5 s */
  readonly lateMispredictions: number;
  /** Every correction's size, per class (uu) */
  readonly errors: { readonly local: readonly number[]; readonly remote: readonly number[]; readonly ball: readonly number[] };
  /** How far corrections moved each class a second, all summed (uu/s; the per-correction sizes depend on how often a
   *  body's state comes, this doesn't) */
  readonly movedPerSecond: { readonly local: number; readonly remote: number; readonly ball: number };
}

export interface NetRunOptions {
  readonly seconds: number;
  readonly up: Profile;
  readonly down: Profile;
  readonly seed: number;
  /** Seconds not measured at the start (the buffer's warm-up, the client joining the server's timeline) */
  readonly warmUp?: number;
  /** As before G1: the exact network state, the ball in every update, cars within 1000 uu of it too, the others and
   *  the pads every 8 ticks */
  readonly legacy?: boolean;
  /** Cars (the client's first, then the teams alternating): 2 by default */
  readonly players?: number;
  /** The cars' inputs (default: the client chases the ball, the others chase it with a weave) */
  readonly drive?: Driver;
  /** How the client predicts the other cars (default: the game's) */
  readonly model?: RemoteModel;
  /** Replay after each update, as before G3 */
  readonly replayEachUpdate?: boolean;
  /** Spans the client draws no frame (a hidden tab, a stall: its updates queue; the next frame is a hitch) */
  readonly clientStalls?: readonly { readonly atS: number; readonly seconds: number }[];
}

/** The default drivers: the client chases the ball as it predicts it; the others chase it with a weave (a bot) */
const chaseDriver: Driver = (player, frame, world, car) => {
  const c = player === 0 ? chase(world.car(car), world.ball(), frame, 0) : chase(world.car(car), world.ball(), world.tick, Math.sin(world.tick / 37) * 0.6);
  return {
    throttle: quantizeAxis(c.throttle),
    steer: quantizeAxis(c.steer),
    pitch: 0,
    yaw: quantizeAxis(c.steer),
    roll: 0,
    dodgeForward: 0,
    bits: (c.boost ? BIT_BOOST : 0) | (c.jump ? BIT_JUMP : 0),
  };
};

/** Before G1's schedule */
function legacyChoice(world: World): { ball: boolean; cars: number[]; pads: boolean } {
  const slow = world.tick % 8 === 0;
  const ball = world.ball().pos;
  const near = (id: number) => {
    const p = world.car(id).pos;
    return Math.hypot(p.x - ball.x, p.y - ball.y, p.z - ball.z) <= 1000;
  };
  return { ball: true, cars: world.carIds().filter((id) => slow || near(id)), pads: slow };
}

/** Steer toward the ball (yaw error over 30°: full lock), boost when roughly facing it, jump when close */
function chase(car: CarState, ball: BodyState, frame: number, jitter: number): { throttle: number; steer: number; boost: boolean; jump: boolean } {
  const dx = ball.pos.x - car.pos.x;
  const dy = ball.pos.y - car.pos.y;
  const angle = Math.atan2(dy, dx) - Math.atan2(car.rot.forward.y, car.rot.forward.x);
  const yaw = Math.atan2(Math.sin(angle), Math.cos(angle));
  const steer = Math.max(-1, Math.min(1, yaw / (Math.PI / 6) + jitter));
  const near = Math.hypot(dx, dy, ball.pos.z - car.pos.z) < 300;
  return { throttle: 1, steer, boost: Math.abs(yaw) < 0.3 && car.boost > 10, jump: near && frame % 90 < 6 };
}

/** The server's replication schedule (server/src/replication.rs): the ball at 100 with the net tick's jitter, a car
 *  4 or 5 updates apart (the replays' 13.4 a second); the ball forced after a hit, a car on a placement; the pads on a
 *  change and once a second */
class Schedule {
  #ballNext = 0;
  readonly #carNext = new Map<number, number>();
  #touch = -1;
  readonly #spawns = new Map<number, number>();
  #pads = "";
  #padsNext = 0;
  readonly #rng: Pcg32;

  constructor(seed: number) {
    this.#rng = new Pcg32(BigInt(seed), 99n);
  }

  choose(world: World, t: number): { ball: boolean; cars: number[]; pads: boolean } {
    const touch = Math.max(-1, ...world.carIds().map((id) => world.carLastBallTouchTick(id) ?? -1));
    const ball = touch !== this.#touch || t >= this.#ballNext;
    this.#touch = touch;
    if (ball) this.#ballNext = t + 1 / 100 + this.#rng.uniform() / 57;
    const cars: number[] = [];
    for (const id of world.carIds()) {
      const spawns = world.car(id).spawnCount;
      if (spawns !== this.#spawns.get(id) || t >= (this.#carNext.get(id) ?? 0) - 1e-9) {
        cars.push(id);
        this.#carNext.set(id, t + (this.#rng.uniform() < 0.52 ? 8 : 10) / 120);
      }
      this.#spawns.set(id, spawns);
    }
    const padState = world.boostPads().map((p) => (p.active ? "1" : "0")).join("");
    const pads = padState !== this.#pads || t >= this.#padsNext;
    if (pads) {
      this.#pads = padState;
      this.#padsNext = t + 1;
    }
    return { ball, cars, pads };
  }
}

interface InFlight<T> {
  readonly at: number;
  readonly value: T;
}

function deliver<T>(queue: InFlight<T>[], now: number): T[] {
  const due = queue.filter((d) => d.at <= now).sort((a, b) => a.at - b.at);
  for (const d of due) queue.splice(queue.indexOf(d), 1);
  return due.map((d) => d.value);
}

export function netRun(engine: Engine, options: NetRunOptions): NetRunResult {
  const server = World.create(engine);
  const players = options.players ?? 2;
  const drive = options.drive ?? chaseDriver;
  const ids = Array.from({ length: players }, (_, i) => server.addCar(i % 2 === 0 ? 0 : 1));
  const local = ids[0] ?? 0;
  server.resetKickoff(options.seed % 5);
  const client = World.create(engine);
  client.loadState(server.saveState());
  client.setDemolitions(false); // (as online.ts: the server's demolitions only)

  const cars = new Map<number, SmoothedCar>(ids.map((id) => [id, { state: new Interpolated(client.car(id)), error: new SyncError() }]));
  let clock = 0; // virtual time (s)
  const upPath = new NetSim(options.up, options.seed);
  const downPath = new NetSim(options.down, options.seed + 1);
  const toServer: InFlight<{ timestamp: number; first: number; frames: InputFrame[] }>[] = [];
  const toClient: InFlight<Update>[] = [];
  const resets: number[] = []; // (the reset requests on their way up)
  let resetsDone = 0;
  const bufferTargets: number[] = [];
  let lateFrom: number | null = null;
  let lastFrameAt = 0;
  const session = new NetSession(
    client,
    local,
    0,
    cars,
    {
      sendInputs: (timestamp, first, frames) => {
        for (const at of upPath.send(clock)) toServer.push({ at, value: { timestamp, first, frames } });
      },
      // (a reliable control message: never lost, RV-337)
      resetInputBuffer: () => {
        resets.push(clock + options.up.baseMs / 1000);
      },
      nowMs: () => clock * 1000,
    },
    options.model ?? "game",
  );
  session.replayEachUpdate = options.replayEachUpdate ?? false;
  const consume = new ServerConsume();
  const schedule = new Schedule(options.seed);
  let echo: { timestamp: number; at: number } | null = null;
  let heardAt = 0;
  let explodedAt = -1;
  const warmUp = options.warmUp ?? 3;
  let downBytes = 0;
  let measuredFrom: { readonly under: number; readonly over: number; readonly repeated: number; readonly zeroed: number; readonly neverConsumed: number } | null = null;
  let measuredTicks = 0;
  let mispredictionsFrom = 0;
  let correctionsFrom = 0;

  const ticks = Math.round(options.seconds * 120);
  for (let n = 1; n <= ticks; n++) {
    clock = n * TICK;
    const measuring = clock >= warmUp;
    if (measuring && !measuredFrom) {
      measuredFrom = { ...consume.stats };
      mispredictionsFrom = session.predictor.stats.localMispredictions;
      correctionsFrom = session.predictor.stats.corrections;
      session.measure = true;
    }

    // The client: a rendered frame every other tick (60 fps): the updates in, two frames ahead, the inputs out (none
    // while it stalls: its updates queue)
    const stalled = (options.clientStalls ?? []).some((st) => clock >= st.atS && clock < st.atS + st.seconds);
    if (stalled) for (const u of deliver(toClient, clock)) session.receive(u);
    if (n % 2 === 0 && !stalled) {
      for (const u of deliver(toClient, clock)) session.receive(u);
      session.applyUpdates();
      session.watchHitches(clock - lastFrameAt);
      lastFrameAt = clock;
      for (let k = 0; k < 2; k++) session.predictor.advance(drive(0, session.predictor.frame + 1, client, local));
      session.sendInputs();
    }

    // The server's tick: the inputs that arrived, one frame consumed, the bot, the physics, an update every other tick
    for (const at of resets.filter((r) => r <= clock)) {
      resets.splice(resets.indexOf(at), 1);
      consume.jitter.reset();
      resetsDone++;
    }
    if (n % 120 === 0) bufferTargets.push(consume.jitter.bufferSize);
    if (lateFrom === null && clock >= options.seconds - 5) lateFrom = session.predictor.stats.localMispredictions;
    for (const p of deliver(toServer, clock)) {
      heardAt = clock;
      if (consume.receive(p.timestamp, p.first, p.frames, clock)) echo = { timestamp: p.timestamp, at: clock };
    }
    const consumed = consume.tick(clock, server.tick % 2 === 1);
    server.setControls(local, inputControls(consumed.frame));
    ids.forEach((car, player) => {
      if (player > 0) server.setControls(car, inputControls(drive(player, server.tick + 1, server, car)));
    });
    server.step();
    // (a goal: the next kickoff a second later, a placement the updates carry)
    if (server.ballExploded()) {
      if (explodedAt < 0) explodedAt = server.tick;
      else if (server.tick - explodedAt > 120) {
        server.resetKickoff((server.tick % 4) + 1);
        explodedAt = -1;
      }
    }
    if (measuring) measuredTicks++;
    if (server.tick % 2 === 0) {
      const chosen = options.legacy ? legacyChoice(server) : schedule.choose(server, server.tick / 120);
      const state = server.writeNetState({ ball: chosen.ball, carIds: chosen.cars, pads: chosen.pads, exact: options.legacy ?? false });
      const update: Update = {
        serverTick: server.tick,
        ackFrame: consume.ackFrame,
        receivedFrame: consume.lastReceived,
        echoTimestamp: echo?.timestamp ?? 0,
        echoDelay: echo ? Math.round((clock - echo.at) * 1000) : 0,
        bufferTarget: Math.min(255, consume.jitter.bufferSize),
        bufferSize: Math.min(255, consume.length),
        bufferLow: 0,
        bufferHigh: 0,
        bufferOver: 0,
        bufferUnder: 0,
        inputLoss: 0,
        part: 0,
        parts: 1,
        state,
      };
      // (none to a client silent 1.5 s: the server's G8, RV-337)
      if (clock - heardAt < 1.5) {
        if (measuring) downBytes += state.length + UPDATE_HEADER;
        for (const at of downPath.send(clock)) toClient.push({ at, value: update });
      }
    }
  }

  const measuredSeconds = Math.max(1e-9, options.seconds - warmUp);
  const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
  const s = consume.stats;
  const from = measuredFrom ?? { under: 0, over: 0, repeated: 0, zeroed: 0, neverConsumed: 0 };
  const result: NetRunResult = {
    local: summary(session.metrics.localErrors),
    remote: summary(session.metrics.remoteErrors),
    ball: summary(session.metrics.ballErrors),
    corrections: session.metrics.depths.length,
    updates: session.predictor.stats.corrections - correctionsFrom,
    localMispredictions: session.predictor.stats.localMispredictions - mispredictionsFrom,
    depth: summary(session.metrics.depths),
    ping: session.ping,
    buffer: {
      target: consume.jitter.bufferSize,
      under: s.under - from.under,
      over: s.over - from.over,
      repeated: s.repeated - from.repeated,
      zeroed: s.zeroed - from.zeroed,
      neverConsumed: s.neverConsumed - from.neverConsumed,
      ticks: measuredTicks,
    },
    downKBps: downBytes / Math.max(1e-9, options.seconds - warmUp) / 1000,
    errors: { local: session.metrics.localErrors, remote: session.metrics.remoteErrors, ball: session.metrics.ballErrors },
    bufferTargets,
    resets: resetsDone,
    direct: session.predictor.stats.direct,
    lateMispredictions: session.predictor.stats.localMispredictions - (lateFrom ?? 0),
    movedPerSecond: {
      local: sum(session.metrics.localErrors) / measuredSeconds,
      remote: sum(session.metrics.remoteErrors) / measuredSeconds,
      ball: sum(session.metrics.ballErrors) / measuredSeconds,
    },
  };
  server.dispose();
  client.dispose();
  return result;
}
