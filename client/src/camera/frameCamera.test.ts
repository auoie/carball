// The player's camera across uneven frames (src/camera/frameCamera.ts, `drift` in carballCamera.ts; notes/camera.md).
// The property, stated directly: at even frames it is the game's camera, update for update, at any rate; at uneven ones
// (dropped and doubled frames, a busy browser's two and three refreshes, a timer's jitter, a variable-refresh screen, a
// hitch) it shows what the even-frame camera shows at the same moments, in steady driving and through transients (a
// slalom with a jump, the ball cam round a moving ball). The frames come through the real physics clock and, for a touch
// device, the page's own FramePacer.
import { describe, expect, it } from "vitest";
import type { CarState } from "../engine/world";
import { blendStates } from "../game/interpolated";
import { FramePacer } from "../input/touchSettings";
import { FixedStep, TICK_SECONDS } from "../loop/fixedStep";
import { type Rot3, type Vec3, vec3 } from "../math/vec";
import { type CameraControls, type CameraView, PlayerCamera, drift } from "./carballCamera";
import { FrameCamera } from "./frameCamera";

const UP = vec3(0, 0, 1);
const STILL_BALL = vec3(0, 3000, 93);
const CAR_CAM: CameraControls = { ballCam: false, rear: false, lookUp: 0, lookRight: 0 };
const BALL_CAM: CameraControls = { ...CAR_CAM, ballCam: true };

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

const facing = (yaw: number): Rot3 => ({ forward: vec3(Math.cos(yaw), Math.sin(yaw), 0), right: vec3(-Math.sin(yaw), Math.cos(yaw), 0), up: UP });

/** A path: the car at each tick (and the ball, where it moves) */
type Path = (tick: number) => { car: CarState; ball: Vec3 };

/** A steady full-lock turn (1410 uu/s on a 653 uu circle: the reviews'), the car moving the way its velocity points */
const turning: Path = (tick) => {
  const th = (1410 / 653) * tick * TICK_SECONDS;
  return {
    car: car(vec3(653 * Math.sin(th), 653 - 653 * Math.cos(th), 17), vec3(Math.cos(th) * 1410, Math.sin(th) * 1410, 0), facing(th)),
    ball: STILL_BALL,
  };
};

/** A steady turn in the air (1410 uu/s on a 3000 uu circle, 400 uu up): the air camera's own following */
const airCircle: Path = (tick) => {
  const th = (1410 / 3000) * tick * TICK_SECONDS;
  return {
    car: car(vec3(3000 * Math.sin(th), 3000 - 3000 * Math.cos(th), 400), vec3(Math.cos(th) * 1410, Math.sin(th) * 1410, 0), facing(th), false),
    ball: STILL_BALL,
  };
};

/** The turn for 2 s, then in the air turned a quarter turn (its velocity too), flying on: the air camera's settling */
const turnThenAir: Path = (tick) => {
  const t = tick * TICK_SECONDS;
  if (t < 2) return turning(tick);
  const from = turning(240).car;
  const f = from.rot.right;
  const flown = t - 2;
  const rot = { forward: f, right: vec3(-from.rot.forward.x, -from.rot.forward.y, 0), up: UP };
  return {
    car: car(vec3(from.pos.x + f.x * 1410 * flown, from.pos.y + f.y * 1410 * flown, 300), vec3(f.x * 1410, f.y * 1410, 0), rot, false),
    ball: STILL_BALL,
  };
};

/** A path from a heading and a height over time (1400 uu/s along the heading), its positions summed tick by tick */
function driven(heading: (t: number) => number, height: (t: number) => number, ball: (t: number, at: Vec3) => Vec3): Path {
  const at: Vec3[] = [vec3(0, 0, 17)];
  return (tick) => {
    for (let k = at.length; k <= tick; k++) {
      const th = heading((k - 1) * TICK_SECONDS);
      const last = at[k - 1] ?? vec3(0, 0, 17);
      at.push(vec3(last.x + Math.cos(th) * 1400 * TICK_SECONDS, last.y + Math.sin(th) * 1400 * TICK_SECONDS, 17));
    }
    const t = tick * TICK_SECONDS;
    const th = heading(t);
    const z = height(t);
    const pos = at[tick] ?? vec3(0, 0, 17);
    const climb = (height(t + 1e-3) - z) / 1e-3;
    const here = vec3(pos.x, pos.y, 17 + z);
    return { car: car(here, vec3(Math.cos(th) * 1400, Math.sin(th) * 1400, climb), facing(th), z <= 0), ball: ball(t, here) };
  };
}

/** A slalom (the heading swinging ±46° every 2.1 s) with a jump at 3 s, 1.3 s in the air */
const slalomWithAJump = (): Path =>
  driven(
    (t) => 0.8 * Math.sin(3 * t),
    (t) => (t > 3 && t < 4.3 ? 650 * (t - 3) - 500 * (t - 3) ** 2 : 0),
    () => STILL_BALL,
  );

/** A gentle turn with the ball circling the car, 900 uu out, once every 2.6 s, rising and falling: the ball cam's view */
const roundAMovingBall = (): Path =>
  driven(
    (t) => 0.5 * t,
    () => 0,
    (t, at) => vec3(at.x + 900 * Math.cos(2.4 * t), at.y + 900 * Math.sin(2.4 * t), 300 + 250 * Math.sin(1.7 * t)),
  );

/** A frame as shown: its real seconds */
type Shown = readonly number[];

interface Frame {
  readonly view: CameraView;
  readonly car: CarState;
  /** The scene's moment (s of world time drawn) */
  readonly at: number;
}

interface Options {
  /** The game's camera: one update a frame with the frame's time (else ours) */
  readonly game?: boolean;
  /** The feel's rate (Hz), by the frame */
  readonly feel: number | ((i: number) => number);
  readonly dilation?: (i: number) => number;
  readonly controls?: CameraControls | ((i: number, dt: number) => CameraControls);
}

/** A run of frames: physics on its own clock (the game's: 5 ticks a frame at most), the car and ball drawn between the
 *  last two ticks, the camera on them as drawn */
