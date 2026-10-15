// The client's prediction and rollback against a simulated server, using the real engine (Node build).
// Network: inputs arrive 6 ticks (50 ms) after they are sent, updates 6 ticks after; the server consumes one input
// frame per tick from a small buffer and sends the world every other tick, as the real server does.
import createEngine from "@engine/carball_engine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { type CarControls, World, initEngine } from "../engine/world";
import { HISTORY_FRAMES, NO_INPUT, Predictor, inputControls } from "./predictor";
import { BIT_BOOST, BIT_JUMP, type InputFrame, quantizeAxis } from "./protocol";
import { arenaMeshes } from "../testing/arena";
let engine: Awaited<ReturnType<typeof createEngine>>;

beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, arenaMeshes());
});

const UP = 6;
const DOWN = 6;
const BUFFER = 2;

/** The local player's scripted input for a frame: drives in circles, jumps and boosts now and then */
function localInput(frame: number): InputFrame {
  return {
    throttle: 127,
    steer: quantizeAxis(Math.sin(frame / 40)),
    pitch: 0,
    yaw: 0,
    roll: 0,
    dodgeForward: 0,
    bits: (frame % 90 < 3 ? BIT_JUMP : 0) | (frame % 50 < 20 ? BIT_BOOST : 0),
  };
}

/** The other car (a bot on the server): changes its steering every half second, which the client cannot predict */
function botControls(tick: number): CarControls {
  return { ...inputControls(NO_INPUT), throttle: 1, steer: Math.floor(tick / 60) % 2 === 0 ? 1 : -1 };
}

interface Delivery<T> {
  readonly at: number;
  readonly value: T;
}

interface ServerUpdate {
  readonly ackFrame: number;
  readonly state: Uint8Array;
}

/** `stall`: client ticks during which the client doesn't run (a stalled tab) while the server goes on */
function run(ticks: number, lossEvery = 0, stall: readonly [number, number] = [0, 0]) {
  const server = World.create(engine);
  const local = server.addCar(0);
  const bot = server.addCar(1);
  server.resetKickoff(4);

  const client = World.create(engine);
  client.loadState(server.saveState());
  const predictor = new Predictor(client, local, 0);

  const toServer: Delivery<{ frame: number; input: InputFrame }>[] = [];
  const toClient: Delivery<ServerUpdate>[] = [];
  const serverQueue: { frame: number; input: InputFrame }[] = [];
  const serverLocalPosAt = new Map<number, string>(); // client frame -> server's position of the local car after it
  const clientLocalPosAt = new Map<number, string>(); // client frame -> where the client predicted it
  let lastConsumed = 0;
  let started = false;
  let largestCorrectionMove = 0; // after the first correction (which syncs the client to the server's timeline)
  let largestBotCorrection = 0;
  let firstAck = 0;
  let syncedAt = 0; // the client frame when the first correction arrived

  for (let t = 1; t <= ticks; t++) {
    // Client: one frame ahead with its own input
    const stalled = t >= stall[0] && t < stall[1];
    if (!stalled) {
      const input = localInput(t);
      predictor.advance(input);
      clientLocalPosAt.set(predictor.frame, JSON.stringify(client.car(local).pos));
      toServer.push({ at: t + UP, value: { frame: predictor.frame, input } });
    }

    // Server: take what arrived, consume one frame per tick once a few are buffered
    while (toServer.length > 0 && (toServer[0]?.at ?? Infinity) <= t) {
      const d = toServer.shift();
      if (d) serverQueue.push(d.value);
    }
    if (serverQueue.length >= BUFFER) started = true;
    if (started) {
      const next = serverQueue.shift();
      if (next) {
        server.setControls(local, inputControls(next.input));
        lastConsumed = next.frame;
      } else {
        lastConsumed++; // nothing buffered: the server repeats the last input (and moves its frame count on)
      }
    }
    server.setControls(bot, botControls(t));
    server.step();
    if (lastConsumed > 0) serverLocalPosAt.set(lastConsumed, JSON.stringify(server.car(local).pos));
    if (t % 2 === 0 && lastConsumed > 0) {
      const update = { ackFrame: lastConsumed, state: server.writeNetState({ ball: true, carIds: [local, bot], pads: true }) };
      const lost = lossEvery > 0 && (t / 2) % lossEvery === 0;
      if (!lost) toClient.push({ at: t + DOWN, value: update });
    }

    // Client: apply arrived updates; a correction must not move the local car (nothing touched it)
    while (!stalled && toClient.length > 0 && (toClient[0]?.at ?? Infinity) <= t) {
      const d = toClient.shift();
      if (!d) break;
      const before = client.car(local).pos;
      const botBefore = client.car(bot).pos;
      predictor.correct(d.value.ackFrame, [d.value.state]);
      const after = client.car(local).pos;
      const botAfter = client.car(bot).pos;
      if (firstAck === 0) {
        firstAck = d.value.ackFrame;
        syncedAt = t;
      }
      else largestCorrectionMove = Math.max(largestCorrectionMove, Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z));
      largestBotCorrection = Math.max(largestBotCorrection, Math.hypot(botAfter.x - botBefore.x, botAfter.y - botBefore.y));
    }
  }
  return { server, client, predictor, local, bot, serverLocalPosAt, clientLocalPosAt, largestCorrectionMove, largestBotCorrection, syncedAt };
}

