// The camera on the physics clock (src/camera/tickedCamera.ts): a car in a steady full-lock turn holds still on screen
// whatever the frames (even, a phone's dropped ones, Firefox-like timer noise, a hitch), as the camera stepped once a
// frame didn't (the user's phone and Firefox, 2026-11-10); a cut drawn at once, not blended
import { describe, expect, it } from "vitest";
import type { CarState } from "../engine/world";
import { type Rot3, vec3 } from "../math/vec";
import { type CameraControls, type CameraView, PlayerCamera } from "./carballCamera";
import { TickedCamera, blendViews } from "./tickedCamera";

const CAR_CAM: CameraControls = { ballCam: false, rear: false, lookUp: 0, lookRight: 0 };
const UP = vec3(0, 0, 1);

function car(pos: ReturnType<typeof vec3>, vel: ReturnType<typeof vec3>, rot: Rot3, angVel: ReturnType<typeof vec3>): CarState {
  return {
    pos,
    vel,
    angVel,
    rot,
    team: 0,
    boost: 33,
    onGround: true,
    supersonic: false,
    boosting: false,
    demoed: false,
    jumping: false,
    hasJumped: false,
    doubleJumped: false,
    hasFlipped: false,
    flipping: false,
    airTimeSinceJump: 0,
    hasFlipOrJump: true,
    hasFlipReset: false,
    worldWheelContacts: 4,
    onRbActor: false,
    wheelGround: ["arena", "arena", "arena", "arena"],
    rbActor: null,
    wheelContact: [true, true, true, true],
    groundNormal: UP,
    wheelNormals: [UP, UP, UP, UP],
    demoRespawnTimer: 0,
    handbrakeVal: 0,
    lastBallHitTick: -1,
    spawnSelection: { side: null, index: 0, locked: null },
    flipResets: 0,
    spawnCount: 0,
  };
}

/** The car at time t on a circle (speed uu/s, radius uu), turning left (the game's frame: x forward, y right, z up) */
function turning(t: number, speed: number, radius: number): CarState {
  const w = -speed / radius; // (left: yaw decreasing, y being right)
  const th = w * t;
  const f = vec3(Math.cos(th), Math.sin(th), 0);
  const r = vec3(-Math.sin(th), Math.cos(th), 0);
  const centre = vec3(0, -radius, 17);
  const pos = vec3(centre.x - r.x * -radius, centre.y - r.y * -radius, 17);
  return car(pos, vec3(f.x * speed, f.y * speed, 0), { forward: f, right: r, up: UP }, vec3(0, 0, w));
}

const TICK = 1 / 120;
const BALL = vec3(0, 3000, 93);

/** The car's yaw on screen (degrees) each frame, the second half of the run: the ticked camera's, or (`perFrame`) the
 *  camera stepped once a frame with the frame's time */
function onScreenYaw(dts: readonly number[], perFrame = false): number[] {
  const ticked = new TickedCamera();
  const camera = new PlayerCamera();
  const out: number[] = [];
  let t = 0;
  let ticks = 0;
  for (const dt of dts) {
    t += dt;
    let view: CameraView;
    let drawn: CarState;
    if (perFrame) {
      drawn = turning(t, 1410, 653);
      view = camera.update(dt, drawn, BALL, CAR_CAM);
    } else {
      while ((ticks + 1) * TICK <= t) {
        ticks++;
        ticked.tick(turning(ticks * TICK, 1410, 653), BALL, CAR_CAM, null);
      }
      // (drawn a tick behind, as the car is: between its last two ticks at the frame's alpha)
      drawn = turning(t - TICK, 1410, 653);
      view = ticked.view((t - ticks * TICK) / TICK, drawn, BALL, CAR_CAM, null);
    }
    const d = Math.atan2(drawn.rot.forward.y, drawn.rot.forward.x) - Math.atan2(view.forward.y, view.forward.x);
    out.push((Math.atan2(Math.sin(d), Math.cos(d)) * 180) / Math.PI);
  }
  return out.slice(Math.floor(out.length / 2));
}

const range = (v: readonly number[]): number => Math.max(...v) - Math.min(...v);