function run(shown: Shown, path: Path, o: Options): Frame[] {
  const clock = new FixedStep();
  const ours = new FrameCamera();
  const game = new PlayerCamera();
  let index = 0;
  let [previous, current] = [path(0), path(0)];
  return shown.map((raw, i) => {
    const real = Math.min(0.4, Math.max(0.0005, raw));
    const world = Math.min(0.4, Math.max(0.0005, raw * (o.dilation?.(i) ?? 1)));
    const ticks = clock.advance(world);
    for (let k = 0; k < ticks; k++) {
      [previous, current] = [current, path(++index)];
      ours.tick({ ...current, respawn: null });
    }
    const alpha = clock.alpha;
    const drawn = blendStates(previous.car, current.car, alpha);
    const ball = vec3(
      previous.ball.x + (current.ball.x - previous.ball.x) * alpha,
      previous.ball.y + (current.ball.y - previous.ball.y) * alpha,
      previous.ball.z + (current.ball.z - previous.ball.z) * alpha,
    );
    const controls = typeof o.controls === "function" ? o.controls(i, raw) : (o.controls ?? CAR_CAM);
    const feel = typeof o.feel === "function" ? o.feel(i) : o.feel;
    const view = o.game
      ? game.update(world, drawn, ball, controls, null, real)
      : ours.frame({ world, real, scene: Math.max(0, world - clock.dropped) }, feel, { car: drawn, ball, respawn: null }, controls, alpha);
    return { view, car: drawn, at: (index - 1 + alpha) * TICK_SECONDS };
  });
}

const degrees = (radians: number): number => (Math.atan2(Math.sin(radians), Math.cos(radians)) * 180) / Math.PI;
const yawOf = (v: Vec3): number => Math.atan2(v.y, v.x);
/** The car's yaw on screen (degrees: its heading less the view's) */
const onScreen = (f: Frame): number => degrees(yawOf(f.car.rot.forward) - yawOf(f.view.forward));

const half = <T>(frames: readonly T[]): T[] => frames.slice(Math.floor(frames.length / 2));
const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const range = (v: readonly number[]): number => Math.max(...v) - Math.min(...v);
const even = (hz: number, seconds: number): number[] => Array.from({ length: Math.round(hz * seconds) }, () => 1 / hz);

/** A seeded generator (the same frames each run) */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
/** Frames on a `hz` screen, `share` of them two refreshes long */
function doubled(hz: number, seconds: number, share: number, r: () => number): number[] {
  const out: number[] = [];
  for (let t = 0; t < seconds;) {
    const n = r() < share ? 2 : 1;
    out.push(n / hz);
    t += n / hz;
  }
  return out;
}
/** Frames on a steady clock (`hz`), each one's time off by up to ±`by` s (a timer's jitter) */
function jittered(hz: number, seconds: number, by: number, r: () => number): number[] {
  const times = Array.from({ length: Math.round(hz * seconds) + 1 }, (_, i) => i / hz + (i === 0 ? 0 : (r() - 0.5) * 2 * by));
  return times.slice(1).map((t, i) => t - (times[i] ?? 0));
}
/** A touch device's frames: a screen's refreshes (`hz`) through the page's FramePacer at `cap`, no animation frame while
 *  the page is busy with the last one drawn (`busy` ms; `slow` ms for a share `late` of them). Busy past a refresh, the
 *  page never gets a frame a refresh after the last: frames two and three refreshes apart (Firefox on a 120 Hz phone) */
function phone(hz: number, cap: number, seconds: number, o: { busy: number; slow: number; late: number; seed?: number }): number[] {
  const pacer = new FramePacer();
  const r = rng(o.seed ?? 5);
  const out: number[] = [];
  let last: number | null = null;
  let busyUntil = 0;
  for (let i = 0; i < hz * seconds; i++) {
    const now = (i * 1000) / hz + (r() - 0.5) * 0.6;
    if (now < busyUntil || !pacer.due(now, cap)) continue;
    if (last !== null) out.push((now - last) / 1000);
    last = now;
    busyUntil = now + (r() < o.late ? o.slow : o.busy);
  }
  return out;
}

const pitchOf = (v: Vec3): number => Math.atan2(v.z, Math.hypot(v.x, v.y));
/** Where a car is in a view: its direction off the view's own (degrees right and up) and its distance (uu) */
function placeIn(position: Vec3, forward: Vec3, of: Vec3): { yaw: number; pitch: number; distance: number } {
  const d = vec3(of.x - position.x, of.y - position.y, of.z - position.z);
  return { yaw: degrees(yawOf(d) - yawOf(forward)), pitch: degrees(pitchOf(d) - pitchOf(forward)), distance: Math.hypot(d.x, d.y, d.z) };
}
/** The frame's car in its own view */
const place = (f: Frame): { yaw: number; pitch: number; distance: number } => placeIn(f.view.position, f.view.forward, f.car.pos);

/** How far a run is from an even-frame camera at the same moments, the worst of its frames from `from` s on (to `to`):
 *  the view's direction (degrees), and the car's place in the view, its direction (degrees) and its distance (uu). At
 *  each frame, the nearest of the even runs given, each one's view taken between its two frames about that moment. One
 *  even run: the same frames' phase (a run whose frames fall on its own). Several, their frames a share of a frame
 *  apart: any phase's, for a run whose frames fall between an even run's, since even-frame cameras themselves differ
 *  by their frames' phase through a transient (0.7 to 1.9 degrees through a jump's take-off: when each first sees the
 *  car off the ground) */
