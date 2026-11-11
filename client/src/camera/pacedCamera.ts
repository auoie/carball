// The player's camera at the display's rate (the user's choice, 2026-11-10: RX82's RV-1251 (b); notes/camera.md). The
// game steps its camera once a frame with the frame's time; ours steps the same formulas on a steady clock: whole steps
// of 1/R, R the display's refresh as the frames show it (a touch device's Frame Rate when capped), on a grid
// phase-locked to the frames, each step with the car and ball as they were at its moment (blended from the ticks it's
// told), and the car it follows drawn as its last step saw it. So its lag behind a turning car is the game's at that rate (3.23°
// at 60, 3.76° at 144, 3.92° at 240), and uneven frames (a phone's dropped ones, Firefox's timer, a hitch) run whole steps
// at their grid times: no wobble (stepped once a frame with the frame's time, the lag changed with each frame's length).
import { blendStates } from "../game/interpolated";
import type { CarState } from "../engine/world";
import { TICK_SECONDS } from "../loop/fixedStep";
import { type Vec3, lerp } from "../math/vec";
import { type CameraControls, type CameraView, PlayerCamera, type RespawnState } from "./carballCamera";

/** What a tick gave the camera: its car (as drawn: online, its correction's offset on it), ball, respawn */
interface TickInput {
  readonly index: number;
  readonly car: CarState;
  readonly ball: Vec3;
  readonly respawn: RespawnState | null;
  /** The car put there (a reset, a respawn): not blended to */
  readonly placed: boolean;
}

/** The ticks kept (a stall's catch-up reaches no further back than this) */
const KEPT_TICKS = 32;
/** The rate's measure: the recent frames kept, how often it's taken, before it any rate this (Hz), its bounds (Hz) */
const RATE = { kept: 120, every: 30, first: 8, initial: 60, min: 24, max: 500 } as const;
/** The lock on the frames: each frame with steps, the grid pulled this share of its offset from the frame (phase), and
 *  the step's length this share (rate): small, so the steps stay evenly spaced through the frames' jitter, and any steady
 *  rate is followed exactly (a display a little off its nominal one, a variable-refresh display's own) */
const LOCK = { phase: 0.02, rate: 0.0004 } as const;
/** A measure this far from the rate followed (a share) is a new rate (a window moved to another display): taken at once */
const NEW_RATE = 0.02;
/** At most this many steps in a frame (a stall's: the grid starts again from the frame after) */
const MAX_STEPS = 8;

/** A step planned in a frame: its moment (drawn position, in ticks), world and real seconds */
interface Step {
  readonly at: number;
  readonly world: number;
  readonly real: number;
}

export class PacedCamera {
  readonly #ticks: TickInput[] = [];
  /** Ticks told */
  #index = 0;
  /** Real seconds told (the frames'), the last step's grid time on it, the last frame's drawn position (ticks) */
  #clock = 0;
  #grid: number | null = null;
  #drawn: number | null = null;
  readonly #intervals: number[] = [];
  #measured = 0;
  /** The step's length (s): the rate measured, the lock's correction on it */
  #period: number = 1 / RATE.initial;
  #planned: readonly Step[] = [];
  #view: CameraView | null = null;
  /** The car as the frame's last step sees it (null: none planned this frame) */
  #subject: CarState | null = null;
  /** The mouse's free-look counts not yet looked with: its offset is its counts (camera/freeLook.ts), not a rate, so a
   *  frame's are shared over its steps (none lost in a frame without one) */
  #mouse = { pitch: 0, yaw: 0 };

  constructor(readonly camera: PlayerCamera = new PlayerCamera()) {}

  /** The steps' rate (Hz) */
  get rate(): number {
    return 1 / this.#period;
  }

