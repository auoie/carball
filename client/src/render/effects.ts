// The game's effects as emitters (src/render/particles.ts), with the values of its default boost (Boost_Standard) and
// goal explosion (Explosion_Default), from the static session's rl-fx/1 descriptions (notes/visual-timing.md VT-2,
// VT-16): values only, the look our own. A demolition's: src/render/demolition.ts.
import {
  AdditiveBlending,
  Color,
  Mesh,
  type Object3D,
  ShaderMaterial,
  SphereGeometry,
} from "three";
import type { Vec3 } from "../math/vec";
import { toThreeVector } from "./coords";
import { Demolition } from "./demolition";
import { type Curve, Emitter, type EmitterSpec, Particles, evaluate } from "./particles";

const curve = (times: readonly number[], values: readonly number[]): Curve => ({ times, values });
const EIGHTHS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];

/** The default boost's paint (no team colour on boost: Boost_Standard's CustomColor default) */
export const BOOST_COLOR = [3, 0.625, 0.1] as const;

/** Boost_Painted_PS: puffs spawned by distance (1 per 32 uu, at most 128 uu a frame), so a car boosting in place leaves
 *  none and the trail lingers after the boost stops; no inherited velocity; drifting up */
export const BOOST_TRAIL: EmitterSpec = {
  name: "boost trail",
  blend: "translucent",
  duration: 1,
  loops: true,
  perUnit: { unit: 32, count: 1, maxFrame: 128 },
  lifetime: { min: 1, max: 1.5 },
  size: 75,
  sizeOverLife: curve([0.001, 0.159, 0.316, 0.473, 0.63, 0.787, 0.945, 0.997], [0.25, 0.975, 1.062, 1.213, 1.349, 1.452, 1.5, 1.5]),
  acceleration: [{ min: [0, 0, 0], max: [0, 0, 30] }],
  color: BOOST_COLOR,
  alpha: 1,
  alphaOverLife: curve([0, 0.156, 0.313, 0.469, 0.626, 0.782, 0.939, 0.991], [0.175, 0.921, 0.679, 0.408, 0.329, 0.165, 0.014, 0]),
};

/** Drive_PS: the idle exhaust while throttling and not boosting (10 a second, blown back) */
export const IDLE_EXHAUST: EmitterSpec = {
  name: "idle exhaust",
  blend: "translucent",
  duration: 0.25,
  loops: true,
  rate: 10,
  lifetime: { min: 0.5, max: 1 },
  size: { min: 6.5, max: 12.5 },
  sizeOverLife: curve(EIGHTHS, [1, 1.182, 1.648, 2.276, 2.944, 3.531, 3.916, 4]),
  velocity: { min: [-50, -5, -5], max: [-100, 5, 5] },
  local: true,
  color: BOOST_COLOR,
  colorOverLife: curve(EIGHTHS, [2, 1.879, 1.568, 1.149, 0.704, 0.312, 0.056, 0]),
  alpha: 0.5,
  alphaOverLife: curve(EIGHTHS, [0.25, 0.235, 0.196, 0.144, 0.088, 0.039, 0.007, 0]),
};

const SPARK_SIZE = curve([0, 0.156, 0.312, 0.469, 0.625, 0.781, 0.937, 1.041], [0.141, 0.838, 0.97, 0.86, 0.676, 0.455, 0.229, 0.094]);
const SPARK_ALPHA = curve([0.014, 0.166, 0.319, 0.471, 0.623, 0.776, 0.928, 0.979], [0.978, 0.912, 0.747, 0.527, 0.3, 0.112, 0.008, 0]);
const SMOKE_ALPHA = curve([-0.004, 0.152, 0.307, 0.462, 0.617, 0.772, 0.927, 0.979], [0.004, 0.97, 0.818, 0.589, 0.34, 0.128, 0.009, 0]);
/** FlashSmall stays white; every other emitter takes the team's colour */
const WHITE_FLASH = "small flash";
const FLING: { min: [number, number, number]; max: [number, number, number] } = { min: [-16384, -16384, -16384], max: [16384, 16384, 16384] };

/** Explosion_Default's emitters, in the scoring team's colour ('Color'); its ribbons (smoke and light trails behind the
 *  sparks) and its shadow are not drawn */
