// The goal replay's camera against CameraState_LiveReplay_TA's rules (notes/camera-respawn-goal.md GS-10).
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { ReplayCamera } from "./replayCamera";

const still = (x: number, y: number, z: number): { pos: ReturnType<typeof vec3>; vel: ReturnType<typeof vec3> } => ({
  pos: vec3(x, y, z),
  vel: vec3(0, 0, 0),
});

describe("the goal replay's camera", () => {
  it("looks at a ball in the goal from 9000 up the field, 1000 up, 1800 from it", () => {
    const camera = new ReplayCamera(0); // (blue scores into orange's goal, y +5120)
    const view = camera.update(1 / 60, { car: null, ball: still(0, 5120, 320), carId: null }, 1);
    // The base: (0, 5120 - 9000, 1320); the camera 1800 from the ball towards it
    const toBase = Math.hypot(0, -9000, 1000);
    expect(view.position.x).toBeCloseTo(0, 6);
    expect(view.position.y).toBeCloseTo(5120 - (9000 * 1800) / toBase, 6);
    expect(view.position.z).toBeCloseTo(320 + (1000 * 1800) / toBase, 6);
    expect(view.forward.y).toBeGreaterThan(0.99);
    expect(view.horizontalFov).toBe(75);
  });

  it("slides to the field's +x side as the play comes out of the goal, for either goal", () => {
    for (const team of [0, 1]) {
      const camera = new ReplayCamera(team);
      const goalY = team === 0 ? 5120 : -5120;
      const view = camera.update(1 / 60, { car: null, ball: still(0, goalY - Math.sign(goalY) * 9000, 320), carId: null }, 1);
      // Focus 9000 out: the base at its full side offset, x +4000
      expect(view.position.x).toBeGreaterThan(1000);
    }
  });

  it("zooms in over a second of slowed replay: FOV 75 to 25", () => {
    const camera = new ReplayCamera(0);
    const focus = { car: null, ball: still(0, 4000, 300), carId: null };
    let view = camera.update(0, focus, 1);
    for (let i = 0; i < 30; i++) view = camera.update(1 / 60, focus, 0.25);
    expect(view.horizontalFov).toBeCloseTo(50, 6);
    for (let i = 0; i < 60; i++) view = camera.update(1 / 60, focus, 0.25);
    expect(view.horizontalFov).toBeCloseTo(25, 6);
  });

  it("focuses between the car and the ball when they're close, at a third of the way up from the car", () => {
    const camera = new ReplayCamera(0);
    const car = still(0, 3000, 17);
    const ball = still(0, 3000, 317);
    const view = camera.update(1 / 60, { car, ball, carId: 1 }, 1);
    // (d 300: the focus 300/1800 short of the midpoint's pull; z lerp(17, 317, 0.35) = 122)
    const focus = { x: view.position.x + view.forward.x * 1800, y: view.position.y + view.forward.y * 1800, z: view.position.z + view.forward.z * 1800 };
    expect(focus.z).toBeCloseTo(122, 6);
    expect(focus.y).toBeCloseTo(3000, 6);
  });
});

describe("the replay camera's focus speed (RV-5)", () => {
  it("keeps its pace when the focus goes to the ball alone: 4/s, 6.7 % of the way in a 60 fps frame", () => {
    const camera = new ReplayCamera(0);
    const at = vec3(0, 3000, 300);
    for (let i = 0; i < 120; i++) camera.update(1 / 60, { car: { pos: at, vel: vec3(0, 0, 0) }, ball: { pos: at, vel: vec3(0, 0, 0) }, carId: 1 }, 1);
    const view = camera.update(1 / 60, { car: null, ball: { pos: vec3(1000, 3000, 300), vel: vec3(0, 0, 0) }, carId: null }, 1);
    const focus = view.position.x + view.forward.x * 1800;
    expect(focus).toBeCloseTo(1000 * (4 / 60), 0);
  });
});
