// The car body's sway, drawing only (the user's, 2026-10-18; the static session's SU1 on the live exe:
// SimpleSpringComponent_TA::UpdateSpring 0x140f65430, the "ChassisSpring" control on the body's chassis bone): a mass held
// at a world position 100 uu above the body, pulled back to it by a damped spring in the car's own axes, falling under
// gravity; its lag behind the drawn car pitches, rolls and lowers the body about its bone. Once a frame, with the frame's
// time capped at 0.05 s. The game's frame throughout (x forward, y right, z up; uu; rotator units 65536 a turn).
import { type Rot3, type Vec3, vec3 } from "../math/vec";

/** A body's spring (its archetype's ChassisSpring, the body's own values: SU1) */
export interface SpringSpec {
  readonly strength: Vec3;
  readonly damping: number;
  readonly maxDisplacement: Vec3;
  readonly mass: number;
  readonly massOffset: Vec3;
  readonly maxSpeed: number;
  /** rotator units a uu of the mass's lag along the car (pitch) and across it (roll); uu a uu of it up and down */
  readonly rotationScale: number;
  readonly translationScale: number;
  /** the chassis bone's height in the car's frame (uu: the body turns about (0, 0, it)) */
  readonly pivotZ: number;
}

const common = { damping: 5, mass: 1, massOffset: vec3(0, 0, 100), maxSpeed: 3000, translationScale: 0.1 } as const;

/** Sport's (the Fennec's), the default */
export const DEFAULT_SPRING: SpringSpec = { ...common, strength: vec3(300, 50, 100), maxDisplacement: vec3(30, 20, 25), rotationScale: 25, pivotZ: 2.6115 };

/** Each garage car's spring (src/game/cars.ts ids; the game's bodies these follow: Sport the Fennec's, Flat the
 *  Dominus's, Tall the Merc's) */
export const CHASSIS_SPRINGS: Readonly<Record<number, SpringSpec>> = {
  0: DEFAULT_SPRING,
  2: { ...common, strength: vec3(200, 50, 100), maxDisplacement: vec3(75, 20, 50), rotationScale: 12, pivotZ: 0.0097 },
  3: { ...common, strength: vec3(200, 50, 100), maxDisplacement: vec3(75, 25, 50), rotationScale: 25, pivotZ: -0.9454 },
};

/** The world's gravity (uu/s²: DefaultGravityZ), the step's longest (s) */
export const SPRING_GRAVITY = -650;
export const SPRING_MAX_DT = 0.05;

/** The body's sway this frame: pitch and roll (radians: nose up, right side down), lowered or raised (uu) */
export interface Sway {
  readonly pitch: number;
  readonly roll: number;
  readonly z: number;
}

const NONE: Sway = { pitch: 0, roll: 0, z: 0 };
const RAD_PER_UNIT = Math.PI / 32768;

const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
/** A world vector in the car's axes, and back */
const toLocal = (r: Rot3, v: Vec3): Vec3 => vec3(
  v.x * r.forward.x + v.y * r.forward.y + v.z * r.forward.z,
  v.x * r.right.x + v.y * r.right.y + v.z * r.right.z,
  v.x * r.up.x + v.y * r.up.y + v.z * r.up.z,
);
const toWorld = (r: Rot3, v: Vec3): Vec3 => vec3(
  r.forward.x * v.x + r.right.x * v.y + r.up.x * v.z,
  r.forward.y * v.x + r.right.y * v.y + r.up.y * v.z,
  r.forward.z * v.x + r.right.z * v.y + r.up.z * v.z,
);

export class ChassisSpring {
  readonly #spec: SpringSpec;
  /** The mass's world position and velocity; null until the first frame */
  #mass: Vec3 | null = null;
  #velocity: Vec3 = vec3(0, 0, 0);
  #sway: Sway = NONE;

  constructor(spec: SpringSpec) {
    this.#spec = spec;
  }

  /** The mass back where it hangs at rest on the car (a respawn, a reset, a jump of the drawn car) */
  reset(): void {
    this.#mass = null;
    this.#velocity = vec3(0, 0, 0);
    this.#sway = NONE;
  }

  /** A frame of `seconds` with the drawn car at `at`, turned `rot` (the world): the body's sway */
  step(at: Vec3, rot: Rot3, seconds: number): Sway {
    const s = this.#spec;
    if (this.#mass === null) {
      this.#mass = add(at, toWorld(rot, s.massOffset));
      return (this.#sway = NONE);
    }
    const dt = Math.min(seconds, SPRING_MAX_DT);
    if (dt <= 0) return this.#sway;
    const falling = vec3(this.#velocity.x, this.#velocity.y, this.#velocity.z + SPRING_GRAVITY * dt);
    const moved = add(this.#mass, vec3(falling.x * dt, falling.y * dt, falling.z * dt));
    const lag = sub(toLocal(rot, sub(moved, at)), s.massOffset);
    const local = toLocal(rot, falling);
    const axis = (d: number, v: number, strength: number, max: number): [number, number] => {
      const held = Math.max(-max, Math.min(max, d));
      // (held at the stop: its velocity takes the step it couldn't make)
      const w = v + (held - d) / dt;
      return [held, w + ((-strength * held - s.damping * w) / s.mass) * dt];
    };
    const [dx, vx] = axis(lag.x, local.x, s.strength.x, s.maxDisplacement.x);
    const [dy, vy] = axis(lag.y, local.y, s.strength.y, s.maxDisplacement.y);
    const [dz, vz] = axis(lag.z, local.z, s.strength.z, s.maxDisplacement.z);
    const speed = Math.hypot(vx, vy, vz);
    const k = speed > s.maxSpeed ? s.maxSpeed / speed : 1;
    this.#velocity = toWorld(rot, vec3(vx * k, vy * k, vz * k));
    const disp = vec3(dx, dy, dz);
    this.#mass = add(at, toWorld(rot, add(disp, s.massOffset)));
    return (this.#sway = { pitch: -dx * s.rotationScale * RAD_PER_UNIT, roll: dy * s.rotationScale * RAD_PER_UNIT, z: dz * s.translationScale });
  }
}