/** A seeded generator (the same frames each run) */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("the camera on the physics clock", () => {
  const r = rng(1);
  const frames: [string, number[]][] = [
    ["144 Hz", Array.from({ length: 1440 }, () => 1 / 144)],
    ["144 Hz ±2 ms (Firefox-like)", Array.from({ length: 1440 }, () => 1 / 144 + (r() - 0.5) * 0.004)],
    ["60 Hz, 15 % dropped (a phone)", Array.from({ length: 600 }, () => (r() < 0.15 ? 2 / 60 : 1 / 60))],
    ["60 Hz with a 66 ms hitch every second", Array.from({ length: 600 }, (_, i) => (i % 60 === 59 ? 0.066 : 1 / 60))],
  ];

  it.each(frames)("a steady turn holds still on screen: %s", (_, dts) => {
    expect(range(onScreenYaw(dts))).toBeLessThan(0.01);
  });

  it("where the camera stepped once a frame wobbled (the bug): a phone's dropped frames, a hitch", () => {
    expect(range(onScreenYaw(frames[2]?.[1] ?? [], true))).toBeGreaterThan(0.3);
    expect(range(onScreenYaw(frames[3]?.[1] ?? [], true))).toBeGreaterThan(0.3);
  });

  it("follows the turn as the game's camera does at a steady 120 Hz", () => {
    const at120 = onScreenYaw(
      Array.from({ length: 1200 }, () => TICK),
      true,
    );
    const ticked = onScreenYaw(frames[2]?.[1] ?? []);
    expect(ticked[ticked.length - 1] ?? 0).toBeCloseTo(at120[at120.length - 1] ?? 1, 2);
  });

  it("a cut (the rear view, a new car) is drawn at once, not blended through", () => {
    const a: CameraView = { position: vec3(0, 0, 100), forward: vec3(1, 0, 0), up: vec3(0, 0, 1), horizontalFov: 110 };
    const behind: CameraView = { ...a, forward: vec3(-1, 0, 0) };
    expect(blendViews(a, behind, 0.5)).toBe(behind);
    const far: CameraView = { ...a, position: vec3(2000, 0, 100) };
    expect(blendViews(a, far, 0.5)).toBe(far);
    const near: CameraView = { ...a, position: vec3(10, 0, 100), horizontalFov: 112 };
    expect(blendViews(a, near, 0.5)).toMatchObject({ position: vec3(5, 0, 100), horizontalFov: 111 });
  });

  it("the mouse's free look: a frame's counts shared over its ticks, so uneven frames turn it as far as even ones", () => {
    const still = turning(0, 0, 653);
    const look = (yaw: number): CameraControls => ({
      ...CAR_CAM,
      freeLook: {
        axes: { pitch: 0, yaw, source: "mouse" },
        settings: { smoothing: false, accelRate: 1, decelRate: 1, freeLookSpeed: 1 },
        ballCamHold: false,
      },
    });
    const yawOf = (v: CameraView): number => Math.atan2(v.forward.y, v.forward.x);
    // (even: a tick a frame, 6 counts each)
    const even = new TickedCamera();
    for (let i = 0; i < 120; i++) {
      even.frame(1, look(6).freeLook);
      even.tick(still, BALL, look(6), null);
    }
    // (uneven: 0, 1 or 2 ticks a frame, the mouse's counts the frame's time's worth)
    const uneven = new TickedCamera();
    const pattern = [1, 2, 0, 1, 2, 0, 0, 2, 1, 1];
    for (let done = 0, i = 0; done < 120; i++) {
      const ticks = Math.min(pattern[i % pattern.length] ?? 1, 120 - done);
      uneven.frame(ticks, look(6 * ticks).freeLook);
      for (let k = 0; k < ticks; k++) uneven.tick(still, BALL, look(6 * ticks), null);
      done += ticks;
    }
    const a = yawOf(even.view(1, still, BALL, look(0), null));
    const b = yawOf(uneven.view(1, still, BALL, look(0), null));
    expect(Math.abs(a)).toBeGreaterThan(0.02);
    expect(b).toBeCloseTo(a, 6);
  });

  it("before any tick and after a reset: the camera's own first view, at once", () => {
    const ticked = new TickedCamera();
    const still = turning(0, 0, 653);
    const first = ticked.view(0.5, still, BALL, CAR_CAM, null);
    expect(first.forward.x).toBeGreaterThan(0.9);
    ticked.tick(still, BALL, CAR_CAM, null);
    ticked.reset();
    expect(ticked.view(0.5, still, BALL, CAR_CAM, null).forward.x).toBeGreaterThan(0.9);
  });
});
