// The player's camera on the physics clock: stepped once a tick with that tick's car and ball, and drawn between its
// last two views at the frame's alpha, as the car is drawn between its last two ticks. Its smoothing is the game's
// formula at a steady 120 Hz whatever the browser's frames: stepped once a frame with the frame's time, its lag behind a
// turning car changed with each frame's length, so uneven frames (a phone's dropped ones, Firefox's timer, a hitch)
// wobbled the car on screen as it turned (the user's phone and Firefox, 2026-11-10; notes/mobile.md).
import { TICK_SECONDS } from "../loop/fixedStep";
import type { CarState } from "../engine/world";
import { type Vec3, vec3 } from "../math/vec";
import { type CameraControls, type CameraView, type FreeLookControls, PlayerCamera, type RespawnState } from "./carballCamera";

/** Two views further apart than a tick's turn or move can take them: a cut (the rear view, a new car, a reset), drawn as
 *  the later one, not blended */
const CUT_COS = Math.cos((30 * Math.PI) / 180);
const CUT_DISTANCE = 300;

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixVec = (a: Vec3, b: Vec3, t: number): Vec3 => vec3(mix(a.x, b.x, t), mix(a.y, b.y, t), mix(a.z, b.z, t));
const unit = (v: Vec3, fallback: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > 1e-9 ? vec3(v.x / l, v.y / l, v.z / l) : fallback;
};
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Between two views at `t` (0: `a`, 1: `b`); a cut, `b` */
export function blendViews(a: CameraView, b: CameraView, t: number): CameraView {
  const moved = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y, b.position.z - a.position.z);
  if (dot(a.forward, b.forward) < CUT_COS || dot(a.up, b.up) < CUT_COS || moved > CUT_DISTANCE) return b;
  return {
    position: mixVec(a.position, b.position, t),
    forward: unit(mixVec(a.forward, b.forward, t), b.forward),
    up: unit(mixVec(a.up, b.up, t), b.up),
    horizontalFov: mix(a.horizontalFov, b.horizontalFov, t),
  };
}

export class TickedCamera {
  #previous: CameraView | null = null;
  #latest: CameraView | null = null;
  /** The mouse's free-look counts not yet looked with, and the frame's ticks left to share them: its offset is its
   *  counts (camera/freeLook.ts), not a rate, so each tick takes its share (none lost in a frame without a tick, none
   *  doubled in one with two) */
  #mouse = { pitch: 0, yaw: 0 };
  #ticksLeft = 0;

  constructor(readonly camera: PlayerCamera = new PlayerCamera()) {}

  /** Before a frame's ticks: how many, and the frame's free look (the mouse's counts added to those pending) */
  frame(ticks: number, freeLook: FreeLookControls | null | undefined): void {
    const axes = freeLook?.axes;
    this.#mouse = axes?.source === "mouse" ? { pitch: this.#mouse.pitch + axes.pitch, yaw: this.#mouse.yaw + axes.yaw } : { pitch: 0, yaw: 0 };
    this.#ticksLeft = ticks;
  }

  /** A physics tick: the camera stepped a tick's time with that tick's car and ball and the frame's controls (the mouse's
   *  free look its share); `realTick` the tick's real time (the swivel's: a goal's slow motion stretches it) */
  tick(car: CarState, ball: Vec3, controls: CameraControls, respawn: RespawnState | null, realTick = TICK_SECONDS): void {
    this.#previous = this.#latest;
    this.#latest = this.camera.update(TICK_SECONDS, car, ball, this.#share(controls), respawn, realTick);
  }

  #share(controls: CameraControls): CameraControls {
    const look = controls.freeLook;
    if (look?.axes.source !== "mouse") return controls;
    const n = Math.max(1, this.#ticksLeft);
    this.#ticksLeft = Math.max(0, this.#ticksLeft - 1);
    const share = { pitch: this.#mouse.pitch / n, yaw: this.#mouse.yaw / n };
    this.#mouse = { pitch: this.#mouse.pitch - share.pitch, yaw: this.#mouse.yaw - share.yaw };
    return { ...controls, freeLook: { ...look, axes: { ...look.axes, ...share } } };
  }

  /** The frame's view: between the last two ticks' at `alpha`; before any tick (a new camera, a reset), the camera's own
   *  first view of this car, at once */
  view(alpha: number, car: CarState, ball: Vec3, controls: CameraControls, respawn: RespawnState | null): CameraView {
    this.#latest ??= this.camera.update(0, car, ball, controls, respawn, 0);
    const previous = this.#previous;
    return previous ? blendViews(previous, this.#latest, Math.min(1, Math.max(0, alpha))) : this.#latest;
  }

  /** Starts over (a new car behind which it starts again): no blend across it */
  reset(): void {
    this.camera.reset();
    this.#previous = null;
    this.#latest = null;
    this.#mouse = { pitch: 0, yaw: 0 };
  }
}
