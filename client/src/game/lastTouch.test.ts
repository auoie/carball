// The last touch's team (HitTeamNum, VT-10: the ball trail's colour) from the engine's per-car touch ticks
import createEngine from "@engine/carball_engine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { NO_CONTROLS, World, initEngine } from "../engine/world";
import { ZERO, vec3 } from "../math/vec";
import { arenaMeshes } from "../testing/arena";
import { freeplayTouchTeam, lastTouchTeam } from "./replayRecorder";

let engine: Awaited<ReturnType<typeof createEngine>>;
beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, arenaMeshes());
});

describe("the last touch's team", () => {
  it("none before a touch; the team of the car that touched the ball last, the newest touch winning", () => {
    const world = World.create(engine);
    const blue = world.addCar(0);
    const orange = world.addCar(1);
    world.resetKickoff(1);
    world.setKickoffCountdown(0);
    expect(lastTouchTeam(world)).toBeNull();
    // (the ball dropped onto each car in turn)
    const drop = (car: number): void => {
      const at = world.car(car).pos;
      world.setBall({ pos: vec3(at.x, at.y, at.z + 160), vel: vec3(0, 0, -400), angVel: ZERO });
      world.step(30);
    };
    drop(orange);
    expect(lastTouchTeam(world)).toBe(1);
    drop(blue);
    expect(lastTouchTeam(world)).toBe(0);
    world.dispose();
  });
});

describe("free play's last touch's team (the user's report: an orange car's touch left the trail blue)", () => {
  it("the garage's team once the car, driven into the ball, touches it, either team; none before (the engine's car is team 0)", () => {
    for (const garage of [0, 1] as const) {
      const world = World.create(engine);
      const car = world.addCar(0);
      world.resetKickoff(1);
      world.setKickoffCountdown(0);
      // (the car 1000 uu short of the ball, facing it, driven at it: a real touch, no staging)
      const forward = vec3(0, 1, 0);
      world.setCar(car, { pos: vec3(0, -1000, 17), vel: ZERO, angVel: ZERO, rot: { forward, right: vec3(-forward.y, forward.x, 0), up: vec3(0, 0, 1) }, boost: 100 });
      world.setBall({ pos: vec3(0, 0, 93), vel: ZERO, angVel: ZERO });
      expect(freeplayTouchTeam(world, garage)).toBeNull();
      for (let tick = 0; tick < 240 && world.carLastBallTouchTick(car) === null; tick++) {
        world.setControls(car, { ...NO_CONTROLS, throttle: 1, boost: true });
        world.step();
      }
      expect(world.carLastBallTouchTick(car), JSON.stringify({ car: world.car(car).pos, ball: world.ball().pos })).not.toBeNull();
      expect(world.car(car).team).toBe(0);
      expect(freeplayTouchTeam(world, garage)).toBe(garage);
      world.dispose();
    }
  });
});

