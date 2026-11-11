// The camera at the display's rate (src/camera/pacedCamera.ts; notes/camera.md): at even frames it's the game's camera
// exactly (stepped once a frame with the frame's time), so its lag behind a turning car is the game's at that rate; at
// uneven ones (a phone's dropped frames, Firefox's timer, a hitch) it runs whole steps and holds the car still on screen;
// it follows the display's rate as it changes, a touch device's cap, a goal's slow motion; the mouse's free look whole.
import { describe, expect, it } from "vitest";
import type { CarState } from "../engine/world";
import { Interpolated } from "../game/interpolated";
import { FixedStep, TICK_SECONDS } from "../loop/fixedStep";
import { type Rot3, type Vec3, vec3 } from "../math/vec";
import { type CameraControls, type CameraView, PlayerCamera } from "./carballCamera";
import { PacedCamera } from "./pacedCamera";

const UP = vec3(0, 0, 1);
const BALL = vec3(0, 3000, 93);
const CAR_CAM: CameraControls = { ballCam: false, rear: false, lookUp: 0, lookRight: 0 };

function car(pos: Vec3, vel: Vec3, rot: Rot3, onGround = true): CarState {
  return {
    pos,
    vel,
    angVel: vec3(0, 0, 0),
    rot,
    team: 0,
    boost: 33,
    onGround,
    supersonic: false,
    boosting: false,
    demoed: false,
    jumping: false,
    hasJumped: !onGround,
    doubleJumped: false,
    hasFlipped: false,
    flipping: false,
    airTimeSinceJump: 0,
    hasFlipOrJump: true,
    hasFlipReset: false,
    worldWheelContacts: onGround ? 4 : 0,
    onRbActor: false,
    wheelGround: onGround ? ["arena", "arena", "arena", "arena"] : [null, null, null, null],
    rbActor: null,
    wheelContact: onGround ? [true, true, true, true] : [false, false, false, false],
    groundNormal: UP,
    wheelNormals: [UP, UP, UP, UP],
    demoRespawnTimer: 0,
    handbrakeVal: 0,
    lastBallHitTick: -1,
    spawnSelection: { side: null, index: 0, locked: null },
    flipResets: 0,
    spawnCount: 0,
  } as CarState;
}

/** A steady full-lock turn to the left (1410 uu/s, 653 uu: the review's), at world time `t` */
function turning(t: number): CarState {
  const w = -1410 / 653;
  const th = w * t;
  const f = vec3(Math.cos(th), Math.sin(th), 0);
  const r = vec3(-Math.sin(th), Math.cos(th), 0);
  return car(vec3(653 * Math.sin(-th) * -1, 653 - 653 * Math.cos(th), 17), vec3(f.x * 1410, f.y * 1410, 0), { forward: f, right: r, up: UP });
}

/** The turn for 2 s, then in the air turned a quarter turn (its velocity too), flying on: the air camera's settle */
function turnThenAir(t: number): CarState {
  if (t < 2) return turning(t);
  const from = turning(2);
  const f = from.rot.right;
  const flown = t - 2;
  return car(
    vec3(from.pos.x + f.x * 1410 * flown, from.pos.y + f.y * 1410 * flown, 300),
    vec3(f.x * 1410, f.y * 1410, 0),
    { forward: f, right: vec3(-from.rot.forward.x, -from.rot.forward.y, 0), up: UP },
    false,
  );
}

interface Frame {
  readonly view: CameraView;
  readonly car: CarState;
}

/** A run of frames (`dts`: real seconds; `dilation`: world over real), physics on its own clock, the car on `path` (world
 *  time) at each tick and drawn between the last two (as the game draws it). `game`: the game's camera, stepped once a
 *  frame with the frame's time, the car as drawn at the frame's alpha; else ours, the car drawn at the alpha it gives */
function frames(
  dts: readonly number[],
  path: (t: number) => CarState,
  o: { game?: boolean; dilation?: (i: number) => number; controls?: (i: number, dt: number) => CameraControls } = {},
): Frame[] {
  const clock = new FixedStep();
  const paced = new PacedCamera();
  const game = new PlayerCamera();
  const body = new Interpolated(path(0));
  let index = 0;
  return dts.map((dt, i) => {
    const world = dt * (o.dilation?.(i) ?? 1);
    const ticks = clock.advance(world);
    for (let k = 0; k < ticks; k++) {
      index++;
      body.push(path(index * TICK_SECONDS));
      paced.tick(body.current, BALL, null);
    }
    const controls = o.controls?.(i, dt) ?? CAR_CAM;
    if (o.game) {
      const drawn = body.blended(clock.alpha);
      return { view: game.update(world, drawn, BALL, controls, null, dt), car: drawn };
    }
    paced.plan(dt, clock.alpha);
    const drawn = paced.subject ?? body.blended(clock.alpha);
    return { view: paced.run(controls, { car: drawn, ball: BALL, respawn: null }), car: drawn };
  });
}