function fromEven(frames: readonly Frame[], evenRuns: readonly (readonly Frame[])[], from = 1, to = Infinity): { view: number; car: number; distance: number } {
  const worst = { view: 0, car: 0, distance: 0 };
  const at = evenRuns.map(() => 0);
  const mix = (a: Vec3, b: Vec3, t: number): Vec3 => vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  for (const f of frames) {
    if (f.at < from || f.at >= to) continue;
    let nearest: { view: number; car: number; distance: number } | null = null;
    evenRuns.forEach((evenRun, n) => {
      let k = at[n] ?? 0;
      while (k + 1 < evenRun.length && (evenRun[k + 1]?.at ?? Infinity) < f.at) k++;
      at[n] = k;
      const [a, b] = [evenRun[k], evenRun[k + 1]];
      if (!a || !b) return;
      const t = (f.at - a.at) / (b.at - a.at);
      const yaw = yawOf(a.view.forward) + (degrees(yawOf(b.view.forward) - yawOf(a.view.forward)) * Math.PI * t) / 180;
      const pitch = pitchOf(a.view.forward) + (pitchOf(b.view.forward) - pitchOf(a.view.forward)) * t;
      const forward = vec3(Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch));
      const [ours, theirs] = [place(f), placeIn(mix(a.view.position, b.view.position, t), forward, f.car.pos)];
      const off = {
        view: Math.max(Math.abs(degrees(yawOf(f.view.forward) - yaw)), Math.abs(degrees(pitchOf(f.view.forward) - pitch))),
        car: Math.max(Math.abs(degrees(((ours.yaw - theirs.yaw) * Math.PI) / 180)), Math.abs(ours.pitch - theirs.pitch)),
        distance: Math.abs(ours.distance - theirs.distance),
      };
      if (!nearest || off.view < nearest.view) nearest = off;
    });
    const found = nearest as { view: number; car: number; distance: number } | null;
    if (!found) continue;
    worst.view = Math.max(worst.view, found.view);
    worst.car = Math.max(worst.car, found.car);
    worst.distance = Math.max(worst.distance, found.distance);
  }
  return worst;
}

describe("drift: an update spanning several nominal frames lands where that many of the game's would", () => {
  /** The game's smoother a step */
  const step = (x: number, target: number, lambda: number, dt: number): number => x + (target - x) * (1 - Math.pow(2.71828, -lambda * dt));

  it("nothing at one frame; at a whole number of them, exactly that many of the game's steps behind an evenly moving target", () => {
    expect(drift(29.64, 1 / 60, 1)).toBe(0);
    expect(drift(29.64, 0, 2)).toBe(0);
    for (const [lambda, h, frames] of [
      [29.64, 1 / 60, 2],
      [29.64, 1 / 144, 3],
      [6.32, 1 / 60, 5],
      [12, 1 / 240, 8],
    ] as const) {
      const v = 37;
      let many = 0;
      for (let k = 1; k <= frames; k++) many = step(many, v * h * k, lambda, h);
      const one = step(0, v * h * frames, lambda, h * frames) + drift(lambda, h * frames, frames) * (v * h * frames);
      expect(one).toBeCloseTo(many, 10);
    }
  });

  it("for any lengths of frames, the lag behind an evenly moving target stays the game's at the nominal rate", () => {
    const [lambda, h, v] = [29.64, 1 / 60, 123.7];
    const lag = (v * h) / (Math.pow(2.71828, lambda * h) - 1);
    const r = rng(3);
    let [x, target] = [0, 0];
    // (settled at even frames first)
    for (let k = 0; k < 600; k++) x = step(x, (target += v * h), lambda, h);
    expect(target - x).toBeCloseTo(lag, 9);
    for (let k = 0; k < 2000; k++) {
      const dt = h * (0.2 + 2.6 * r());
      const moved = v * dt;
      target += moved;
      x = step(x, target, lambda, dt) + drift(lambda, dt, dt / h) * moved;
      expect(Math.abs(target - x - lag)).toBeLessThan(1e-9);
    }
  });
});

