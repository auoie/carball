// The free-camera editor's rules (notes/training-editor.md TE1 §2-3): the flight, the clamps, the look, the selection's
// edits, the speed and time steps, the camera behind the selection, the meter's needle, the bumpers' repeat, the tap and
// the hold, undo and redo
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import {
  BEHIND,
  CLAMPS,
  FLIGHT,
  REPEAT,
  Repeat,
  ShotHistory,
  TAP_SECONDS,
  TapHold,
  UNITS_PER_RAD,
  axes,
  behind,
  clampTo,
  cycle,
  editBall,
  editCar,
  firstCamera,
  flyVelocity,
  follow,
  lookPose,
  needleDegrees,
  resetPitch,
  stepSpeed,
  stepTime,
} from "./editorControls";
import type { Shot } from "./pack";

const shot: Shot = {
  timeLimit: 10,
  ball: { location: vec3(0, 4120, 100), launch: { pitch: 8192, yaw: 16384, roll: 0 }, speed: 1500 },
  car: { location: vec3(0, 0, 17), rotation: { pitch: 0, yaw: 16384, roll: 0 }, startSpeed: 0 },
};
const still = { forward: 0, right: 0, up: 0 };
const run = (seconds: number, move: typeof still, yaw = 0, dt = 1 / 120) => {
  let v = vec3(0, 0, 0);
  for (let t = 0; t < seconds - 1e-9; t += dt) v = flyVelocity(v, move, yaw, dt);
  return v;
};

describe("the fly camera's flight (TE-4: 2000 uu/s across, 1000 up, 4000 uu/s², braked 10/s)", () => {
  it("speeds up at 4000 to 2000 along the camera's yaw, up and down at half both", () => {
    expect(run(0.25, { ...still, forward: 1 }).x).toBeCloseTo(1000, 0);
    expect(run(1, { ...still, forward: 1 }).x).toBeCloseTo(FLIGHT.speed, 6);
    expect(run(1, { ...still, up: 1 }).z).toBeCloseTo(FLIGHT.speed * FLIGHT.vertical, 6);
    expect(run(1, { ...still, up: -1 }).z).toBeCloseTo(-1000, 6);
    // (yaw 90°: forward is +y, right is -x)
    const v = run(1, { ...still, forward: 1 }, Math.PI / 2);
    expect([v.x, v.y]).toEqual([expect.closeTo(0, 6), expect.closeTo(2000, 6)]);
    expect(run(1, { ...still, right: 1 }, Math.PI / 2).x).toBeCloseTo(-2000, 6);
    // (a stick half over: half the top speed)
    expect(run(2, { ...still, forward: 0.5 }).x).toBeCloseTo(1000, 6);
  });

  it("with no input the speed is braked by min(10 dt, 1) a frame; across the input, only what's off it", () => {
    const v = flyVelocity(vec3(2000, 0, 1000), still, 0, 0.05);
    expect([v.x, v.z]).toEqual([1000, 500]);
    expect(flyVelocity(vec3(2000, 0, 0), still, 0, 0.2)).toEqual(vec3(0, 0, 0));
    const turned = flyVelocity(vec3(0, 2000, 0), { ...still, forward: 1 }, 0, 0.05);
    expect(turned.y).toBeCloseTo(1000, 6);
    expect(turned.x).toBeCloseTo(200, 6);
  });
});

describe("the clamps (TE-5, simplified: the ball and car inside the arena)", () => {
  it("keep the camera in the stadium's box, the ball 100 up at least, the car on or above the floor", () => {
    expect(clampTo("camera", vec3(9000, -9000, 0))).toEqual(vec3(5037, -6936, 15));
    expect(clampTo("camera", vec3(0, 0, 9000)).z).toBe(4096);
    expect(clampTo("ball", vec3(0, 0, 20)).z).toBe(100);
    expect(clampTo("ball", vec3(5000, 6000, 3000))).toEqual(vec3(CLAMPS.ball.x, CLAMPS.ball.y, CLAMPS.ball.zMax));
    expect(clampTo("car", vec3(0, 0, 0)).z).toBe(17);
  });

  it("the look turns the camera's pitch within ±90°, its yaw any", () => {
    const p = lookPose({ pos: vec3(0, 0, 0), yaw: 0, pitch: 0 }, 10, 3);
    expect(p.pitch).toBeCloseTo(Math.PI / 2, 12);
    expect(p.yaw).toBe(10);
    expect(lookPose(p, 0, -5).pitch).toBeCloseTo(-Math.PI / 2, 12);
  });
});

