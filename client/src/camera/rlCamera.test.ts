// Scenario tests for the camera port; expected values come from the decompiled formulas.
import { describe, expect, it } from "vitest";
import type { CarState } from "../engine/world";
import { type Rot3, type Vec3, sub, vec3 } from "../math/vec";
import { type CameraControls, PlayerCamera, Swivel, quantizeSwivelInput } from "./rlCamera";

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
    demoRespawnTimer: 0,
    spawnSelection: { side: null, index: 0, locked: null },
    flipResets: 0,
    spawnCount: 0,
    ...overrides,
  };
}

const CAR_CAM: CameraControls = { ballCam: false, rear: false, lookUp: 0, lookRight: 0 };
const BALL_CAM: CameraControls = { ...CAR_CAM, ballCam: true };

const settle = (camera: PlayerCamera, c: CarState, ball: Vec3, controls = CAR_CAM, seconds = 5) => {
  let view = camera.update(1 / 120, c, ball, controls);
  for (let t = 0; t < seconds * 120; t++) view = camera.update(1 / 120, c, ball, controls);
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
    const first = camera.update(1 / 60, car({ rot: turned }), vec3(0, 3000, 93), CAR_CAM);
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
    const view = settle(new PlayerCamera(), car(), ball, BALL_CAM);
    const dir = Math.atan2(view.forward.y, view.forward.x);
    const toBall = Math.atan2(ball.y - view.position.y, ball.x - view.position.x);
    expect(Math.abs(dir - toBall)).toBeLessThan(0.05);
  });

  it("blends the switch over 0.5 s instead of jumping", () => {
    const camera = new PlayerCamera();
    const ball = vec3(0, 3000, 93);
    const before = settle(camera, car(), ball);
    const switched = camera.update(1 / 120, car(), ball, BALL_CAM);
    // Right after the switch the view is still almost where it was
    expect(Math.hypot(switched.position.x - before.position.x, switched.position.y - before.position.y)).toBeLessThan(15);
    const after = settle(camera, car(), ball, BALL_CAM, 1);
    expect(after.forward.y).toBeGreaterThan(0.9); // now looking at the ball (+y)
  });

  it("the switch eases in: a quarter of the offset is left at mid-blend (VTBlend_EaseIn, exponent 2)", () => {
    const yaw = (v: { forward: Vec3 }) => Math.atan2(v.forward.y, v.forward.x);
    const ball = vec3(0, 3000, 93);
    const carYaw = yaw(settle(new PlayerCamera(), car(), ball));
    const ballYaw = yaw(settle(new PlayerCamera(), car(), ball, BALL_CAM));
    const camera = new PlayerCamera();
    settle(camera, car(), ball);
    let view = camera.update(1 / 120, car(), ball, BALL_CAM);
    for (let i = 1; i < 30; i++) view = camera.update(1 / 120, car(), ball, BALL_CAM); // 0.25 s of the 0.5
    const left = (yaw(view) - ballYaw) / (carYaw - ballYaw);
    expect(left).toBeGreaterThan(0.2);
    expect(left).toBeLessThan(0.3); // (linear: 0.5)
  });
});