describe("Predictor", () => {
  it("predicts the local car exactly: corrections never move it", () => {
    const r = run(360);
    expect(r.predictor.stats.corrections).toBeGreaterThan(150);
    expect(r.predictor.stats.ignoredOld).toBe(0);
    expect(r.largestCorrectionMove).toBe(0);
    expect(r.predictor.stats.localMispredictions).toBe(1); // only the first correction (joining the server's timeline)
    // Frame by frame, the client predicted its car exactly where the server put it after consuming that frame
    let compared = 0;
    // (frames the client predicted before its first correction belong to its own, earlier timeline)
    for (const [frame, serverPos] of r.serverLocalPosAt) {
      if (frame <= r.syncedAt) continue;
      expect(r.clientLocalPosAt.get(frame), `frame ${String(frame)}`).toBe(serverPos);
      compared++;
    }
    expect(compared).toBeGreaterThan(300);
    r.server.dispose();
    r.client.dispose();
  });

  it("corrects the other car, whose inputs it can only guess", () => {
    const r = run(360);
    // Each correction replays at least the round trip (12 frames)
    expect(r.predictor.stats.resimulatedFrames / r.predictor.stats.corrections).toBeGreaterThanOrEqual(UP + DOWN);
    expect(r.largestBotCorrection).toBeGreaterThan(0.5); // the bot's steering changes were mispredicted
    r.server.dispose();
    r.client.dispose();
  });

  it("catches up after stalling while the server went on", () => {
    // The client stops for 1 s; the server repeats its last input and moves its frame count past the client's
    const r = run(480, 0, [120, 240]);
    // (the server's states for frames it hadn't reached applied at its present, its frames not renumbered: G7)
    expect(r.predictor.stats.direct).toBeGreaterThan(0);
    // Afterwards it follows the server again: its own car predicted exactly where the server put it, frame by frame
    expect(r.predictor.stats.corrections).toBeGreaterThan(100);
    let compared = 0;
    for (let f = r.predictor.frame - 100; f <= r.predictor.frame; f++) {
      const serverPos = r.serverLocalPosAt.get(f);
      if (serverPos === undefined) continue;
      expect(r.clientLocalPosAt.get(f), `frame ${String(f)}`).toBe(serverPos);
      compared++;
    }
    expect(compared).toBeGreaterThan(80);
    r.server.dispose();
    r.client.dispose();
  });

  it("survives lost updates", () => {
    const r = run(240, 3); // every third update lost
    expect(r.largestCorrectionMove).toBe(0);
    r.server.dispose();
    r.client.dispose();
  });

  it("the game's rule: a car missing from updates drives on with its last replicated throttle and steer", () => {
    // (the game's car PreAsyncTick sets a SimulatedProxy's Throttle/Steer/bHandbrake from its replicated values every
    // frame: notes/netcode-live.md §4; the earlier "fade" model let them fade out, below)
    const server = World.create(engine);
    const local = server.addCar(0);
    const near = server.addCar(1);
    const far = server.addCar(1);
    server.resetKickoff(4);
    for (const car of [near, far]) server.setControls(car, { ...inputControls(NO_INPUT), throttle: 1, steer: 1 });
    server.step();
    for (const model of ["game", "fade"] as const) {
      const client = World.create(engine);
      client.loadState(server.saveState()); // (frame 0: both cars driving with full throttle and steer)
      const predictor = new Predictor(client, local, 0, model);
      predictor.correct(0, [server.writeNetState({ ball: true, carIds: [local, near, far], pads: true })]);
      for (let f = 1; f <= 30; f++) {
        predictor.advance(NO_INPUT);
        if (f % 2 === 0) predictor.correct(f, [server.writeNetState({ ball: true, carIds: [local, near], pads: true })]);
      }
      const controls = client.carControls(far);
      expect(controls.throttle, model).toBe(model === "game" ? 1 : 0);
      expect(controls.steer, model).toBe(model === "game" ? 1 : 0);
      client.dispose();
    }
    server.dispose();
  });

  it("the game's rule: a car's changed inputs rewrite the replayed frames, fading out over 0.1 s; new frames take them in full", () => {
    const server = World.create(engine);
    const local = server.addCar(0);
    const other = server.addCar(1);
    server.resetKickoff(4);
    const client = World.create(engine);
    client.loadState(server.saveState()); // (frame 0: the other car idle)
    const predictor = new Predictor(client, local, 0);
    for (let f = 1; f <= 20; f++) {
      server.setControls(other, { ...inputControls(NO_INPUT), throttle: 1, steer: -1 });
      server.step();
      predictor.advance(NO_INPUT);
    }
    // The server's state after frame 14 arrives at frame 20: the car's inputs differ from those recorded for frame 14,
    // so frames 14..20 replay with them faded: 6 frames on, half of them
    const ack = 14;
    const replay = World.create(engine);
    replay.loadState(server.saveState());
    expect(predictor.correct(ack, [server.writeNetState({ ball: true, carIds: [local, other], pads: true })])).toBe(6);
    // (as the engine keeps an axis: a byte, 0.5 -> 64/127)
    expect(client.carControls(other).throttle).toBeCloseTo(0.5, 2);
    expect(client.carControls(other).steer).toBeCloseTo(-0.5, 2);
    // The next frame is new: the replicated values in full
    predictor.advance(NO_INPUT);
    expect(client.carControls(other).throttle).toBe(1);
    expect(client.carControls(other).steer).toBe(-1);
    replay.dispose();
    server.dispose();
    client.dispose();
  });

  it("the game's rule: another car boosting on the ground replicates full throttle, which fades in the replay (GA-1, RV-321)", () => {
    for (const throttle of [0, 0.2]) {
      const server = World.create(engine);
      const local = server.addCar(0);
      const other = server.addCar(1);
      server.resetKickoff(4);
      for (let f = 0; f < 30; f++) server.step(); // (settled on its wheels)
      const client = World.create(engine);
      client.loadState(server.saveState());
      const predictor = new Predictor(client, local, 0);
      let at34: Uint8Array = new Uint8Array();
      for (let f = 1; f <= 40; f++) {
        server.setControls(other, { ...inputControls(NO_INPUT), throttle, boost: true });
        server.step();
        if (f === 34) at34 = server.writeNetState({ ball: true, carIds: [local, other], pads: true });
        predictor.advance(NO_INPUT);
      }
      // (its inputs differ from those recorded: the replay's frames rewritten with the effective throttle, 1, fading; the
      // boost button off)
      expect(predictor.correct(34, [at34])).toBe(6);
      expect(client.carControls(other).throttle, String(throttle)).toBeCloseTo(0.5, 2);
      expect(client.carControls(other).boost).toBe(false);
      predictor.advance(NO_INPUT);
      expect(client.carControls(other).throttle).toBe(1);
      expect(client.carControls(other).boost).toBe(false);
      server.dispose();
      client.dispose();
    }
  });

  it("the game's rule: unchanged inputs leave the recorded frames alone; the handbrake is copied, not faded (RV-323)", () => {
    const server = World.create(engine);
    const local = server.addCar(0);
    const other = server.addCar(1);
    server.resetKickoff(4);
    const client = World.create(engine);
    client.loadState(server.saveState());
    const predictor = new Predictor(client, local, 0);
    const states = new Map<number, Uint8Array>();
    for (let f = 1; f <= 20; f++) {
      server.setControls(other, { ...inputControls(NO_INPUT), throttle: 1, handbrake: true });
      server.step();
      states.set(f, server.writeNetState({ ball: true, carIds: [local, other], pads: true }));
      predictor.advance(NO_INPUT);
    }
    // The first state with these inputs: frames 14..20 rewritten, the throttle fading, the handbrake as it is
    predictor.correct(14, [states.get(14) ?? new Uint8Array()]);
    expect(client.carControls(other).throttle).toBeCloseTo(0.5, 2);
    expect(client.carControls(other).handbrake).toBe(true);
    // The same state again (its inputs as recorded for its frame): nothing rewritten (the present's stays as it was)
    predictor.correct(14, [states.get(14) ?? new Uint8Array()]);
    expect(client.carControls(other).throttle).toBeCloseTo(0.5, 2);
    server.dispose();
    client.dispose();
  });

  it("the game's rule: a later state whose inputs are the ones recorded for its frame rewrites nothing (RV-361)", () => {
    // (throttle -1 replicated at frame 14 fades to -0.5 by frame 20; the server's -0.5 there (byte -64) is the same: the
    // present stays the first fade's, -1 x (1 - 8/12); a fade started again from frame 20 would give -0.5 x (1 - 2/12))
    const server = World.create(engine);
    const local = server.addCar(0);
    const other = server.addCar(1);
    server.resetKickoff(4);
    const client = World.create(engine);
    client.loadState(server.saveState());
    const predictor = new Predictor(client, local, 0);
    const states = new Map<number, Uint8Array>();
    for (let f = 1; f <= 22; f++) {
      server.setControls(other, { ...inputControls(NO_INPUT), throttle: f <= 14 ? -1 : -0.5 });
      server.step();
      states.set(f, server.writeNetState({ ball: true, carIds: [local, other], pads: true }));
      predictor.advance(NO_INPUT);
    }
    predictor.correct(14, [states.get(14) ?? new Uint8Array()]);
    const first = client.carControls(other).throttle;
    expect(first).toBeCloseTo(-1 / 3, 1); // (as a byte: -43/128)
    predictor.correct(20, [states.get(20) ?? new Uint8Array()]);
    expect(client.carControls(other).throttle).toBe(first);
    server.dispose();
    client.dispose();
  });

  it("the game's rule: an older update doesn't replace the newer one's replicated inputs; a reload adopts new cars (RV-323)", () => {
    const server = World.create(engine);
    const local = server.addCar(0);
    const other = server.addCar(1);
    server.resetKickoff(4);
    const client = World.create(engine);
    client.loadState(server.saveState());
    const predictor = new Predictor(client, local, 0);
    const states = new Map<number, Uint8Array>();
    for (let f = 1; f <= 20; f++) {
      server.setControls(other, { ...inputControls(NO_INPUT), throttle: f < 10 ? 1 : -1 });
      server.step();
      states.set(f, server.writeNetState({ ball: true, carIds: [local, other], pads: true }));
      predictor.advance(NO_INPUT);
    }
    predictor.correct(16, [states.get(16) ?? new Uint8Array()]);
    predictor.correct(8, [states.get(8) ?? new Uint8Array()]); // (older: throttle 1, not the newer -1)
    predictor.advance(NO_INPUT);
    expect(client.carControls(other).throttle).toBe(-1);
    // A reload with a new car: it gets its components off and its replicated inputs
    const third = server.addCar(0);
    server.setControls(third, { ...inputControls(NO_INPUT), throttle: 1 });
    server.step();
    client.addCar(0);
    predictor.reload(predictor.frame, server.saveState());
    predictor.advance(NO_INPUT);
    expect(client.carControls(third).throttle).toBe(1);
    server.dispose();
    client.dispose();
  });

  it("the game's rule: another car's boost and air control don't run on the client (its components are off)", () => {
    // Another car in the air, boosting (the server's state after its first boosting tick): on the client it falls as
    // the server's states show it (the game's SimulatedProxy); with its components on, the client would boost it on
    const server = World.create(engine);
    const local = server.addCar(0);
    const other = server.addCar(1);
    server.resetKickoff(4);
    server.setCar(other, { pos: { x: 0, y: 2000, z: 800 }, vel: { x: 0, y: 0, z: 0 }, angVel: { x: 0, y: 0, z: 0 }, rot: server.car(other).rot, boost: 100 });
    server.setControls(other, { ...inputControls(NO_INPUT), boost: true, throttle: 1 });
    server.step();
    const speeds: Record<string, number> = {};
    for (const model of ["game", "gameComponents"] as const) {
      const client = World.create(engine);
      client.loadState(server.saveState());
      const predictor = new Predictor(client, local, 1, model);
      predictor.correct(1, [server.writeNetState({ ball: true, carIds: [local, other], pads: true })]);
      for (let f = 2; f <= 30; f++) predictor.advance(NO_INPUT);
      const v = client.car(other).vel;
      speeds[model] = Math.hypot(v.x, v.y);
      client.dispose();
    }
    // (the horizontal speed the server's state gave it, no more: no boost, no air throttle; RV-323)
    const atAck = Math.hypot(server.car(other).vel.x, server.car(other).vel.y);
    expect(speeds["game"]).toBeLessThanOrEqual(atAck + 0.01);
    expect(speeds["gameComponents"]).toBeGreaterThan(200);
    server.dispose();
  });

  it("an older update arriving after a newer one still applies, without undoing the newer one (NR-6)", () => {
    // The server's states after frames 10 (the far car) and 20 (the near car), the cars steering in ways the client
    // can't guess; delivered in order, and newer first: the client ends up in exactly the same world
    const server = World.create(engine);
    const local = server.addCar(0);
    const near = server.addCar(1);
    const far = server.addCar(1);
    server.resetKickoff(4);
    const start = server.saveState();
    const states = new Map<number, Uint8Array>();
    for (let f = 1; f <= 20; f++) {
      server.setControls(near, { ...inputControls(NO_INPUT), throttle: 1, steer: f < 8 ? 1 : -1 });
      server.setControls(far, { ...inputControls(NO_INPUT), throttle: 1, steer: f < 5 ? -1 : 1 });
      server.step();
      if (f === 10) states.set(f, server.writeNetState({ ball: true, carIds: [local, far], pads: true }));
      if (f === 20) states.set(f, server.writeNetState({ ball: true, carIds: [local, near], pads: true }));
    }
    const replay = (order: readonly number[]): Uint8Array => {
      const client = World.create(engine);
      client.loadState(start);
      const predictor = new Predictor(client, local, 0);
      for (let f = 1; f <= 30; f++) predictor.advance(NO_INPUT);
      for (const f of order) expect(predictor.correct(f, [states.get(f) ?? new Uint8Array()])).toBe(30 - f);
      const world = client.saveState();
      client.dispose();
      return world;
    };
    const inOrder = replay([10, 20]);
    expect(replay([20, 10])).toEqual(inOrder);
    expect(replay([20])).not.toEqual(inOrder); // (the older update does tell the client something)
    server.dispose();
  });

  it("a burst of updates in one frame replays once, from the oldest, into the world they make one by one (G3)", () => {
    const server = World.create(engine);
    const local = server.addCar(0);
    const near = server.addCar(1);
    const far = server.addCar(1);
    server.resetKickoff(4);
    const start = server.saveState();
    const states = new Map<number, Uint8Array>();
    for (let f = 1; f <= 20; f++) {
      server.setControls(near, { ...inputControls(NO_INPUT), throttle: 1, steer: f < 8 ? 1 : -1 });
      server.setControls(far, { ...inputControls(NO_INPUT), throttle: 1, steer: f < 5 ? -1 : 1 });
      server.step();
      if (f === 10) states.set(f, server.writeNetState({ ball: true, carIds: [local, far], pads: true }));
      if (f === 20) states.set(f, server.writeNetState({ ball: true, carIds: [local, near], pads: true }));
    }
    const world = (apply: (p: Predictor) => void): { world: Uint8Array; replayed: number } => {
      const client = World.create(engine);
      client.loadState(start);
      const predictor = new Predictor(client, local, 0);
      for (let f = 1; f <= 30; f++) predictor.advance(NO_INPUT);
      apply(predictor);
      const out = { world: client.saveState(), replayed: predictor.stats.resimulatedFrames };
      client.dispose();
      return out;
    };
    const oneByOne = world((p) => {
      for (const f of [10, 20]) p.correct(f, [states.get(f) ?? new Uint8Array()]);
    });
    for (const order of [
      [10, 20],
      [20, 10],
    ]) {
      const burst = world((p) => {
        for (const f of order) expect(p.stage(f, [states.get(f) ?? new Uint8Array()])).toBe(true);
        expect(p.resimulate()).toBe(20);
      });
      expect(burst.world, order.join(",")).toEqual(oneByOne.world);
      expect(burst.replayed).toBe(20); // (one replay of 20 frames; one by one: 20 + 10)
    }
    expect(oneByOne.replayed).toBe(30);
    server.dispose();
  });

  it("applies a state with no acknowledgement yet at the present, without a replay (G7)", () => {
    const server = World.create(engine);
    const local = server.addCar(0);
    server.resetKickoff(4);
    const client = World.create(engine);
    client.loadState(server.saveState());
    const predictor = new Predictor(client, local, 0);
    for (let f = 1; f <= 20; f++) predictor.advance(NO_INPUT);
    server.setBall({ pos: { x: 500, y: 500, z: 300 }, vel: { x: 0, y: 0, z: 0 }, angVel: { x: 0, y: 0, z: 0 } });
    server.step();
    expect(predictor.correct(0, [server.writeNetState({ ball: true, carIds: [local], pads: true })])).toBe(0);
    expect(predictor.stats.direct).toBe(1);
    expect(predictor.stats.resimulatedFrames).toBe(0);
    expect(client.ball().pos.x).toBeCloseTo(server.ball().pos.x, 3);
    expect(predictor.frame).toBe(20); // (not renumbered)
    server.dispose();
    client.dispose();
  });

  it("after a state applied at the present, a later one for an earlier frame still gives the other cars' newer inputs (RV-332)", () => {
    // (RX10's P1a: an ack-0 state applied directly, then the state after frame 25 staged: the other car's next frame takes
    // its throttle 1, not the direct one's 0)
    const server = World.create(engine);
    const local = server.addCar(0);
    const other = server.addCar(1);
    server.resetKickoff(4);
    const client = World.create(engine);
    client.loadState(server.saveState());
    const predictor = new Predictor(client, local, 0);
    const states = new Map<number, Uint8Array>();
    for (let f = 1; f <= 30; f++) {
      server.setControls(other, { ...inputControls(NO_INPUT), throttle: f < 10 ? 0 : 1 });
      server.step();
      states.set(f, server.writeNetState({ ball: true, carIds: [local, other], pads: true }));
      predictor.advance(NO_INPUT);
    }
    predictor.correct(0, [states.get(5) ?? new Uint8Array()]); // (no acknowledgement yet: applied at the present)
    expect(predictor.stats.direct).toBe(1);
    predictor.correct(25, [states.get(25) ?? new Uint8Array()]);
    predictor.advance(NO_INPUT);
    expect(client.carControls(other).throttle).toBe(1);
    server.dispose();
    client.dispose();
  });

  it("a staged state then one applied at the present in the same frame: the direct one lands on the present (RV-336)", () => {
    // (T7's recovery frame: the staged state is replayed first, so the direct one doesn't land on its past frame)
    const server = World.create(engine);
    const local = server.addCar(0);
    server.resetKickoff(4);
    const client = World.create(engine);
    client.loadState(server.saveState());
    const predictor = new Predictor(client, local, 0);
    const states = new Map<number, Uint8Array>();
    for (let f = 1; f <= 30; f++) {
      server.setControls(local, { ...inputControls(NO_INPUT), throttle: 1 });
      server.step();
      states.set(f, server.writeNetState({ ball: true, carIds: [], pads: true }));
      predictor.advance({ ...NO_INPUT, throttle: 127 });
    }
    const present = client.car(local).pos;
    expect(predictor.stage(10, [states.get(10) ?? new Uint8Array()])).toBe(true);
    server.setBall({ pos: { x: 300, y: 300, z: 400 }, vel: { x: 0, y: 0, z: 0 }, angVel: { x: 0, y: 0, z: 0 } });
    server.step();
    expect(predictor.stage(40, [server.writeNetState({ ball: true, carIds: [], pads: true })])).toBe(false); // (a frame not reached)
    expect(client.car(local).pos).toEqual(present); // (the car at the present, not at frame 10)
    expect(client.ball().pos.x).toBeCloseTo(server.ball().pos.x, 3);
    server.dispose();
    client.dispose();
  });

  it("replays an acknowledgement older than its history from its oldest frame (G7: RPF = max(ack, PF − 119))", () => {
    const server = World.create(engine);
    const local = server.addCar(0);
    server.resetKickoff(4);
    const client = World.create(engine);
    client.loadState(server.saveState());
    const predictor = new Predictor(client, local, 0);
    for (let f = 1; f <= 200; f++) predictor.advance(NO_INPUT);
    expect(predictor.correct(10, [server.writeNetState({ ball: true, carIds: [local], pads: true })])).toBe(HISTORY_FRAMES - 1);
    expect(predictor.stats.ignoredOld).toBe(0);
    server.dispose();
    client.dispose();
  });

  it("doesn't predict while its car is demolished: states apply at the present until it respawns (G5, T11)", () => {
    const server = World.create(engine);
    const local = server.addCar(0);
    server.addCar(1);
    server.resetKickoff(4);
    const client = World.create(engine);
    client.loadState(server.saveState());
    client.setDemolitions(false);
    const predictor = new Predictor(client, local, 0);
    const LAG = 12;
    server.demolishCar(local);
    const states = new Map<number, Uint8Array>();
    let directWhileDemoed = 0;
    let replaysWhileDemoed = 0;
    let replayedAfter = 0;
    for (let f = 1; f <= 600; f++) {
      server.step();
      states.set(f, server.writeNetState({ ball: true, carIds: server.carIds(), pads: true }));
      predictor.advance(NO_INPUT);
      if (f % 4 === 0 && f > LAG) {
        const wasPredicting = predictor.predicting;
        const direct = predictor.stats.direct;
        const replayed = predictor.correct(f - LAG, [states.get(f - LAG) ?? new Uint8Array()]);
        if (!wasPredicting) {
          directWhileDemoed += predictor.stats.direct - direct;
          replaysWhileDemoed += replayed;
        } else if (f > 500) replayedAfter = Math.max(replayedAfter, replayed);
      }
    }
    expect(server.car(local).demoed).toBe(false); // (respawned after 3 s)
    expect(directWhileDemoed).toBeGreaterThan(50);
    expect(replaysWhileDemoed).toBe(0);
    expect(predictor.predicting).toBe(true);
    expect(replayedAfter).toBe(LAG); // (predicting again: each state replayed from its frame)
    server.dispose();
    client.dispose();
  });

  it("a state applied at the present for an older frame keeps the other cars' newer replicated inputs (RV-360; RX13's C13)", () => {
    // (the staged state after frame 25 gave the other car throttle 1; an ack-0 state from frame 5, applied directly
    // afterwards, mustn't put its throttle 0 back)
    const server = World.create(engine);
    const local = server.addCar(0);
    const other = server.addCar(1);
    server.resetKickoff(4);
    const client = World.create(engine);
    client.loadState(server.saveState());
    const predictor = new Predictor(client, local, 0);
    const states = new Map<number, Uint8Array>();
    for (let f = 1; f <= 30; f++) {
      server.setControls(other, { ...inputControls(NO_INPUT), throttle: f < 10 ? 0 : 1 });
      server.step();
      states.set(f, server.writeNetState({ ball: true, carIds: [local, other], pads: true }));
      predictor.advance(NO_INPUT);
    }
    predictor.correct(25, [states.get(25) ?? new Uint8Array()]);
    predictor.advance(NO_INPUT);
    expect(client.carControls(other).throttle).toBe(1);
    const direct = predictor.stats.direct;
    predictor.correct(0, [states.get(5) ?? new Uint8Array()]);
    expect(predictor.stats.direct).toBe(direct + 1);
    predictor.advance(NO_INPUT);
    expect(client.carControls(other).throttle).toBe(1);
    server.dispose();
    client.dispose();
  });

  it("after a respawn, a state for a frame before the last one applied at the present still gives the others' inputs (RV-332)", () => {
    // (RX10's P1b: the states applied while demolished are labelled with their own frames, so the first staged one after
    // the respawn, for an earlier frame than the present, isn't skipped as older)
    const server = World.create(engine);
    const local = server.addCar(0);
    const other = server.addCar(1);
    server.resetKickoff(4);
    const client = World.create(engine);
    client.loadState(server.saveState());
    client.setDemolitions(false);
    const predictor = new Predictor(client, local, 0);
    const LAG = 12;
    const throttleAt = (f: number): number => Math.floor(f / 8) % 2; // (changes within the lag)
    server.demolishCar(local);
    const states = new Map<number, Uint8Array>();
    let expected: number | null = null;
    let checked = 0;
    let wrong = 0;
    for (let f = 1; f <= 500; f++) {
      server.setControls(other, { ...inputControls(NO_INPUT), throttle: throttleAt(f) });
      server.step();
      states.set(f, server.writeNetState({ ball: true, carIds: server.carIds(), pads: true }));
      predictor.advance(NO_INPUT);
      if (expected !== null) {
        checked++;
        if (client.carControls(other).throttle !== expected) wrong++;
        expected = null;
      }
      if (f % 4 === 0 && f > LAG) {
        const wasPredicting = predictor.predicting;
        predictor.correct(f - LAG, [states.get(f - LAG) ?? new Uint8Array()]);
        if (wasPredicting) expected = throttleAt(f - LAG);
      }
    }
    expect(server.car(local).demoed).toBe(false);
    expect(checked).toBeGreaterThan(20);
    expect(wrong).toBe(0);
    server.dispose();
    client.dispose();
  });

  it("keeps its history in the same buffers: no snapshot allocated a frame once it's full (G3)", () => {
    const client = World.create(engine);
    const local = client.addCar(0);
    client.addCar(1);
    client.resetKickoff(4);
    const predictor = new Predictor(client, local, 0);
    const save = client.saveStateInto.bind(client);
    let fresh = 0;
    const sizes = new Set<number>();
    client.saveStateInto = (target) => {
      const written = save(target);
      if (written.buffer !== target?.buffer) fresh++;
      sizes.add(written.length);
      return written;
    };
    // (driving, jumping, landing, into the ball: the snapshot's size changes with its contacts)
    const drive = (f: number) => ({ ...NO_INPUT, throttle: 127, steer: f < 600 ? 0 : Math.round(Math.sin(f / 30) * 127), bits: f > 600 && f % 90 < 3 ? 1 : 0 });
    for (let f = 1; f <= 200; f++) predictor.advance(drive(f));
    const filling = fresh;
    expect(filling).toBeLessThanOrEqual(200);
    for (let f = 201; f <= 1000; f++) predictor.advance(drive(f));
    expect(sizes.size).toBeGreaterThan(1);
    expect(fresh).toBe(filling);
    client.dispose();
  });
});
