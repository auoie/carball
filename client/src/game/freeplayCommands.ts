// Free play's ball commands as the game does them (FreeplayCommands_TA, the live 2026-10-06 build: FP3, its trail in
// out/bsim/agents/FP3/): Take Possession and Start Dribble place the ball (teleports, refused where the ball can't go),
// Launch Ball pops it up, Pass Ball and Defend Shot launch it. Pure: the world's ray test and the random source given.
import { type Rot3, type Vec3, ZERO, add, dot, length, normalize, scale, sub, vec3 } from "../math/vec";

/** Default__FreeplayCommandsConfig_TA's (package data) */
export const FREEPLAY_COMMANDS = {
  /** A teleported ball keeps this much of its spin */
  spinScale: 0.5,
  /** Take Possession: the gap between the car's hitbox and the ball */
  inFrontDistance: 50,
  /** Start Dribble: the gap over the car's roof */
  onCarDistance: 10,
  onCarForwardBase: 30,
  onCarForwardFromTurn: -100,
  onCarAccelerationEffect: 0.05,
  onCarMaxRight: 350,
  onCarSlowRight: 0.5,
  onCarMinUp: 0.25,
  /** Either teleport in the air: along the car's velocity, and forward */
  airAlongVelocity: 40,
  airForward: 25,
  /** Launch Ball: its upward speed added (PopBallUpZVelocity), the ball's own held within 0..popUpMax first */
  popUpSpeed: 750,
  popUpMax: 6000,
  /** Pass Ball's and Defend Shot's horizontal launch speed, their vertical held within ±ratio of it */
  launchSpeed: 2778,
  maxVerticalRatio: 2,
  passVelocityWeight: 0.9,
  passVelocityZWeight: 0.5,
  passGoalLead: 400,
  passHeight: 100,
  passDropoffRange: 3000,
  passIterations: 5,
  /** Defend Shot: the target's spread across the goal mouth, and its centre's height */
  defendHalfWidth: 864.51,
  defendHalfHeight: 280.51,
  defendCentreZ: 320,
} as const;

/** The ball's bounds sphere (its mesh's bounds merged with its collision sphere, +1: 103.22 at almost any rotation, FP3),
 *  not its collision radius */
export const BALL_BOUNDS_RADIUS = 103.22;
/** The goals' front centres' |y| and height (the nearest goal's and the passes' aim) */
const GOAL_Y = 5120;
const GOAL_FRONT_Z = 312;
/** Gravity (uu/s², down) */
const GRAVITY = 650;
/** The car's top speed, Start Dribble's slow-to-fast scale */
const MAX_CAR_SPEED = 2300;

/** What a command needs of the car: its body, its hitbox (full size and offset), on the ground (enough wheels in contact),
 *  its wheels' mean contact normal, and the previous tick's velocity (Start Dribble's acceleration) */
export interface CommandCar {
  readonly pos: Vec3;
  readonly rot: Rot3;
  readonly vel: Vec3;
  readonly angVel: Vec3;
  readonly onGround: boolean;
  readonly groundNormal: Vec3;
  readonly hitboxSize: Vec3;
  readonly hitboxOffset: Vec3;
  readonly lastVel: Vec3;
}

/** The world's ray test against its static collision: the fraction along from → to of the first hit, null for none */
export type StaticRay = (from: Vec3, to: Vec3) => number | null;

const lerp1 = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const flat = (v: Vec3): Vec3 => vec3(v.x, v.y, 0);
const dist2D = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y);

/** In the air (not on the ground): either teleport puts the ball over the car, a little ahead along its velocity */
export function airTarget(car: CommandCar): Vec3 {
  const c = FREEPLAY_COMMANDS;
  const up = car.hitboxSize.z / 2 + car.hitboxOffset.z + BALL_BOUNDS_RADIUS + c.onCarDistance;
  return add(add(add(car.pos, vec3(0, 0, up)), scale(normalize(car.vel), c.airAlongVelocity)), scale(car.rot.forward, c.airForward));
}