  /** A physics tick's car (as drawn), ball and respawn; `placed`: the car put there, not moved there */
  tick(car: CarState, ball: Vec3, respawn: RespawnState | null, placed = false): void {
    this.#index++;
    this.#ticks.push({ index: this.#index, car, ball, respawn, placed });
    if (this.#ticks.length > KEPT_TICKS) this.#ticks.shift();
  }

  /** A frame's steps planned: `real` its real seconds, `alpha` where the ticks put the scene (between the last two). Each
   *  step at its grid time, the car there blended from the ticks (a step just after the frame's time carried on from the
   *  last two), its world time the scene's (slowed after a goal). A touch device's Frame Rate is its frames' rate, so
   *  the camera's */
  plan(real: number, alpha: number): void {
    this.#measure(real);
    const period = this.#period;
    // (a step due this much before its grid time: under half a step, so the frames' jitter never moves one from a frame
    // to the next)
    const early = 0.45 * period;
    const end = this.#index - 1 + alpha;
    const start = this.#drawn ?? end;
    this.#drawn = end;
    const from = this.#clock;
    this.#clock += Math.max(0, real);
    const now = this.#clock;
    // (a stall, a page away, or the first frame: the grid starts again, a step due now)
    if (this.#grid === null || now - this.#grid > MAX_STEPS * period) this.#grid = now - period;
    // (the world's time a real second, as the scene moved: a goal's slow motion, and the time the physics clock drops in
    // a stall, more ticks than a frame runs, never stepped by the camera either)
    const dilation = real > 0 ? Math.max(0, ((end - start) * TICK_SECONDS) / real) : 1;
    const steps: Step[] = [];
    while (this.#grid + period <= now + early && steps.length < MAX_STEPS) {
      this.#grid += period;
      // (a step just after the frame: its moment a little past the last tick, the poses carried on from the last two)
      const through = real > 0 ? Math.max(0, (this.#grid - from) / real) : 1;
      steps.push({ at: start + through * (end - start), world: period * dilation, real: period });
    }
    // (phase-locked: pulled a little of the way to the frame each time, so the frames' jitter never moves a step from
    // one to the next, the steps stay evenly spaced, and a display a little off its measured rate never drifts)
    if (steps.length > 0) {
      const offset = Math.min(early, Math.max(-early, now - this.#grid));
      this.#grid += LOCK.phase * offset;
      this.#period += LOCK.rate * offset;
    }
    this.#planned = steps;
    const last = steps[steps.length - 1];
    this.#subject = last ? (this.#inputAt(last.at)?.car ?? null) : null;
  }

  /** The car to draw as the one this camera follows: as its last step saw it, at that step's moment (the frame's to
   *  within half a step), so the two agree whatever the frames; null with none this frame (drawn as the scene is) */
  get subject(): CarState | null {
    return this.#subject;
  }

  /** The planned steps run (the frame's controls; the mouse's counts shared over them): the view at the last. Before any
   *  tick, or with none planned since a reset, the camera's view of `fallback` (the car and ball as drawn) at once */
  run(controls: CameraControls, fallback: { readonly car: CarState; readonly ball: Vec3; readonly respawn: RespawnState | null }): CameraView {
    const look = controls.freeLook;
    const axes = look?.axes;
    this.#mouse = axes?.source === "mouse" ? { pitch: this.#mouse.pitch + axes.pitch, yaw: this.#mouse.yaw + axes.yaw } : { pitch: 0, yaw: 0 };
    const steps = this.#planned;
    this.#planned = [];
    steps.forEach((step, i) => {
      const input = this.#inputAt(step.at) ?? fallback;
      let stepControls = controls;
      if (look && axes?.source === "mouse") {
        const share = { pitch: this.#mouse.pitch / (steps.length - i), yaw: this.#mouse.yaw / (steps.length - i) };
        this.#mouse = { pitch: this.#mouse.pitch - share.pitch, yaw: this.#mouse.yaw - share.yaw };
        stepControls = { ...controls, freeLook: { ...look, axes: { ...axes, ...share } } };
      }
      this.#view = this.camera.update(step.world, input.car, input.ball, stepControls, input.respawn, step.real);
    });
    this.#view ??= this.camera.update(0, fallback.car, fallback.ball, controls, fallback.respawn, 0);
    return this.#view;
  }

  /** Starts over (a new car behind which it starts again): its first step a fresh view */
  reset(): void {
    this.camera.reset();
    this.#view = null;
    this.#mouse = { pitch: 0, yaw: 0 };
  }

  /** The rate from the frames' intervals, taken every so often: the mean of their middle half (a few dropped frames'
   *  long ones left out, a timer's alternation averaged); followed by the lock, the step's length set from it only when
   *  it's moved (a window taken to another display, a phone's refresh changing, a Frame Rate chosen) */
  #measure(real: number): void {
    const ms = real * 1000;
    if (ms > 0 && ms < 250) {
      this.#intervals.push(ms);
      if (this.#intervals.length > RATE.kept) this.#intervals.shift();
      this.#measured++;
      const n = this.#intervals.length;
      if (n === RATE.first || (n >= RATE.first && this.#measured % RATE.every === 0)) {
        const middle = [...this.#intervals].sort((a, b) => a - b).slice(Math.floor(n / 4), Math.ceil((3 * n) / 4));
        const measured = Math.min(RATE.max, Math.max(RATE.min, 1000 / (middle.reduce((a, b) => a + b, 0) / Math.max(1, middle.length))));
        if (n === RATE.first || Math.abs(measured * this.#period - 1) > NEW_RATE) this.#period = 1 / measured;
      }
    }
  }

  /** The tick inputs at a drawn position (ticks): blended between the two ticks around it (not across a placing, nor a
   *  move no tick can make); none kept there, null */
  #inputAt(at: number): { readonly car: CarState; readonly ball: Vec3; readonly respawn: RespawnState | null } | null {
    const base = Math.floor(at);
    let a = this.#ticks.find((e) => e.index === base);
    let b = this.#ticks.find((e) => e.index === base + 1);
    let t = at - base;
    // (past the last tick: carried on from the last two)
    if (a && !b && base === this.#index) [a, b, t] = [this.#ticks.find((e) => e.index === base - 1), a, 1 + t];
    if (!a || !b) return a ?? b ?? null;
    const moved = Math.hypot(b.car.pos.x - a.car.pos.x, b.car.pos.y - a.car.pos.y, b.car.pos.z - a.car.pos.z);
    if (b.placed || moved > TELEPORT) return t > 0 ? b : a;
    return { car: blendStates(a.car, b.car, t), ball: lerp(a.ball, b.ball, t), respawn: t < 0.5 ? a.respawn : b.respawn };
  }
}

/** Further than a tick can move a car (uu: 2300 uu/s is 19 a tick): a teleport, not blended */
const TELEPORT = 300;
