// The particle emitters against the game's spawning rules (notes/visual-timing.md VT-2, VT-16).
import { Group } from "three";
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { Demolition } from "./demolition";
import { BOOST_TRAIL, GOAL_EXPLOSION, GoalExplosion, IDLE_EXHAUST, SceneEffects } from "./effects";
import { Emitter, type EmitterSpec, Particles, additiveOutput, evaluate, particleColor, unitDirection } from "./particles";

const FRAME = 1 / 60;

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
const emitterSpec = (name: string): EmitterSpec => {
  const spec = GOAL_EXPLOSION.find((s) => s.name === name);
  if (!spec) throw new Error(`no emitter ${name}`);
  return spec;
};

describe("particle emitters", () => {
  it("curves are linear between their points and clamped outside", () => {
    const c = { times: [0, 0.5, 1], values: [0, 1, 0] };
    expect(evaluate(c, -1)).toBe(0);
    expect(evaluate(c, 0.25)).toBeCloseTo(0.5, 12);
    expect(evaluate(c, 2)).toBe(0);
  });

  it("the boost trail spawns by distance: 1-4 per 32 uu (the Fennec's SpawnRate), none while still, none on a teleport", () => {
    const particles = new Particles(() => 0.5); // (a count of 2.5 per 32 uu)
    const trail = new Emitter(particles, BOOST_TRAIL);
    trail.active = true;
    trail.update(FRAME, vec3(0, 0, 17));
    trail.update(FRAME, vec3(0, 0, 17)); // (still)
    expect(particles.count).toBe(0);
    trail.update(FRAME, vec3(96, 0, 17)); // 3 units x 2.5: 7 puffs
    expect(particles.count).toBe(7);
    trail.update(FRAME, vec3(1096, 0, 17)); // (a 1000 uu jump: over 128 uu a frame, not filled: RV-52e)
    expect(particles.count).toBe(7);
    trail.active = false;
    trail.update(FRAME, vec3(1160, 0, 17));
    expect(particles.count).toBe(7);
    // They live 1 to 1.5 s (here 1.25)
    particles.update(1.2);
    expect(particles.count).toBe(7);
    particles.update(0.1);
    expect(particles.count).toBe(0);
  });

  it("over 3200 uu the trail leaves about 250 puffs (2.5 per 32 uu: RV-44), each 20-35 uu wide (RV-43)", () => {
    const particles = new Particles(seeded(4));
    const trail = new Emitter(particles, BOOST_TRAIL);
    trail.active = true;
    for (let x = 0; x <= 3200; x += 64) trail.update(FRAME, vec3(x, 0, 17));
    expect(particles.count).toBeGreaterThan(230);
    expect(particles.count).toBeLessThan(270);
    const widths = particles.list().map((p) => p.width);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...widths)).toBeLessThanOrEqual(35);
  });

  it("the idle exhaust moves with the car (local space: RV-42): at 1400 uu/s every puff stays within 100 uu behind it", () => {
    const particles = new Particles(seeded(5));
    const exhaust = new Emitter(particles, IDLE_EXHAUST);
    exhaust.active = true;
    const frame = { forward: vec3(0, 1, 0), right: vec3(-1, 0, 0), up: vec3(0, 0, 1) };
    let socket = vec3(0, 0, 17);
    for (let i = 0; i < 30; i++) {
      socket = vec3(0, (i * 1400) / 60, 17);
      exhaust.update(FRAME, socket, frame);
      particles.update(FRAME);
    }
    const list = particles.list();
    expect(list.length).toBeGreaterThan(2);
    for (const { pos } of list) {
      const d = vec3(pos.x - socket.x, pos.y - socket.y, pos.z - socket.z);
      const local = { x: d.x * frame.forward.x + d.y * frame.forward.y, y: d.x * frame.right.x + d.y * frame.right.y, z: d.z };
      expect(local.x).toBeGreaterThanOrEqual(-100);
      expect(local.x).toBeLessThanOrEqual(0);
      expect(Math.abs(local.y)).toBeLessThanOrEqual(5);
      expect(Math.abs(local.z)).toBeLessThanOrEqual(5);
    }
  });

  it("the smoke materials' colour over life (RV-45): the trail ends 0.5 grey, the explosion's smoke goes warm grey", () => {
    const close = (a: readonly number[], b: readonly number[], eps: number): void => {
      for (let k = 0; k < 3; k++) expect(Math.abs((a[k] ?? 0) - (b[k] ?? 0))).toBeLessThan(eps);
    };
    close(particleColor(BOOST_TRAIL, BOOST_TRAIL.color, 0.5), [0.5, 0.5, 0.5], 1e-9);
    close(particleColor(BOOST_TRAIL, BOOST_TRAIL.color, 0), BOOST_TRAIL.color.map((c) => 0.9951 * c + 0.0049 * 0.5), 1e-3);
    // (blue's smoke at 0.3 of its life: P1 0.102, P2 0.472 -> (0.246, 0.258, 0.272))
    close(particleColor(emitterSpec("smoke puffs"), [0.098, 0.451, 1], 0.3), [0.246, 0.258, 0.272], 0.01);
  });

  it("additive intensity isn't clamped before the tone map (RV-46): FlashSmall's centre at 0.05 s is 1 - e^-3.27", () => {
    const flash = emitterSpec("small flash");
    const [r] = additiveOutput(flash, flash.color, 16, 0.05 / 0.1);
    expect(r).toBeCloseTo(1 - Math.exp(-16 * evaluate(flash.alphaOverLife ?? { times: [], values: [] }, 0.5)), 6);
    expect(r).toBeGreaterThan(0.95);
  });

  it("the stretched smoke's length has its own curve (RV-48): 0.96 at a tenth of its life, its width 0.64", () => {
    const smoke = emitterSpec("smoke stretched");
    expect(evaluate(smoke.lengthOverLife ?? { times: [], values: [] }, 0.1)).toBeCloseTo(0.958, 2);
    expect(evaluate(smoke.sizeOverLife ?? { times: [], values: [] }, 0.1)).toBeCloseTo(0.641, 2);
  });

  it("directions as the game draws them (RV-52d): normalize(U(-1, 1)^3), mean max|component| 0.794", () => {
    const random = seeded(6);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const d = unitDirection(random);
      sum += Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z));
    }
    expect(sum / n).toBeGreaterThan(0.789);
    expect(sum / n).toBeLessThan(0.799);
  });

  it("an emitter's particles go at once when it's killed (a demolished car's trail: KillParticlesForced, RV-52f)", () => {
    const particles = new Particles(() => 0.5);
    const trail = new Emitter(particles, BOOST_TRAIL);
    const other = new Emitter(particles, emitterSpec("sparks"));
    trail.active = true;
    other.start();
    trail.update(FRAME, vec3(0, 0, 17));
    trail.update(FRAME, vec3(96, 0, 17));
    other.update(FRAME, vec3(0, 0, 17));
    expect(particles.count).toBe(7 + 64);
    trail.kill();
    expect(particles.count).toBe(64);
    expect(trail.active).toBe(false);
  });

  it("a rate over a duration (the explosion's smoke puffs: 512/s for 0.0625 s after 0.1 s: 32) and bursts", () => {
    const particles = new Particles(() => 0.5);
    const puffs = emitterSpec("smoke puffs");
    const e = new Emitter(particles, puffs);
    e.start();
    for (let i = 0; i < 30; i++) e.update(FRAME, vec3(0, 5200, 300));
    expect(particles.count).toBe(32);
    expect(e.done).toBe(true);
    const sparks = new Emitter(new Particles(() => 0.5), emitterSpec("sparks"));
    sparks.start();
    sparks.update(FRAME, vec3(0, 0, 0));
    expect(sparks.particles.count).toBe(64);
  });

  it("the goal explosion and a demolition run their course and clear up (5 s; the husks' 3 s)", () => {
    const scene = new Group();
    const effects = new SceneEffects(scene);
    effects.goal(vec3(0, 5200, 300), 0);
    effects.demolition(vec3(0, 0, 17));
    expect(effects.particles.count).toBe(0); // (they spawn on their first update)
    effects.update(FRAME);
    expect(effects.particles.count).toBeGreaterThan(300);
    for (let t = 0; t < 7; t += FRAME) effects.update(FRAME);
    expect(effects.particles.count).toBe(0);
    expect(scene.children.length).toBe(1); // (the particles' root alone)
    const explosion = new GoalExplosion(new Particles(), new Group(), vec3(0, 0, 0), [0.098, 0.451, 1]);
    explosion.update(4.9);
    expect(explosion.done).toBe(false);
    explosion.update(0.2);
    expect(explosion.done).toBe(true);
    const demo = new Demolition(new Particles(), new Group(), vec3(0, 0, 17));
    demo.update(3);
    expect(demo.done).toBe(true);
  });
});
