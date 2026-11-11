// Render interpolation: bodies are drawn between the previous and the current physics tick.
import { Quaternion, type Vector3 } from "three";
import type { BodyState } from "../engine/world";
import { lerp } from "../math/vec";
import { fromThreeQuaternion, toThreeQuaternion, toThreeVector } from "../render/coords";

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
  /** The state with interpolated position, velocity and rotation (for the camera: the pose drawn, rotation slerped as
   *  rotation(), as the game's render pose: notes/client-loop-timing.md LT-8). */
  blended(alpha: number): T {
    return blendStates(this.previous, this.current, alpha);
  }
}
const tmpQuat = new Quaternion();
const blendQuat = new Quaternion();

/** Two ticks' states blended at `alpha` (0: `a`, 1: `b`): position, velocity and rotation (slerped), the rest `b`'s */
export function blendStates<T extends BodyState>(a: T, b: T, alpha: number): T {
  const from = toThreeQuaternion(a.rot, tmpQuat);
  return {
    ...b,
    pos: lerp(a.pos, b.pos, alpha),
    vel: lerp(a.vel, b.vel, alpha),
    rot: fromThreeQuaternion(toThreeQuaternion(b.rot, blendQuat).slerp(from, 1 - alpha)),
  };
}
