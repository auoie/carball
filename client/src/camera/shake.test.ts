// The camera shakes against the game's ShakeComponent_X (notes/camera-shakes.md).
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { CameraShakes, EXPLOSION_LARGE, JUMP, distanceScale, shakeWeight } from "./shake";

describe("camera shakes", () => {
  it("scale by distance: (1 - clamp((d - inner) / (outer - inner)))^falloff, none past outer", () => {
    expect(distanceScale(EXPLOSION_LARGE, 0)).toBe(1);
    expect(distanceScale(EXPLOSION_LARGE, 3000)).toBeCloseTo(0.25, 12);
    expect(distanceScale(EXPLOSION_LARGE, 6000)).toBe(0);
    expect(distanceScale(JUMP, 50000)).toBe(1); // (no radius: the own car's)
  });

  it("blend in and out linearly: Explosion_Large in over 0.1 s, out over its whole second", () => {
    expect(shakeWeight(EXPLOSION_LARGE, 0.05)).toBeCloseTo(0.5, 12);
    expect(shakeWeight(EXPLOSION_LARGE, 0.1)).toBeCloseTo(0.9, 12);
    expect(shakeWeight(EXPLOSION_LARGE, 0.5)).toBeCloseTo(0.5, 12);
    expect(shakeWeight(EXPLOSION_LARGE, 1)).toBe(0);
  });

  it("oscillate as Amp · sin((t + τ) · Freq): a jump's 5 uu up at 30 rad/s; summed; done after their duration", () => {
    const shakes = new CameraShakes(() => 0);
    shakes.play(JUMP);
    shakes.update(0.05); // (blended in: weight 1)
    const one = shakes.offsets(vec3(0, 0, 0)).location.z;
    expect(one).toBeCloseTo(5 * Math.sin(0.05 * 30), 9);
    shakes.play(JUMP); // (a double jump: its own, added)
    expect(shakes.offsets(vec3(0, 0, 0)).location.z).toBeCloseTo(one, 9); // (the new one at t 0: weight 0)
    shakes.update(0.2);
    expect(shakes.count).toBe(0);
    expect(shakes.offsets(vec3(0, 0, 0)).location.z).toBe(0);
  });

  it("measure a goal's distance once, from where it started to the player's car", () => {
    const shakes = new CameraShakes(() => 0);
    shakes.play(EXPLOSION_LARGE, vec3(0, 5200, 300));
    shakes.update(0.1);
    const near = shakes.offsets(vec3(0, 5200, 300)).rotation.yaw;
    expect(Math.abs(near)).toBeGreaterThan(0);
    // (once measured, the car moving away doesn't change it)
    expect(shakes.offsets(vec3(0, -5000, 17)).rotation.yaw).toBe(near);
    const far = new CameraShakes(() => 0);
    far.play(EXPLOSION_LARGE, vec3(0, 5200, 300));
    far.update(0.1);
    expect(far.offsets(vec3(0, -2000, 17)).rotation.yaw).toBe(0);
  });
});
