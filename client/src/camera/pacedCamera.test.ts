// The camera at the screen's rate (src/camera/pacedCamera.ts; notes/camera.md): at even frames it's the game's camera
// exactly (stepped once a frame with the frame's time), so its lag behind a turning car is the game's at that rate; at
// uneven ones (dropped frames, a timer's jitter, a hitch, a variable-refresh screen, a phone's cap) every frame lands on
// a step and the car is drawn as its camera saw it: no wobble, the car with the camera and the scene; a reset, a stall, a
// time away handled; the mouse's free look whole. The touch cases run through the page's own FramePacer.
import { describe, expect, it } from "vitest";
import type { CarState } from "../engine/world";
import { Interpolated } from "../game/interpolated";
import { FramePacer } from "../input/touchSettings";
import { FixedStep, TICK_SECONDS } from "../loop/fixedStep";
import { type Rot3, type Vec3, vec3 } from "../math/vec";
import { type CameraControls, type CameraView, PlayerCamera } from "./carballCamera";
import { type FrameClock, PacedCamera } from "./pacedCamera";

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

/** Straight along x at 2300 uu/s: the car's distance from the camera steady unless the two are drawn apart */
function straight(t: number): CarState {
  return car(vec3(-3000 + 2300 * t, 0, 17), vec3(2300, 0, 0), { forward: vec3(1, 0, 0), right: vec3(0, 1, 0), up: UP });
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
  /** The followed car as drawn, and the rest of the scene's moment for it (the car at the frame's alpha) */
  readonly car: CarState;
  readonly scene: CarState;
  /** The newest tick's car */
  readonly newest: CarState;
  /** The steps the frame ran */
  readonly steps: number;
}

/** A frame's real seconds, and (touch) the pacer's clock */
interface Shown {
  readonly dt: number;
  readonly clock: FrameClock | null;
}

/** A run of frames, physics on its own clock, the car on `path` (world time) at each tick and drawn between the last two
 *  (as the game draws it). `game`: the game's camera, stepped once a frame with the frame's time, the car as drawn at the
 *  frame's alpha; else ours, the followed car drawn as it gives */
function run(
  shown: readonly Shown[],
  path: (t: number) => CarState,
  o: { game?: boolean; dilation?: (i: number) => number; controls?: (i: number, dt: number) => CameraControls } = {},
): Frame[] {
  const clock = new FixedStep();
  const paced = new PacedCamera();
  const game = new PlayerCamera();
  const body = new Interpolated(path(0));
  let index = 0;
  return shown.map(({ dt, clock: frame }, i) => {
    const world = dt * (o.dilation?.(i) ?? 1);
    const ticks = clock.advance(world);
    for (let k = 0; k < ticks; k++) {
      index++;
      body.push(path(index * TICK_SECONDS));
      paced.tick(body.current, BALL, null);
    }
    const controls = o.controls?.(i, dt) ?? CAR_CAM;
    const scene = body.blended(clock.alpha);
    const newest = body.current;
    if (o.game) return { view: game.update(world, scene, BALL, controls, null, dt), car: scene, scene, newest, steps: 1 };
    paced.plan(dt, clock.alpha, frame);
    const steps = paced.stepsPlanned;
    const drawn = paced.subject ?? scene;
    return { view: paced.run(controls, { car: drawn, ball: BALL, respawn: null }), car: drawn, scene, newest, steps };
  });
}

/** A desktop's frames (every one shown) */
const desktop = (dts: readonly number[]): Shown[] => dts.map((dt) => ({ dt, clock: null }));

/** A touch device's frames: a screen's vsyncs (`hz`, each one's time off by up to ±`jitter` s, `missed` of them skipped)
 *  through the page's FramePacer at `cap` */
