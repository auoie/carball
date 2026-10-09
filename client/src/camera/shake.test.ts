// The camera shakes against the game's ShakeComponent_X (notes/camera-shakes.md).
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { BOOST_ORB_USED, CameraShakes, DODGE, EXPLOSION_LARGE, EXPLOSION_MEDIUM, JUMP, distanceScale, shakeWeight } from "./shake";

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

  it("BoostOrb_Used re-measures its distance every tick (bAttenuate: RV-49): from 600 to 1100 uu away, none", () => {
    const shakes = new CameraShakes(() => 0);
    shakes.play(BOOST_ORB_USED, vec3(0, 0, 17));
    shakes.update(0.06);
    expect(Math.abs(shakes.offsets(vec3(600, 0, 17)).rotation.pitch)).toBeGreaterThan(0);
    const moved = shakes.offsets(vec3(1100, 0, 17));
    expect(moved.rotation).toEqual({ pitch: 0, yaw: 0, roll: 0 });
  });

  it("a rotation is truncated twice: after its blend weight, and after the distance scale", () => {
    // (Explosion_Large at 0.05 s: blend 0.5; yaw 2000 sin(0.6 + ...); with phase 0, at 3000 of its 6000 uu, scale 0.25)
    const shakes = new CameraShakes(() => 0);
    shakes.play(EXPLOSION_LARGE, vec3(0, 0, 0));
    shakes.update(0.05);
    const w = shakeWeight(EXPLOSION_LARGE, 0.05);
    const v = 2000 * Math.sin(0.05 * 12);
    const scale = distanceScale(EXPLOSION_LARGE, 3000);
    expect(shakes.offsets(vec3(3000, 0, 0)).rotation.yaw).toBe(Math.trunc(Math.trunc(v * w) * scale));
  });

  it("the game's parameters: Explosion_Medium, BoostOrb_Used, Jump, Dodge (notes/camera-shakes.md)", () => {
    expect([EXPLOSION_MEDIUM.duration, EXPLOSION_MEDIUM.blendIn, EXPLOSION_MEDIUM.blendOut, EXPLOSION_MEDIUM.outer, EXPLOSION_MEDIUM.falloff]).toEqual([0.25, 0.1, 0.1, 4096, 1]);
    expect(EXPLOSION_MEDIUM.rot?.pitch).toEqual({ amp: 500, freq: 50, random: true });
    expect(EXPLOSION_MEDIUM.attenuate).toBe(true);
    expect([BOOST_ORB_USED.duration, BOOST_ORB_USED.inner, BOOST_ORB_USED.outer, BOOST_ORB_USED.amplitudeScale, BOOST_ORB_USED.frequencyScale]).toEqual([0.2, 512, 1024, 0.5, 0.5]);
    expect(BOOST_ORB_USED.rot?.pitch).toEqual({ amp: 128, freq: 32 });
    expect(JUMP.loc?.z).toEqual({ amp: 5, freq: 30 });
    expect([DODGE.duration, DODGE.blendIn, DODGE.blendOut]).toEqual([0.1, 0.1, 0.05]);
    expect(DODGE.loc?.x).toEqual({ amp: 5, freq: 30, random: true });
  });
});