describe("the camera across a frame", () => {
  it("at even frames it is the game's camera, frame for frame, at 30 to 240 Hz: a turn, the air's quarter turn, a goal's slow motion, the ball cam", () => {
    const slow = (i: number): number => (i >= 60 && i < 120 ? 0.25 : 1);
    for (const hz of [30, 60, 120, 144, 165, 240]) {
      for (const [path, controls, dilation] of [
        [turnThenAir, CAR_CAM, undefined],
        [turnThenAir, CAR_CAM, slow],
        [roundAMovingBall(), BALL_CAM, undefined],
      ] as const) {
        const o = { feel: hz, controls, ...(dilation ? { dilation } : {}) };
        const ours = run(even(hz, 5), path, o);
        const game = run(even(hz, 5), path, { ...o, game: true });
        ours.forEach((f, i) => {
          const g = game[i]?.view;
          const off = g ? Math.hypot(f.view.forward.x - g.forward.x, f.view.forward.y - g.forward.y, f.view.forward.z - g.forward.z) : 1;
          const away = g ? Math.hypot(f.view.position.x - g.position.x, f.view.position.y - g.position.y, f.view.position.z - g.position.z) : 1;
          expect(off, `${String(hz)} Hz, frame ${String(i)}`).toBeLessThan(1e-9);
          expect(away, `${String(hz)} Hz, frame ${String(i)}`).toBeLessThan(1e-6);
        });
      }
    }
  });

  it("follows a steady turn as the game does at the feel's rate: 2.45° at 30, 3.23° at 60, 3.68° at 120, 3.76° at 144, 3.92° at 240", () => {
    for (const [hz, lag] of [
      [30, 2.45],
      [60, 3.23],
      [120, 3.68],
      [144, 3.76],
      [240, 3.92],
    ] as const) {
      expect(Math.abs(mean(half(run(even(hz, 6), turning, { feel: hz })).map(onScreen))), `${String(hz)} Hz`).toBeCloseTo(lag, 2);
    }
  });

  it("holds a steady turn still on screen whatever the frames, at the feel's lag (where the game's own camera wobbles)", () => {
    const r = rng(1);
    const cases: [string, number[], number, number, number][] = [
      // [the frames, the feel's rate, its lag, the game's own wobble on them at least]
      ["60 Hz, 15 % of frames doubled", doubled(60, 12, 0.15, r), 60, 3.23, 0.5],
      ["60 Hz, 85 % doubled (REN-02)", doubled(60, 20, 0.85, r), 60, 3.23, 0.5],
      ["60 Hz, 95 % doubled", doubled(60, 20, 0.95, r), 60, 3.23, 0.2],
      ["144 Hz, 45 % doubled", doubled(144, 12, 0.45, r), 144, 3.76, 0.2],
      ["Firefox's 16/17 ms", Array.from({ length: 720 }, (_, i) => (i % 2 ? 0.01717 : 0.01617)), 60, 3.23, 0.005],
      ["60 Hz, each frame's time ±1 ms", jittered(60, 12, 0.001, r), 60, 3.23, 0.03],
      ["144 Hz, each frame's time ±2 ms", jittered(144, 12, 0.002, r), 144, 3.76, 0.05],
      ["a variable-refresh screen, 7 to 14 ms a frame", Array.from({ length: 1200 }, () => 0.007 + 0.007 * r()), 144, 3.76, 0.1],
      ["a hitch of 66 ms every second at 60 Hz", Array.from({ length: 720 }, (_, i) => (i % 60 === 59 ? 0.066 : 1 / 60)), 60, 3.23, 1],
      // (a 120 Hz phone at its cap of 60 in a browser busy past a refresh each frame, a fifth of its frames a refresh
      // later still: frames 16.7 and 25 ms apart, never 8.3: REN-01)
      ["a 120 Hz phone at 60, the page busy: 2 and 3 refreshes a frame", phone(120, 60, 12, { busy: 12, slow: 20, late: 0.2 }), 60, 3.23, 0.3],
      ["the same, 40 % of its frames late", phone(120, 60, 12, { busy: 12, slow: 20, late: 0.4 }), 60, 3.23, 0.3],
      ["a 90 Hz phone at 60: a refresh, then two", phone(90, 60, 12, { busy: 5, slow: 5, late: 0 }), 60, 3.23, 0.08],
    ];
    for (const [name, shown, feel, lag, gameWobbles] of cases) {
      const frames = half(run(shown, turning, { feel }));
      const seen = frames.map(onScreen);
      expect(range(seen), name).toBeLessThan(0.01);
      expect(Math.abs(mean(seen)), name).toBeCloseTo(lag, 2);
      // (and the car itself still in the view: where it's drawn, to 0.05 degrees (the busy phone's 0.04: the focus
      // follows the car's curved path between updates as along a straight line), and how far, a hundredth of a uu;
      // the game's own camera on the same frames moves it over twice as far)
      const wander = (of: Frame[]): number => Math.max(range(of.map((f) => place(f).yaw)), range(of.map((f) => place(f).pitch)));
      const game = half(run(shown, turning, { feel, game: true }));
      expect(wander(frames), `${name}: the car's place`).toBeLessThan(0.05);
      expect(wander(frames), `${name}: the car's place, against the game's own`).toBeLessThan(wander(game) / 2);
      expect(range(frames.map((f) => place(f).distance)), `${name}: the car's distance`).toBeLessThan(0.01);
      expect(range(game.map(onScreen)), `${name}: the game's own`).toBeGreaterThan(gameWobbles);
    }
  });

  it("follows a steady turn in the air as the game does at the feel's rate, still on screen whatever the frames (RV-1301)", () => {
    const lagOf = (f: Frame): number => degrees(yawOf(f.car.vel) - yawOf(f.view.forward));
    const settled = (frames: Frame[]): Frame[] => frames.filter((f) => f.at > 7);
    const at = (hz: number): number => mean(settled(run(even(hz, 14), airCircle, { feel: hz })).map(lagOf));
    expect([at(60), at(144)].map((v) => +v.toFixed(2))).toEqual([19.11, 18.45]);
    const r = rng(1);
    const cases: [string, number[], number, number][] = [
      // [the frames, the feel's rate, the game's own wobble on them at least]
      ["60 Hz, 40 % of frames doubled", doubled(60, 14, 0.4, r), 60, 0.2],
      ["60 Hz, each frame's time ±1 ms", jittered(60, 14, 0.001, r), 60, 0.005],
      ["a 120 Hz phone at 60, the page busy: 2 and 3 refreshes a frame", phone(120, 60, 14, { busy: 12, slow: 20, late: 0.2 }), 60, 0.08],
      ["the same, 40 % of its frames late", phone(120, 60, 14, { busy: 12, slow: 20, late: 0.4 }), 60, 0.08],
      ["a 90 Hz phone at 60: a refresh, then two", phone(90, 60, 14, { busy: 5, slow: 5, late: 0 }), 60, 0.02],
      ["a variable-refresh screen, 7 to 14 ms a frame", Array.from({ length: 1400 }, () => 0.007 + 0.007 * r()), 144, 0.05],
      // (the feel not the frames' own rate: before the first measure on a 144 Hz screen, after a window's move to a
      // 60 Hz one. Every update a fraction of a nominal frame, or several of them)
      ["144 Hz frames at a feel of 60", even(144, 14), 60, 0],
      ["60 Hz frames at a feel of 144", even(60, 14), 144, 0],
    ];
    for (const [name, shown, feel, gameWobbles] of cases) {
      const seen = settled(run(shown, airCircle, { feel })).map(lagOf);
      expect(Math.abs(mean(seen) - at(feel)), `${name}: its lag ${mean(seen).toFixed(3)}`).toBeLessThan(0.02);
      expect(range(seen), name).toBeLessThan(0.01);
      const game = settled(run(shown, airCircle, { feel, game: true })).map(lagOf);
      if (gameWobbles > 0) expect(range(game), `${name}: the game's own`).toBeGreaterThan(gameWobbles);
      else expect(Math.abs(mean(game) - at(feel)), `${name}: the game's own lag is the frames' rate's`).toBeGreaterThan(0.5);
    }
    // (the camera alone, every update the same share of a nominal frame: the lag the game's at any share)
    for (const share of [0.417, 0.5, 0.75, 1.25, 1.5, 2]) {
      const camera = new PlayerCamera();
      const lags: number[] = [];
      for (let i = 0; (i * share) / 60 < 14; i++) {
        const t = (i * share) / 60 / TICK_SECONDS;
        const here = blendStates(airCircle(Math.floor(t)).car, airCircle(Math.floor(t) + 1).car, t - Math.floor(t));
        const view = camera.update(share / 60, here, STILL_BALL, CAR_CAM, null, share / 60, share);
        if ((i * share) / 60 > 7) lags.push(degrees(yawOf(here.vel) - yawOf(view.forward)));
      }
      expect(Math.abs(mean(lags) - at(60)), `updates of ${String(share)} of a frame: ${mean(lags).toFixed(3)}`).toBeLessThan(0.005);
    }
  });

  it("the feel's rate read wrong moves the lag a little, and never wobbles: a 60 Hz screen read as 75, a 120 Hz phone's cap read as 52", () => {
    const r = rng(7);
    for (const [shown, feel, lag] of [
      [doubled(60, 12, 0.2, r), 75, 3.4],
      [phone(120, 60, 12, { busy: 12, slow: 20, late: 0.2 }), 52, 3.1],
    ] as const) {
      const seen = half(run(shown, turning, { feel })).map(onScreen);
      expect(range(seen)).toBeLessThan(0.01);
      expect(Math.abs(mean(seen))).toBeCloseTo(lag, 1);
    }
  });

  // Through transients, against the even-frame camera at the same moments: the view's direction and the car's place in
  // it. Ten seeds of each pattern, the thresholds theirs (one seed's worst frame is no guide: the landing's read 0.15
  // with one and 0.3 with another).
  // - Frames that fall on an even run's own (doubled ones): that run's camera, everywhere, to a thousandth of a degree.
  // - Frames that fall between: any phase's, twenty-four of them (0.7 ms apart). Between events, a hundredth of a
  //   degree. At a take-off or a landing no closer than even cameras are to each other: they differ by 0.7 to 1.9
  //   degrees by when each first sees the car off the ground, and a frame that falls between two of theirs is inside
  //   that spread, no one camera's (0.3 degrees from the nearest at worst, as the game's own camera on such frames is).
  const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
  const ON_GRID: [string, (seed: number) => number[]][] = [
    ["60 Hz, 40 % of frames doubled", (seed) => doubled(60, 12.5, 0.4, rng(seed))],
    ["60 Hz, 90 % doubled", (seed) => doubled(60, 12.5, 0.9, rng(seed))],
  ];
  const BETWEEN: [string, (seed: number) => number[]][] = [
    ["60 Hz, each frame's time ±1 ms", (seed) => jittered(60, 12.5, 0.001, rng(seed))],
    ["a 120 Hz phone at 60, the page busy: 2 and 3 refreshes a frame", (seed) => phone(120, 60, 12.5, { busy: 12, slow: 20, late: 0.2, seed })],
    ["the same, 40 % of its frames late", (seed) => phone(120, 60, 12.5, { busy: 12, slow: 20, late: 0.4, seed })],
    ["a 90 Hz phone at 60: a refresh, then two", (seed) => phone(90, 60, 12.5, { busy: 5, slow: 5, late: 0, seed })],
  ];
  const evenRunsOf = (path: Path, controls: CameraControls): Frame[][] =>
    Array.from({ length: 24 }, (_, n) => run([...(n > 0 ? [n / 24 / 60] : []), ...even(60, 13)], path, { feel: 60, controls }));
  type Off = ReturnType<typeof fromEven>;
  const worstOf = (all: readonly Off[]): Off => ({
    view: Math.max(...all.map((a) => a.view)),
    car: Math.max(...all.map((a) => a.car)),
    distance: Math.max(...all.map((a) => a.distance)),
  });

  it("through a slalom with a jump it shows what the even-frame camera shows at the same moments, the car where that camera has it", () => {
    const path = slalomWithAJump();
    const evenRuns = evenRunsOf(path, CAR_CAM);
    /** The jump: from its take-off (3 s) to the view settled after its landing (4.3 s) */
    const jump = [2.95, 4.9] as const;
    const between = (frames: Frame[], refs: Frame[][]): Off => worstOf([fromEven(frames, refs, 1, jump[0]), fromEven(frames, refs, jump[1])]);
    for (const [name, make] of ON_GRID) {
      const off = worstOf(SEEDS.map((seed) => fromEven(run(make(seed), path, { feel: 60 }), evenRuns.slice(0, 1))));
      expect(Math.max(off.view, off.car), name).toBeLessThan(0.001);
      expect(off.distance, name).toBeLessThan(0.01);
      const game = fromEven(run(make(1), path, { feel: 60, game: true }), evenRuns.slice(0, 1));
      expect(game.view, `${name}: the game's own`).toBeGreaterThan(1);
      expect(game.car, `${name}: the game's own, the car's place`).toBeGreaterThan(0.3);
    }
    for (const [name, make] of BETWEEN) {
      const runs = SEEDS.map((seed) => run(make(seed), path, { feel: 60 }));
      const calm = worstOf(runs.map((frames) => between(frames, evenRuns)));
      expect(calm.view, `${name}, between events`).toBeLessThan(0.01);
      expect(calm.car, `${name}, between events: the car's place`).toBeLessThan(0.05);
      expect(calm.distance, `${name}, between events: the car's distance`).toBeLessThan(0.15);
      const events = runs.map((frames) => fromEven(frames, evenRuns, jump[0], jump[1]));
      expect(worstOf(events).view, `${name}, the jump: the worst seed`).toBeLessThan(0.4);
      expect(mean(events.map((e) => e.view)), `${name}, the jump: the seeds' mean`).toBeLessThan(0.2);
      expect(worstOf(events).car, `${name}, the jump: the car's place`).toBeLessThan(0.3);
      // (the game's own camera on the same frames, between events: off every phase's, but for the jitter's)
      if (!name.includes("±1 ms")) {
        const game = between(run(make(1), path, { feel: 60, game: true }), evenRuns);
        expect(game.view, `${name}: the game's own`).toBeGreaterThan(0.15);
        expect(game.car, `${name}: the game's own, the car's place`).toBeGreaterThan(0.15);
      }
    }
    // (the spread the jump's bound is inside: even cameras a part of a frame apart, through the jump)
    const apart = Math.max(...[6, 12, 18].map((n) => fromEven(evenRuns[n] ?? [], evenRuns.slice(0, 1), jump[0], jump[1]).view));
    expect(apart).toBeGreaterThan(0.7);
  });

  it("the same in ball cam round a moving ball, and through a slalom all in the air", () => {
    /** The slalom flown: 400 uu up, never on the ground (the air camera's own turning, no take-off or landing in it) */
    const flown = slalomWithAJump();
    const airSlalom: Path = (tick) => {
      const on = flown(tick).car;
      return { car: car(vec3(on.pos.x, on.pos.y, 400), vec3(on.vel.x, on.vel.y, 0), on.rot, false), ball: STILL_BALL };
    };
    for (const [what, path, controls, from, view, gameView] of [
      ["the ball cam round a moving ball", roundAMovingBall(), BALL_CAM, 1, 0.01, 0.1],
      // (from 6 s: the air camera's start, another camera's by its first frame's length, takes that long to fade)
      ["a slalom in the air", airSlalom, CAR_CAM, 6, 0.15, 0.1],
    ] as const) {
      const evenRuns = evenRunsOf(path, controls);
      for (const [name, make] of ON_GRID) {
        const off = worstOf(SEEDS.map((seed) => fromEven(run(make(seed), path, { feel: 60, controls }), evenRuns.slice(0, 1), from)));
        expect(Math.max(off.view, off.car), `${what}, ${name}`).toBeLessThan(0.002);
        expect(off.distance, `${what}, ${name}`).toBeLessThan(0.01);
        expect(
          fromEven(run(make(1), path, { feel: 60, controls, game: true }), evenRuns.slice(0, 1), from).view,
          `${what}, ${name}: the game's own`,
        ).toBeGreaterThan(0.5);
      }
      for (const [name, make] of BETWEEN) {
        const off = worstOf(SEEDS.map((seed) => fromEven(run(make(seed), path, { feel: 60, controls }), evenRuns, from)));
        expect(off.view, `${what}, ${name}`).toBeLessThan(view);
        expect(off.car, `${what}, ${name}: the car's place`).toBeLessThan(0.05);
        expect(off.distance, `${what}, ${name}: the car's distance`).toBeLessThan(0.15);
        if (!name.includes("±1 ms")) {
          expect(fromEven(run(make(1), path, { feel: 60, controls, game: true }), evenRuns, from).view, `${what}, ${name}: the game's own`).toBeGreaterThan(
            gameView,
          );
        }
      }
    }
  });

  it("a car put 500 uu aside in the air (a correction too big to smooth) is no travel to look ahead along: no further from an even camera than the game's own (RV-1319)", () => {
    // (the air circle, the car's place jumped sideways at 8 s: no new spawn, no camera reset)
    const jumped: Path = (tick) => {
      const on = airCircle(tick);
      if (tick < 960) return on;
      return { ...on, car: { ...on.car, pos: vec3(on.car.pos.x + 500 * on.car.rot.right.x, on.car.pos.y + 500 * on.car.rot.right.y, on.car.pos.z) } };
    };
    const evenRuns = Array.from({ length: 24 }, (_, n) => run([...(n > 0 ? [n / 24 / 60] : []), ...even(60, 11)], jumped, { feel: 60 }));
    for (const [name, make] of [
      ["a 90 Hz phone at 60", (seed: number) => phone(90, 60, 10.5, { busy: 5, slow: 5, late: 0, seed })],
      ["a 120 Hz phone at 60, the page busy, 40 % late", (seed: number) => phone(120, 60, 10.5, { busy: 12, slow: 20, late: 0.4, seed })],
    ] as const) {
      const worst = (game: boolean): number =>
        Math.max(...[1, 2, 3, 5, 8].map((seed) => fromEven(run(make(seed), jumped, { feel: 60, game }), evenRuns, 7.9, 8.6).view));
      const [ours, game] = [worst(false), worst(true)];
      expect(ours, `${name}: ${ours.toFixed(2)} for the game's own ${game.toFixed(2)}`).toBeLessThan(game + 0.25);
      expect(ours, name).toBeLessThan(1);
    }
  });

  it("the air view's pitch, flattened while the car flies back toward the camera, the game's at any share of a frame an update", () => {
    // (forwards for 3 s, then back the way it came and diving: its velocity against the view's direction, so the game
    // scales the pitch down each frame while the view comes round)
    const flyingBack = (t: number): CarState => {
      const back = Math.max(0, t - 3);
      const vel = t < 3 ? vec3(1400, 0, 0) : vec3(-1000, 0, -1200);
      return car(vec3(1400 * Math.min(t, 3) - 1000 * back, 0, 3000 - 1200 * back), vel, facing(0), false);
    };
    /** The view's pitch (degrees) at each of `times`, every update `share` of a nominal frame at 60 */
    const pitches = (share: number, times: readonly number[]): number[] => {
      const camera = new PlayerCamera();
      const out: number[] = [];
      for (let i = 1; out.length < times.length; i++) {
        const t = (i * share) / 60;
        const view = camera.update(share / 60, flyingBack(t), STILL_BALL, CAR_CAM, null, share / 60, share);
        if (t >= (times[out.length] ?? Infinity)) out.push(degrees(pitchOf(view.forward)));
      }
      return out;
    };
    const times = [3.1, 3.2, 3.3, 3.4, 3.5];
    const game = pitches(1, times);
    expect(Math.max(...game.map(Math.abs))).toBeGreaterThan(1);
    for (const share of [0.417, 0.5, 0.75, 1.25, 1.5]) {
      pitches(share, times).forEach((pitch, i) => {
        expect(
          Math.abs(pitch - (game[i] ?? 0)),
          `updates of ${String(share)} of a frame, at ${String(times[i])} s: ${pitch.toFixed(2)} for ${(game[i] ?? 0).toFixed(2)}`,
        ).toBeLessThan(0.06);
      });
    }
  });

  it("the feel's rate changing (a window from a 144 Hz screen to a 60 Hz one): the new rate's lag, still", () => {
    const frames = run([...even(144, 3), ...even(60, 6)], turning, { feel: (i) => (i < 432 + 30 ? 144 : 60) });
    expect(Math.abs(mean(frames.slice(300, 432).map(onScreen)))).toBeCloseTo(3.76, 2);
    const after = frames.slice(frames.length - 120).map(onScreen);
    expect(Math.abs(mean(after))).toBeCloseTo(3.23, 2);
    expect(range(after)).toBeLessThan(0.01);
  });

  it("the mouse's free look whole: a frame's counts shared over its updates and truncated once a frame, the game's turn on the same frames (RV-1304)", () => {
    const still: Path = () => turning(0);
    const look = (yaw: number): CameraControls => ({
      ...CAR_CAM,
      freeLook: { axes: { pitch: 0, yaw, source: "mouse" }, settings: { smoothing: false, accelRate: 1, decelRate: 1, freeLookSpeed: 1 }, ballCamHold: false },
    });
    /** The view's turn over the frames, the mouse moving 720 counts a second (whole counts each frame) */
    const turned = (shown: Shown, feel: number, game = false): number => {
      let [counts, owed] = [0, 0];
      const frames = run(shown, still, {
        feel,
        game,
        controls: (_, dt) => {
          owed += dt * 720;
          const now = Math.floor(owed - counts);
          counts += now;
          return look(now);
        },
      });
      const last = frames[frames.length - 1];
      return last ? degrees(yawOf(last.view.forward) - yawOf(frames[0]?.view.forward ?? vec3(1, 0, 0))) : 0;
    };
    const r = rng(2);
    for (const [name, shown, feel] of [
      ["60 Hz, 40 % of frames doubled", doubled(60, 2, 0.4, r), 60],
      // (frames of one to two nominal ones, two updates in many: each lost up to a unit of its own, a tenth of the turn)
      ["a variable-refresh screen, 7 to 14 ms a frame, at a feel of 144", Array.from({ length: 190 }, () => 0.007 + 0.007 * r()), 144],
      ["a 120 Hz phone at 60, the page busy", phone(120, 60, 2, { busy: 12, slow: 20, late: 0.3 }), 60],
    ] as const) {
      const [ours, game] = [turned(shown, feel), turned(shown, feel, true)];
      expect(Math.abs(game), name).toBeGreaterThan(4);
      expect(ours, name).toBeCloseTo(game, 9);
    }
  });
});

