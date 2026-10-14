// The network session's wiring (src/net/session.ts, RV-314): the hitch reset, the acknowledgement, the inputs sent, the
// server tick's client frame and the smoothing's previous tick, against the engine (Node build).
import createEngine from "@engine/rlengine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { type CarState, World, initEngine } from "../engine/world";
import { Interpolated } from "../game/interpolated";
import { SyncError } from "../game/syncError";
import { arenaMeshes } from "../testing/arena";
import { NO_INPUT, inputControls } from "./predictor";
import type { InputFrame, Update } from "./protocol";
import { NetSession, type SmoothedCar } from "./session";

let engine: Awaited<ReturnType<typeof createEngine>>;

beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, arenaMeshes());
});

interface Setup {
  readonly server: World;
  readonly client: World;
  readonly local: number;
  readonly other: number;
  readonly cars: Map<number, SmoothedCar>;
  readonly session: NetSession;
  readonly sent: { first: number; frames: InputFrame[] }[];
  resets: number;
  now: number;
}

function setup(): Setup {
  const server = World.create(engine);
  const local = server.addCar(0);
  const other = server.addCar(1);
  server.resetKickoff(4);
  const client = World.create(engine);
  client.loadState(server.saveState());
  const cars = new Map<number, SmoothedCar>([local, other].map((id) => [id, { state: new Interpolated(client.car(id)), error: new SyncError() }]));
  const s: Omit<Setup, "session"> & { session?: NetSession } = { server, client, local, other, cars, sent: [], resets: 0, now: 0 };
  const session = new NetSession(client, local, 0, cars, {
    sendInputs: (_timestamp, first, frames) => {
      s.sent.push({ first, frames });
    },
    resetInputBuffer: () => {
      s.resets++;
    },
    nowMs: () => s.now,
  });
  return Object.assign(s, { session });
}

function update(s: Setup, serverTick: number, ackFrame: number): Update {
  return {
    serverTick,
    ackFrame,
    receivedFrame: ackFrame,
    echoTimestamp: 0,
    echoDelay: 0,
    bufferTarget: 7,
    bufferSize: 7,
    part: 0,
    parts: 1,
    state: s.server.writeNetState({ ball: true, carIds: [s.local, s.other], pads: true }),
  };
}

function dispose(s: Setup): void {
  s.server.dispose();
  s.client.dispose();
}

describe("the network session's wiring", () => {
  it("resets the server's input buffer 2 s after the last hitch (a frame over 0.1 s)", () => {
    const s = setup();
    s.session.watchHitches(0.3);
    for (let i = 0; i < 100; i++) s.session.watchHitches(1 / 60);
    expect(s.resets).toBe(0); // (1.67 s)
    s.session.watchHitches(0.2); // (another hitch: 2 s from here)
    for (let i = 0; i < 115; i++) s.session.watchHitches(1 / 60);
    expect(s.resets).toBe(0);
    for (let i = 0; i < 10; i++) s.session.watchHitches(1 / 60);
    expect(s.resets).toBe(1);
    for (let i = 0; i < 300; i++) s.session.watchHitches(1 / 60);
    expect(s.resets).toBe(1);
    dispose(s);
  });

  it("keeps the newest update's acknowledgement: an older update doesn't take it back", () => {
    const s = setup();
    for (let f = 1; f <= 20; f++) s.session.predictor.advance(NO_INPUT);
    s.session.receive(update(s, 100, 12));
    s.session.receive(update(s, 98, 9));
    s.session.applyUpdates();
    expect(s.session.ackFrame).toBe(12);
    // A newer update's lower acknowledgement does (the server consuming this client's frames again after a stall, G7)
    s.session.receive(update(s, 102, 11));
    s.session.applyUpdates();
    expect(s.session.ackFrame).toBe(11);
    dispose(s);
  });

  it("after a stall, with the server's acknowledgement past its frames, sends its newest 10 (G7)", () => {
    const s = setup();
    for (let f = 1; f <= 20; f++) s.session.predictor.advance({ ...NO_INPUT, throttle: f });
    s.session.receive(update(s, 100, 60)); // (the server moved its count on while this client stalled)
    s.session.applyUpdates();
    s.session.sendInputs();
    expect(s.sent.at(-1)?.first).toBe(11);
    expect(s.sent.at(-1)?.frames.length).toBe(10);
    dispose(s);
  });

  it("sends the frames after the acknowledgement, the newest 10 at most", () => {
    const s = setup();
    for (let f = 1; f <= 20; f++) s.session.predictor.advance({ ...NO_INPUT, throttle: f });
    s.session.sendInputs();
    expect(s.sent.at(-1)?.first).toBe(11);
    expect(s.sent.at(-1)?.frames.map((x) => x.throttle)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    s.session.receive(update(s, 100, 16));
    s.session.applyUpdates();
    s.session.sendInputs();
    expect(s.sent.at(-1)?.first).toBe(17);
    expect(s.sent.at(-1)?.frames.length).toBe(4);
    // (nothing once the connection closed)
    s.session.disconnected = true;
    s.session.sendInputs();
    expect(s.sent.length).toBe(2);
    dispose(s);
  });

  it("finds a server tick's client frame from the acknowledgement nearest it", () => {
    const s = setup();
    for (let f = 1; f <= 140; f++) s.session.predictor.advance(NO_INPUT);
    s.session.receive(update(s, 100, 40)); // (offset 60)
    s.session.receive(update(s, 200, 130)); // (offset 70)
    s.session.applyUpdates();
    expect(s.session.frameAt(110)).toBe(50);
    expect(s.session.frameAt(190)).toBe(120);
    dispose(s);
  });

  it("moves a car's previous tick with a correction: its drawn pose stays where it was", () => {
    const s = setup();
    for (let f = 1; f <= 10; f++) s.session.predictor.advance(NO_INPUT);
    const entry = s.cars.get(s.other);
    if (!entry) throw new Error("no entry");
    entry.state.push(s.client.car(s.other), false);
    entry.state.push(s.client.car(s.other), false);
    const previousBefore: CarState = entry.state.previous;
    const currentBefore: CarState = entry.state.current;
    // The server's other car drove where the client didn't predict it
    for (let f = 1; f <= 10; f++) {
      s.server.setControls(s.other, { ...inputControls(NO_INPUT), throttle: 1, steer: 1 });
      s.server.step();
    }
    s.session.correct(10, [s.server.writeNetState({ ball: true, carIds: [s.local, s.other], pads: true })]);
    const moved = { x: entry.state.current.pos.x - currentBefore.pos.x, y: entry.state.current.pos.y - currentBefore.pos.y };
    expect(Math.hypot(moved.x, moved.y)).toBeGreaterThan(1);
    expect(entry.state.previous.pos.x - previousBefore.pos.x).toBeCloseTo(moved.x, 3);
    expect(entry.state.previous.pos.y - previousBefore.pos.y).toBeCloseTo(moved.y, 3);
    dispose(s);
  });
});