describe("the selection's edits (TE-3, TE-6)", () => {
  it("the ball moved within its clamp, its launch turned: the pitch within a quarter turn, the yaw wrapped", () => {
    const moved = editBall(shot, vec3(100, -50, -500), Math.PI / 2, 0);
    expect(moved.ball.location).toEqual(vec3(100, 4070, 100));
    expect(moved.ball.launch.yaw).toBe(32768);
    expect(editBall(shot, vec3(0, 0, 0), -Math.PI, 0).ball.launch.yaw).toBe(49152);
    expect(editBall(shot, vec3(0, 0, 0), 0, Math.PI).ball.launch.pitch).toBe(16384);
    expect(editBall(shot, vec3(0, 0, 0), 0, -Math.PI).ball.launch.pitch).toBe(-16384);
    expect(moved.car).toBe(shot.car);
  });

  it("the car moved and turned: its pitch untouched while locked, within ±90° unlocked; Reset Pitch puts it at 0", () => {
    const locked = editCar(shot, vec3(0, 0, 300), Math.PI / 4, 0.5, true);
    expect(locked.car.location).toEqual(vec3(0, 0, 317));
    expect(locked.car.rotation.yaw).toBe(16384 + 8192);
    expect(locked.car.rotation.pitch).toBe(0);
    const tilted = editCar(shot, vec3(0, 0, 0), 0, Math.PI, false);
    expect(tilted.car.rotation.pitch).toBe(16384);
    expect(editCar(tilted, vec3(0, 0, 0), 0, 0.3, true).car.rotation.pitch).toBe(16384);
    expect(resetPitch(tilted).car.rotation.pitch).toBe(0);
  });

  it("speeds in steps of 50 (the ball's 0-6000, the car's 0-2300), the time limit 1-59, nothing for the free camera", () => {
    expect(stepSpeed(shot, "ball", 3).ball.speed).toBe(1650);
    expect(stepSpeed(shot, "ball", 200).ball.speed).toBe(6000);
    expect(stepSpeed(shot, "ball", -200).ball.speed).toBe(0);
    expect(stepSpeed(shot, "car", 100).car.startSpeed).toBe(2300);
    expect(stepSpeed(shot, "free", 5)).toBe(shot);
    expect(stepTime(shot, 1).timeLimit).toBe(11);
    expect(stepTime({ ...shot, timeLimit: 59 }, 1).timeLimit).toBe(59);
    expect(stepTime({ ...shot, timeLimit: 1 }, -1).timeLimit).toBe(1);
  });

  it("Edit Object goes to the ball first, then the car and back", () => {
    expect([cycle("free"), cycle("ball"), cycle("car")]).toEqual(["ball", "car", "ball"]);
  });
});