/** The car's yaw on screen (degrees: its heading less the view's) */
function onScreen(f: Frame): number {
  const d = Math.atan2(f.car.rot.forward.y, f.car.rot.forward.x) - Math.atan2(f.view.forward.y, f.view.forward.x);
  return (Math.atan2(Math.sin(d), Math.cos(d)) * 180) / Math.PI;
}

const tail = (run: readonly Frame[]): number[] => run.slice(Math.floor(run.length / 2)).map(onScreen);
const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const range = (v: readonly number[]): number => Math.max(...v) - Math.min(...v);
const even = (hz: number, seconds: number): number[] => Array.from({ length: Math.round(hz * seconds) }, () => 1 / hz);
/** Frames on a steady clock (`hz`), each one's time off by up to ±`by` s (a timer's jitter: the clock itself steady), as
 *  the intervals between them */
function jittered(hz: number, seconds: number, by: number, r: () => number): number[] {
  const times = Array.from({ length: Math.round(hz * seconds) + 1 }, (_, i) => i / hz + (i === 0 ? 0 : (r() - 0.5) * 2 * by));
  return times.slice(1).map((t, i) => t - (times[i] ?? 0));
}

/** A seeded generator (the same frames each run) */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("the camera at the display's rate", () => {
  it("at even frames it is the game's camera, frame for frame: a turn, then the air's quarter turn settling, a goal's slow motion", () => {
    const dts = even(60, 5);
    const slow = (i: number): number => (i >= 60 && i < 120 ? 0.25 : 1);
    for (const dilation of [(): number => 1, slow]) {
      const ours = frames(dts, turnThenAir, { dilation });
      const game = frames(dts, turnThenAir, { game: true, dilation });
      ours.forEach((f, i) => {
        const g = game[i];
        expect(Math.abs(f.view.forward.x - (g?.view.forward.x ?? 0)) + Math.abs(f.view.forward.y - (g?.view.forward.y ?? 0))).toBeLessThan(1e-9);
      });
    }
  });

  it("follows a steady turn as the game does at the display's rate: 3.23° at 60, 3.76° at 144, 3.92° at 240; 2.45° at a phone's 30", () => {
    for (const [hz, lag] of [
      [60, 3.23],
      [144, 3.76],
      [240, 3.92],
      [30, 2.45],
    ] as const) {
      const ours = mean(tail(frames(even(hz, 6), turning)));
      const game = mean(tail(frames(even(hz, 6), turning, { game: true })));
      expect(ours, `${String(hz)} Hz`).toBeCloseTo(game, 3);
      expect(Math.abs(ours), `${String(hz)} Hz`).toBeCloseTo(lag, 2);
    }
  });

  it("holds a steady turn still on screen at uneven frames, at the display's lag: dropped frames, Firefox's timer, a hitch, a display off its rate", () => {
    const r = rng(1);
    const at = (hz: number, seconds: number): number[] => Array.from({ length: Math.round(hz * seconds) }, () => 1 / hz);
    const cases: [string, number[], number, number][] = [
      ["60 Hz, 15 % dropped (a phone)", Array.from({ length: 600 }, () => (r() < 0.15 ? 2 / 60 : 1 / 60)), 3.23, 0.01],
      [
        "Firefox's 16/17 ms (headless Firefox's recorded alternation, around 60 Hz)",
        Array.from({ length: 600 }, (_, i) => (i % 2 ? 0.01717 : 0.01617)),
        3.23,
        0.01,
      ],
      ["a 16/17 ms alternation off 60 Hz (16.56 ms on average)", Array.from({ length: 600 }, (_, i) => (i % 2 ? 0.01706 : 0.01606)), 3.23, 0.01],
      ["60 Hz, each frame's time ±1 ms", jittered(60, 10, 0.001, r), 3.23, 0.01],
      ["144 Hz, each frame's time ±0.5 ms", jittered(144, 10, 0.0005, r), 3.76, 0.01],
      ["60 Hz with a hitch of two refreshes every second", Array.from({ length: 600 }, (_, i) => (i % 60 === 59 ? 2 / 60 : 1 / 60)), 3.23, 0.01],
      ["a 143.9 Hz display", at(143.9, 10), 3.76, 0.01],
      ["a variable-refresh display at 110 a second", at(110, 10), 3.6, 0.01],
      // (a stress past any browser's timer: ±2 ms at 144 Hz, 29 % of a frame either way; the game's camera, stepped with
      // each frame's time, wobbles 0.5° there)
      ["144 Hz, each frame's time ±2 ms", jittered(144, 10, 0.002, r), 3.76, 0.03],
    ];
    for (const [name, dts, lag, still] of cases) {
      const seen = tail(frames(dts, turning));
      expect(range(seen), name).toBeLessThan(still);
      expect(Math.abs(mean(seen)), name).toBeCloseTo(lag, 1);
    }
    // (a stall past what the physics clock runs in a frame, 66 ms, its last frame in each second: its lost time a short
    // swing, settled within a quarter of a second)
    const stalls = frames(
      Array.from({ length: 600 }, (_, i) => (i % 60 === 59 ? 0.066 : 1 / 60)),
      turning,
    ).map(onScreen);
    const settled = stalls.filter((_, i) => i >= 300 && i % 60 >= 15 && i % 60 < 59);
    expect(range(settled)).toBeLessThan(0.01);
    // (where the game's camera, stepped with each frame's time, wobbles)
    expect(range(tail(frames(cases[0]?.[1] ?? [], turning, { game: true })))).toBeGreaterThan(0.3);
  });

  it("follows the display's rate as it changes (a window moved from a 144 Hz display to a 60 Hz one): the new rate's lag, still", () => {
    const run = frames([...even(144, 3), ...even(60, 6)], turning);
    const before = run.slice(300, 432).map(onScreen);
    const after = run.slice(run.length - 120).map(onScreen);
    expect(Math.abs(mean(before))).toBeCloseTo(3.76, 2);
    expect(Math.abs(mean(after))).toBeCloseTo(3.23, 2);
    expect(range(after)).toBeLessThan(0.01);
  });

  it("the mouse's free look whole: a frame's counts shared over its steps, so dropped frames turn it as far as even ones", () => {
    const still = (): CarState => turning(0);
    const look = (yaw: number): CameraControls => ({
      ...CAR_CAM,
      freeLook: { axes: { pitch: 0, yaw, source: "mouse" }, settings: { smoothing: false, accelRate: 1, decelRate: 1, freeLookSpeed: 1 }, ballCamHold: false },
    });
    const yawOf = (run: readonly Frame[]): number => {
      const v = run[run.length - 1]?.view;
      return v ? Math.atan2(v.forward.y, v.forward.x) : 0;
    };
    // (6 counts a 60th of a second, each frame its time's worth)
    const evenRun = frames(even(60, 2), still, { controls: (_, dt) => look(Math.round(dt * 360)) });
    // (a phone's few dropped frames: a 60 Hz display still)
    const pattern = [1, 1, 1, 2, 1, 1, 1, 1, 1, 3, 1, 1, 1];
    const uneven: number[] = [];
    for (let left = 120, i = 0; left > 0; i++) {
      const n = Math.min(pattern[i % pattern.length] ?? 1, left);
      uneven.push(n / 60);
      left -= n;
    }
    const unevenRun = frames(uneven, still, { controls: (_, dt) => look(Math.round(dt * 360)) });
    expect(Math.abs(yawOf(evenRun))).toBeGreaterThan(0.02);
    expect(yawOf(unevenRun)).toBeCloseTo(yawOf(evenRun), 6);
  });

  it("a new car (a reset) starts it over at once; a teleport between two ticks is not blended through", () => {
    const paced = new PacedCamera();
    paced.tick(turning(0), BALL, null);
    paced.tick({ ...turning(TICK_SECONDS), pos: vec3(4000, 0, 17) }, BALL, null);
    paced.plan(1 / 60, 0.5);
    const view = paced.run(CAR_CAM, { car: turning(0), ball: BALL, respawn: null });
    // (the camera behind the car where it was put, not halfway between)
    expect(view.position.x).toBeGreaterThan(3000);
    paced.reset();
    paced.plan(1 / 60, 0.5);
    expect(paced.run(CAR_CAM, { car: turning(0), ball: BALL, respawn: null }).forward.x).toBeGreaterThan(0.9);
  });
});
