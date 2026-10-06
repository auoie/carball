import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { type Rot3, vec3 } from "../math/vec";
import { toThreeQuaternion, toThreeVector } from "./coords";

const close = (a: Vector3, b: Vector3): void => {
  expect(a.distanceTo(b)).toBeLessThan(1e-6);
};

describe("Rocket League -> Three.js frames", () => {
  it("maps z up to y up", () => {
    close(toThreeVector(vec3(1, 2, 3)), new Vector3(1, 3, 2));
  });

  it("rotates a car's local axes onto its forward/up/right directions", () => {
    // Car facing +y, the orange goal (yaw 90 degrees in Rocket League)
    const rot: Rot3 = { forward: vec3(0, 1, 0), right: vec3(-1, 0, 0), up: vec3(0, 0, 1) };
    const q = toThreeQuaternion(rot);
    close(new Vector3(1, 0, 0).applyQuaternion(q), toThreeVector(rot.forward));
    close(new Vector3(0, 1, 0).applyQuaternion(q), toThreeVector(rot.up));
    close(new Vector3(0, 0, 1).applyQuaternion(q), toThreeVector(rot.right));
  });

  it("handles a car upside down on the ceiling", () => {
    const rot: Rot3 = { forward: vec3(1, 0, 0), right: vec3(0, -1, 0), up: vec3(0, 0, -1) };
    const q = toThreeQuaternion(rot);
    close(new Vector3(0, 1, 0).applyQuaternion(q), new Vector3(0, -1, 0));
  });
});