export const GOAL_EXPLOSION: readonly EmitterSpec[] = [
  {
    name: "smoke puffs",
    blend: "translucent",
    delay: 0.1,
    duration: 0.0625,
    rate: 512,
    lifetime: { min: 2, max: 5 },
    size: { min: 256, max: 768 },
    sizeOverLife: curve([0, 0.152, 0.305, 0.457, 0.609, 0.761, 0.914, 0.965], [0.75, 0.827, 0.889, 0.936, 0.97, 0.99, 0.999, 1]),
    sphere: { radius: curve([0, 0.074, 0.148], [0, 306.707, 311.369]), velocityScale: { min: 0.5, max: 1 } },
    velocityOverLife: curve([-0.009, 0.044, 0.097, 0.151, 0.204, 0.258, 0.311, 0.364], [0.982, 0.945, 0.851, 0.723, 0.582, 0.454, 0.359, 0.323]),
    color: [4, 1, 0],
    alphaOverLife: SMOKE_ALPHA,
  },
  {
    name: "smoke stretched",
    blend: "translucent",
    duration: 0.125,
    rate: 256,
    lifetime: { min: 0.5, max: 3 },
    size: { min: 128, max: 256 },
    length: { min: 512, max: 1024 },
    sizeOverLife: curve([-0.002, 0.151, 0.303, 0.456, 0.608, 0.761, 0.914, 0.965], [0.4, 0.69, 0.78, 0.861, 0.928, 0.975, 0.998, 1]),
    velocity: { min: [-128, -128, -128], max: [128, 128, 128] },
    sphere: { radius: 256, velocityScale: { min: 2, max: 4 } },
    velocityOverLife: curve([-0.009, 0.042, 0.093, 0.145, 0.196, 0.248, 0.299], [0.982, 0.912, 0.735, 0.507, 0.278, 0.101, 0.031]),
    color: [4, 1, 0],
    colorOverLife: curve([-0.005, 0.463], [3.615, 0.959]),
    alphaOverLife: SMOKE_ALPHA,
  },
  {
    name: "trail parents",
    blend: "additive",
    duration: 1,
    bursts: [{ time: 0, count: 8 }],
    lifetime: { min: 0.125, max: 0.333 },
    size: 64,
    sizeOverLife: SPARK_SIZE,
    acceleration: [FLING, FLING],
    sphere: { radius: 96, surface: true, velocityScale: 128 },
    color: [4, 1, 0],
    colorOverLife: 3.47,
    alphaOverLife: SPARK_ALPHA,
  },
  {
    name: "sparks",
    blend: "additive",
    duration: 1,
    bursts: [{ time: 0, count: 64 }],
    lifetime: { min: 0.25, max: 0.5 },
    size: 16,
    length: 128,
    sizeOverLife: SPARK_SIZE,
    acceleration: [FLING, { min: [0, 0, -8192], max: [0, 0, -8192] }],
    sphere: { radius: 96, surface: true, velocityScale: 64 },
    color: [4, 1, 0],
    colorOverLife: 1.1,
    alphaOverLife: SPARK_ALPHA,
  },
  {
    name: "outer sparks",
    blend: "additive",
    duration: 1,
    bursts: [{ time: 0, count: 256 }],
    lifetime: { min: 0.5, max: 1 },
    size: { min: 3, max: 8 },
    length: { min: 48, max: 128 },
    sizeOverLife: SPARK_SIZE,
    sphere: { radius: 256, surface: true, velocityScale: 8 },
    velocityOverLife: curve(
      [-0.009, 0.043, 0.095, 0.147, 0.199, 0.252, 0.304, 0.356, 0.408, 0.46, 0.512],
      [0.982, 0.956, 0.886, 0.783, 0.658, 0.522, 0.386, 0.261, 0.158, 0.088, 0.063],
    ),
    color: [3, 1, 0],
    colorOverLife: 1.1,
    alphaOverLife: curve([0.014, 0.166, 0.319, 0.471, 0.623, 0.776, 0.928, 0.979], [0.978, 0.878, 0.653, 0.414, 0.27, 8.182, 0.87, 0]),
  },
  {
    name: WHITE_FLASH,
    blend: "additive",
    duration: 1,
    bursts: [{ time: 0, count: 1 }],
    lifetime: 0.1,
    size: 1536,
    sizeOverLife: curve([0, 0.988], [1, 0.125]),
    color: [1, 1, 1],
    alpha: 16,
    alphaOverLife: curve([0, 0.154, 0.309, 0.464, 0.618, 0.773, 0.928, 0.979], [0, 0.204, 0.167, 0.194, 0.228, 0.208, 0.078, 0]),
  },
  {
    name: "big flash",
    blend: "additive",
    duration: 1,
    bursts: [{ time: 0, count: 1 }],
    lifetime: 0.5,
    size: 6144,
    sizeOverLife: curve([0, 0.988], [1, 0.125]),
    color: [4, 1, 0],
    colorOverLife: 0.064,
    alphaOverLife: curve(
      [-0.033, 0.068, 0.169, 0.27, 0.372, 0.473, 0.574, 0.675, 0.777, 0.878, 0.979],
      [2.765, 2.46, 2.118, 1.755, 1.387, 1.031, 0.704, 0.42, 0.198, 0.052, 0],
    ),
  },
];

