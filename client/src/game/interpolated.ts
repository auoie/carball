// Render interpolation: bodies are drawn between the previous and the current physics tick.
import { Quaternion, type Vector3 } from "three";
import type { BodyState } from "../engine/world";
import { type Rot3, cross, dot, lerp, normalize, scale, sub } from "../math/vec";
import { toThreeQuaternion, toThreeVector } from "../render/coords";

/** Interpolates between the previous and current tick for rendering. */
export class Interpolated<T extends BodyState> {
  previous: T;
  current: T;
  constructor(state: T) {
    this.previous = state;
    this.current = state;
  }
  /** The next tick's state; `placed`: the body was put there (a respawn, a reset), not interpolated to it */
  push(state: T, placed = false): void {
    this.previous = placed ? state : this.current;
    this.current = state;
  }
  position(alpha: number, out: Vector3): Vector3 {
    return toThreeVector(lerp(this.previous.pos, this.current.pos, alpha), out);
  }
  rotation(alpha: number, out: Quaternion): Quaternion {
    const a = toThreeQuaternion(this.previous.rot, tmpQuat);
    return toThreeQuaternion(this.current.rot, out).slerp(a, 1 - alpha);
  }
  /** The state with interpolated position, velocity and rotation (for the camera). */
  blended(alpha: number): T {
    return {
      ...this.current,
      pos: lerp(this.previous.pos, this.current.pos, alpha),
      vel: lerp(this.previous.vel, this.current.vel, alpha),
      rot: blendRotation(this.previous.rot, this.current.rot, alpha),
    };
  }
}
const tmpQuat = new Quaternion();

/** Interpolates two orientations by their axes, re-orthonormalized (right = up x forward in this frame). */
function blendRotation(a: Rot3, b: Rot3, t: number): Rot3 {
  const forward = normalize(lerp(a.forward, b.forward, t), b.forward);
  const upRaw = lerp(a.up, b.up, t);
  const up = normalize(sub(upRaw, scale(forward, dot(upRaw, forward))), b.up);
  return { forward, up, right: cross(up, forward) };
}
