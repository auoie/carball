// Camera shakes as the game's (notes/camera-shakes.md): RL's ShakeComponent_X, not UE3's CameraShake. Each axis
// oscillates v = Amp · A · sin((t + τ) · Freq · F) (Freq in rad/s; τ a random 0..1 s, or 0), weighted by its blend
// in and out; scaled by the distance from the local car to its source; every active shake summed, and added to the
// view after the swivel and the rear camera: rotation per component (truncated to rotator units), location on the
// world's axes. Their time runs on the world's (slowed after a goal). Only with the Default camera preset (the
// game's bEnableCameraShake), so off for Modern profiles.
import type { Vec3 } from "../math/vec";
import type { Rotator } from "./unreal";

export interface Oscillator {
  readonly amp: number;
  /** rad/s */
  readonly freq: number;
  /** EOO_OffsetRandom (else OffsetZero) */
  readonly random?: boolean;
}

export interface ShakeSpec {
  readonly name: string;
  /** OscillationDuration (s) */
  readonly duration: number;
  readonly blendIn: number;
  readonly blendOut: number;
  readonly rot?: { readonly pitch?: Oscillator; readonly yaw?: Oscillator; readonly roll?: Oscillator };
  readonly loc?: { readonly x?: Oscillator; readonly y?: Oscillator; readonly z?: Oscillator };
  readonly amplitudeScale?: number;
  readonly frequencyScale?: number;
  /** The distance scale's radii (uu; outer 0: no attenuation) and falloff exponent */
  readonly inner?: number;
  readonly outer?: number;
  readonly falloff?: number;
  /** Measured every tick (bAttenuate), else once when it starts */
  readonly attenuate?: boolean;
}

/** Explosion_Large: the goal */
export const EXPLOSION_LARGE: ShakeSpec = {
  name: "Explosion_Large",
  duration: 1,
  blendIn: 0.1,
  blendOut: 1,
  rot: { pitch: { amp: 1000, freq: 12, random: true }, yaw: { amp: 2000, freq: 12, random: true }, roll: { amp: 1000, freq: 12, random: true } },
  loc: { x: { amp: 5, freq: 40, random: true }, y: { amp: 5, freq: 50, random: true }, z: { amp: 5, freq: 70, random: true } },
  inner: 0,
  outer: 6000,
  falloff: 2,
};

/** Explosion_Medium: a demolition */
export const EXPLOSION_MEDIUM: ShakeSpec = {
  name: "Explosion_Medium",
  duration: 0.25,
  blendIn: 0.1,
  blendOut: 0.1,
  rot: { pitch: { amp: 500, freq: 50, random: true }, yaw: { amp: 500, freq: 50, random: true }, roll: { amp: 500, freq: 50, random: true } },
  loc: { x: { amp: 5, freq: 50, random: true }, y: { amp: 5, freq: 50, random: true }, z: { amp: 5, freq: 50 } },
  inner: 0,
  outer: 4096,
  falloff: 1,
  attenuate: true,
};

/** BoostOrb_Used: any pad taken by any car */
export const BOOST_ORB_USED: ShakeSpec = {
  name: "BoostOrb_Used",
  duration: 0.2,
  blendIn: 0.05,
  blendOut: 0.15,
  rot: { pitch: { amp: 128, freq: 32 } },
  amplitudeScale: 0.5,
  frequencyScale: 0.5,
  inner: 512,
  outer: 1024,
  falloff: 1,
  attenuate: true, // (bAttenuate: the distance measured every tick, RV-49)
};

/** Jump and double jump (each its own component, which may overlap): the player's own car */
export const JUMP: ShakeSpec = { name: "Jump", duration: 0.15, blendIn: 0.05, blendOut: 0.05, loc: { z: { amp: 5, freq: 30 } } };

/** Dodge: the player's own car */
export const DODGE: ShakeSpec = { name: "Dodge", duration: 0.1, blendIn: 0.1, blendOut: 0.05, loc: { x: { amp: 5, freq: 30, random: true } } };

interface Active {
  readonly spec: ShakeSpec;
  /** One component per key (a car's impact shake restarts) */
  readonly key: string | null;
  readonly at: Vec3 | null;
  readonly phase: readonly number[]; // τ per axis: pitch, yaw, roll, x, y, z
  readonly amplitude: number;
  t: number;
  /** The distance scale, when measured once */
  scale: number | null;
}

