// The correction smoothing against the game's constants (RBActor_TA.NetworkSyncSettings, notes/netcode-audit.md N-1).
import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { IDENTITY_ROT, type Rot3, length, vec3 } from "../math/vec";

/** `angle` rad about the unit axis `axis` (Rocket League frame), as a car rotation */
function turn(axis: Vector3, angle: number, of: Rot3 = IDENTITY_ROT): Rot3 {
  const q = new Quaternion().setFromAxisAngle(new Vector3(axis.x, axis.z, axis.y), angle);
  return { forward: rotateRl(of.forward, q), right: rotateRl(of.right, q), up: rotateRl(of.up, q) };
}

/** The drawn rotation: the error on top of the state's */
function drawn(e: SyncError, rot: Rot3): Quaternion {
  return e.applyRotation(toThreeQuaternion(rot));
}
import { fromThreeQuaternion, rotateRl, toThreeQuaternion } from "../render/coords";
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

  it("a second rotation correction keeps the drawn pose too (the error composed on the right, as the game's)", () => {
    // Two corrections about different axes (they don't commute): after each, the car is drawn where it was before it
    const e = new SyncError();
    const a = turn(new Vector3(0, 0, 1), 0.3);
    const b = turn(new Vector3(1, 0, 0), 0.4, a);
    const c = turn(new Vector3(0, 1, 0), -0.5, b);
    e.accumulate({ pos: vec3(0, 0, 0), rot: a }, { pos: vec3(0, 0, 0), rot: b });
    expect(drawn(e, b).angleTo(toThreeQuaternion(a))).toBeLessThan(1e-6);
    e.accumulate({ pos: vec3(0, 0, 0), rot: b }, { pos: vec3(0, 0, 0), rot: c });
    expect(drawn(e, c).angleTo(toThreeQuaternion(a))).toBeLessThan(1e-6);
  });

  it("converts rotations back from Three's frame", () => {
    const r = turn(new Vector3(0.6, 0, 0.8), 1.1, turn(new Vector3(0, 0, 1), 0.7));
    const back = fromThreeQuaternion(toThreeQuaternion(r));
    for (const k of ["forward", "right", "up"] as const) {
      expect(length(vec3(back[k].x - r[k].x, back[k].y - r[k].y, back[k].z - r[k].z))).toBeLessThan(1e-6);
    }
  });

  it("decays once a tick, drawn between the last tick's offset and this one at the frame's alpha; a correction moves both, so every alpha's drawn pose stays (RV-1247)", () => {
    const e = new SyncError();
    e.accumulate({ pos: vec3(100, 0, 0) }, { pos: vec3(0, 0, 0) });
    e.tick(1 / 120);
    const next = 100 * (1 - 4 / 120);
    expect(e.locationAt(0).x).toBeCloseTo(100, 9);
    expect(e.locationAt(1).x).toBeCloseTo(next, 9);
    expect(e.locationAt(0.5).x).toBeCloseTo((100 + next) / 2, 9);
    const alphas = [0, 0.3, 1];
    const before = alphas.map((a) => e.locationAt(a).x);
    e.accumulate({ pos: vec3(20, 0, 0) }, { pos: vec3(0, 0, 0) });
    alphas.forEach((a, i) => {
      expect(e.locationAt(a).x).toBeCloseTo((before[i] ?? 0) + 20, 9);
    });
    // (the rotation alike: halfway, half the turn between the two ticks' offsets)
    const r = new SyncError();
    r.accumulate({ pos: vec3(0, 0, 0), rot: turn(new Vector3(0, 0, 1), 0.2) }, { pos: vec3(0, 0, 0), rot: IDENTITY_ROT });
    r.tick(1 / 120);
    const angle = (q: Quaternion): number => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    expect(angle(r.rotationAt(0, new Quaternion()))).toBeCloseTo(0.2, 6);
    expect(angle(r.rotationAt(0.5, new Quaternion()))).toBeCloseTo((0.2 + angle(r.rotationAt(1, new Quaternion()))) / 2, 4);
    r.clear();
    expect(r.locationAt(0)).toEqual(vec3(0, 0, 0));
  });

  it("ignores a negative frame time", () => {
    const e = new SyncError();
    e.accumulate({ pos: vec3(10, 0, 0) }, { pos: vec3(0, 0, 0) });
    e.decay(-1);
    expect(e.location.x).toBe(10);
  });
});
