// The bots' builders' rules the vectors don't reach (RV-538: BM6, BM7d, BM17, BM18, BM18b, BM19): has_flip after a dodge,
// Nexto's keys turned to the bot's heading (the angular velocity too), Necto's pad timer zeroed while its pad is down,
// the kickoff's taker (the left one among the nearest, within the tolerance) and its script only while the ball's y is 0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BotCar, BotView } from "../local/bots";
import { ZERO_ROW } from "./driver";
import { entityPerceiver } from "./entityPerceiver";
import { nearestLeftKickoff, takesKickoff } from "./kickoff";
import { type BotManifest, type KickoffScript, parseManifest } from "./manifest";

const manifest = (id: string): BotManifest => {
  const m = parseManifest(JSON.parse(readFileSync(new URL(`../../bots/${id}/bot.json`, import.meta.url), "utf8")));
  if (typeof m === "string") throw new Error(`${id}: ${m}`);
  return m;
};

const zero = { x: 0, y: 0, z: 0 };
const car = (over: Partial<BotCar> = {}): BotCar => ({
  pos: { x: 0, y: -4608, z: 17 },
  vel: zero,
  angVel: zero,
  rot: { forward: { x: 0, y: 1, z: 0 }, right: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  team: 0,
  boost: 33,
  onGround: true,
  jumping: false,
  hasJumped: false,
  doubleJumped: false,
  hasFlipped: false,
  airTimeSinceJump: 0,
  demoed: false,
  demoRespawnTimer: 0,
  handbrakeVal: 0,
  lastBallHitTick: -1,
  ...over,
});
const view = (cars: BotCar[], over: { self?: number; ball?: Partial<BotView["state"]["ball"]>; pads?: boolean[]; kickoffPause?: boolean } = {}): BotView => ({
  state: {
    cars,
    ball: { pos: { x: 0, y: 0, z: 93 }, vel: zero, angVel: zero, ...over.ball },
    pads: (over.pads ?? new Array<boolean>(34).fill(true)).map((active) => ({ pos: zero, active, cooldown: 0 })),
    score: [0, 0],
    tickCount: 0,
    kickoffPause: over.kickoffPause ?? false,
    goalScored: false,
    matchEnded: false,
    ballPrediction: () => new Float32Array(0),
  },
  self: over.self ?? 0,
  tick: 0,
});
/** A key row of a build (its 24 columns) */
const keyRow = (inputs: readonly { data: Float32Array }[], row: number): number[] => [...(inputs[1]?.data.subarray(row * 24, row * 24 + 24) ?? [])];

describe("the entity perceiver", () => {
  it("has_flip: none after a dodge or a second jump in the air, back on the ground", () => {
    const builder = entityPerceiver(manifest("nexto"));
    const flipped = view([car({ onGround: false, hasFlipped: true }), car({ onGround: false, doubleJumped: true }), car({ onGround: false })]);
    expect(builder.derived(flipped).hasFlip).toEqual([false, false, true]);
  });

  it("Nexto: every key vector turned to the bot's heading, the angular velocity too", () => {
    const nexto = manifest("nexto");
    const builder = entityPerceiver(nexto);
    // (the bot facing +x: a quarter turn; the ball spinning about y)
    const inputs = builder.build(view([car({ rot: { forward: { x: 1, y: 0, z: 0 }, right: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } } }), car({ team: 1, pos: { x: 0, y: 4608, z: 17 } })], { ball: { angVel: { x: 0, y: 2, z: 0 } } }), ZERO_ROW);
    const ball = keyRow(inputs, 2);
    const norm = (nexto.observation as unknown as { norm: { angVel: number } }).norm.angVel;
    expect(ball[17]).toBeCloseTo(-2 / norm, 5);
    expect(ball[18]).toBeCloseTo(0, 5);
  });

  it("Necto: a pad's timer zeroed while it's down", () => {
    const necto = manifest("necto");
    const builder = entityPerceiver(necto);
    const cars = [car(), car({ team: 1, pos: { x: 0, y: 4608, z: 17 } })];
    const first = (necto.observation as unknown as { padBotFromOur: number[] }).padBotFromOur[0] ?? 0;
    // (its first pad up: its timer started; then taken)
    const up = keyRow(builder.build(view(cars), ZERO_ROW), 1 + cars.length);
    expect(up[21]).toBeGreaterThan(0);
    const pads = new Array<boolean>(34).fill(true);
    pads[first] = false;
    const down = keyRow(builder.build(view(cars, { pads }), ZERO_ROW), 1 + cars.length);
    expect(down[21]).toBe(0);
  });
});

describe("the kickoff's taker and script", () => {
  // (a 2v2's blue cars on the diagonal spots, as near the ball as each other)
  const right = car({ pos: { x: 2048, y: -2560, z: 17 } });
  const left = car({ pos: { x: -2048, y: -2560, z: 17 } });

  it("the left one among the nearest takes: blue's largest x, orange's smallest", () => {
    expect(takesKickoff(view([right, left], { self: 0 }), 10)).toBe(true);
    expect(takesKickoff(view([right, left], { self: 1 }), 10)).toBe(false);
    const orange = (x: number): BotCar => car({ team: 1, pos: { x, y: 2560, z: 17 } });
    expect(takesKickoff(view([orange(2048), orange(-2048)], { self: 1 }), 10)).toBe(true);
    expect(takesKickoff(view([orange(2048), orange(-2048)], { self: 0 }), 10)).toBe(false);
  });

  it("a car farther than the tolerance from the nearest doesn't take, however left it is", () => {
    // (31 uu farther than its mate)
    const farther = car({ pos: { x: 2048, y: -2600, z: 17 } });
    expect(takesKickoff(view([farther, left], { self: 0 }), 10)).toBe(false);
    expect(takesKickoff(view([farther, left], { self: 1 }), 10)).toBe(true);
  });

  it("the script's rows only while the pause lasts and the ball's y is exactly 0", () => {
    const script: KickoffScript = { script: "rows-v1", phases: [[3, [1, 0, 0, 0, 0, 0, 1, 0]]], totalTicks: 3, taker: "nearest-left-v1", takerToleranceUu: 10, setsPrevAction: true };
    const kickoff = nearestLeftKickoff(script);
    expect(kickoff.step(view([right, left], { kickoffPause: true }))).toEqual([1, 0, 0, 0, 0, 0, 1, 0]);
    expect(kickoff.step(view([right, left], { kickoffPause: true, ball: { pos: { x: 0, y: 0.5, z: 93 } } }))).toBeNull();
  });
});