/** MeshStatic1: the electric sphere (radius 128 scaled 0.5 x its curve: about 30 to 1230 uu in its 0.5 s), additive */
const SPHERE = {
  life: 0.5,
  radius: 128 * 0.5,
  size: curve([0, 0.153, 0.305, 0.458, 0.61, 0.763, 0.915, 0.966], [0.471, 7.343, 12.253, 15.544, 17.561, 18.646, 19.142, 19.236]),
  color: curve([0, 0.068], [16.67, 5.878]),
  alpha: curve([-0.001, 0.157, 0.314, 0.471, 0.628, 0.786, 0.943, 0.995], [0, 0.503, 0.347, 0.235, 0.148, 0.078, 0.019, 0]),
} as const;

/** The goal explosion at the ball, in the scoring team's colour (linear): its emitters and its electric sphere, for its
 *  5 s life (the actor's LifeSpan); world time, so it slows with the goal's slow motion */
export class GoalExplosion {
  readonly #emitters: Emitter[];
  readonly #sphere: Mesh;
  readonly #material: ShaderMaterial;
  readonly #color: readonly [number, number, number];
  readonly #at: Vec3;
  #age = 0;

  constructor(particles: Particles, scene: Object3D, at: Vec3, color: readonly [number, number, number]) {
    this.#at = at;
    this.#color = color;
    this.#emitters = GOAL_EXPLOSION.map((spec) => {
      const e = new Emitter(particles, spec, spec.name === WHITE_FLASH ? spec.color : color);
      e.start();
      return e;
    });
    // (a shell, brightest at its rim: the game's sphere is a thin electric texture, not a fill)
    this.#material = new ShaderMaterial({
      uniforms: { tint: { value: new Color() } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - world.xyz);
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 tint;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
          gl_FragColor = vec4(tint * rim * rim * rim, 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.#sphere = new Mesh(new SphereGeometry(1, 24, 16), this.#material);
    toThreeVector(at, this.#sphere.position);
    scene.add(this.#sphere);
  }

  /** Whether it's over (its emitters done, its 5 s up: then the caller drops it) */
  get done(): boolean {
    return this.#age >= 5;
  }

  update(seconds: number): void {
    this.#age += Math.max(0, seconds);
    for (const e of this.#emitters) if (e.active) e.update(seconds, this.#at);
    const t = this.#age / SPHERE.life;
    this.#sphere.visible = t < 1;
    if (t < 1) {
      this.#sphere.scale.setScalar(SPHERE.radius * evaluate(SPHERE.size, t));
      const c = evaluate(SPHERE.color, t);
      const tone = (v: number): number => 1 - Math.exp(-Math.max(0, v * c));
      const a = Math.min(1, evaluate(SPHERE.alpha, t));
      (this.#material.uniforms["tint"]?.value as Color).setRGB(tone(this.#color[0]) * a, tone(this.#color[1]) * a, tone(this.#color[2]) * a);
    }
  }

  dispose(): void {
    this.#sphere.removeFromParent();
    this.#sphere.geometry.dispose();
    this.#material.dispose();
  }
}

/** The teams' primary colours (linear; the stadium's, AV-2): the goal explosion's 'Color' */
export const TEAM_PRIMARY: readonly (readonly [number, number, number])[] = [
  [0.098, 0.451, 1],
  [0.7647, 0.3922, 0.098],
];

/** A scene's effects: its particles and the goal explosions under way (world time) */
export class SceneEffects {
  readonly particles = new Particles();
  readonly #scene: Object3D;
  readonly #explosions: GoalExplosion[] = [];
  readonly #demolitions: Demolition[] = [];

  constructor(scene: Object3D) {
    this.#scene = scene;
    scene.add(this.particles.root);
  }

  /** A goal: the explosion at the ball (`at`, game frame), in the scoring team's colour */
  goal(at: Vec3, scoringTeam: number): void {
    this.#explosions.push(new GoalExplosion(this.particles, this.#scene, at, TEAM_PRIMARY[scoringTeam === 1 ? 1 : 0] ?? [1, 1, 1]));
  }

  /** Where the camera is (last drawn): the demolitions' husks collide only near it */
  camera: Vec3 | null = null;

  /** A car demolished: its effect at the car's origin (src/render/demolition.ts) */
  demolition(at: Vec3): void {
    this.#demolitions.push(new Demolition(this.particles, this.#scene, at));
  }

  update(seconds: number): void {
    for (const list of [this.#explosions, this.#demolitions] as (GoalExplosion | Demolition)[][]) {
      for (const e of list) e.update(seconds, this.camera);
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (e?.done) {
          e.dispose();
          list.splice(i, 1);
        }
      }
    }
    this.particles.update(seconds);
  }
}
