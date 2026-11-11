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

/** A steady full-lock turn to the left (1410 uu/s on a 653 uu circle: the reviews') */
const turning: Path = (tick) => {
  const th = (-1410 / 653) * tick * TICK_SECONDS;
  return {
    car: car(vec3(653 * Math.sin(th), 653 - 653 * Math.cos(th), 17), vec3(Math.cos(th) * 1410, Math.sin(th) * 1410, 0), facing(th)),
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

/** The worst difference (degrees) of the view's direction on a run from an even-frame camera's at the same moments: at
 *  each of the run's frames (its first second left out), the nearest of the even runs given, each one's view taken
 *  between its two frames about that moment. One even run: the same frames' phase (a run whose frames fall on its own).
 *  Several, their frames a share of a frame apart: any phase's, for a run whose frames fall between an even run's, since
 *  even-frame cameras themselves differ by their frames' phase through a transient (0.7 to 1.9° through a jump's
 *  take-off: when each first sees the car off the ground) */
function fromEven(frames: readonly Frame[], evenRuns: readonly (readonly Frame[])[]): number {
  let worst = 0;
  const at = evenRuns.map(() => 0);
  for (const f of frames) {
    if (f.at < 1) continue;
    let nearest = Infinity;
    evenRuns.forEach((evenRun, n) => {
      let k = at[n] ?? 0;
      while (k + 1 < evenRun.length && (evenRun[k + 1]?.at ?? Infinity) < f.at) k++;
      at[n] = k;
      const [a, b] = [evenRun[k], evenRun[k + 1]];
      if (!a || !b) return;
      const t = (f.at - a.at) / (b.at - a.at);
      const yaw = yawOf(a.view.forward) + (degrees(yawOf(b.view.forward) - yawOf(a.view.forward)) * Math.PI * t) / 180;
      const pitch = a.view.forward.z + (b.view.forward.z - a.view.forward.z) * t;
      nearest = Math.min(nearest, Math.max(Math.abs(degrees(yawOf(f.view.forward) - yaw)), (Math.abs(f.view.forward.z - pitch) * 180) / Math.PI));
    });
    if (Number.isFinite(nearest)) worst = Math.max(worst, nearest);
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
      const seen = half(run(shown, turning, { feel })).map(onScreen);
      expect(range(seen), name).toBeLessThan(0.01);
      expect(Math.abs(mean(seen)), name).toBeCloseTo(lag, 2);
      expect(range(half(run(shown, turning, { feel, game: true })).map(onScreen)), `${name}: the game's own`).toBeGreaterThan(gameWobbles);
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

  it("through transients it shows what the even-frame camera shows at the same moments: a slalom with a jump, the ball cam round a moving ball", () => {
    const r = rng(11);
    // (frames that fall on an even run's own: its phase's camera, to a hundredth of a degree; frames that fall between:
    // any phase's, twenty-four of them (0.7 ms apart), to 0.15°, half a pixel at 1080p)
    const onPhase: [string, number[]][] = [
      ["60 Hz, 40 % of frames doubled", doubled(60, 9, 0.4, r)],
      ["60 Hz, 90 % doubled", doubled(60, 9, 0.9, r)],
    ];
    const anyPhase: [string, number[]][] = [
      ["60 Hz, each frame's time ±1 ms", jittered(60, 9, 0.001, r)],
      ["a 120 Hz phone at 60, the page busy: 2 and 3 refreshes a frame", phone(120, 60, 9, { busy: 12, slow: 20, late: 0.2 })],
      ["the same, 40 % of its frames late", phone(120, 60, 9, { busy: 12, slow: 20, late: 0.4 })],
      ["a 90 Hz phone at 60: a refresh, then two", phone(90, 60, 9, { busy: 5, slow: 5, late: 0 })],
    ];
    for (const [what, path, controls, gameOff] of [
      ["a slalom with a jump", slalomWithAJump(), CAR_CAM, 0.4],
      ["the ball cam round a moving ball", roundAMovingBall(), BALL_CAM, 0.4],
    ] as const) {
      const evenRuns = Array.from({ length: 24 }, (_, n) => run([...(n > 0 ? [n / 24 / 60] : []), ...even(60, 9)], path, { feel: 60, controls }));
      const evenRun = evenRuns.slice(0, 1);
      for (const [name, shown] of onPhase) {
        expect(fromEven(run(shown, path, { feel: 60, controls }), evenRun), `${what}, ${name}`).toBeLessThan(0.01);
      }
      for (const [name, shown] of anyPhase) {
        expect(fromEven(run(shown, path, { feel: 60, controls }), evenRuns), `${what}, ${name}`).toBeLessThan(0.15);
        // (the game's own camera on the same frames: off every phase's)
        expect(fromEven(run(shown, path, { feel: 60, controls, game: true }), evenRuns), `${what}, ${name}: the game's own`).toBeGreaterThan(
          name.includes("±1 ms") ? 0 : 0.15,
        );
      }
      const gameRun = run(onPhase[0]?.[1] ?? [], path, { feel: 60, controls, game: true });
      expect(fromEven(gameRun, evenRun), `${what}: the game's own`).toBeGreaterThan(gameOff);
    }
  });

  it("the feel's rate changing (a window from a 144 Hz screen to a 60 Hz one): the new rate's lag, still", () => {
    const frames = run([...even(144, 3), ...even(60, 6)], turning, { feel: (i) => (i < 432 + 30 ? 144 : 60) });
    expect(Math.abs(mean(frames.slice(300, 432).map(onScreen)))).toBeCloseTo(3.76, 2);
    const after = frames.slice(frames.length - 120).map(onScreen);
    expect(Math.abs(mean(after))).toBeCloseTo(3.23, 2);
    expect(range(after)).toBeLessThan(0.01);
  });

  it("the mouse's free look whole: a frame's counts shared over its updates, so doubled frames turn it as far as even ones", () => {
    const still: Path = () => turning(0);
    const look = (yaw: number): CameraControls => ({
      ...CAR_CAM,
      freeLook: { axes: { pitch: 0, yaw, source: "mouse" }, settings: { smoothing: false, accelRate: 1, decelRate: 1, freeLookSpeed: 1 }, ballCamHold: false },
    });
    const turned = (shown: Shown): number => {
      const frames = run(shown, still, { feel: 60, controls: (_, dt) => look(Math.round(dt * 360)) });
      const last = frames[frames.length - 1];
      return last ? yawOf(last.view.forward) : 0;
    };
    const pattern = [1, 1, 2, 1, 1, 1, 2, 2, 1];
    const uneven: number[] = [];
    for (let left = 120, i = 0; left > 0; i++) {
      const n = Math.min(pattern[i % pattern.length] ?? 1, left);
      uneven.push(n / 60);
      left -= n;
    }
    expect(Math.abs(turned(even(60, 2)))).toBeGreaterThan(0.02);
    expect(turned(uneven)).toBeCloseTo(turned(even(60, 2)), 6);
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
    // (the garage's camera, a replay's, drawn for a while: the player's starts from its own car)
    view.idle();
    expect(next(900)).toEqual([{ at: 900, frames: 1 }]);
    view.reset();
    expect(next(-3000)).toEqual([{ at: -3000, frames: 1 }]);
    // (a new car: its spawn's count; a teleport: further than any car drives in the frame)
    expect(next(-2960, 1)).toEqual([{ at: -2960, frames: 1 }]);
    expect(next(-2920, 1)).toHaveLength(2);
    expect(next(2000, 1)).toEqual([{ at: 2000, frames: 1 }]);
  });
});
