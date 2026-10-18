// Custom training's variance (Actor Modifiers: notes/custom-training.md §4.2, CTR-14): each shot's ball moved ± the
// location modifier along x and y and ± the height modifier in z, its speed × (1 ± the speed modifier); the car moved ±
// its location modifier along x and y, its yaw ± its rotation modifier; each axis drawn uniformly and on its own, in the
// world's axes. The game caps a move at the first thing its swept shape meets; here, inside the arena's box (no further
// out than the start was).
import { type Vec3, vec3 } from "../math/vec";
import { type Shot, PACK_LIMITS, wrapYaw } from "./pack";
import type { TrainingSettings } from "./settings";

export interface Variance {
  /** The ball's move (uu), its speed's factor */
  readonly ball: Vec3;
  readonly speed: number;
  /** The car's move along x and y (uu), its yaw's (rotator units) */
  readonly car: Vec3;
  readonly yaw: number;
}

export const NO_VARIANCE: Variance = { ball: vec3(0, 0, 0), speed: 1, car: vec3(0, 0, 0), yaw: 0 };

/** Rotator units a degree */
const UNITS_PER_DEGREE = 65536 / 360;
/** The ball's radius and the car's reach from its origin (uu): how near the arena's sides a moved start may come */
const BALL_RADIUS = 92.75;
const CAR_REACH = 60;
const HALF_X = 4096;
const HALF_Y = 5120;

/** A shot's variance drawn from the settings' modifiers (`random` in [0, 1): every axis drawn, zero ranges too) */
export function rollVariance(s: TrainingSettings, random: () => number): Variance {
  // (+ 0: a zero range's −0 as 0)
  const u = (range: number): number => (random() * 2 - 1) * range + 0;
  const [bx, by, bz] = [u(s.ballLocationModifier), u(s.ballLocationModifier), u(s.ballHeightModifier)];
  const speed = 1 + u(s.ballSpeedModifier / 100);
  const [cx, cy] = [u(s.carLocationModifier), u(s.carLocationModifier)];
  const yaw = u(s.carRotationModifier) * UNITS_PER_DEGREE;
  return { ball: vec3(bx, by, bz), speed, car: vec3(cx, cy, 0), yaw };
}

/** One coordinate moved by `d`, kept within ±`limit` (or as far out as it started, past it) */
function capped(from: number, d: number, limit: number): number {
  const bound = Math.max(limit, Math.abs(from));
  return Math.max(-bound, Math.min(bound, from + d));
}

/** The shot as varied */
export function applyVariance(shot: Shot, v: Variance): Shot {
  if (v === NO_VARIANCE) return shot;
  const b = shot.ball.location;
  const c = shot.car.location;
  const top = PACK_LIMITS.top - BALL_RADIUS;
  return {
    ...shot,
    ball: {
      ...shot.ball,
      location: vec3(capped(b.x, v.ball.x, HALF_X - BALL_RADIUS), capped(b.y, v.ball.y, HALF_Y - BALL_RADIUS), Math.max(BALL_RADIUS, Math.min(Math.max(top, b.z), b.z + v.ball.z))),
      speed: Math.max(0, Math.min(PACK_LIMITS.ballSpeed, shot.ball.speed * v.speed)),
    },
    car: {
      ...shot.car,
      location: vec3(capped(c.x, v.car.x, HALF_X - CAR_REACH), capped(c.y, v.car.y, HALF_Y - CAR_REACH), c.z),
      rotation: { ...shot.car.rotation, yaw: wrapYaw(shot.car.rotation.yaw + Math.round(v.yaw)) },
    },
  };
}
