// The particle emitters against the game's spawning rules (notes/visual-timing.md VT-2, VT-16).
import { Group } from "three";
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { Demolition } from "./demolition";
import { BOOST_TRAIL, GOAL_EXPLOSION, GoalExplosion, SceneEffects } from "./effects";
import { Emitter, type EmitterSpec, Particles, evaluate } from "./particles";

const FRAME = 1 / 60;
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

  it("the boost trail spawns by distance: 1 per 32 uu, at most 128 uu counted a frame; none while still", () => {
    const particles = new Particles(() => 0.5);
    const trail = new Emitter(particles, BOOST_TRAIL);
    trail.active = true;
    trail.update(FRAME, vec3(0, 0, 17));
    trail.update(FRAME, vec3(0, 0, 17)); // (still)
    expect(particles.count).toBe(0);
    trail.update(FRAME, vec3(96, 0, 17)); // 3 puffs
    expect(particles.count).toBe(3);
    trail.update(FRAME, vec3(1096, 0, 17)); // (1000 uu: only 128 counted, 4 puffs)
    expect(particles.count).toBe(7);
    trail.active = false;
    trail.update(FRAME, vec3(2096, 0, 17));
    expect(particles.count).toBe(7);
    // They live 1 to 1.5 s (here 1.25)
    particles.update(1.2);
    expect(particles.count).toBe(7);
    particles.update(0.1);
    expect(particles.count).toBe(0);
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