describe("swivel and rear camera", () => {
  const yawDegrees = (v: { forward: Vec3 }) => Math.atan2(v.forward.y, v.forward.x) / DEG;
  const pitchDegrees = (v: { forward: Vec3 }) => Math.asin(v.forward.z) / DEG;

  it("the look input is replicated as a byte", () => {
    expect(quantizeSwivelInput(0)).toBe(0);
    expect(quantizeSwivelInput(1)).toBe(1);
    expect(quantizeSwivelInput(-1)).toBe(-1);
    expect(quantizeSwivelInput(2)).toBe(1);
    expect(quantizeSwivelInput(0.5)).toBeCloseTo(64 / 127, 6);
    expect(quantizeSwivelInput(-0.5)).toBe(-0.5);
  });

  it("full right turns the view 22500 units (123.6 degrees) when slow", () => {
    const view = settle(new PlayerCamera(), car(), vec3(0, 3000, 93), { ...CAR_CAM, lookRight: 1 }, 10);
    expect(yawDegrees(view)).toBeCloseTo((22500 * 360) / 65536, 0);
  });

  it("looks less far round at speed, up to 30 degrees up and 49 down", () => {
    const s = new Swivel();
    for (let i = 0; i < 2000; i++) s.update(1 / 120, 0, 1, 2500, 2.5);
    expect(s.rotation.yaw).toBeGreaterThan(17900);
    expect(s.rotation.yaw).toBeLessThanOrEqual(18000);
    for (let i = 0; i < 2000; i++) s.update(1 / 120, 1, 0, 0, 2.5);
    expect(s.rotation.pitch).toBeGreaterThan(5400);
    for (let i = 0; i < 2000; i++) s.update(1 / 120, -1, 0, 0, 2.5);
    expect(s.rotation.pitch).toBeLessThan(-8800);
  });

  it("eases out at the swivel speed and returns twice as fast", () => {
    const s = new Swivel();
    s.update(0.1, 0, 1, 0, 2.5); // 25% of the way
    expect(s.rotation.yaw).toBe(Math.trunc(22500 * 0.25));
    const out = s.rotation.yaw;
    s.update(0.1, 0, 0, 0, 2.5); // back towards 0 at 5/s: 50% of the way
    expect(s.rotation.yaw).toBe(Math.trunc(out * 0.5));
  });

  it("pitch adds to the camera's angle", () => {
    const view = settle(new PlayerCamera(), car(), vec3(0, 3000, 93), { ...CAR_CAM, lookUp: 1 }, 10);
    expect(pitchDegrees(view)).toBeCloseTo(((5500 - Math.trunc(-3 * 182.044) * -1) * 360) / 65536, 0);
  });

  it("the rear camera looks backwards", () => {
    const view = settle(new PlayerCamera(), car(), vec3(0, 3000, 93), { ...CAR_CAM, rear: true });
    expect(view.forward.x).toBeLessThan(-0.99);
  });

  it("with the rear camera the ball cam stops looking at the ball", () => {
    const view = settle(new PlayerCamera(), car(), vec3(0, 3000, 93), { ...BALL_CAM, rear: true });
    expect(view.forward.x).toBeLessThan(-0.99);
  });
});

