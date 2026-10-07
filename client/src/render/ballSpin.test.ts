// The display orientation integrated from the ball's angular velocity, including against the real engine
// (requires the engine build, engine/build-wasm, and the generated arena, out/arena).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import createEngine from "@engine/rlengine.mjs";
import { Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { type BodyState, World, initEngine } from "../engine/world";
import { IDENTITY_ROT, type Vec3, ZERO, vec3 } from "../math/vec";
import { BallSpin } from "./ballSpin";
import { BALL_RADIUS } from "./entities";
import { toThreeQuaternion } from "./coords";

const TICK = 1 / 120;
const state = (angVel: Vec3): BodyState => ({ pos: ZERO, vel: ZERO, angVel, rot: IDENTITY_ROT });
const expectVec = (a: Vec3, b: Vec3): void => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.z).toBeCloseTo(b.z, 6);
};

describe("BallSpin", () => {
  it("keeps its orientation without angular velocity", () => {
    const spin = new BallSpin();
    const { rot } = spin.advance(state(ZERO), TICK);
    expectVec(rot.forward, IDENTITY_ROT.forward);
    expectVec(rot.up, IDENTITY_ROT.up);
  });

  it("turns by the angular speed times the time", () => {
    // Half a turn about z in one second: forward ends up backwards, up stays up
    const spin = new BallSpin();
    let s = state(vec3(0, 0, Math.PI));
    for (let i = 0; i < 120; i++) s = spin.advance(s, TICK);
    expectVec(s.rot.forward, vec3(-1, 0, 0));
    expectVec(s.rot.right, vec3(0, -1, 0));
    expectVec(s.rot.up, vec3(0, 0, 1));
  });

  it("composes rotations about different axes in the world frame", () => {
    // A quarter turn about z, then a quarter turn about x (world axes): forward -> right -> up
    const spin = new BallSpin();
    spin.advance(state(vec3(0, 0, Math.PI / 2)), 1);
    const { rot } = spin.advance(state(vec3(Math.PI / 2, 0, 0)), 1);
    expectVec(rot.forward, vec3(0, 0, 1));
  });
});

describe("BallSpin on the engine's ball", () => {
  let engine: Awaited<ReturnType<typeof createEngine>>;
  beforeAll(async () => {
    const arenaPath = fileURLToPath(new URL("../../../out/arena/collision_meshes/soccar/soccar_arena.cmf", import.meta.url));
    engine = await createEngine();
    initEngine(engine, [new Uint8Array(readFileSync(arenaPath))]);
  });

  it("rolls forwards: the top of the ball moves the way the ball travels", () => {
    const world = World.create(engine);
    world.setBall({ pos: vec3(0, 0, BALL_RADIUS + 1), vel: vec3(0, 1200, 0), angVel: ZERO });
    const spin = new BallSpin();
    let ball = world.ball();
    for (let i = 0; i < 60; i++) {
      world.step();
      ball = spin.advance(world.ball(), TICK);
    }
    // The engine leaves the orientation alone (if this fails, it now tracks it: use its rotation instead)
    expect(world.ball().rot.up.z).toBeCloseTo(1, 4);
    expect(ball.vel.y).toBeGreaterThan(500);
    // Rolling towards +y: the ball's top point tips towards +y, in the engine's frame and once drawn in Three's
    expect(ball.rot.up.y).toBeGreaterThan(0.1);
    const top = new Vector3(0, 1, 0).applyQuaternion(toThreeQuaternion(ball.rot));
    expect(top.z).toBeGreaterThan(0.1); // Three z = Rocket League y
    world.dispose();
  });
});
