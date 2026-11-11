// The player's camera at the screen's rate (the user's choice, 2026-11-10: RX82's RV-1251 (b), RX84's RV-1262;
// notes/camera.md). The game steps its camera once a frame with the frame's time; ours steps the same formulas on a
// steady clock: whole steps of 1/R on a grid phase-locked to the frames, each step with the car and ball as they were at
// its moment (blended from the ticks it's told), and the car it follows drawn as its last step saw it. R is the screen's
// refresh (a phone's Frame Rate cap when it divides it: 60 on a 120 Hz phone), so every frame drawn lands on a step: its
// lag behind a turning car is the game's at that rate (3.23° at 60, 3.76° at 144, 3.92° at 240), and uneven frames (a
// phone's dropped ones, Firefox's timer, a hitch) run whole steps at their grid times: no wobble (stepped once a frame
// with the frame's time, the lag changed with each frame's length).
import { blendStates } from "../game/interpolated";
import type { CarState } from "../engine/world";
import { TICK_SECONDS } from "../loop/fixedStep";
import { type Vec3, lerp } from "../math/vec";
import { type CameraControls, type CameraView, PlayerCamera, type RespawnState } from "./carballCamera";

/** A touch device's frames as its pacer knows them (input/touchSettings.ts FramePacer); a desktop's: none (its frames
 *  are every refresh the page makes, measured here) */
export interface FrameClock {
  /** The screen's refresh, from every animation frame (Hz; null: not measured yet) */
  readonly refreshHz: number | null;
  /** The Frame Rate's cap (Hz; 0: none) */
  readonly capHz: number;
  /** This frame started the cap's cadence again (a vsync missed) */
  readonly rephased: boolean;
}

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
/** The most ticks a frame moves the scene (the physics clock's 5 and its alpha) */
const FRAME_TICKS = 6;
/** A desktop's refresh measured: the recent frames kept, how often it's taken, before it any rate this (Hz), its bounds */
const RATE = { kept: 120, every: 30, first: 8, initial: 60, min: 24, max: 500 } as const;
/** The lock on the frames: each frame with steps, the grid pulled this share of its offset from the frame (phase), the
 *  step's length this share (rate) within `range` of the rate measured: small, so the steps stay evenly spaced through
 *  the frames' jitter, and a screen a little off the rate measured is followed exactly */
