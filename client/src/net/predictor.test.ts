// The client's prediction and rollback against a simulated server, using the real engine (Node build).
// Network: inputs arrive 6 ticks (50 ms) after they are sent, updates 6 ticks after; the server consumes one input
// frame per tick from a small buffer and sends the world every other tick, as the real server does.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import createEngine from "@engine/rlengine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { type CarControls, World, initEngine } from "../engine/world";
import { NO_INPUT, Predictor, inputControls } from "./predictor";
import { BIT_BOOST, BIT_JUMP, type InputFrame, quantizeAxis } from "./protocol";

const arenaPath = fileURLToPath(new URL("../../../out/arena/collision_meshes/soccar/soccar_arena.cmf", import.meta.url));
let engine: Awaited<ReturnType<typeof createEngine>>;

beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, [new Uint8Array(readFileSync(arenaPath))]);
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

function run(ticks: number, lossEvery = 0) {
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
    const input = localInput(t);
    predictor.advance(input);
    clientLocalPosAt.set(t, JSON.stringify(client.car(local).pos));
    toServer.push({ at: t + UP, value: { frame: t, input } });

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
    while (toClient.length > 0 && (toClient[0]?.at ?? Infinity) <= t) {
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

  it("survives lost updates", () => {
    const r = run(240, 3); // every third update lost
    expect(r.largestCorrectionMove).toBe(0);
    r.server.dispose();
    r.client.dispose();
  });
});
