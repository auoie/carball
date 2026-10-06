// Small immutable vector/rotation types in Rocket League's frame: x and y horizontal, z up (uu).

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Rotation as the world directions of the local axes: forward (x), right (y), up (z). */
export interface Rot3 {
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const ZERO: Vec3 = vec3(0, 0, 0);
export const IDENTITY_ROT: Rot3 = { forward: vec3(1, 0, 0), right: vec3(0, 1, 0), up: vec3(0, 0, 1) };

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));

export function normalize(a: Vec3, fallback: Vec3 = ZERO): Vec3 {
  const len = length(a);
  return len > 1e-6 ? scale(a, 1 / len) : fallback;
}

/** A local offset (x forward, y right, z up) in world space. */
export function localToWorld(rot: Rot3, local: Vec3): Vec3 {
  return add(add(scale(rot.forward, local.x), scale(rot.right, local.y)), scale(rot.up, local.z));
}
