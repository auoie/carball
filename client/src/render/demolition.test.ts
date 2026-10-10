// The demolition's husks against the export's rules and the static session's simulation of them (demolition.json
// husks.simulation: 4000 draws a type, 120 Hz, a flat floor, the car's centre at z 17, the camera close).
import { Group } from "three";
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { DEMOLITION, Demolition, HUSK_SECONDS, type HuskKind, boomMaterial, launchHusk, stepHusk, traceWorld } from "./demolition";
import { Particles } from "./particles";

/** A seeded generator (mulberry32) */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DT = 1 / 120;
const CAR = vec3(0, 0, 17);

function simulate(kind: HuskKind, draws: number, seed: number): { below: number; distance: number[]; bounces: number[] } {
  const random = seeded(seed);
  let below = 0;
  const distance: number[] = [];
  const bounces: number[] = [];
  for (let i = 0; i < draws; i++) {
    const h = launchHusk(kind, CAR, random);
    if (h.pos.z < 0) {
      below++;
      continue;
    }
    const contacts = h.contactsLeft;
    for (let t = 0; t < HUSK_SECONDS && !h.frozen; t += DT) stepHusk(h, DT, null, random);
    if (!h.frozen) continue;
    distance.push(Math.hypot(h.pos.x - CAR.x, h.pos.y - CAR.y));
    bounces.push(contacts - 1);
  }
  return { below: below / draws, distance, bounces };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

describe("the demolition's husks", () => {
  it("are flung 50 uu out at 1200-1500 uu/s (drawn 3 x 400-500), falling at 3 x 512-600, from the car's origin", () => {
    const random = seeded(1);
    for (let i = 0; i < 200; i++) {
      const h = launchHusk("engine", CAR, random);
      expect(Math.hypot(h.pos.x - CAR.x, h.pos.y - CAR.y, h.pos.z - CAR.z)).toBeCloseTo(50, 6);
      const speed = Math.hypot(h.base.x, h.base.y, h.base.z);
      expect(speed).toBeGreaterThanOrEqual(400);
      expect(speed).toBeLessThanOrEqual(500);
      expect(h.fall).toBeGreaterThanOrEqual(512);
      expect(h.fall).toBeLessThanOrEqual(600);
      expect(h.contactsLeft).toBe(1);
    }
    const rims = Array.from({ length: 200 }, () => launchHusk("rim", CAR, random).contactsLeft);
    expect(new Set(rims)).toEqual(new Set([3, 4]));
  });

  it("move as p0 + 3 (v0 t + a t^2 / 2) in the air", () => {
    const h = launchHusk("chassis", vec3(0, 0, 1000), seeded(7));
    const p0 = { ...h.pos };
    const v0 = { ...h.base };
    for (let i = 0; i < 24; i++) stepHusk(h, DT, null);
    const t = 24 * DT;
    expect(h.pos.x).toBeCloseTo(p0.x + 3 * v0.x * t, 3);
    // (stepped per frame, as Cascade does: the drop within a frame's worth of the continuous one)
    expect(Math.abs(h.pos.z - (p0.z + 3 * (v0.z * t - (h.fall * t * t) / 2)))).toBeLessThan(3 * h.fall * t * DT);
  });

  it("as the static session simulated them: a third lost under the floor, resting about 850 uu out, rims bouncing 2-3 times", () => {
    const engine = simulate("engine", 4000, 11);
    const rims = simulate("rim", 4000, 12);
    expect(engine.below).toBeCloseTo(0.353, 1);
    expect(median(engine.distance)).toBeGreaterThan(780);
    expect(median(engine.distance)).toBeLessThan(900);
    expect(Math.max(...engine.bounces)).toBe(0);
    expect(median(rims.distance)).toBeGreaterThan(830);
    expect(median(rims.distance)).toBeLessThan(960);
    const meanBounces = rims.bounces.reduce((s, b) => s + b, 0) / rims.bounces.length;
    expect(meanBounces).toBeCloseTo(2.5, 1);
  });

  it("freeze on their contact (engine and chassis: the first), then never move again", () => {
    const random = seeded(3);
    let h = launchHusk("engine", CAR, random);
    while (h.pos.z < 17 || h.base.z < 0) h = launchHusk("engine", CAR, random); // (one flung upwards)
    for (let t = 0; t < 3; t += DT) stepHusk(h, DT, null, random);
    expect(h.frozen).toBe(true);
    expect(h.pos.z).toBeCloseTo(0, 1);
    const at = { ...h.pos };
    stepHusk(h, DT, null, random);
    expect(h.pos).toEqual(at);
  });

  it("collide only near the camera: from 1000 uu away on, they fall through the floor", () => {
    const random = seeded(5);
    let h = launchHusk("chassis", CAR, random);
    while (h.base.z < 0) h = launchHusk("chassis", CAR, random);
    for (let t = 0; t < 3; t += DT) stepHusk(h, DT, vec3(0, 3000, 500), random);
    expect(h.frozen).toBe(false);
    expect(h.colliding).toBe(false);
    expect(h.pos.z).toBeLessThan(-1000);
  });

  it("the arena's walls: the back walls open at the goal mouths, the corners as their chords", () => {
    expect(traceWorld(vec3(0, 5000, 300), vec3(0, 5300, 300))).toBeNull(); // (into the goal)
    expect(traceWorld(vec3(1500, 5000, 300), vec3(1500, 5300, 300))?.n).toEqual([0, -1, 0]);
    expect(traceWorld(vec3(0, 5500, 300), vec3(0, 6100, 300))?.n).toEqual([0, -1, 0]); // (the goal's back)
    const corner = traceWorld(vec3(3500, 4000, 300), vec3(3900, 4400, 300));
    expect(corner?.n[0]).toBeCloseTo(-Math.SQRT1_2);
    expect(traceWorld(vec3(0, 0, -20), vec3(0, 0, -40))).toBeNull(); // (already under the floor)
  });

  it("the effect: embers, streams and the rest at once, the husks gone at 3 s", () => {
    const particles = new Particles(seeded(9));
    const scene = new Group();
    const demo = new Demolition(particles, scene, CAR, seeded(10));
    expect(scene.children.length).toBe(6); // (the husks; no "BOOM!" without a document to draw it)
    demo.update(DT);
    expect(particles.count).toBeGreaterThanOrEqual(125 + 3 + 8 + 1 + 1);
    let streams = 0;
    for (let t = DT; t < 0.5; t += DT) {
      const before = particles.count;
      demo.update(DT);
      particles.update(DT);
      streams += Math.max(0, particles.count - before);
    }
    // (2 x 455 a second for 0.35 s: 318, give or take the frames' rounding and the sources' deaths at 0.38-0.4 s)
    expect(streams).toBeGreaterThan(290);
    demo.update(HUSK_SECONDS);
    expect(demo.done).toBe(true);
    demo.dispose();
    expect(scene.children.length).toBe(0);
  });
});

describe("the demolition's soft particles (RV-86)", () => {
  it("fade where the scene is just behind them: the flash over 227.5 uu (FlashGradient), the flipbooks and smoke over 255", () => {
    const depth = (name: string): number | undefined => DEMOLITION.find((e) => e.name === name)?.softDepth;
    expect(depth("demolition flash")).toBe(227.5);
    expect(depth("demolition fireball")).toBe(255);
    expect(depth("demolition plume")).toBe(255);
    expect(depth("demolition smoke")).toBe(255);
    // (the embers' Sparks_MAT has no depth fade)
    expect(depth("demolition embers")).toBeUndefined();
  });
});

describe("BOOM!", () => {
  it("is a soft particle as Explosion_MAT is: fading over 63.75 uu where the floor is just behind it (RV-113)", () => {
    const material = boomMaterial(null);
    const shader = { vertexShader: "void main() {\n#include <fog_vertex>\n}", fragmentShader: "void main() {\n#include <opaque_fragment>\n}" };
    material.onBeforeCompile(shader as never, null as never);
    expect(shader.vertexShader).toContain("vSoftWorld = (inverse(viewMatrix) * mvPosition).xyz;\n#include <fog_vertex>");
    expect(shader.fragmentShader).toContain("/ 63.75, 0.0, 1.0)");
    expect(shader.fragmentShader.indexOf("diffuseColor.a *=")).toBeLessThan(shader.fragmentShader.indexOf("#include <opaque_fragment>"));
  });
});