describe("respawn cameras (notes/camera-respawn-goal.md CAM-20..29)", () => {
  const wreck = vec3(1000, -2000, 17);
  const demoed = (timer: number, locked: { pos: Vec3; yaw: number } | null = null) =>
    car({ pos: wreck, demoed: true, demoRespawnTimer: timer, spawnSelection: { side: null, index: 0, locked } });
  const ball = vec3(0, 3000, 93);
  const spot = { pos: vec3(-2304, -4608, 17), yaw: Math.PI / 2 };
  const angle = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));

  it("a demolition blends over 0.25 s (EaseIn²) to above the wreck: 400 away at FOV 120, the view's rotation held", () => {
    const camera = new PlayerCamera();
    const before = settle(camera, car({ pos: wreck }), ball, CAR_CAM, 2);
    let view = camera.update(1 / 120, demoed(3), ball, CAR_CAM);
    for (let i = 1; i < 15; i++) view = camera.update(1 / 120, demoed(3), ball, CAR_CAM);
    // Half way: a quarter of the FOV's change left
    expect(view.horizontalFov).toBeCloseTo(120 + (before.horizontalFov - 120) * 0.25, 0);
    for (let i = 0; i < 20; i++) view = camera.update(1 / 120, demoed(3), ball, CAR_CAM);
    expect(view.horizontalFov).toBe(120);
    expect(angle(view.forward, before.forward)).toBeLessThan(1e-6);
    const focus = vec3(view.position.x + view.forward.x * 400, view.position.y + view.forward.y * 400, view.position.z + view.forward.z * 400);
    expect(focus.x).toBeCloseTo(wreck.x, 6);
    expect(focus.y).toBeCloseTo(wreck.y, 6);
    expect(focus.z).toBeCloseTo(wreck.z + 100, 6);
  });

  it("a spot picked: 0.25 s to above it (z 83 + height), facing its way level, at the player's distance and FOV", () => {
    const camera = new PlayerCamera();
    settle(camera, car({ pos: wreck }), ball, CAR_CAM, 1);
    let view = camera.update(1 / 120, demoed(3), ball, CAR_CAM);
    for (let i = 0; i < 60; i++) view = camera.update(1 / 120, demoed(2.5), ball, CAR_CAM);
    for (let i = 0; i < 31; i++) view = camera.update(1 / 120, demoed(2), ball, CAR_CAM, { held: false, selected: spot });
    expect(view.horizontalFov).toBeCloseTo(90, 6);
    expect(view.forward.y).toBeCloseTo(1, 6);
    expect(view.position.x).toBeCloseTo(spot.pos.x, 6);
    expect(view.position.y).toBeCloseTo(spot.pos.y - 270, 6);
    expect(view.position.z).toBeCloseTo(83 + 100, 6);
  });

  it("0.5 s before the respawn: the locked spot's view; then the new car blends in over 0.5 s, from behind it", () => {
    const camera = new PlayerCamera();
    settle(camera, car({ pos: wreck }), ball, CAR_CAM, 1);
    for (let i = 0; i < 300; i++) camera.update(1 / 120, demoed(3 - i / 120), ball, CAR_CAM);
    let view = camera.update(1 / 120, demoed(0.49, spot), ball, CAR_CAM);
    for (let i = 0; i < 59; i++) view = camera.update(1 / 120, demoed(0.49 - i / 120, spot), ball, CAR_CAM);
    // (blended 0.5 s from the wreck view: there)
    expect(view.position.x).toBeCloseTo(spot.pos.x, 3);
    expect(view.position.z).toBeCloseTo(183, 3);
    const respawned = car({ pos: vec3(spot.pos.x, spot.pos.y, 17), rot: { forward: vec3(0, 1, 0), right: vec3(-1, 0, 0), up: UP } });
    view = camera.update(1 / 120, respawned, ball, CAR_CAM);
    expect(view.position.x).toBeCloseTo(spot.pos.x, 0); // (no cut)
    for (let i = 0; i < 61; i++) view = camera.update(1 / 120, respawned, ball, CAR_CAM);
    expect(view.forward.y).toBeGreaterThan(0.99); // behind the new car
    expect(view.position.y).toBeLessThan(spot.pos.y - 200);
  });

  it("after a goal (respawns held) the wreck view stays, past the prespawn time", () => {
    const camera = new PlayerCamera();
    settle(camera, car({ pos: wreck }), ball, CAR_CAM, 1);
    let view = camera.update(1 / 120, demoed(3), ball, CAR_CAM);
    for (let i = 0; i < 400; i++) view = camera.update(1 / 120, demoed(0), ball, CAR_CAM, { held: true, selected: null });
    expect(view.horizontalFov).toBe(120);
  });
});