const LOCK = { phase: 0.02, rate: 0.0004, range: 0.03 } as const;
/** A stall this long (s) runs no steps: the grid starts again, one step of the time the scene moved */
const STALL = 0.25;
/** A cap this close to a whole share of the refresh divides it (119.88 Hz at 60: 2) */
const DIVIDES = 0.1;
/** The furthest a step's moment is carried past the newest tick (ticks: 1.25 ms, a timer's jitter) */
const CARRY = 0.15;
/** A rate this far off the lock's centre (a share) moves the centre to it */
const RECENTRE = 0.01;

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
  /** Real seconds told (the frames'), the last grid point on it, the last frame's drawn position (ticks) */
  #clock = 0;
  #grid: number | null = null;
  #drawn: number | null = null;
  /** The last step's moment (drawn position) and time (on the clock) */
  #last: { readonly at: number; readonly time: number } | null = null;
  readonly #intervals: number[] = [];
  #measured = 0;
  /** A desktop's refresh as measured (s) */
  #refresh = 1 / RATE.initial;
  /** The step's length (s): the rate's (`#base`), the lock's correction on it */
  #base = 1 / RATE.initial;
  #period = 1 / RATE.initial;
  #planned: readonly Step[] = [];
  #view: CameraView | null = null;
  /** The car as the last step saw it (kept through a frame without a step, with its view) */
  #subject: CarState | null = null;
  /** The mouse's free-look counts not yet looked with: its offset is its counts (camera/freeLook.ts), not a rate, so a
   *  frame's are shared over its steps (none lost in a frame without one) */
  #mouse = { pitch: 0, yaw: 0 };

  constructor(readonly camera: PlayerCamera = new PlayerCamera()) {}

  /** The steps' rate (Hz) */
  get rate(): number {
    return 1 / this.#period;
  }

  /** The steps planned in the last frame, and the world time they step (tests) */
  get stepsPlanned(): number {
    return this.#planned.length;
  }

  get worldPlanned(): number {
    return this.#planned.reduce((s, step) => s + step.world, 0);
  }

  /** A physics tick's car (as drawn), ball and respawn; `placed`: the car put there, not moved there */
  tick(car: CarState, ball: Vec3, respawn: RespawnState | null, placed = false): void {
    this.#index++;
    this.#ticks.push({ index: this.#index, car, ball, respawn, placed });
    if (this.#ticks.length > KEPT_TICKS) this.#ticks.shift();
  }

  /** A frame's steps planned: `real` its real seconds, `alpha` where the ticks put the scene (between the last two),
   *  `frame` a touch device's pacer's (none: a desktop's). Each step at its grid time, the car there blended from the ticks
   *  (none past the newest), its world time the scene's (slowed after a goal) */
  plan(real: number, alpha: number, frame: FrameClock | null = null): void {
    const from = this.#clock;
    this.#clock += Math.max(0, real);
    const now = this.#clock;
    const end = this.#index - 1 + alpha;
    // (back after frames it didn't plan (the editor's camera, a replay): only this frame's moving stepped, RV-1264)
    const start = this.#drawn !== null && end - this.#drawn <= FRAME_TICKS ? this.#drawn : end - Math.min(FRAME_TICKS, real / TICK_SECONDS);
    this.#drawn = end;
    const { period: base, capped } = this.#rateOf(real, frame);
    // (a rate past the lock's reach of the one followed is a new one: the grid starts again on it; a little off the
    // lock's centre, the range centred on it again, the lock carrying on)
    if (Math.abs(base / this.#period - 1) > LOCK.range) [this.#base, this.#period, this.#grid] = [base, base, null];
    else if (Math.abs(base / this.#base - 1) > RECENTRE) this.#base = base;
    const period = this.#period;
    // (a step due this much before its grid time: under half a step, so the frames' jitter never moves one from a frame
    // to the next)
    const early = 0.45 * period;
    // (the scene's moment at a time in the frame, a step's just past the frame's too (its moment exactly): past the newest
    // tick by a timer's jitter at most, carried on from the last two (a wall's or a touch's overshoot under 3 uu), never
    // further, RV-1263)
    const at = (time: number): number => (real > 0 ? Math.min(this.#index + CARRY, start + Math.max(0, (time - from) / real) * (end - start)) : end);
    const steps: Step[] = [];
    const last = this.#last;
    if (frame?.rephased && capped && last && this.#grid !== null) {
      // (a vsync missed at a phone's cap: one step of the time that passed, as the game's on a late frame, the steps
      // from this frame on)
      steps.push({ at: end, world: Math.max(0, (end - last.at) * TICK_SECONDS), real: now - last.time });
      this.#grid = now;
    } else if (this.#grid === null || now - this.#grid > STALL) {
      // (the first frame, a stall, a new rate: one step of the time the scene moved this frame, the grid from here: RV-1261)
      steps.push({ at: end, world: Math.max(0, (end - start) * TICK_SECONDS), real: Math.min(real, period) });
      this.#grid = now;
    } else {
      // (the world's time a real second, as the scene moved: a goal's slow motion, and the time the physics clock drops
      // in a stall, never stepped by the camera either)
      const dilation = real > 0 ? Math.max(0, ((end - start) * TICK_SECONDS) / real) : 1;
      while (this.#grid + period <= now + early) {
        this.#grid += period;
        steps.push({ at: at(this.#grid), world: period * dilation, real: period });
      }
      // (phase-locked: pulled a little of the way to the frame each time, so the frames' jitter never moves a step from
      // one to the next, the steps stay evenly spaced, and a screen a little off its measured rate is followed)
      if (steps.length > 0) {
        const offset = Math.min(early, Math.max(-early, now - this.#grid));
        this.#grid += LOCK.phase * offset;
        this.#period = Math.min(this.#base * (1 + LOCK.range), Math.max(this.#base * (1 - LOCK.range), this.#period + LOCK.rate * offset));
      }
    }
    this.#planned = steps;
    const newest = steps[steps.length - 1];
    if (newest) {
      this.#last = { at: newest.at, time: this.#grid };
      this.#subject = this.#inputAt(newest.at)?.car ?? null;
    }
    // (a frame without a step keeps the last step's car with its view: RV-1259)
  }

  /** The car to draw as the one this camera follows: as its last step saw it, at that step's moment (the frame's, every
   *  frame landing on a step), so the two agree whatever the frames; null before any (drawn as the scene is) */
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

  /** Starts over (a new car behind which it starts again): its ticks forgotten, so nothing before is drawn or stepped
   *  (RV-1260); its first step a fresh view */
  reset(): void {
    this.camera.reset();
    this.#ticks.length = 0;
    this.#drawn = null;
    this.#last = null;
    this.#grid = null;
    this.#subject = null;
    this.#view = null;
    this.#mouse = { pitch: 0, yaw: 0 };
  }

  /** The step's length: a touch device's cap where it divides the screen's refresh (its frames landing on every step),
   *  else the screen's refresh (a cap that doesn't divide it, 60 on a 90 Hz screen: frames a refresh or two apart, each on
   *  a step, none shimmering); a desktop's refresh measured from its frames */
  #rateOf(real: number, frame: FrameClock | null): { readonly period: number; readonly capped: boolean } {
    if (frame?.refreshHz) {
      const refresh = frame.refreshHz;
      const share = frame.capHz > 0 ? refresh / frame.capHz : 1;
      const whole = Math.round(share);
      return whole >= 2 && Math.abs(share - whole) <= DIVIDES ? { period: whole / refresh, capped: true } : { period: 1 / refresh, capped: false };
    }
    this.#measure(real);
    return { period: this.#refresh, capped: false };
  }

  /** A desktop's refresh from its frames' intervals, taken every so often: each interval over the whole refreshes it
   *  spans (a dropped frame two), averaged (a timer's jitter cancels; their median's to start from) */
  #measure(real: number): void {
    const ms = real * 1000;
    if (!(ms > 0) || ms >= 250) return;
    this.#intervals.push(ms);
    if (this.#intervals.length > RATE.kept) this.#intervals.shift();
    this.#measured++;
    const n = this.#intervals.length;
    if (n !== RATE.first && (n < RATE.first || this.#measured % RATE.every !== 0)) return;
    // (seeded from the median: a timer's jitter doesn't move it, nor dropped frames short of half)
    let refresh = [...this.#intervals].sort((a, b) => a - b)[Math.floor(n / 2)] ?? 1000 / RATE.initial;
    for (let pass = 0; pass < 2; pass++) {
      const shares = this.#intervals.filter((v) => v <= 4.5 * refresh).map((v) => v / Math.max(1, Math.round(v / refresh)));
      if (shares.length > 0) refresh = shares.reduce((a, b) => a + b, 0) / shares.length;
    }
    this.#refresh = 1 / Math.min(RATE.max, Math.max(RATE.min, 1000 / refresh));
  }

  /** The tick inputs at a drawn position (ticks): blended between the two ticks around it (not across a placing, nor a
   *  move no tick can make); none kept there, null */
  #inputAt(at: number): { readonly car: CarState; readonly ball: Vec3; readonly respawn: RespawnState | null } | null {
    const base = Math.floor(at);
    let a = this.#ticks.find((e) => e.index === base);
    let b = this.#ticks.find((e) => e.index === base + 1);
    let t = at - base;
    // (just past the newest tick: carried on from the last two, CARRY at most)
    if (a && !b && base === this.#index) [a, b, t] = [this.#ticks.find((e) => e.index === base - 1), a, 1 + t];
    if (!a || !b) return a ?? b ?? null;
    const moved = Math.hypot(b.car.pos.x - a.car.pos.x, b.car.pos.y - a.car.pos.y, b.car.pos.z - a.car.pos.z);
    if (b.placed || moved > TELEPORT) return t > 0 ? b : a;
    return { car: blendStates(a.car, b.car, t), ball: lerp(a.ball, b.ball, t), respawn: t < 0.5 ? a.respawn : b.respawn };
  }
}

/** Further than a tick can move a car (uu: 2300 uu/s is 19 a tick): a teleport, not blended */
const TELEPORT = 300;