describe("the camera behind the selection (TE1 §2.3)", () => {
  it("the ball's 550 behind its launch and 200 to the side, its view half the launch's pitch; the car's 300 behind and 25 up", () => {
    const pose = behind({ ...shot, ball: { ...shot.ball, launch: { pitch: 0, yaw: 0, roll: 0 } } }, "ball", -1);
    expect(pose.pos.x).toBeCloseTo(-BEHIND.ball.back, 9);
    expect(pose.pos.y).toBeCloseTo(4120 - BEHIND.ball.side, 9);
    expect(pose.pos.z).toBeCloseTo(100, 9);
    expect(behind(shot, "ball", 1).pitch).toBeCloseTo(8192 / UNITS_PER_RAD / 2, 12);
    const car = behind(shot, "car", 1);
    expect(car.pos.x).toBeCloseTo(0, 9);
    expect(car.pos.y).toBeCloseTo(-300, 9);
    expect(car.pos.z).toBe(42);
    expect([car.yaw, car.pitch]).toEqual([Math.PI / 2, 0]);
  });

  it("follows at a share of min(3 dt, 1), the yaw the short way round", () => {
    const from = { pos: vec3(0, 0, 0), yaw: 3, pitch: 0 };
    const to = { pos: vec3(100, 0, 0), yaw: -3, pitch: 1 };
    const half = follow(from, to, 1 / 6);
    expect(half.pos.x).toBeCloseTo(50, 9);
    expect(half.yaw).toBeCloseTo(3 + (2 * Math.PI - 6) / 2, 9);
    expect(follow(from, to, 1).pos.x).toBe(100);
  });

  it("a new pack's first camera: 700 behind the car, 600 to its right, 500 up, looking 25° left and 15° down", () => {
    const pose = firstCamera(shot);
    const { forward, right } = axes(Math.PI / 2, 0);
    expect(pose.pos.x).toBeCloseTo(-forward.x * 700 + right.x * 600, 9);
    expect(pose.pos.y).toBeCloseTo(-700, 9);
    expect(pose.pos.z).toBe(517);
    expect(pose.yaw).toBeCloseTo(Math.PI / 2 - (25 * Math.PI) / 180, 12);
    expect(pose.pitch).toBeCloseTo((-15 * Math.PI) / 180, 12);
  });
});

describe("the strength meter, the bumpers, Tab and R", () => {
  it("the needle from +39° at no speed to -39° at the most", () => {
    expect([needleDegrees(0, 6000), needleDegrees(3000, 6000), needleDegrees(6000, 6000), needleDegrees(9000, 6000)]).toEqual([39, 0, -39, -39]);
  });

  it("a bumper held: a step at once, at 0.25, 0.5 and 0.75 s, then every 0.02 s; let go, none", () => {
    const r = new Repeat();
    const at: number[] = [];
    let t = 0;
    if (r.set(1) === 1) at.push(0);
    const dt = 0.005;
    for (let i = 0; i < 200; i++) {
      t += dt;
      for (let k = r.tick(dt); k > 0; k--) at.push(Math.round(t * 1000) / 1000);
    }
    expect(at.slice(0, 6)).toEqual([0, REPEAT.slow, 0.5, 0.75, 0.77, 0.79]);
    expect(at).toHaveLength(4 + Math.floor((1 - 0.75) / REPEAT.fast + 1e-9));
    expect(r.set(1)).toBe(0);
    expect(r.set(0)).toBe(0);
    expect(r.tick(1)).toBe(0);
    expect(r.set(-1)).toBe(-1);
  });

  it("a tap is let go within 0.5 s; held that long, a hold once and no tap after", () => {
    const k = new TapHold();
    k.press(0);
    expect(k.poll(0.2)).toBeNull();
    expect(k.release(0.3)).toBe("tap");
    k.press(1);
    expect(k.poll(1 + TAP_SECONDS)).toBe("hold");
    expect(k.poll(2)).toBeNull();
    expect(k.release(2.5)).toBeNull();
  });
});

describe("undo and redo (TE1 §2.6)", () => {
  it("one step for edits that come within 0.5 s of each other; redo cleared by a new edit; nothing past the ends", () => {
    const h = new ShotHistory();
    const a = shot;
    const b = stepTime(a, 1);
    const c = stepTime(b, 1);
    const d = stepTime(c, 1);
    h.edited(a, 0);
    h.edited(b, 0.2);
    h.edited(c, 1);
    expect(h.undo(d)).toBe(c);
    expect(h.undo(c)).toBe(a);
    expect(h.undo(a)).toBeNull();
    expect(h.redo(a)).toBe(c);
    h.edited(c, 5);
    expect(h.redo(d)).toBeNull();
    h.clear();
    expect(h.undo(d)).toBeNull();
  });
});
