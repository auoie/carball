// Render interpolation (notes/client-loop-timing.md LT-8): the camera's blended pose is the pose drawn.
import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { BodyState } from "../engine/world";
import { vec3 } from "../math/vec";
import { fromThreeQuaternion } from "../render/coords";
import { Interpolated } from "./interpolated";

const body = (yaw: number, roll: number): BodyState => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), roll));
  return { pos: vec3(yaw * 100, 0, 17), vel: vec3(0, 0, 0), angVel: vec3(0, 0, 0), rot: fromThreeQuaternion(q) };
};

describe("render interpolation", () => {
  it("blends the camera's rotation as the drawn one (slerp), not by its axes", () => {
    const s = new Interpolated(body(0, 0));
    s.push(body(1.2, 0.7));
    for (const alpha of [0, 0.3, 0.5, 0.9, 1]) {
      const drawn = fromThreeQuaternion(s.rotation(alpha, new Quaternion()));
      const blended = s.blended(alpha).rot;
      for (const axis of ["forward", "right", "up"] as const) {
        for (const c of ["x", "y", "z"] as const) expect(blended[axis][c]).toBeCloseTo(drawn[axis][c], 12);
      }
    }
  });
});
