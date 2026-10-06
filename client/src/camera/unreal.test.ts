import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import {
  axesToRotator,
  normalizeAxis,
  rlerp,
  rotationAxes,
  rotator,
  rotatorToVector,
  smoothInterpLerpValue,
  transformByRotator,
  vectorToRotator,
} from "./unreal";

describe("Unreal rotators", () => {
  it("normalizes axes into (-32768, 32768]", () => {
    expect(normalizeAxis(32768)).toBe(32768);
    expect(normalizeAxis(32769)).toBe(-32767);
    expect(normalizeAxis(-40000)).toBe(25536);
    expect(normalizeAxis(65536 * 3 + 5)).toBe(5);
  });

  it("converts between rotators and directions", () => {
    const v = rotatorToVector(rotator(0, 16384, 0)); // yaw 90 degrees: +y
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
    const r = vectorToRotator(vec3(1, 1, Math.SQRT2));
    expect(r.pitch).toBeCloseTo(8192); // 45 degrees up
    expect(r.yaw).toBeCloseTo(8192);
  });

  it("FRotationMatrix axes: identity, then yaw and roll", () => {
    const id = rotationAxes(rotator(0, 0, 0));
    expect(id.right.y).toBeCloseTo(1);
    expect(id.up.z).toBeCloseTo(1);
    const rolled = rotationAxes(rotator(0, 0, 16384)); // rolled 90 degrees right: right axis points down
    expect(rolled.right.z).toBeCloseTo(-1);
    expect(rolled.up.y).toBeCloseTo(1);
  });

  it("recovers a rotator from its axes", () => {
    const r = rotator(-3000, 20000, 5000);
    const back = axesToRotator(rotationAxes(r));
    expect(back.pitch).toBeCloseTo(r.pitch, 3);
    expect(back.yaw).toBeCloseTo(r.yaw, 3);
    expect(back.roll).toBeCloseTo(r.roll, 3);
  });

  it("V >> R rotates a local vector into the world", () => {
    const v = transformByRotator(vec3(0, 0, 100), rotator(0, 0, 16384));
    expect(v.y).toBeCloseTo(100);
    expect(v.z).toBeCloseTo(0);
  });

  it("RLerp takes the shortest way round", () => {
    const r = rlerp(rotator(0, 30000, 0), rotator(0, -30000, 0), 0.5);
    expect(normalizeAxis(r.yaw)).toBeCloseTo(32768);
  });

  it("smooth interp is 1 - e^(-lambda dt)", () => {
    expect(smoothInterpLerpValue(10, 0.1)).toBeCloseTo(1 - Math.exp(-1), 4);
  });
});