/** Take Possession on the ground: ahead of the hitbox by the gap, the ball's bounds radius above the surface under the car
 *  (`below`: how far the surface is under the car along its down axis, 0 if not within that radius) */
export function possessionTarget(car: CommandCar, below: number): Vec3 {
  const c = FREEPLAY_COMMANDS;
  const ext = length(scale(car.hitboxSize, 0.5));
  return add(add(car.pos, scale(car.rot.forward, BALL_BOUNDS_RADIUS + ext + c.inFrontDistance)), scale(car.rot.up, BALL_BOUNDS_RADIUS - below));
}

/** Start Dribble on the ground: over the roof, moved back and lower toward the inside of a turn, forward with the
 *  car's acceleration while slow (a wall's turn not counted) */
export function dribbleTarget(car: CommandCar): Vec3 {
  const c = FREEPLAY_COMMANDS;
  const s = length(car.vel) / MAX_CAR_SPEED;
  const accel = scale(sub(car.vel, car.lastVel), 120);
  const onWall = car.onGround && Math.abs(car.groundNormal.z) < 0.9;
  const turn = onWall ? 0 : car.angVel.z / 5.5;
  const forward = c.onCarForwardBase * (1 - s) + lerp1(c.onCarAccelerationEffect * dot(car.rot.forward, accel), c.onCarForwardFromTurn, Math.abs(turn));
  const right = c.onCarMaxRight * turn * lerp1(c.onCarSlowRight, 1, s);
  const up = (car.hitboxSize.z / 2 + car.hitboxOffset.z + BALL_BOUNDS_RADIUS + c.onCarDistance) * clamp(1 - Math.abs(turn), c.onCarMinUp, 1);
  return add(add(add(car.pos, vec3(0, 0, up)), scale(car.rot.forward, forward)), scale(car.rot.right, right));
}

/** Where a teleport puts the ball: in the air the air spot; on the ground Take Possession's (the surface found by a ray
 *  down from the car, the ball's bounds radius long) or Start Dribble's */
export function teleportTarget(kind: "possession" | "dribble", car: CommandCar, ray: StaticRay): Vec3 {
  if (!car.onGround) return airTarget(car);
  if (kind === "dribble") return dribbleTarget(car);
  const hit = ray(car.pos, sub(car.pos, scale(car.rot.up, BALL_BOUNDS_RADIUS)));
  return possessionTarget(car, hit === null ? 0 : hit * BALL_BOUNDS_RADIUS);
}

/** Inside a goal's volume (x ±960, |y| 5120 to 6032, z -64 to 688): no ball placed there */
export function inGoal(p: Vec3): boolean {
  return Math.abs(p.x) <= 960 && Math.abs(p.y) >= 5120 && Math.abs(p.y) <= 6032 && p.z >= -64 && p.z <= 688;
}

/** A teleport's spot allowed: not in a goal, and nothing static between it and the car (the game traces a 1 uu box; a ray
 *  here, a hair thinner) */
export function teleportAllowed(p: Vec3, car: CommandCar, ray: StaticRay): boolean {
  return !inGoal(p) && ray(p, car.pos) === null;
}

/** The ball teleported to `p`: moving with the car, half its spin, its rotation kept */
export function teleportedBall(
  ball: { readonly angVel: Vec3; readonly rot: Rot3 },
  car: CommandCar,
  p: Vec3,
): { pos: Vec3; vel: Vec3; angVel: Vec3; rot: Rot3 } {
  return { pos: p, vel: car.vel, angVel: scale(ball.angVel, FREEPLAY_COMMANDS.spinScale), rot: ball.rot };
}

/** Launch Ball: the ball's upward speed held within 0..6000, then 750 more; nothing else changed */
export function poppedUp(vel: Vec3): Vec3 {
  const c = FREEPLAY_COMMANDS;
  return vec3(vel.x, vel.y, clamp(vel.z, 0, c.popUpMax) + c.popUpSpeed);
}

/** The velocity that takes a ball from `from` to `to` under gravity at horizontal speed `h`, its vertical held within
 *  ±maxVerticalRatio·h; none if h is 0 or the two are (nearly) above each other */
