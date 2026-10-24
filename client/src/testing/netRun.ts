// A match over a simulated network path, in process (notes/netcode-live.md §13.0): the client's network core as it runs
// in the game (src/net/session.ts: the predictor, corrections and their smoothing, the inputs sent, the ping) against
// the server's own match: the local host's module (carball_host.wasm, src/local/host.ts: the server's match, its input
// buffer, its replication and the compact network state, compiled to WebAssembly), on a virtual clock. The local player
// and the host's bots (players of its match whose controls the drivers give, from the match's whole state after each
// tick, as the offline match's bots do) chase the ball, so they meet it and each other. The client joins as a page
// does (its hello, the welcome, the world again as the bots join), and every message between them is the protocol's.
import type createEngine from "@engine/carball_engine.mjs";
import { type BodyState, type CarState, World } from "../engine/world";
import { SendClock } from "../game/cameraInput";
import { postGoalDilation } from "../game/goalSequence";
import { Interpolated } from "../game/interpolated";
import { SyncError } from "../game/syncError";
import type { InputStats, LocalHost } from "../local/host";
import { FixedStep, frameTimes } from "../loop/fixedStep";
import { type RemoteModel, inputControls } from "../net/predictor";
import {
  BIT_BOOST,
  BIT_JUMP,
  type ControlMessage,
  type InputFrame,
  PROTOCOL_VERSION,
  type Update,
  decodeControl,
  decodeDatagram,
  encodeControl,
  encodeDatagram,
  quantizeAxis,
} from "../net/protocol";
import { NetSession, type SmoothedCar } from "../net/session";
import { NetSim, Pcg32, type Profile } from "./netsim";

type Engine = Awaited<ReturnType<typeof createEngine>>;

/** The client's player in the host's match (the bots' 2 on) */
const CLIENT = 1;

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
  /** The server's input buffer as its updates tell it (each update's window since the last, once an update: its parts
   *  carry the same, RV-1039; summed over the measured span, HUD-21): its target at the end, the ticks it had no frame for
   *  (under), the frames it skipped (over), the client's input datagrams it never got (lost, of `sent`), and the ticks
   *  measured */
  readonly buffer: {
    readonly target: number;
    readonly under: number;
    readonly over: number;
    readonly lost: number;
    readonly sent: number;
    readonly ticks: number;
  };
  /** Downstream, what the client received a second (KB, the update datagrams) */
  readonly downKBps: number;
  /** The server's input buffer target each second (from the start) and the resets it got */
  readonly bufferTargets: readonly number[];
  readonly resets: number;
  /** States applied at the present, not replayed (G5, G7) */
  readonly direct: number;
  /** Local mispredictions in the run's last 5 s */
  readonly lateMispredictions: number;
  /** The match's phases as the client was told them, each with when (s) */
  readonly phases: readonly { readonly at: number; readonly phase: string }[];
  /** Every correction's size, per class (uu) */
  readonly errors: { readonly local: readonly number[]; readonly remote: readonly number[]; readonly ball: readonly number[] };
  /** How far corrections moved each class a second, all summed (uu/s; the per-correction sizes depend on how often a
   *  body's state comes, this doesn't) */
  readonly movedPerSecond: { readonly local: number; readonly remote: number; readonly ball: number };
  /** The server's own input buffer counters for the client at the end, the whole run's (the host's: RV-1034) */
  readonly serverInput: InputStats | null;
}