/** The distance scale: (1 - clamp((d - inner) / (outer - inner), 0, 1))^falloff; 1 with no outer radius */
export function distanceScale(spec: ShakeSpec, distance: number): number {
  const outer = spec.outer ?? 0;
  if (outer <= 0) return 1;
  if (distance >= outer) return 0;
  const inner = spec.inner ?? 0;
  const f = Math.min(1, Math.max(0, (distance - inner) / Math.max(1e-6, outer - inner)));
  return (1 - f) ** (spec.falloff ?? 1);
}

/** The blend weight at `t`: in over blendIn, out over blendOut before the end (linear) */
export function shakeWeight(spec: ShakeSpec, t: number): number {
  const rem = spec.duration - t;
  const blendIn = spec.blendIn > 0 && t < spec.blendIn ? t / spec.blendIn : 1;
  const blendOut = spec.blendOut > 0 && rem < spec.blendOut ? Math.max(0, rem) / spec.blendOut : 1;
  return Math.min(blendIn, blendOut);
}

export class CameraShakes {
  readonly #active: Active[] = [];
  readonly #random: () => number;

  constructor(random: () => number = Math.random) {
    this.#random = random;
  }

  /** Starts a shake: from `at` (null: on the player's car, unattenuated), `amplitude` its AmplitudeScale (the impact's);
   *  `key`: a shake of that key already running restarts instead (one component per car) */
  play(spec: ShakeSpec, at: Vec3 | null = null, amplitude = 1, key: string | null = null): void {
    if (spec.duration <= 0) return; // (rumble only)
    if (key !== null) {
      const i = this.#active.findIndex((a) => a.key === key);
      if (i >= 0) this.#active.splice(i, 1);
    }
    const phase = [0, 1, 2, 3, 4, 5].map(() => this.#random());
    this.#active.push({ spec, key, at, phase, amplitude, t: 0, scale: null });
  }

  get count(): number {
    return this.#active.length;
  }

  /** `seconds`: the world's time */
  update(seconds: number): void {
    for (const a of this.#active) a.t += Math.max(0, seconds);
    for (let i = this.#active.length - 1; i >= 0; i--) {
      const a = this.#active[i];
      if (a && a.t >= a.spec.duration) this.#active.splice(i, 1);
    }
  }

  /** The summed offsets for the view now: rotation (rotator units) and location (uu, world axes); `listener`: the
   *  player's car */
  offsets(listener: Vec3): { readonly rotation: Rotator; readonly location: Vec3 } {
    let pitch = 0;
    let yaw = 0;
    let roll = 0;
    const loc = { x: 0, y: 0, z: 0 };
    for (const a of this.#active) {
      const { spec } = a;
      let scale = 1;
      if (a.at) {
        const d = Math.hypot(a.at.x - listener.x, a.at.y - listener.y, a.at.z - listener.z);
        if (spec.attenuate) scale = distanceScale(spec, d);
        else scale = a.scale ??= distanceScale(spec, d);
      }
      const w = shakeWeight(spec, a.t);
      if (w <= 0 || scale <= 0) continue;
      const A = (spec.amplitudeScale ?? 1) * a.amplitude;
      const F = spec.frequencyScale ?? 1;
      // (the oscillator's output weighted by its blend: Location w v, Rotation trunc(w v); then summed scaled by the
      // distance: Loc s, trunc(Rot s), so a rotation is truncated twice)
      const axis = (o: Oscillator | undefined, k: number): number =>
        o ? o.amp * A * Math.sin((a.t + (o.random ? (a.phase[k] ?? 0) : 0)) * o.freq * F) * w : 0;
      const rot = (o: Oscillator | undefined, k: number): number => Math.trunc(Math.trunc(axis(o, k)) * scale);
      pitch += rot(spec.rot?.pitch, 0);
      yaw += rot(spec.rot?.yaw, 1);
      roll += rot(spec.rot?.roll, 2);
      loc.x += axis(spec.loc?.x, 3) * scale;
      loc.y += axis(spec.loc?.y, 4) * scale;
      loc.z += axis(spec.loc?.z, 5) * scale;
    }
    return { rotation: { pitch, yaw, roll }, location: loc };
  }
}