describe("the camera's updates a frame", () => {
  /** A camera that keeps what each update was given */
  class Recording extends PlayerCamera {
    readonly updates: { dt: number; at: Vec3; realDt: number; frames: number }[] = [];
    override update(...args: Parameters<PlayerCamera["update"]>): CameraView {
      const [dt, followed, , , , realDt, frames] = args;
      this.updates.push({ dt, at: followed.pos, realDt: realDt ?? dt, frames: frames ?? 1 });
      return super.update(...args);
    }
  }
  const at = (x: number, spawnCount = 0): { car: CarState; ball: Vec3; respawn: null } => ({
    car: { ...car(vec3(x, 0, 17), vec3(1400, 0, 0), facing(0)), spawnCount },
    ball: STILL_BALL,
    respawn: null,
  });
  const span = (seconds: number): { world: number; real: number; scene: number } => ({ world: seconds, real: seconds, scene: seconds });

  it("one for each nominal frame the frame spans, on the car blended across it, each told its share of a nominal frame", () => {
    const camera = new Recording();
    const view = new FrameCamera(camera);
    view.frame(span(1 / 60), 60, at(0), CAR_CAM);
    expect(camera.updates).toEqual([{ dt: 1 / 60, at: vec3(0, 0, 17), realDt: 1 / 60, frames: 1 }]);
    camera.updates.length = 0;
    // (a doubled frame: two, the first halfway there)
    view.frame(span(2 / 60), 60, at(40), CAR_CAM);
    expect(camera.updates.map((u) => [u.at.x, u.frames])).toEqual([
      [20, 1],
      [40, 1],
    ]);
    expect(camera.updates.reduce((s, u) => s + u.dt, 0)).toBeCloseTo(2 / 60, 12);
    camera.updates.length = 0;
    // (a frame and a half: two updates of three quarters each; a third of a frame: one of a third)
    view.frame(span(1.5 / 60), 60, at(70), CAR_CAM);
    expect(camera.updates.map((u) => +u.frames.toFixed(9))).toEqual([0.75, 0.75]);
    camera.updates.length = 0;
    view.frame(span(1 / 180), 60, at(75), CAR_CAM);
    expect(camera.updates.map((u) => [u.at.x, +u.frames.toFixed(6)])).toEqual([[75, 0.333333]]);
    camera.updates.length = 0;
    // (the scene's time, not the frame's: a goal's slow motion, and the ticks the physics clock dropped)
    view.frame({ world: 1 / 240, real: 1 / 60, scene: 1 / 240 }, 60, at(80), CAR_CAM);
    expect(camera.updates.map((u) => [u.dt, u.realDt, +u.frames.toFixed(6)])).toEqual([[1 / 240, 1 / 60, 1]]);
    camera.updates.length = 0;
    view.frame({ world: 0.1, real: 0.1, scene: 5 / 120 }, 240, at(130), CAR_CAM);
    expect(camera.updates).toHaveLength(8);
    expect(camera.updates.reduce((s, u) => s + u.dt, 0)).toBeCloseTo(5 / 120, 12);
    expect(camera.updates[0]?.frames).toBeCloseTo(10 / 8, 9);
  });

  it("each update on the car as drawn at its moment, between the ticks about it: a take-off reaches the camera when a frame there would have seen it", () => {
    const camera = new Recording();
    const view = new FrameCamera(camera);
    const flying = (x: number, z: number): { car: CarState; ball: Vec3; respawn: null } => ({
      car: car(vec3(x, 0, z), vec3(1400, 0, 0), facing(0), z <= 17),
      ball: STILL_BALL,
      respawn: null,
    });
    // (ticks 1 and 2 on the ground; the last frame drawn at tick 2)
    view.tick(flying(0, 17));
    view.tick(flying(10, 17));
    view.frame(span(1 / 60), 60, flying(10, 17), CAR_CAM, 1);
    // (a doubled frame of four ticks, the car off the ground at the last of them: the first update, halfway through
    // the frame, is the scene as a frame there would have drawn it, two ticks back and still on the ground; the second
    // is this frame's)
    for (const [x, z] of [
      [20, 17],
      [30, 17],
      [40, 17],
      [50, 40],
    ] as const)
      view.tick(flying(x, z));
    camera.updates.length = 0;
    const onGround: boolean[] = [];
    const spy = camera.update.bind(camera);
    camera.update = (...args) => {
      onGround.push(args[1].onGround);
      return spy(...args);
    };
    view.frame(span(2 / 60), 60, flying(50, 40), CAR_CAM, 1);
    expect(camera.updates.map((u) => u.at.x)).toEqual([30, 50]);
    expect(onGround).toEqual([true, false]);
  });

  it("nothing blended across a reset, a frame another camera drew, or a car put where it is (a spawn, a teleport): the game's one update", () => {
    const camera = new Recording();
    const view = new FrameCamera(camera);
    const next = (x: number, spawnCount = 0): { at: number; frames: number }[] => {
      camera.updates.length = 0;
      view.frame(span(2 / 60), 60, at(x, spawnCount), CAR_CAM);
      return camera.updates.map((u) => ({ at: u.at.x, frames: u.frames }));
    };
    expect(next(0)).toEqual([{ at: 0, frames: 1 }]);
    expect(next(40)).toHaveLength(2);
    // (the garage's camera, a replay's, drawn for a while: the player's starts from its own car, wherever that is: far
    // off, or a frame's drive on)
    view.idle();
    expect(next(900)).toEqual([{ at: 900, frames: 1 }]);
    expect(next(940)).toHaveLength(2);
    view.idle();
    expect(next(980)).toEqual([{ at: 980, frames: 1 }]);
    view.reset();
    expect(next(-3000)).toEqual([{ at: -3000, frames: 1 }]);
    expect(next(-2960)).toHaveLength(2);
    view.reset();
    expect(next(-2920)).toEqual([{ at: -2920, frames: 1 }]);
    expect(next(-2960)).toHaveLength(2);
    expect(next(-3000)).toHaveLength(2);
    // (a new car: its spawn's count; a teleport: further than any car drives in the frame)
    expect(next(-2960, 1)).toEqual([{ at: -2960, frames: 1 }]);
    expect(next(-2920, 1)).toHaveLength(2);
    expect(next(2000, 1)).toEqual([{ at: 2000, frames: 1 }]);
  });

  it("a reset forgets the ticks: the frame after it steps from its own car, never between a tick from before and one since", () => {
    const camera = new Recording();
    const view = new FrameCamera(camera);
    view.tick(at(0));
    view.tick(at(10));
    view.frame(span(1 / 60), 60, at(5), CAR_CAM, 0.5);
    // (the car put 45 uu on, a reset: near enough that the ticks about it would pass for a drive)
    view.reset();
    view.frame(span(1 / 60), 60, at(50), CAR_CAM, 0.5);
    view.tick(at(60));
    view.tick(at(70));
    camera.updates.length = 0;
    view.frame(span(2 / 60), 60, at(65), CAR_CAM, 0.5);
    // (halfway from the reset's frame, the car at 50, to this one's at 65; with the old ticks kept, between the tick
    // at 10 and the one at 60)
    expect(camera.updates.map((u) => u.at.x)).toEqual([57.5, 65]);
  });

  it("a car demolished or put elsewhere inside a frame is stepped to by the ticks: each update the scene at its moment, the even-frame camera's view (RV-1306)", () => {
    const camera = new Recording();
    const view = new FrameCamera(camera);
    const wreck = (x: number): { car: CarState; ball: Vec3; respawn: null } => ({ ...at(x), car: { ...at(x).car, demoed: true } });
    view.tick(at(0));
    view.tick(at(10));
    view.frame(span(1 / 60), 60, at(10), CAR_CAM, 1);
    // (a doubled frame of four ticks, the car demolished at the last of them: the first update is the car alive, two
    // ticks on; the second this frame's wreck. One update on the wreck for the whole frame, before)
    view.tick(at(20));
    view.tick(at(30));
    view.tick(at(40));
    view.tick(wreck(50));
    camera.updates.length = 0;
    view.frame(span(2 / 60), 60, wreck(50), CAR_CAM, 1);
    expect(camera.updates.map((u) => u.at.x)).toEqual([30, 50]);
    // (and a new car far off, its spawn at a tick inside the frame: the old place up to that tick, then the new)
    for (const x of [50, 50, 50]) view.tick(wreck(x));
    view.tick(at(-3000, 1));
    camera.updates.length = 0;
    view.frame(span(2 / 60), 60, at(-3000, 1), CAR_CAM, 1);
    expect(camera.updates.map((u) => u.at.x)).toEqual([50, -3000]);
    // (through a demolition on doubled frames: the even-frame camera's view at the same moments, to a thousandth of a
    // degree, where it was 2 degrees off for the frame)
    const demolished: Path = (tick) => {
      const live = turning(Math.min(tick, 301));
      return tick > 301 ? { ...live, car: { ...live.car, demoed: true, vel: vec3(0, 0, 0) } } : live;
    };
    const evenRun = [run(even(60, 4), demolished, { feel: 60 })];
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      const off = fromEven(run(doubled(60, 4, 0.6, rng(seed)), demolished, { feel: 60 }), evenRun, 1);
      expect(off.view, `seed ${String(seed)}`).toBeLessThan(0.001);
    }
  });
});
