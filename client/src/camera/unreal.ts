// The Unreal Engine 3 maths the camera script is written in: rotators in Unreal units (65536 per turn),
// FRotationMatrix axes, RLerp, the smooth-interp helpers. Vectors use the game's frame (z up).
import { type Rot3, type Vec3, add, cross, dot, length, scale, sub, vec3 } from "../math/vec";

export const UNITS_PER_TURN = 65536;
const RAD_TO_UNITS = 32768 / Math.PI;
const UNITS_TO_RAD = Math.PI / 32768;

/** FRotator (floats here; the game truncates to ints, a 0.0055 degree difference). */
export interface Rotator {
  readonly pitch: number;
  readonly yaw: number;
  readonly roll: number;
}

export const rotator = (pitch: number, yaw: number, roll: number): Rotator => ({ pitch, yaw, roll });
export const ZERO_ROTATOR: Rotator = rotator(0, 0, 0);

/** FRotator::NormalizeAxis: wrap into (-32768, 32768]. */
export function normalizeAxis(a: number): number {
  let r = ((a % UNITS_PER_TURN) + UNITS_PER_TURN) % UNITS_PER_TURN;
  if (r > 32768) r -= UNITS_PER_TURN;
  return r;
}

export const normalizeRotator = (r: Rotator): Rotator => rotator(normalizeAxis(r.pitch), normalizeAxis(r.yaw), normalizeAxis(r.roll));

export const addRotators = (a: Rotator, b: Rotator): Rotator => rotator(a.pitch + b.pitch, a.yaw + b.yaw, a.roll + b.roll);
export const subRotators = (a: Rotator, b: Rotator): Rotator => rotator(a.pitch - b.pitch, a.yaw - b.yaw, a.roll - b.roll);
export const scaleRotator = (a: Rotator, s: number): Rotator => rotator(a.pitch * s, a.yaw * s, a.roll * s);

/** Vector(Rotator): the forward direction. */
export function rotatorToVector(r: Rotator): Vec3 {
  const p = r.pitch * UNITS_TO_RAD;
  const y = r.yaw * UNITS_TO_RAD;
  return vec3(Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p));
}

/** Rotator(Vector): yaw and pitch of a direction, no roll. */
export function vectorToRotator(v: Vec3): Rotator {
  return rotator(Math.atan2(v.z, Math.hypot(v.x, v.y)) * RAD_TO_UNITS, Math.atan2(v.y, v.x) * RAD_TO_UNITS, 0);
}

/** FRotationMatrix: world directions of the rotator's x (forward), y (right) and z (up) axes. */
export function rotationAxes(r: Rotator): Rot3 {
  const sp = Math.sin(r.pitch * UNITS_TO_RAD);
  const cp = Math.cos(r.pitch * UNITS_TO_RAD);
  const sy = Math.sin(r.yaw * UNITS_TO_RAD);
  const cy = Math.cos(r.yaw * UNITS_TO_RAD);
  const sr = Math.sin(r.roll * UNITS_TO_RAD);
  const cr = Math.cos(r.roll * UNITS_TO_RAD);
  return {
    forward: vec3(cp * cy, cp * sy, sp),
    right: vec3(sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, -sr * cp),
    up: vec3(-(cr * sp * cy + sr * sy), cy * sr - cr * sp * sy, cr * cp),
  };
}

/** FMatrix::Rotator(): the rotator of an orientation given by its axes. */
export function axesToRotator(axes: Rot3): Rotator {
  const x = axes.forward;
  const pitch = Math.atan2(x.z, Math.hypot(x.x, x.y)) * RAD_TO_UNITS;
  const yaw = Math.atan2(x.y, x.x) * RAD_TO_UNITS;
  const noRollRight = rotationAxes(rotator(pitch, yaw, 0)).right;
  const roll = Math.atan2(dot(axes.up, noRollRight), dot(axes.right, noRollRight)) * RAD_TO_UNITS;
  return rotator(pitch, yaw, roll);
}

/** `V >> R`: a vector in the rotator's local frame, in world space. */
export function transformByRotator(v: Vec3, r: Rotator): Vec3 {
  const a = rotationAxes(r);
  return add(add(scale(a.forward, v.x), scale(a.right, v.y)), scale(a.up, v.z));
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));

/** RLerp(A, B, Alpha, bShortestPath = true). */
export const rlerp = (a: Rotator, b: Rotator, alpha: number): Rotator => addRotators(a, scaleRotator(normalizeRotator(subRotators(b, a)), alpha));

/** Object.GetSmoothInterpLerpValue: 1 - e^(-lambda * dt), frame-rate independent. */
export const smoothInterpLerpValue = (lambda: number, dt: number): number => 1 - Math.pow(2.71828, -lambda * dt);
export const vSmoothInterpTo = (from: Vec3, to: Vec3, lambda: number, dt: number): Vec3 => vlerp(from, to, smoothInterpLerpValue(lambda, dt));
export const rSmoothInterpTo = (from: Rotator, to: Rotator, lambda: number, dt: number): Rotator => rlerp(from, to, smoothInterpLerpValue(lambda, dt));

export function normal(v: Vec3): Vec3 {
  const len = length(v);
  return len < 1e-4 ? vec3(0, 0, 0) : scale(v, 1 / len);
}

export { cross, dot };
