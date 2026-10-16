// The particle emitters against the game's spawning rules (notes/visual-timing.md VT-2, VT-16).
import { Group, type Mesh, type ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { Demolition } from "./demolition";
import { BOOST_TRAIL, GOAL_EXPLOSION, GoalExplosion, IDLE_EXHAUST, SceneEffects } from "./effects";
import { Emitter, type EmitterSpec, Particles, additiveOutput, evaluate, particleColor, spherePoint, unitDirection, particleDetail } from "./particles";
import { fogAll } from "./heightFog";

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

  it("at 1400 uu/s and 60 fps the trail leaves about 2.07 puffs per 32 uu (RV-85), each 20-35 uu wide (RV-43)", () => {
    const particles = new Particles(seeded(4));
    const trail = new Emitter(particles, BOOST_TRAIL);
    trail.active = true;
    // (6400 uu: 274 frames of 23.33 uu; the game's 2.0736 per 32 uu, the static session's Markov chain)
    const step = 1400 / 60;
    for (let i = 0; i <= 274; i++) trail.update(FRAME, vec3(i * step, 0, 17));
    const perUnit = (particles.count * 32) / (274 * step);
    expect(perUnit).toBeGreaterThan(1.95);
    expect(perUnit).toBeLessThan(2.2);
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

  it("additive intensity isn't clamped before the tone map (RV-46, PP-17): FlashSmall's centre at 0.05 s is 3.27, linear HDR", () => {
    const flash = emitterSpec("small flash");
    const [r] = additiveOutput(flash, flash.color, 16, 0.05 / 0.1);
    expect(r).toBeCloseTo(16 * evaluate(flash.alphaOverLife ?? { times: [], values: [] }, 0.5), 6);
    expect(r).toBeGreaterThan(3);
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

describe("a spawn sphere's offsets (SpawnEx: RV-82)", () => {
  it("in the volume: U(-1, 1)^3 clamped to the sphere, so 1 - pi/6 of them on the surface, mean |offset| (1 - pi/24) R", () => {
    let seed = 12345;
    const random = (): number => {
      // (a small LCG: reproducible)
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const n = 100_000;
    let surface = 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const p = spherePoint(random, 100, false);
      const r = Math.hypot(p.x, p.y, p.z) / 100;
      expect(r).toBeLessThanOrEqual(1 + 1e-9);
      if (r > 1 - 1e-9) surface++;
      sum += r;
    }
    expect(surface / n).toBeCloseTo(1 - Math.PI / 6, 2);
    expect(Math.abs(surface / n - 0.476)).toBeLessThan(0.005);
    // (pi/6 inside at a mean 3/4, the rest on the surface: pi/8 + 1 - pi/6)
    expect(Math.abs(sum / n - (1 - Math.PI / 24))).toBeLessThan(0.005);
  });

  it("on the surface: every offset at the radius", () => {
    let k = 0;
    const random = (): number => ((k = (k * 7 + 3) % 101) + 0.5) / 101;
    for (let i = 0; i < 200; i++) {
      const p = spherePoint(random, 256, true);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(256, 6);
    }
  });
});

describe("spawning by distance (GetSpawnAmount: RV-85)", () => {
  const spec = (count: number): EmitterSpec => ({ ...BOOST_TRAIL, lifetime: 100, perUnit: { unit: 32, count, maxFrame: 128 } });
  const run = (count: number, step: number, frames: number): number => {
    const particles = new Particles(seeded(9));
    const emitter = new Emitter(particles, spec(count));
    emitter.active = true;
    for (let i = 0; i <= frames; i++) emitter.update(FRAME, vec3(i * step, 0, 17));
    return particles.count;
  };

  it("the leftover a distance: 2.5 a unit at 23.33 uu a frame spawns one a frame (60 in 60 frames, not 109)", () => {
    expect(run(2.5, 1400 / 60, 60)).toBe(60);
  });

  it("at 1400 uu/s, per 32 uu: 1.0 for 1 a unit, 1.371 for 2, 2.743 for 4", () => {
    const per = (count: number): number => (run(count, 1400 / 60, 600) * 32) / (600 * (1400 / 60));
    expect(per(1)).toBeCloseTo(1, 1);
    expect(per(2)).toBeCloseTo(1.371, 2);
    expect(per(4)).toBeCloseTo(2.743, 2);
  });

  it("a teleport spawns none and drops the leftover; standing still spawns none and keeps it", () => {
    const particles = new Particles(seeded(9));
    const emitter = new Emitter(particles, spec(1));
    emitter.active = true;
    emitter.update(FRAME, vec3(0, 0, 17));
    emitter.update(FRAME, vec3(20, 0, 17)); // (L 20)
    emitter.update(FRAME, vec3(20, 0, 17)); // (still: L kept)
    emitter.update(FRAME, vec3(40, 0, 17)); // (40: one, L 8)
    expect(particles.count).toBe(1);
    emitter.update(FRAME, vec3(1040, 0, 17)); // (a teleport: none, L 0)
    emitter.update(FRAME, vec3(1070, 0, 17)); // (30: none without the old leftover)
    expect(particles.count).toBe(1);
  });

  it("the height fog takes each particle where it is: the quad's world position its shader builds (RV-208, RV-227)", () => {
    const particles = new Particles(() => 0.5);
    fogAll(particles.root);
    const shaders = particles.root.children.map((m) => ((m as Mesh).material as ShaderMaterial).vertexShader);
    expect(shaders).toHaveLength(2);
    for (const shader of shaders) expect(shader).toContain("vFogWorld = vWorld;");
  });
});

describe("Particle Detail and the emitters' second LOD (QG-24/25)", () => {
  /** Boost trail puffs spawned over a 640 uu drive, the camera `eye` (none: near) */
  const puffs = (performance: boolean, eye: { x: number; y: number; z: number } | null): { count: number; names: Set<string> } => {
    particleDetail.performance = performance;
    const particles = new Particles(() => 0.5);
    particles.eye = eye;
    const trail = new Emitter(particles, BOOST_TRAIL);
    trail.active = true;
    for (let x = 0; x <= 640; x += 16) trail.update(1 / 60, { x, y: 0, z: 17 });
    particleDetail.performance = false;
    return { count: particles.count, names: new Set(particles.list().map((p) => p.spec?.name ?? "")) };
  };

  it("the boost trail: a puff per 32 uu at High Quality near the camera; at Performance, or beyond 3072 uu at any setting, per 64", () => {
    const near = puffs(false, { x: 0, y: 500, z: 100 });
    const performance = puffs(true, { x: 0, y: 500, z: 100 });
    const far = puffs(false, { x: 0, y: 5000, z: 100 });
    expect(near.names).toEqual(new Set(["boost trail"]));
    expect(performance.names).toEqual(new Set(["boost trail (LOD 1)"]));
    expect(far.names).toEqual(new Set(["boost trail (LOD 1)"]));
    expect(performance.count / near.count).toBeCloseTo(0.5, 1);
    expect(far.count).toBe(performance.count);
  });

  it("the idle exhaust's LOD 1: 25 across and fainter, still 10 a second", () => {
    const lod = IDLE_EXHAUST.lod?.spec;
    expect([lod?.size, lod?.alpha, lod?.rate, IDLE_EXHAUST.lod?.beyond]).toEqual([{ min: 25, max: 25 }, 0.15, 10, 2500]);
  });
});
