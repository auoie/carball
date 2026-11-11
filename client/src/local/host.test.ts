// The local host (the server's own match in WebAssembly): a player joins with a hello and is welcomed; a bot joins the
// other team; the full match starts, its updates come, and the bot's controls drive its car
import createEngine from "@engine/carball_engine.mjs";
import createHost from "@host/carball_host.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { World, initEngine } from "../engine/world";
import { type ControlMessage, PROTOCOL_VERSION, decodeControl, decodeDatagram, encodeControl } from "../net/protocol";
import { arenaMeshes } from "../testing/arena";
import { LocalBots, chaser } from "./bots";
import { type HostMessage, LocalHost, SLIP_SECONDS } from "./host";

let host: LocalHost;
let engine: Awaited<ReturnType<typeof createEngine>>;
beforeAll(async () => {
  host = LocalHost.create(await createHost(), arenaMeshes());
  engine = await createEngine();
  initEngine(engine, arenaMeshes());
});

const hello = (team: number, name: string): Uint8Array =>
  encodeControl({
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

/** A drained control message's body decoded (its frame's two length bytes off) */
const controls = (messages: readonly HostMessage[], id: number): ControlMessage[] =>
  messages.flatMap((m) => (m.id === id && m.kind === "control" ? [decodeControl(m.bytes.subarray(2))] : []));

describe("the local host", () => {
  it("welcomes a player's hello, starts a 1v1 with a bot, sends updates and drives the bot's car", () => {
    host.open(1, 7);
    host.connect(1);
    host.control(1, hello(0, "Player"), 0);
    const first = host.drain();
    const welcome = controls(first, 1).find((m) => m.type === "welcome");
    expect(welcome?.type).toBe("welcome");
    host.connect(2);
    host.control(2, hello(1, "Bot"), 0);
    host.bot(2, { throttle: 1, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: true, handbrake: false });
    const botCar = host.car(2);
    expect(botCar).not.toBeNull();
    // (11 game seconds: the warm-up, the kickoff's countdown and a few seconds of play, ticked as the worker does)
    const messages: HostMessage[] = [];
    let now = 0;
    for (let i = 0; i < 11 * 120; i++) {
      now = host.nextTick() ?? now + 1 / 120;
      host.tick(now);
      messages.push(...host.drain());
    }
    const updates = messages.filter((m) => m.id === 1 && m.kind === "datagram").map((m) => (m.kind === "datagram" ? decodeDatagram(m.bytes) : null));
    expect(updates.filter((u) => u?.type === "update").length).toBeGreaterThan(200);
    // (the online match's own start: waiting, the warm-up and the kickoff's countdown, then play)
    expect(controls(messages, 1).flatMap((m) => (m.type === "match" ? [m.phase] : []))).toContain("active");
    // The bot's car, from the match's whole state: driven off its kickoff spot at full boost
    const world = World.create(engine);
    world.loadState(host.state(1));
    const car = world.car(botCar ?? -1);
    expect(car.team).toBe(1);
    expect(Math.hypot(car.vel.x, car.vel.y)).toBeGreaterThan(1000);
    world.dispose();
  });

  it("far behind its ticks the clock slips, the backlog not played back: a slow start keeps its whole countdown, a suspended tab no fast-forward (NET-02)", () => {
    expect(LocalHost.tickTime(5, 5.05)).toBe(5);
    expect(LocalHost.tickTime(5, 5 + SLIP_SECONDS + 0.01)).toBe(5 + SLIP_SECONDS + 0.01);
    // (the worker's start-up took 3 s: the match opened at 0 s, its players in at 3 s)
    host.open(1, 7);
    host.connect(1);
    host.control(1, hello(0, "Player"), 3);
    host.connect(2);
    host.control(2, hello(1, "Bot"), 3);
    host.drain();
    /** A pass of the worker's at `now`: the ticks run, the phases they told */
    const pass = (now: number): { ticks: number; phases: string[] } => {
      let ticks = 0;
      const phases: string[] = [];
      for (let next = host.nextTick(); next !== null && next <= now && ticks < 12; next = host.nextTick()) {
        host.tick(LocalHost.tickTime(next, now));
        ticks++;
        phases.push(...controls(host.drain(), 1).flatMap((m) => (m.type === "match" ? [m.phase] : [])));
      }
      return { ticks, phases };
    };
    // (the first pass: a tick with the time now, the host's few catch-up ticks in it and the rest skipped, then the one
    // due at that time; not the 360 behind)
    expect(pass(3).ticks).toBeLessThanOrEqual(2);
    expect(host.nextTick()).toBeGreaterThan(3);
    // (the kickoff's countdown whole from there: play no sooner than 6.9 s on, where the backlog played back had it
    // 3 s sooner)
    let active: number | null = null;
    for (let t = 3; t < 12 && active === null; t += 1 / 60) if (pass(t).phases.includes("active")) active = t;
    expect(active).toBeGreaterThan(3 + 6.9);
    expect(active).toBeLessThan(3 + 7.3);
    // (a minute suspended in play: one pass, no fast-forward)
    const before = host.nextTick() ?? 0;
    expect(pass(before + 60).ticks).toBeLessThanOrEqual(2);
    expect(host.nextTick()).toBeGreaterThan(before + 60);
  });

  it("a bot's brain is given the match's state after every tick: the chaser hits the kickoff's ball (the player idle)", async () => {
    host.open(1, 3);
    host.connect(1);
    host.control(1, hello(0, "Player"), 0);
    const world = World.create(engine);
    const bots = new LocalBots(world, 2);
    bots.join(host, 2, { team: 1, name: "Chaser", brain: "chaser" }, chaser(), 0);
    let now = 0;
    for (let i = 0; i < 12 * 120; i++) {
      now = host.nextTick() ?? now + 1 / 120;
      await bots.beforeTick(host);
      host.tick(now);
      host.drain();
    }
    world.loadState(host.state(1));
    const ball = world.ball();
    expect(Math.hypot(ball.pos.x, ball.pos.y)).toBeGreaterThan(300);
    world.dispose();
  });
});
