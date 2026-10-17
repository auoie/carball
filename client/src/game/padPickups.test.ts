// A pad taken again the tick it returns (a car parked on it, the user's report): the client never sees it active, its
// cooldown jumping back up instead; the pickup's feedback keyed on that too (padPickedUp)
import createEngine from "@engine/carball_engine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { type BoostPadState, World, initEngine, padPickedUp } from "../engine/world";
import { SoundDetector } from "../audio/detect";
import { TOKENS, TokenPadsView } from "../render/tokenPads";
import { type InstancedMesh, Vector3 } from "three";
import { ZERO, vec3 } from "../math/vec";
import { arenaMeshes } from "../testing/arena";

let engine: Awaited<ReturnType<typeof createEngine>>;
beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, arenaMeshes());
});

describe("a big pad under a parked car", () => {
  it("returns and is taken again in one tick: never active to the client, its cooldown jumping from ~0 back to 10", () => {
    const world = World.create(engine);
    const car = world.addCar(0);
    world.resetKickoff(1);
    world.setKickoffCountdown(0);
    const index = world.boostPads().findIndex((p) => p.big);
    const pad = world.boostPads()[index];
    if (!pad) throw new Error("no big pad");
    const rot = { forward: vec3(1, 0, 0), right: vec3(0, 1, 0), up: vec3(0, 0, 1) };
    world.setCar(car, { pos: vec3(pad.pos.x, pad.pos.y, 17), vel: ZERO, angVel: ZERO, rot, boost: 0 });
    world.step(2);
    expect(world.boostPads()[index]?.active).toBe(false);
    // (parked on it, its boost spent again before the pad returns, so it can take it)
    const seen: { active: boolean; cooldown: number }[] = [];
    for (let tick = 0; tick < 13 * 120; tick++) {
      if (tick === 9 * 120) world.setCar(car, { pos: world.car(car).pos, vel: ZERO, angVel: ZERO, rot: world.car(car).rot, boost: 20 });
      world.step();
      const p = world.boostPads()[index];
      if (p) seen.push({ active: p.active, cooldown: p.cooldown });
    }
    expect(seen.some((s) => s.active)).toBe(false);
    const jump = seen.findIndex((s, i) => i > 0 && s.cooldown > (seen[i - 1]?.cooldown ?? 0) + 1);
    expect(jump).toBeGreaterThan(0);
    expect(seen[jump - 1]?.cooldown ?? 99).toBeLessThan(0.1);
    expect(seen[jump]?.cooldown ?? 0).toBeGreaterThan(9.9);
    world.dispose();
  });
});

describe("the pickup's feedback keyed on the pickup itself", () => {
  const big = (active: boolean, cooldown: number): BoostPadState => ({ pos: { x: 3584, y: 0, z: 73 }, big: true, active, cooldown });

  it("padPickedUp: up then taken; taken both times with its cooldown jumped back up; not a countdown or a prediction's small correction", () => {
    expect(padPickedUp(big(true, 0), big(false, 10))).toBe(true);
    expect(padPickedUp(big(false, 0.05), big(false, 10))).toBe(true);
    expect(padPickedUp(big(false, 5), big(false, 4.9))).toBe(false);
    expect(padPickedUp(big(false, 5), big(false, 5.3))).toBe(false);
    expect(padPickedUp(big(false, 0.05), big(true, 0))).toBe(false);
    expect(padPickedUp(undefined, big(false, 10))).toBe(false);
  });

  it("the pickup's sound, free play's and online's (both feed the detector the world's pads): for a pad taken again the tick it returned", () => {
    const detector = new SoundDetector();
    const world = (pad: BoostPadState): Parameters<SoundDetector["update"]>[0] => ({ cars: new Map(), ball: { pos: vec3(0, 0, 93), vel: ZERO, angVel: ZERO, rot: { forward: vec3(1, 0, 0), right: vec3(0, 1, 0), up: vec3(0, 0, 1) } }, pads: [pad] });
    detector.update(world(big(false, 0.03)), 1 / 60);
    expect(detector.update(world(big(false, 10)), 1 / 60)).toEqual([{ kind: "pad", big: true, at: { x: 3584, y: 0, z: 73 } }]);
    expect(detector.update(world(big(false, 9.98)), 1 / 60)).toEqual([]);
  });

  it("the pad's ball pops for it", () => {
    const tokens = new TokenPadsView([big(false, 0.03)]);
    const balls = tokens.root.children[2] as InstancedMesh;
    const scale = (): number => new Vector3(balls.instanceMatrix.array[0] ?? 0, balls.instanceMatrix.array[1] ?? 0, balls.instanceMatrix.array[2] ?? 0).length();
    tokens.update([big(false, 0.01)], 1 / 60);
    expect(scale()).toBe(0);
    tokens.update([big(false, 10)], 1 / 60);
    expect(scale()).toBeGreaterThan(TOKENS.ball.radius * 0.9);
  });
});

