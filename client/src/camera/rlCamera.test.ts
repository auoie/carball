// Scenario tests for the camera port; expected values come from the decompiled formulas.
import { describe, expect, it } from "vitest";
import type { CarState } from "../engine/world";
import { type Rot3, type Vec3, sub, vec3 } from "../math/vec";
import { PlayerCamera } from "./rlCamera";

const UP = vec3(0, 0, 1);

function car(overrides: Partial<CarState> = {}): CarState {
  const rot: Rot3 = { forward: vec3(1, 0, 0), right: vec3(0, 1, 0), up: UP };
  return {
    pos: vec3(0, 0, 17),
    vel: vec3(0, 0, 0),
    angVel: vec3(0, 0, 0),
    rot,
    team: 0,
    boost: 33,
    onGround: true,
    supersonic: false,
    boosting: false,
    demoed: false,
    jumping: false,
    wheelContact: [true, true, true, true],
    groundNormal: UP,
    ...overrides,
  };
}

const settle = (camera: PlayerCamera, c: CarState, ball: Vec3, ballCam = false, seconds = 5) => {
  let view = camera.update(1 / 120, c, ball, ballCam);
  for (let t = 0; t < seconds * 120; t++) view = camera.update(1 / 120, c, ball, ballCam);
  return view;
};

const DEG = Math.PI / 180;

describe("car cam", () => {
  it("rests behind the car: focus 100 above it, 270 back along a view pitched down 3 degrees", () => {
    const view = settle(new PlayerCamera(), car(), vec3(0, 3000, 93));
    const pitch = Math.trunc(-3 * 182.044) * ((2 * Math.PI) / 65536);
    const focus = vec3(0, 0, 117);
    const expected = sub(focus, vec3(Math.cos(pitch) * 270, 0, Math.sin(pitch) * 270));
    expect(view.position.x).toBeCloseTo(expected.x, 1);
    expect(view.position.y).toBeCloseTo(0, 3);
    expect(view.position.z).toBeCloseTo(expected.z, 1);
    expect(view.forward.z).toBeCloseTo(Math.sin(-3 * DEG), 3);
    expect(view.horizontalFov).toBeCloseTo(90);
  });

  it("falls back with speed (stiffness 0.5) and widens the FOV", () => {
    const view = settle(new PlayerCamera(), car({ vel: vec3(1400, 0, 0) }), vec3(0, 3000, 93));
    const distance = Math.hypot(view.position.x - 0, view.position.z - 117);
    expect(distance).toBeCloseTo(270 + 1400 * 0.05 * 0.5, 0);
    expect(view.horizontalFov).toBeCloseTo(90 + (5 * 1400) / 2300, 2);
  });

  it("adds 10 degrees of FOV when supersonic", () => {
    const view = settle(new PlayerCamera(), car({ vel: vec3(2300, 0, 0), supersonic: true }), vec3(0, 3000, 93));
    expect(view.horizontalFov).toBeCloseTo(100, 2);
  });

  it("follows the car round a turn", () => {
    const camera = new PlayerCamera();
    settle(camera, car(), vec3(0, 3000, 93));
    const turned: Rot3 = { forward: vec3(0, 1, 0), right: vec3(-1, 0, 0), up: UP };
    const first = camera.update(1 / 60, car({ rot: turned }), vec3(0, 3000, 93), false);
    expect(first.forward.y).toBeGreaterThan(0.1); // turning quickly...
    expect(first.forward.y).toBeLessThan(0.9); // ...but smoothed
    const view = settle(camera, car({ rot: turned }), vec3(0, 3000, 93));
    expect(view.forward.y).toBeCloseTo(Math.cos(3 * DEG), 3);
  });

  it("rolls a tenth of the car's roll", () => {
    const roll = 20 * DEG;
    const rolled: Rot3 = {
      forward: vec3(1, 0, 0),
      right: vec3(0, Math.cos(roll), -Math.sin(roll)),
      up: vec3(0, Math.sin(roll), Math.cos(roll)),
    };
    const view = settle(new PlayerCamera(), car({ rot: rolled }), vec3(0, 3000, 93));
    expect(Math.atan2(view.up.y, view.up.z)).toBeCloseTo(roll * 0.1, 2);
  });
});

describe("ball cam", () => {
  it("turns to face the ball", () => {
    const ball = vec3(2000, 2000, 93);
    const view = settle(new PlayerCamera(), car(), ball, true);
    const dir = Math.atan2(view.forward.y, view.forward.x);
    const toBall = Math.atan2(ball.y - view.position.y, ball.x - view.position.x);
    expect(Math.abs(dir - toBall)).toBeLessThan(0.05);
  });

  it("blends the switch over 0.5 s instead of jumping", () => {
    const camera = new PlayerCamera();
    const ball = vec3(0, 3000, 93);
    const before = settle(camera, car(), ball);
    const switched = camera.update(1 / 120, car(), ball, true);
    // Right after the switch the view is still almost where it was
    expect(Math.hypot(switched.position.x - before.position.x, switched.position.y - before.position.y)).toBeLessThan(15);
    const after = settle(camera, car(), ball, true, 1);
    expect(after.forward.y).toBeGreaterThan(0.9); // now looking at the ball (+y)
  });
});