describe("free look (notes/camera-respawn-goal.md CAM-10..15)", () => {
  const SETTINGS = { smoothing: true, accelRate: 5.8, decelRate: 10.8, freeLookSpeed: 2.5 };
  const look = (yaw: number, pitch = 0, source: "stick" | "mouse" = "stick", ballCamHold = false): CameraControls => ({
    ...CAR_CAM,
    freeLook: { axes: { pitch, yaw, source }, settings: SETTINGS, ballCamHold },
  });
  const yawOf = (v: Vec3) => Math.atan2(v.y, v.x);
  const ball = vec3(0, 3000, 93);
  const turned = car({ rot: { forward: vec3(0, 1, 0), right: vec3(-1, 0, 0), up: UP } });

  it("the view turns only by the look input: the car turning under it doesn't turn it", () => {
    const camera = new PlayerCamera();
    settle(camera, car(), ball, look(0), 1);
    const view = settle(camera, turned, ball, look(0), 2);
    expect(Math.abs(yawOf(view.forward))).toBeLessThan(1e-3); // (still along +x; the classic camera follows to +y)
    expect(yawOf(settle(new PlayerCamera(), turned, ball, CAR_CAM, 2).forward)).toBeCloseTo(Math.PI / 2, 2);
  });

  it("a full stick for a second turns it 20745 units (114°), round the car (the focus stays above it)", () => {
    const camera = new PlayerCamera();
    let view = settle(camera, car(), ball, look(0), 1);
    const before = yawOf(view.forward);
    for (let i = 0; i < 120; i++) view = camera.update(1 / 120, car(), ball, look(1));
    expect((yawOf(view.forward) - before) * (32768 / Math.PI)).toBeCloseTo(20745, -1);
  });

  it("its pitch stops at 75°; no swivel in free-look mode", () => {
    const camera = new PlayerCamera();
    let view = settle(camera, car(), ball, look(0), 1);
    for (let i = 0; i < 240; i++) view = camera.update(1 / 120, car(), ball, look(0, 1));
    expect(Math.asin(view.forward.z)).toBeCloseTo((13653 * Math.PI) / 32768, 4);
    const still = settle(new PlayerCamera(), car(), ball, look(0), 1);
    const swivelled = settle(new PlayerCamera(), car(), ball, { ...look(0), lookRight: 1 }, 1);
    expect(swivelled.forward.y).toBeCloseTo(still.forward.y, 9);
  });

  it("the rear camera suspends it; let go, the view is behind the car again (recentred)", () => {
    const camera = new PlayerCamera();
    settle(camera, car(), ball, look(0), 1);
    for (let i = 0; i < 60; i++) camera.update(1 / 120, car(), ball, look(1));
    const rear = settle(camera, car(), ball, { ...look(0), rear: true }, 1);
    expect(rear.forward.x).toBeLessThan(-0.99); // (the classic rear view: backwards)
    const after = settle(camera, car(), ball, look(0), 0.1);
    expect(after.forward.x).toBeGreaterThan(0.99);
  });

  it("toggled, the free-look ball cam is left by a stick past its deadzone (not while it blends in)", () => {
    const camera = new PlayerCamera();
    settle(camera, car(), ball, look(0), 1);
    const ballCam = (yaw: number): CameraControls => ({ ...look(yaw), ballCam: true });
    camera.update(1 / 120, car(), ball, ballCam(0.5));
    expect(camera.takeBallCamExit()).toBe(false); // (blending in)
    for (let i = 0; i < 70; i++) camera.update(1 / 120, car(), ball, ballCam(0));
    expect(camera.takeBallCamExit()).toBe(false);
    camera.update(1 / 120, car(), ball, ballCam(0.5));
    expect(camera.takeBallCamExit()).toBe(true);
  });

  it("held, the free-look ball cam lasts at least its blend in", () => {
    const camera = new PlayerCamera();
    settle(camera, car(), ball, look(0, 0, "mouse", true), 1);
    let view = camera.update(1 / 120, car(), ball, { ...look(0, 0, "mouse", true), ballCam: true });
    for (let i = 0; i < 30; i++) view = camera.update(1 / 120, car(), ball, look(0, 0, "mouse", true)); // (let go at once)
    for (let i = 0; i < 40; i++) view = camera.update(1 / 120, car(), ball, look(0, 0, "mouse", true));
    expect(view.forward.y).toBeGreaterThan(0.9); // (it reached the ball before it ended: the view kept its rotation)
  });

  it("turns the demolished view too", () => {
    const camera = new PlayerCamera();
    settle(camera, car(), ball, look(0), 1);
    const wrecked = car({ demoed: true, demoRespawnTimer: 3 });
    let view = camera.update(1 / 120, wrecked, ball, look(0));
    for (let i = 0; i < 60; i++) view = camera.update(1 / 120, wrecked, ball, look(0));
    const before = yawOf(view.forward);
    for (let i = 0; i < 60; i++) view = camera.update(1 / 120, car({ demoed: true, demoRespawnTimer: 2.4 }), ball, look(1));
    expect(yawOf(view.forward) - before).toBeGreaterThan(0.5);
  });
});