function touch(hz: number, cap: number, seconds: number, o: { jitter?: number; missed?: number; seed?: number; skip?: (i: number) => boolean } = {}): Shown[] {
  const pacer = new FramePacer();
  const r = rng(o.seed ?? 5);
  const out: Shown[] = [];
  let last: number | null = null;
  for (let i = 0; i < hz * seconds; i++) {
    if (i > 10 && (r() < (o.missed ?? 0) || o.skip?.(i))) continue;
    const now = (i * 1000) / hz + (r() - 0.5) * 2 * (o.jitter ?? 0) * 1000;
    if (!pacer.due(now, cap)) continue;
    if (last !== null) out.push({ dt: (now - last) / 1000, clock: { refreshHz: pacer.refreshHz, capHz: cap, rephased: pacer.rephased } });
    last = now;
  }
  return out;
}

/** A touch device not holding its cap: a screen's vsyncs (`hz`) through the page's FramePacer at `cap`, no animation frame
 *  while the page is busy with the last one drawn (`busy` ms; `slow` ms for a share `late` of them, from `from` s to `to`
 *  s): a frame late by a refresh or two; a page busy past a refresh never gets every refresh's frame */
function busyPhone(
  hz: number,
  cap: number,
  seconds: number,
  o: { busy: number; slow: number; late: number; seed?: number; from?: number; to?: number },
): Shown[] {
  const pacer = new FramePacer();
  const r = rng(o.seed ?? 5);
  const out: Shown[] = [];
  let last: number | null = null;
  let busyUntil = 0;
  for (let i = 0; i < hz * seconds; i++) {
    const now = (i * 1000) / hz + (r() - 0.5) * 0.6;
    if (now < busyUntil || !pacer.due(now, cap)) continue;
    if (last !== null) out.push({ dt: (now - last) / 1000, clock: { refreshHz: pacer.refreshHz, capHz: cap, rephased: pacer.rephased } });
    last = now;
    const slow = now >= (o.from ?? 1) * 1000 && now < (o.to ?? seconds) * 1000 && r() < o.late;
    busyUntil = now + (slow ? o.slow : o.busy);
  }
  return out;
}

/** A desktop's frames on a `hz` screen, the page busy `busy` ms a frame (`slow` ms for a share `late`): each frame at the
 *  first refresh after it's done */
function busyDesktop(hz: number, seconds: number, o: { busy: number; slow: number; late: number; seed?: number }): Shown[] {
  const r = rng(o.seed ?? 5);
  const out: number[] = [];
  let last = 0;
  let busyUntil = 0;
  for (let i = 1; i < hz * seconds; i++) {
    const now = (i * 1000) / hz;
    if (now < busyUntil) continue;
    out.push((now - last) / 1000);
    last = now;
    busyUntil = now + (r() < o.late ? o.slow : o.busy);
  }
  return desktop(out);
}

/** The car's yaw on screen (degrees: its heading less the view's) */
function onScreen(f: Frame): number {
  const d = Math.atan2(f.car.rot.forward.y, f.car.rot.forward.x) - Math.atan2(f.view.forward.y, f.view.forward.x);
  return (Math.atan2(Math.sin(d), Math.cos(d)) * 180) / Math.PI;
}
/** The car's distance from the camera (uu) */
const fromCamera = (f: Frame): number => Math.hypot(f.car.pos.x - f.view.position.x, f.car.pos.y - f.view.position.y);
/** The followed car's distance from where the scene's moment has it (uu) */
const fromScene = (f: Frame): number => Math.hypot(f.car.pos.x - f.scene.pos.x, f.car.pos.y - f.scene.pos.y);

const half = (frames: readonly Frame[]): Frame[] => frames.slice(Math.floor(frames.length / 2));
const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const range = (v: readonly number[]): number => Math.max(...v) - Math.min(...v);
const even = (hz: number, seconds: number): number[] => Array.from({ length: Math.round(hz * seconds) }, () => 1 / hz);
/** Frames on a steady clock (`hz`), each one's time off by up to ±`by` s (a timer's jitter), as intervals */
function jittered(hz: number, seconds: number, by: number, r: () => number): number[] {
  const times = Array.from({ length: Math.round(hz * seconds) + 1 }, (_, i) => i / hz + (i === 0 ? 0 : (r() - 0.5) * 2 * by));
  return times.slice(1).map((t, i) => t - (times[i] ?? 0));
}
/** Frames on a `hz` screen, `share` of them two refreshes long (dropped) */
function dropping(hz: number, seconds: number, share: number, r: () => number): number[] {
  const out: number[] = [];
  for (let t = 0; t < seconds;) {
    const n = r() < share ? 2 : 1;
    out.push(n / hz);
    t += n / hz;
  }
  return out;
}