export function launchVector(from: Vec3, to: Vec3, h: number): Vec3 {
  const d = dist2D(from, to);
  if (h <= 0 || d < 0.001) return ZERO;
  const t = d / h;
  const horizontal = scale(normalize(flat(sub(to, from))), h);
  const limit = FREEPLAY_COMMANDS.maxVerticalRatio * h;
  const vz = clamp((to.z - from.z + (GRAVITY / 2) * t * t) / t, -limit, limit);
  return vec3(horizontal.x, horizontal.y, vz);
}

/** The goals' front centres, in the game's order (the later wins a tie) */
const GOAL_FRONTS: readonly Vec3[] = [vec3(0, -GOAL_Y, GOAL_FRONT_Z), vec3(0, GOAL_Y, GOAL_FRONT_Z)];

/** The goal the car heads at most: its velocity's direction against each goal's from the car (a tie: the later goal, the
 *  orange one; a car at rest ties) */
export function headedGoal(car: Pick<CommandCar, "pos" | "vel">): Vec3 {
  const heading = normalize(car.vel);
  let best = GOAL_FRONTS[0] ?? ZERO;
  let bestScore = -Infinity;
  for (const g of GOAL_FRONTS) {
    const score = dot(heading, normalize(sub(g, car.pos)));
    if (score >= bestScore) [best, bestScore] = [g, score];
  }
  return best;
}

/** Pass Ball: the speed it's passed at, and where to (ahead of the car by its velocity over the flight, led toward the
 *  goal it heads at, a little high), iterated as the game does */
export function passTarget(ball: Vec3, car: Pick<CommandCar, "pos" | "vel">): { target: Vec3; speed: number } {
  const c = FREEPLAY_COMMANDS;
  const toCar = scale(normalize(flat(sub(car.pos, ball))), c.launchSpeed);
  const dropoff = clamp(dist2D(ball, car.pos) / c.passDropoffRange, 0.5, 1);
  const speed = Math.min(c.launchSpeed, length(scale(add(toCar, flat(car.vel)), dropoff)));
  const lead = scale(normalize(flat(sub(headedGoal(car), car.pos))), c.passGoalLead);
  let target = car.pos;
  if (speed > 0) {
    const ahead = vec3(car.vel.x * c.passVelocityWeight, car.vel.y * c.passVelocityWeight, car.vel.z * c.passVelocityWeight * c.passVelocityZWeight);
    for (let i = 0; i < c.passIterations; i++) {
      const t = dist2D(ball, target) / speed;
      target = add(add(car.pos, scale(ahead, t)), lead);
    }
  }
  return { target: add(target, vec3(0, 0, c.passHeight)), speed };
}

/** Pass Ball's launch: to its target at its speed (no randomness) */
export function passVelocity(ball: Vec3, car: Pick<CommandCar, "pos" | "vel">): Vec3 {
  const { target, speed } = passTarget(ball, car);
  return launchVector(ball, target, speed);
}

/** The goal nearest the car (by its front centre): -1 the blue one (negative y), 1 the orange one */
export function nearestGoal(car: Vec3): -1 | 1 {
  const squared = (y: number): number => dot(sub(car, vec3(0, y, GOAL_FRONT_Z)), sub(car, vec3(0, y, GOAL_FRONT_Z)));
  return squared(-GOAL_Y) < squared(GOAL_Y) ? -1 : 1;
}

/** Defend Shot's aim: a random spot across the nearest goal's mouth (`random`: uniform in 0..1, twice) */
export function defendTarget(side: -1 | 1, random: () => number): Vec3 {
  const c = FREEPLAY_COMMANDS;
  const across = (2 * random() - 1) * c.defendHalfWidth;
  const height = (2 * random() - 1) * c.defendHalfHeight;
  return vec3(across, side * GOAL_Y, c.defendCentreZ + height);
}

/** Defend Shot: the ball launched from where it is at the nearest goal, never at the car */
export function defendVelocity(ball: Vec3, car: Vec3, random: () => number): Vec3 {
  return launchVector(ball, defendTarget(nearestGoal(car), random), FREEPLAY_COMMANDS.launchSpeed);
}