export interface NetRunOptions {
  readonly seconds: number;
  readonly up: Profile;
  readonly down: Profile;
  readonly seed: number;
  /** Seconds not measured at the start (the buffer's warm-up, the client joining the server's timeline) */
  readonly warmUp?: number;
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
  /** The page's frame rate (its display's: 60 by default; 59.94, 144) and its frames' jitter (ms, normal: 0 by
   *  default), the game's fixed step taking what each frame's time gives (RV-1033) */
  readonly frameHz?: number;
  readonly frameJitterMs?: number;
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

/** A driver that circles where it is, never near the ball: the network alone, no goal's sequence in the run (T7, T8) */
export const circleDriver: Driver = () => ({ throttle: quantizeAxis(0.6), steer: quantizeAxis(1), pitch: 0, yaw: 0, roll: 0, dodgeForward: 0, bits: 0 });

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

interface InFlight<T> {
  readonly at: number;
  readonly value: T;
}

function deliver<T>(queue: InFlight<T>[], now: number): T[] {
  return deliverTimed(queue, now).map((d) => d.value);
}

/** The same, each with the time it arrived */
function deliverTimed<T>(queue: InFlight<T>[], now: number): InFlight<T>[] {
  const due = queue.filter((d) => d.at <= now).sort((a, b) => a.at - b.at);
  for (const d of due) queue.splice(queue.indexOf(d), 1);
  return due;
}

/** A page's hello, joining the open match on `team` */
function hello(team: number, name: string): Uint8Array {
  return encodeControl({
    type: "hello",
    version: PROTOCOL_VERSION,
    team,
    model: 0,
    dodgeDeadzone: 0.5,
    steeringSensitivity: 1,
    airControlSensitivity: 1,
    autoSkipReplay: true,
    key: 0n,
    name,
    quickChat: "everyone",
    blockNonTactical: false,
    intent: "join",
    playlist: 0,
    token: 0n,
    ticket: "",
  });
}

const RESET_INPUT_BUFFER = encodeControl({ type: "resetInputBuffer" });
/** A frame's inputs while the match is frozen (online.ts: the replay, the podium, its end) */
const NO_INPUT: InputFrame = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, dodgeForward: 0, bits: 0 };
const NO_CONTROLS = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };

