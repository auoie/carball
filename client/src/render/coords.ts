// Rocket League (Unreal) uses a left-handed frame with z up; Three.js is right-handed with y up.
// Swapping y and z is a reflection, which converts one into the other without mirroring the scene:
//   three = (rl.x, rl.z, rl.y)
// A car's local frame converts the same way: Three's local x = forward, y = up, z = right.
import { Matrix4, Quaternion, Vector3 } from "three";
import type { Rot3, Vec3 } from "../math/vec";

export function toThreeVector(v: Vec3, out: Vector3 = new Vector3()): Vector3 {
  return out.set(v.x, v.z, v.y);
}

const basis = new Matrix4();

/** The rotation whose local x/y/z axes are the car's forward/up/right in Three's frame. */
export function toThreeQuaternion(rot: Rot3, out: Quaternion = new Quaternion()): Quaternion {
  const { forward: f, right: r, up: u } = rot;
  // Columns: local x -> forward, local y -> up, local z -> right (each with y and z swapped)
  basis.set(f.x, u.x, r.x, 0, f.z, u.z, r.z, 0, f.y, u.y, r.y, 0, 0, 0, 0, 1);
  return out.setFromRotationMatrix(basis);
}

/** Back from Three's frame (rl = (x, z, y)). */
export function fromThreeVector(v: Vector3): Vec3 {
  return { x: v.x, y: v.z, z: v.y };
}

const axis = new Vector3();

/** The car frame of a Three rotation (toThreeQuaternion's inverse). */
export function fromThreeQuaternion(q: Quaternion): Rot3 {
  const f = fromThreeVector(axis.set(1, 0, 0).applyQuaternion(q));
  const u = fromThreeVector(axis.set(0, 1, 0).applyQuaternion(q));
  const r = fromThreeVector(axis.set(0, 0, 1).applyQuaternion(q));
  return { forward: f, up: u, right: r };
}

/** A vector (Rocket League frame) turned by a Three rotation. */
export function rotateRl(v: Vec3, q: Quaternion): Vec3 {
  return fromThreeVector(toThreeVector(v, axis).applyQuaternion(q));
}