/** A seeded generator (the same frames each run) */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("the camera at the screen's rate", () => {
  it("at even frames it is the game's camera, frame for frame: a turn, then the air's quarter turn settling, a goal's slow motion", () => {
    const dts = desktop(even(60, 5));
    const slow = (i: number): number => (i >= 60 && i < 120 ? 0.25 : 1);
    for (const dilation of [(): number => 1, slow]) {
      const ours = run(dts, turnThenAir, { dilation });
      const game = run(dts, turnThenAir, { game: true, dilation });
      ours.forEach((f, i) => {
        const g = game[i];
        expect(Math.abs(f.view.forward.x - (g?.view.forward.x ?? 0)) + Math.abs(f.view.forward.y - (g?.view.forward.y ?? 0))).toBeLessThan(1e-9);
      });
    }
  });

  it("follows a steady turn as the game does at the screen's rate: 3.23° at 60, 3.68° at 120, 3.76° at 144, 3.81° at 165, 3.92° at 240", () => {
    for (const [hz, lag] of [
      [60, 3.23],
      [120, 3.68],
      [144, 3.76],
      [165, 3.81],
      [240, 3.92],
    ] as const) {
      const ours = mean(half(run(desktop(even(hz, 6)), turning)).map(onScreen));
      const game = mean(half(run(desktop(even(hz, 6)), turning, { game: true })).map(onScreen));
      expect(ours, `${String(hz)} Hz`).toBeCloseTo(game, 3);
      expect(Math.abs(ours), `${String(hz)} Hz`).toBeCloseTo(lag, 2);
    }
  });

  it("a phone at its cap: the cap's lag where it divides the screen's refresh (120 Hz at 60 or 30), the screen's where it doesn't (90 at 60)", () => {
    for (const [hz, cap, lag] of [
      [120, 60, 3.23],
      [120, 30, 2.45],
      [60, 30, 2.45],
      [90, 60, 3.53],
      [144, 60, 3.76],
    ] as const) {
      const seen = half(run(touch(hz, cap, 8, { jitter: 0.0003 }), turning)).map(onScreen);
      expect(Math.abs(mean(seen)), `${String(hz)}/${String(cap)}`).toBeCloseTo(lag, 1);
      expect(range(seen), `${String(hz)}/${String(cap)}`).toBeLessThan(0.01);
    }
  });

  it("every frame on a step, the car with its camera and the scene, at uneven frames: drops, a timer, a variable-refresh screen, a phone's cap (RV-1259, RV-1262)", () => {
    const r = rng(1);
    const cases: [string, Shown[]][] = [
      ["60 Hz, a third of the frames dropped", desktop(dropping(60, 10, 0.33, r))],
      ["144 Hz, 30 % dropped", desktop(dropping(144, 10, 0.3, r))],
      ["144 Hz, 45 % dropped", desktop(dropping(144, 10, 0.45, r))],
      ["120 Hz through a 1 ms timer (8, 8, 9 ms)", desktop(Array.from({ length: 1200 }, (_, i) => (i % 3 === 2 ? 0.009 : 0.008)))],
      ["a window from a 60 Hz screen to a 144 Hz one", desktop([...even(60, 2), ...even(144, 6)])],
      ["Firefox's 16/17 ms", desktop(Array.from({ length: 600 }, (_, i) => (i % 2 ? 0.01717 : 0.01617)))],
      ["60 Hz, each frame's time ±1 ms", desktop(jittered(60, 10, 0.001, r))],
      ["a phone, 144 Hz at 60, 2 % of vsyncs missed", touch(144, 60, 10, { jitter: 0.0003, missed: 0.02 })],
      ["a phone, 144 Hz at 30, 2 % missed", touch(144, 30, 10, { jitter: 0.0003, missed: 0.02 })],
      ["a phone, 90 Hz at 60, 2 % missed", touch(90, 60, 10, { jitter: 0.0003, missed: 0.02 })],
      ["a phone, 120 Hz at 60, 2 % missed", touch(120, 60, 10, { jitter: 0.0003, missed: 0.02 })],
    ];
    for (const [name, shown] of cases) {
      const frames = half(run(shown, straight));
      expect(frames.filter((f) => f.steps === 0).length, `${name}: frames without a step`).toBe(0);
      expect(range(frames.map(fromCamera)), `${name}: the car from its camera`).toBeLessThan(0.5);
      expect(Math.max(...frames.map(fromScene)), `${name}: the car from the scene`).toBeLessThan(3);
    }
  });

  it("over many runs: most frames doubled still a step on every frame, the car with its camera and the scene (RV-1268, RV-1270)", () => {
    const check = (name: string, shown: Shown[]): void => {
      const frames = half(run(shown, straight));
      expect(frames.filter((f) => f.steps === 0).length, `${name}: frames without a step`).toBe(0);
      expect(range(frames.map(fromCamera)), `${name}: the car from its camera`).toBeLessThan(0.5);
      expect(Math.max(...frames.map(fromScene)), `${name}: the car from the scene`).toBeLessThan(3);
    };
    for (let seed = 1; seed <= 10; seed++) {
      const r = rng(seed * 7919);
      for (const [hz, share] of [
        [60, 0.4],
        [60, 0.45],
        [144, 0.4],
        [144, 0.45],
      ] as const)
        check(`${String(hz)} Hz, ${String(share * 100)} % doubled, seed ${String(seed)}`, desktop(dropping(hz, 10, share, r)));
      // (a phone at a 30 cap, its vsyncs missed now and then: its pacer's refresh the steps', RV-1270)
      for (const hz of [144, 120]) check(`a phone, ${String(hz)} Hz at 30, seed ${String(seed)}`, touch(hz, 30, 10, { jitter: 0.0003, missed: 0.02, seed }));
    }
    const r = rng(11);
    check("60 Hz, half the frames doubled", desktop(dropping(60, 10, 0.5, r)));
    check("60 Hz, 70 % doubled", desktop(dropping(60, 10, 0.7, r)));
  });

  it("a stall, then a burst of short frames (a hidden tab caught up): the screen's rate kept, its lag (RV-1278)", () => {
    for (const hz of [60, 144]) {
      for (const burst of [8, 12, 16]) {
        const shown = desktop([...even(hz, 3), 0.4, ...Array.from({ length: burst }, () => 0.002), ...even(hz, 3)]);
        const frames = run(shown, turning);
        const after = frames.slice(Math.round(hz * 3) + 1 + burst + Math.round(hz * 0.5)).map(onScreen);
        const lag = hz === 60 ? 3.23 : 3.76;
        expect(Math.max(...after.map(Math.abs)), `${String(hz)} Hz, a burst of ${String(burst)}`).toBeLessThan(lag + 0.15);
      }
    }
  });

  it("a variable-refresh screen (no fixed refresh): a frame without a step keeps the car with its camera (RV-1259)", () => {
    const r = rng(13);
    const frames = half(run(desktop(Array.from({ length: 1000 }, () => 0.007 + 0.007 * r())), straight));
    expect(range(frames.map(fromCamera))).toBeLessThan(0.5);
  });

  it("a step's moment carried no more than 0.15 tick past the newest (RV-1263)", () => {
    const r = rng(17);
    for (const shown of [desktop(jittered(60, 10, 0.001, r)), desktop(jittered(144, 10, 0.0005, r)), touch(120, 60, 10, { jitter: 0.0003 })]) {
      for (const f of run(shown, straight)) expect(f.car.pos.x).toBeLessThanOrEqual(f.newest.pos.x + 0.15 * TICK_SECONDS * 2300 + 1e-6);
    }
  });

  it("after a window's move, whatever the time before it: still within 4 s (RV-1269); a faster screen stepped every frame within 0.2 s (RV-1272)", () => {
    for (const [from, to] of [
      [144, 60],
      [75, 60],
      [60, 144],
      [144, 165],
      [120, 60],
    ] as const) {
      for (let before = 2; before <= 6; before += 0.5) {
        const frames = run(desktop([...even(from, before), ...even(to, 6)]), turning);
        const moved = Math.round(from * before);
        const late = frames.slice(moved + 4 * to, moved + 6 * to).map(onScreen);
        expect(range(late), `${String(from)}→${String(to)} after ${String(before)} s`).toBeLessThan(0.05);
        if (to > from) {
          const settled = frames.slice(moved + Math.round(0.2 * to));
          expect(settled.filter((f) => f.steps === 0).length, `${String(from)}→${String(to)} after ${String(before)} s`).toBe(0);
        }
      }
    }
  });

  it("holds a steady turn still on screen at uneven frames, at the screen's lag", () => {
    const r = rng(2);
    const cases: [string, Shown[], number, number][] = [
      ["60 Hz, 15 % dropped", desktop(dropping(60, 10, 0.15, r)), 3.23, 0.01],
      ["60 Hz, a third dropped", desktop(dropping(60, 10, 0.33, r)), 3.23, 0.01],
      ["Firefox's 16/17 ms", desktop(Array.from({ length: 600 }, (_, i) => (i % 2 ? 0.01717 : 0.01617))), 3.23, 0.01],
      ["144 Hz, each frame's time ±0.5 ms", desktop(jittered(144, 10, 0.0005, r)), 3.76, 0.01],
      ["60 Hz, a hitch of two refreshes a second", desktop(Array.from({ length: 600 }, (_, i) => (i % 60 === 59 ? 2 / 60 : 1 / 60))), 3.23, 0.01],
      ["a 143.9 Hz screen", desktop(even(143.9, 10)), 3.76, 0.01],

      // (a stress past any browser's timer: ±2 ms at 144 Hz, 29 % of a frame either way; the game's camera wobbles 0.5°)
      ["144 Hz, each frame's time ±2 ms", desktop(jittered(144, 10, 0.002, r)), 3.76, 0.05],
    ];
    for (const [name, shown, lag, still] of cases) {
      const seen = half(run(shown, turning)).map(onScreen);
      expect(range(seen), name).toBeLessThan(still);
      expect(Math.abs(mean(seen)), name).toBeCloseTo(lag, 1);
    }
    // (where the game's camera, stepped with each frame's time, wobbles)
    expect(range(half(run(cases[0]?.[1] ?? [], turning, { game: true })).map(onScreen))).toBeGreaterThan(0.3);
    // (a phone holding its cap but for a frame now and then, one every 4 s: the late frame's one step of the time that
    // passed, as the game's at the cap on it: no more swing than the game's camera on the same frames, the cap's lag)
    for (const [hz, cap, lag] of [
      [120, 60, 3.23],
      [120, 30, 2.45],
    ] as const) {
      const shown = touch(hz, cap, 12, { jitter: 0.0003, skip: (i) => i % (4 * hz) === 2 * hz });
      const ours = half(run(shown, turning)).map(onScreen);
      const game = range(half(run(shown, turning, { game: true })).map(onScreen));
      expect(range(ours), `${String(hz)}/${String(cap)}`).toBeLessThanOrEqual(game + 0.01);
      expect(Math.abs(mean(ours)), `${String(hz)}/${String(cap)}`).toBeCloseTo(lag, 1);
    }
    // (a cap that doesn't divide the refresh, vsyncs missed: the refresh's steps, no more swing than the game's)
    const shown = touch(90, 60, 10, { jitter: 0.0003, missed: 0.02 });
    expect(range(half(run(shown, turning)).map(onScreen))).toBeLessThanOrEqual(range(half(run(shown, turning, { game: true })).map(onScreen)) + 0.01);
  });

  it("a phone not holding its cap (a slow browser: a tenth to two fifths of its frames late): the screen's refresh's steps, steady, the car with its camera and the scene", () => {
    const cases: [string, { busy: number; slow: number }][] = [
      ["a frame late by a refresh", { busy: 5, slow: 20 }],
      ["late by a refresh or two", { busy: 5, slow: 28 }],
      // (the page busy past a refresh every frame: never an animation frame a refresh after the last, the screen's
      // refresh read from frames two and three of them apart)
      ["the page busy 12 ms every frame", { busy: 12, slow: 20 }],
    ];
    for (const [name, busy] of cases) {
      for (const late of [0.1, 0.2, 0.4]) {
        for (const seed of [977, 1954, 2931]) {
          const label = `${name}, ${String(late * 100)} % late, seed ${String(seed)}`;
          const shown = busyPhone(120, 60, 12, { ...busy, late, seed });
          const turn = half(run(shown, turning));
          expect(turn.filter((f) => f.steps === 0).length, `${label}: frames without a step`).toBe(0);
          expect(range(turn.map(onScreen)), label).toBeLessThan(0.03);
          // (the game's lag at the screen's 120 Hz, not the cap's)
          expect(Math.abs(mean(turn.map(onScreen))), label).toBeCloseTo(3.68, 1);
          const along = half(run(shown, straight));
          expect(range(along.map(fromCamera)), `${label}: the car from its camera`).toBeLessThan(0.5);
          expect(Math.max(...along.map(fromScene)), `${label}: the car from the scene`).toBeLessThan(5);
        }
      }
    }
    // (the same frames with a 60 Hz screen's animation frames: a frame doubled)
    for (const late of [0.2, 0.4]) {
      const along = half(run(busyPhone(60, 60, 12, { busy: 5, slow: 20, late }), straight));
      expect(along.filter((f) => f.steps === 0).length).toBe(0);
      expect(Math.max(...along.map(fromScene))).toBeLessThan(5);
    }
  });

  it("the cap's steps again once the phone holds it: ten seconds with no frame late", () => {
    // (late frames for 6 s, then none)
    const frames = run(busyPhone(120, 60, 30, { busy: 5, slow: 20, late: 0.2, from: 1, to: 7 }), turning);
    const at = (from: number, to: number): number[] => frames.slice(Math.round(from * 55), Math.round(to * 55)).map(onScreen);
    expect(Math.abs(mean(at(4, 6)))).toBeCloseTo(3.68, 1);
    const end = frames.slice(frames.length - 300).map(onScreen);
    expect(Math.abs(mean(end))).toBeCloseTo(3.23, 2);
    expect(range(end)).toBeLessThan(0.01);
  });

  it("a desktop's page busy past a refresh (a slow browser at 144 Hz: frames two refreshes apart, some three): the screen's refresh found, steady", () => {
    for (const late of [0.1, 0.3]) {
      const shown = busyDesktop(144, 12, { busy: 9, slow: 16, late });
      const turn = half(run(shown, turning));
      expect(turn.filter((f) => f.steps === 0).length, `${String(late)}: frames without a step`).toBe(0);
      expect(range(turn.map(onScreen)), String(late)).toBeLessThan(0.02);
      expect(Math.abs(mean(turn.map(onScreen))), String(late)).toBeCloseTo(3.76, 1);
      expect(Math.max(...half(run(shown, straight)).map(fromScene)), String(late)).toBeLessThan(3);
    }
  });

  it("a hitch at 240 Hz swings no more than the game's; a stall past a quarter second, one step of the scene's time (RV-1261)", () => {
    const hitch = (ms: number): Shown[] => desktop(Array.from({ length: 1200 }, (_, i) => (i % 240 === 239 ? ms / 1000 : 1 / 240)));
    for (const ms of [40, 66, 100]) {
      const ours = range(half(run(hitch(ms), turning)).map(onScreen));
      const game = range(half(run(hitch(ms), turning, { game: true })).map(onScreen));
      expect(ours, `${String(ms)} ms`).toBeLessThanOrEqual(game + 0.01);
    }
    // (40 ms at 240 Hz, under the quarter second: its steps all run, a tenth of a degree at most, RV-1261)
    expect(range(half(run(hitch(40), turning)).map(onScreen))).toBeLessThan(0.1);
    // (a tab shown again after 0.4 s: no swing past the game's)
    const away = desktop([...even(60, 3), 0.4, ...even(60, 3)]);
    expect(range(half(run(away, turning)).map(onScreen))).toBeLessThanOrEqual(range(half(run(away, turning, { game: true })).map(onScreen)) + 0.01);
  });

  it("follows the screen's rate as it changes (a window from 144 Hz to 60): the new rate's lag, still", () => {
    const frames = run(desktop([...even(144, 3), ...even(60, 6)]), turning);
    const before = frames.slice(300, 432).map(onScreen);
    const after = frames.slice(frames.length - 120).map(onScreen);
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
    const yawOf = (frames: readonly Frame[]): number => {
      const v = frames[frames.length - 1]?.view;
      return v ? Math.atan2(v.forward.y, v.forward.x) : 0;
    };
    // (6 counts a 60th of a second, each frame its time's worth)
    const evenRun = run(desktop(even(60, 2)), still, { controls: (_, dt) => look(Math.round(dt * 360)) });
    const pattern = [1, 1, 1, 2, 1, 1, 1, 1, 1, 3, 1, 1, 1];
    const uneven: number[] = [];
    for (let left = 120, i = 0; left > 0; i++) {
      const n = Math.min(pattern[i % pattern.length] ?? 1, left);
      uneven.push(n / 60);
      left -= n;
    }
    const unevenRun = run(desktop(uneven), still, { controls: (_, dt) => look(Math.round(dt * 360)) });
    expect(Math.abs(yawOf(evenRun))).toBeGreaterThan(0.02);
    expect(yawOf(unevenRun)).toBeCloseTo(yawOf(evenRun), 6);
  });

  it("a reset forgets the ticks before it: the new car drawn at once, the view behind it, even with no tick since (RV-1260)", () => {
    const paced = new PacedCamera();
    for (let i = 1; i <= 8; i++) paced.tick({ ...straight(i * TICK_SECONDS), pos: vec3(3996, 1000, 17) }, BALL, null);
    paced.plan(1 / 240, 0.5);
    paced.run(CAR_CAM, { car: straight(0), ball: BALL, respawn: null });
    paced.reset();
    const fresh = { ...straight(0), pos: vec3(0, -4608, 17) };
    paced.plan(1 / 240, 0.5);
    expect(paced.subject).toBeNull();
    const view = paced.run(CAR_CAM, { car: fresh, ball: BALL, respawn: null });
    // (behind the new car, looking along it)
    expect(Math.hypot(view.position.x - fresh.pos.x, view.position.y - fresh.pos.y)).toBeLessThan(600);
    expect(view.forward.x).toBeGreaterThan(0.9);
  });

  it("a teleport between two ticks is not blended through", () => {
    const paced = new PacedCamera();
    paced.tick(straight(0), BALL, null);
    paced.tick({ ...straight(TICK_SECONDS), pos: vec3(4000, 0, 17) }, BALL, null);
    paced.plan(1 / 60, 0.5);
    expect(paced.subject?.pos.x).toBe(4000);
  });

  it("back after frames it didn't plan (the editor's camera, a replay): only the frame's time stepped (RV-1264)", () => {
    const paced = new PacedCamera();
    const clock = new FixedStep();
    let index = 0;
    const frame = (planned: boolean): number => {
      const ticks = clock.advance(1 / 60);
      for (let k = 0; k < ticks; k++) paced.tick(turning(++index * TICK_SECONDS), BALL, null);
      if (!planned) return 0;
      paced.plan(1 / 60, clock.alpha);
      const world = paced.worldPlanned;
      paced.run(CAR_CAM, { car: turning(index * TICK_SECONDS), ball: BALL, respawn: null });
      return world;
    };
    for (let i = 0; i < 120; i++) frame(true);
    for (let i = 0; i < 600; i++) frame(false);
    expect(frame(true)).toBeLessThan(1 / 60 + 1e-6);
  });
});