/** The run, on the host's match: `host` the local host's module set up (LocalHost.create), its match opened anew */
export function netRun(engine: Engine, host: LocalHost, options: NetRunOptions): NetRunResult {
  const players = options.players ?? 2;
  const drive = options.drive ?? chaseDriver;
  // (the match: as many a side as the players need; the client's player first, then the bots, the teams alternating)
  host.open(Math.max(1, Math.ceil(players / 2)), options.seed);
  const bots = Array.from({ length: players - 1 }, (_, i) => CLIENT + 1 + i);
  host.connect(CLIENT);
  host.control(CLIENT, hello(0, "Client"), 0);
  bots.forEach((id, i) => {
    host.connect(id);
    host.control(id, hello((i + 1) % 2, `Bot ${String(i + 1)}`), 0);
    host.bot(id, NO_CONTROLS);
  });
  const joined = host.drain().flatMap((m) => (m.id === CLIENT && m.kind === "control" ? [decodeControl(m.bytes.subarray(2))] : []));
  const welcome = joined.find((m) => m.type === "welcome");
  if (welcome?.type !== "welcome") throw new Error("the host didn't welcome the client");
  const client = World.create(engine);
  client.loadState(welcome.snapshot);
  client.setDemolitions(false); // (as online.ts: the server's demolitions only)
  const local = welcome.carId;
  const cars = new Map<number, SmoothedCar>();
  /** The client's cars as its world has them (the world again: the bots' joined) */
  const syncCars = (): void => {
    for (const id of client.carIds()) if (!cars.has(id)) cars.set(id, { state: new Interpolated(client.car(id)), error: new SyncError() });
    for (const id of [...cars.keys()]) if (!client.carIds().includes(id)) cars.delete(id);
  };
  syncCars();
  /** The match's whole state after each tick, as the bots see it (the offline match's: src/local/bots.ts) */
  const botWorld = World.create(engine);

  let clock = 0; // virtual time (s)
  const upPath = new NetSim(options.up, options.seed);
  const downPath = new NetSim(options.down, options.seed + 1);
  // (the reliable streams' paths: the same delays and stalls, nothing lost or twice (QUIC resends), in order: RV-1033)
  const reliable = (p: Profile): Profile => ({ ...p, loss: { kind: "none" }, duplicate: 0, outages: [] });
  const streamUp = new NetSim(reliable(options.up), options.seed + 2);
  const streamDown = new NetSim(reliable(options.down), options.seed + 3);
  const streamAt = { up: 0, down: 0 };
  const toServer: InFlight<Uint8Array>[] = [];
  const toClient: InFlight<Update>[] = [];
  const controls: InFlight<ControlMessage>[] = []; // (the server's control messages on their way down)
  const resets: number[] = []; // (the reset requests on their way up)
  let resetsDone = 0;
  const bufferTargets: number[] = [];
  // (in an object: set in the host's tick, a closure, which the compiler's narrowing doesn't follow)
  const late: { from: number | null } = { from: null };
  let lastFrameAt = 0;
  let sequence = 0;
  let sent = 0;
  const session = new NetSession(
    client,
    local,
    welcome.frame,
    cars,
    {
      sendInputs: (timestamp, firstFrame, frames) => {
        const bytes = encodeDatagram({ type: "inputs", timestamp, sequence: sequence++ & 0xffff, firstFrame, frames });
        if (clock >= (options.warmUp ?? 3)) sent++;
        for (const at of upPath.send(clock)) toServer.push({ at, value: bytes });
      },
      // (a reliable control message: never lost, RV-337; its stream's delay, RV-1033)
      resetInputBuffer: () => {
        streamAt.up = Math.max(streamAt.up, streamUp.send(clock)[0] ?? clock);
        resets.push(streamAt.up);
      },
      nowMs: () => clock * 1000,
    },
    options.model ?? "game",
  );
  session.replayEachUpdate = options.replayEachUpdate ?? false;
  const warmUp = options.warmUp ?? 3;
  let downBytes = 0;
  const buffer = { target: 0, under: 0, over: 0, lost: 0 };
  let measuredTicks = 0;
  let mispredictionsFrom = 0;
  let correctionsFrom = 0;
  let measuring = false;
  const phases: { at: number; phase: string }[] = [];

  // (the client paced as a page: a rendered frame each 1/60 s of real time, its ticks from the game's fixed step, slowed
  // after a goal by its curve, its input packets at 60 Hz of real time: online.ts's #frame)
  const fixedStep = new FixedStep();
  const sendClock = new SendClock();
  let goalTick: number | null = null;
  let phase: string | null = null;
  const clientFrame = (): void => {
    const stalled = (options.clientStalls ?? []).some((st) => clock >= st.atS && clock < st.atS + st.seconds);
    for (const u of deliver(toClient, clock)) session.receive(u);
    if (stalled) return; // (no frame drawn: its updates queue, the next a hitch)
    // (the control messages come in at the page's frame, before its updates apply: online.ts's #frame, RV-1033)
    for (const c of deliver(controls, clock)) {
      if (c.type === "world") session.reload(c.frame, c.snapshot, syncCars);
      else if (c.type === "event" && c.event.kind === "goal") goalTick = c.serverTick;
      else if (c.type === "match" && c.phase !== phase) {
        phase = c.phase;
        phases.push({ at: clock, phase: c.phase });
      }
    }
    const raw = clock - lastFrameAt;
    session.applyUpdates();
    session.watchHitches(raw);
    lastFrameAt = clock;
    const goalFrame = goalTick === null ? null : session.frameAt(goalTick);
    const dilation = goalFrame === null ? 1 : postGoalDilation(session.predictor.frame + 1 - goalFrame);
    const { world } = frameTimes(raw, dilation);
    const ticks = fixedStep.advance(world);
    const frozen = phase === "prePodium" || phase === "finished" || phase === "replay";
    for (let k = 0; k < ticks; k++) session.predictor.advance(frozen ? NO_INPUT : drive(0, session.predictor.frame + 1, client, local));
    if (sendClock.due(world / dilation)) session.sendInputs();
  };

  // The host's tick: what arrived on the way up (each at its own time), the tick, its messages to the client on their
  // way down; the bots' controls for the next tick from the match's state after this one
  let second = 0;
  const hostTick = (): void => {
    if (clock >= warmUp && !measuring) {
      measuring = true;
      mispredictionsFrom = session.predictor.stats.localMispredictions;
      correctionsFrom = session.predictor.stats.corrections;
    }
    // (the corrections measured in play alone: a goal's slow motion, its countdown and the replay are the match's, not
    // the prediction's)
    session.measure = measuring && phase === "active";
    for (const at of resets.filter((r) => r <= clock)) {
      resets.splice(resets.indexOf(at), 1);
      host.control(CLIENT, RESET_INPUT_BUFFER, at);
      resetsDone++;
    }
    // (the server's game thread reads a session's inputs once a pass, a pass a tick: every datagram that came since, in
    // order, each with its arrival time, as the game takes every packet (its InputSlot's eight a pass, a bound only a
    // flood reaches: RV-991, RV-1151))
    for (const d of deliverTimed(toServer, clock)) host.datagram(CLIENT, d.value, d.at);
    host.tick(clock);
    if (measuring) measuredTicks++;
    if (late.from === null && clock >= options.seconds - 5) late.from = session.predictor.stats.localMispredictions;
    for (const m of host.drain()) {
      if (m.id !== CLIENT || m.kind === "end") continue;
      if (m.kind === "control") {
        streamAt.down = Math.max(streamAt.down, streamDown.send(clock)[0] ?? clock);
        controls.push({ at: streamAt.down, value: decodeControl(m.bytes.subarray(2)) });
        continue;
      }
      const u = decodeDatagram(m.bytes);
      if (u.type !== "update") continue;
      buffer.target = u.bufferTarget;
      if (measuring) {
        // (an update's window once: each of its parts carries it, RV-1039)
        if (u.part === 0) {
          buffer.under += u.bufferUnder;
          buffer.over += u.bufferOver;
          buffer.lost += u.inputLoss;
        }
        downBytes += m.bytes.byteLength;
      }
      for (const at of downPath.send(clock)) toClient.push({ at, value: u });
    }
    // (the server's buffer target each second of real time)
    while (clock >= second + 1) {
      second++;
      bufferTargets.push(buffer.target);
    }
    if (bots.length > 0) {
      botWorld.loadState(host.state(CLIENT));
      bots.forEach((id, i) => {
        const car = host.car(id);
        if (car !== null) host.bot(id, inputControls(drive(i + 1, botWorld.tick + 1, botWorld, car)));
      });
    }
  };

  // (both on one virtual clock: the client's frame first when they fall together, as a page's frame before the server
  // hears it; the page's frames at its display's rate, jittered as asked, RV-1033)
  const frameRng = new Pcg32(BigInt(options.seed), 77n);
  const frameSeconds = 1 / (options.frameHz ?? 60);
  const frameGap = (): number => Math.max(0.001, frameSeconds + ((options.frameJitterMs ?? 0) / 1000) * frameRng.normal());
  for (let frameAt = frameGap(); ;) {
    const tickAt = host.nextTick();
    if (tickAt === null) break;
    if (frameAt <= tickAt + 1e-9) {
      if (frameAt > options.seconds + 1e-9) break;
      clock = frameAt;
      frameAt += frameGap();
      clientFrame();
    } else {
      if (tickAt > options.seconds + 1e-9) break;
      clock = tickAt;
      hostTick();
    }
  }

  const measuredSeconds = Math.max(1e-9, options.seconds - warmUp);
  const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
  const result: NetRunResult = {
    local: summary(session.metrics.localErrors),
    remote: summary(session.metrics.remoteErrors),
    ball: summary(session.metrics.ballErrors),
    corrections: session.metrics.depths.length,
    updates: session.predictor.stats.corrections - correctionsFrom,
    localMispredictions: session.predictor.stats.localMispredictions - mispredictionsFrom,
    depth: summary(session.metrics.depths),
    ping: session.ping,
    buffer: { ...buffer, sent, ticks: measuredTicks },
    downKBps: downBytes / measuredSeconds / 1000,
    errors: { local: session.metrics.localErrors, remote: session.metrics.remoteErrors, ball: session.metrics.ballErrors },
    bufferTargets,
    phases,
    resets: resetsDone,
    direct: session.predictor.stats.direct,
    lateMispredictions: session.predictor.stats.localMispredictions - (late.from ?? 0),
    movedPerSecond: {
      local: sum(session.metrics.localErrors) / measuredSeconds,
      remote: sum(session.metrics.remoteErrors) / measuredSeconds,
      ball: sum(session.metrics.ballErrors) / measuredSeconds,
    },
    serverInput: host.inputStats(CLIENT),
  };
  botWorld.dispose();
  client.dispose();
  return result;
}