describe("review fixes (RV-6..8, 11, 13)", () => {
  const SETTINGS = { smoothing: true, accelRate: 5.8, decelRate: 10.8, freeLookSpeed: 2.5 };
  const look = (yaw: number): CameraControls => ({ ...CAR_CAM, freeLook: { axes: { pitch: 0, yaw, source: "stick" }, settings: SETTINGS, ballCamHold: false } });
  const yawDeg = (v: Vec3) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
  const ball = vec3(0, 3000, 93);
  const spot = (x: number, yaw: number) => ({ pos: vec3(x, -4608, 17), yaw });
  const wreck = (timer: number) => car({ demoed: true, demoRespawnTimer: timer });

  it("RV-6: the free-look ball cam faces the ball at once, the old view fading out EaseIn²: a quarter short at mid-blend", () => {
    const camera = new PlayerCamera();
    settle(camera, car(), ball, look(0), 1);
    let view = camera.update(1 / 120, car(), ball, { ...look(0), ballCam: true });
    for (let i = 1; i < 30; i++) view = camera.update(1 / 120, car(), ball, { ...look(0), ballCam: true });
    expect(yawDeg(view.forward)).toBeGreaterThan(90 - 22.5 - 3);
    expect(yawDeg(view.forward)).toBeLessThan(90 - 22.5 + 3);
  });

  it("RV-7: a new pick moves from the view shown, even mid-move: no jump, and its first frame is where it was", () => {
    const camera = new PlayerCamera();
    settle(camera, car(), ball, CAR_CAM, 1);
    camera.update(1 / 120, wreck(3), ball, CAR_CAM);
    let view = camera.update(1 / 120, wreck(2.9), ball, CAR_CAM, { held: false, selected: spot(-2000, Math.PI / 2) });
    for (let i = 0; i < 60; i++) view = camera.update(1 / 120, wreck(2.8), ball, CAR_CAM, { held: false, selected: spot(-2000, Math.PI / 2) });
    const steps: number[] = [];
    let last = view.position;
    for (let i = 0; i < 20; i++) {
      const pick = i < 6 ? spot(0, Math.PI / 2) : spot(2000, Math.PI / 2);
      view = camera.update(1 / 120, wreck(2.7), ball, CAR_CAM, { held: false, selected: pick });
      steps.push(Math.hypot(view.position.x - last.x, view.position.y - last.y));
      last = view.position;
    }
    expect(steps[0]).toBeCloseTo(0, 6); // (the change's frame: where it was)
    expect(steps[6]).toBeCloseTo(0, 6);
    expect(Math.max(...steps)).toBeLessThan(400); // (no jump: 2000 uu in 0.1 s at most ~170 a frame)
  });

  it("RV-8: with no spot locked, the new car cuts in: its first frame is a fresh car cam's", () => {
    const camera = new PlayerCamera();
    settle(camera, car(), ball, CAR_CAM, 1);
    for (let i = 0; i < 240; i++) camera.update(1 / 120, wreck(2 - i / 120), ball, CAR_CAM);
    const respawned = car({ pos: vec3(-2304, -4608, 17) });
    const view = camera.update(1 / 120, respawned, ball, CAR_CAM);
    const fresh = new PlayerCamera().update(1 / 120, respawned, ball, CAR_CAM);
    expect(view.position.x).toBeCloseTo(fresh.position.x, 6);
    expect(view.position.y).toBeCloseTo(fresh.position.y, 6);
    expect(view.position.z).toBeCloseTo(fresh.position.z, 6);
  });

  it("RV-11: the free look still turning in the wreck view doesn't carry into the spot's view", () => {
    const camera = new PlayerCamera();
    settle(camera, car(), ball, look(0), 1);
    for (let i = 0; i < 60; i++) camera.update(1 / 120, wreck(3 - i / 120), ball, look(1));
    let view = camera.update(1 / 120, wreck(2.4), ball, look(0), { held: false, selected: spot(-2000, Math.PI / 2) });
    for (let i = 0; i < 60; i++) view = camera.update(1 / 120, wreck(2.4 - i / 120), ball, look(0), { held: false, selected: spot(-2000, Math.PI / 2) });
    expect(yawDeg(view.forward)).toBeCloseTo(90, 6);
  });

  it("RV-13: free-look mode keeps the swivel as it was: back in classic, it's there on the first frame", () => {
    const camera = new PlayerCamera();
    const swivel = { ...CAR_CAM, lookRight: 1 };
    const before = settle(camera, car(), ball, swivel, 4); // (the swivel settled: the next frame adds nothing)
    settle(camera, car(), ball, { ...look(0), lookRight: 1 }, 1);
    const after = camera.update(1 / 120, car(), ball, swivel);
    expect(yawDeg(after.forward)).toBeCloseTo(yawDeg(before.forward), 1);
  });
});
