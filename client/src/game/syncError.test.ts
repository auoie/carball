// The correction smoothing against the game's constants (RBActor_TA.NetworkSyncSettings, notes/netcode-audit.md N-1).
import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { IDENTITY_ROT, type Rot3, length, vec3 } from "../math/vec";
import { SyncError } from "./syncError";

const FRAME = 1 / 60;

describe("SyncError", () => {
  it("a 100 uu correction glides out: at most 6.7 uu in the first frame, 1.6 after 60 frames, gone by about 83", () => {
    const e = new SyncError();
    e.accumulate({ pos: vec3(100, 0, 0) }, { pos: vec3(0, 0, 0) });
    expect(e.location.x).toBe(100);
    e.decay(FRAME);
    expect(100 - e.location.x).toBeLessThanOrEqual(6.7);
    for (let i = 1; i < 60; i++) e.decay(FRAME);
    expect(e.location.x).toBeCloseTo(1.6, 1);
    let frames = 60;
    while (length(e.location) > 0 && frames < 200) {
      e.decay(FRAME);
      frames++;
    }
    expect(frames).toBeGreaterThanOrEqual(82);
    expect(frames).toBeLessThanOrEqual(85);
  });

  it("errors add up, and the drawn pose is where it was at the moment of a correction", () => {
    const e = new SyncError();
    e.accumulate({ pos: vec3(10, 0, 0) }, { pos: vec3(0, 0, 0) });
    e.accumulate({ pos: vec3(0, 5, 0) }, { pos: vec3(0, 0, 0) });
    expect(e.location).toEqual(vec3(10, 5, 0));
    // (Three's frame: x, z, y)
    expect(e.applyPosition(new Vector3(1, 2, 3)).toArray()).toEqual([11, 2, 8]);
  });

  it("smooths a rotation correction at rate 5, snapping to none below 0.001 rad", () => {
    const e = new SyncError();
    const c = Math.cos(0.2);
    const s = Math.sin(0.2);
    const turned: Rot3 = { forward: vec3(c, s, 0), right: vec3(-s, c, 0), up: vec3(0, 0, 1) }; // 0.2 rad of yaw
    e.accumulate({ pos: vec3(0, 0, 0), rot: turned }, { pos: vec3(0, 0, 0), rot: IDENTITY_ROT });
    expect(e.angle()).toBeCloseTo(0.2, 4);
    e.decay(FRAME);
    expect(e.angle()).toBeCloseTo(0.2 * (1 - 5 / 60), 3);
    for (let i = 0; i < 200; i++) e.decay(FRAME);
    expect(e.angle()).toBe(0);
    expect(e.applyRotation(new Quaternion()).equals(new Quaternion())).toBe(true);
  });
});
