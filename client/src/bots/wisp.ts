// Wisp v2's observation builder "wisp-v1", action mask "wisp-v1", mirror "wisp-x-v1" and moments "wisp-celebrate-v1"
// (ours: its obs_builder.py, eta.py, utils.py, arena_sdf.py, action_parser.py and bot.py's celebrate ported, the deployed
// bot's quirks kept; checked against its own Python on recorded states, notes/bots-ml.md). 432 floats: the ball (16),
// its predicted path at 22, 66, 198 and 594 ticks (48), the 34 pads and the 5 nearest (44), the previous action (8), the
// walls and the landing's normal (6), the score, turning, touch and handbrake (4), then 51 for the bot and for each of 2
// teammates and 3 opponents (zero rows for the empty seats, teammates and opponents each shuffled). Orange sees the field
// turned (x and y negated), and the bot always sees itself at +x (x mirrored when it isn't: then its action's steer, yaw
// and roll too). Vectors in float32 as its numpy (each operation rounded), scalars in float64, the result float32.
//
// The car's state is the engine's own (as the bot's training had it): its handbrake's level, its time in the air since a
// jump, whether the ball was touched in the last step (8 ticks), the pads' cooldowns, a ball prediction of the ball alone
// (720 slices, as its framework gives it).
import type { BotCar, BotState, BotView } from "../local/bots";
import type { Controls8 } from "./manifest";
import type { ObservationBuilder } from "./observations";

/** A float32 vector (each component a float32 value) */
type F3 = readonly [number, number, number];
interface RotF {
  readonly forward: F3;
  readonly right: F3;
  readonly up: F3;
}
interface Phys {
  readonly pos: F3;
  readonly rot: RotF;
  readonly vel: F3;
  readonly angVel: F3;
}

const f = Math.fround;
const v = (x: number, y: number, z: number): F3 => [f(x), f(y), f(z)];
const ZERO: F3 = [0, 0, 0];
const plus = (a: F3, b: F3): F3 => [f(a[0] + b[0]), f(a[1] + b[1]), f(a[2] + b[2])];
const minus = (a: F3, b: F3): F3 => [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])];
const times = (a: F3, s: number): F3 => {
  const k = f(s);
  return [f(a[0] * k), f(a[1] * k), f(a[2] * k)];
};
const timesV = (a: F3, b: F3): F3 => [f(a[0] * b[0]), f(a[1] * b[1]), f(a[2] * b[2])];
const over = (a: F3, s: number): F3 => {
  const k = f(s);
  return [f(a[0] / k), f(a[1] / k), f(a[2] / k)];
};
const absV = (a: F3): F3 => [Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2])];
const maxV = (a: F3, b: F3): F3 => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
const maxComp = (a: F3): number => Math.max(a[0], a[1], a[2]);
const dotF = (a: F3, b: F3): number => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
const lengthF = (a: F3): number => f(Math.sqrt(dotF(a, a)));
/** Vec.normalized: over its length, at least 1e-7 */
const normalized = (a: F3): F3 => {
  const l = lengthF(a);
  return over(a, f(1e-7) > l ? 1e-7 : l);
};
const to2d = (a: F3): F3 => [a[0], a[1], 0];
const isZero = (a: F3): boolean => a[0] === 0 && a[1] === 0 && a[2] === 0;
/** RotMat.dot(vec): the vector in its frame */
const rotDot = (m: RotF, a: F3): F3 => [dotF(a, m.forward), dotF(a, m.right), dotF(a, m.up)];
const fromVec = (p: { readonly x: number; readonly y: number; readonly z: number }): F3 => v(p.x, p.y, p.z);

// --- common_values.py
const SIDE_WALL_X = 4096;
const BACK_WALL_Y = 5120;
const CEILING_Z = 2044;
const BACK_NET_Y = 6000;
const CORNER_WALL_AX_INTERSECT = 8064;
const GOAL_HEIGHT = 642.775;
const GOAL_WIDTH_FROM_CENTER = 892.755;
const ORANGE_GOAL_CENTER = v(0, BACK_WALL_Y, GOAL_HEIGHT / 2);
const BLUE_GOAL_CENTER = v(0, -BACK_WALL_Y, GOAL_HEIGHT / 2);
const BALL_RADIUS = 91.25;
const CAR_MAX_SPEED = 2300;
const CAR_MAX_THROTTLE_SPEED = 1410;
const BOOST_ACCELERATION = 991.66;
const DEMO_RESPAWN_TIME = 3;
const GRAVITY = v(0, 0, -650);
const BOOST_LOCATIONS: readonly F3[] = (
  [
    [0, -4240, 70],
    [-1792, -4184, 70],
    [1792, -4184, 70],
    [-3072, -4096, 73],
    [3072, -4096, 73],
    [-940, -3308, 70],
    [940, -3308, 70],
    [0, -2816, 70],
    [-3584, -2484, 70],
    [3584, -2484, 70],
    [-1788, -2300, 70],
    [1788, -2300, 70],
    [-2048, -1036, 70],
    [2048, -1036, 70],
    [0, -1024, 70],
    [-3584, 0, 73],
    [-1024, 0, 70],
    [1024, 0, 70],
    [3584, 0, 73],
    [0, 1024, 70],
    [-2048, 1036, 70],
    [2048, 1036, 70],
    [-1788, 2300, 70],
    [1788, 2300, 70],
    [-3584, 2484, 70],
    [3584, 2484, 70],
    [0, 2816, 70],
    [-940, 3310, 70],
    [940, 3308, 70],
    [-3072, 4096, 73],
    [3072, 4096, 73],
    [-1792, 4184, 70],
    [1792, 4184, 70],
    [0, 4240, 70],
  ] as const
).map(([x, y, z]) => v(x, y, z));
/** Its "x-mirrored" pad order (sorted by y·10000 − x: one quirk kept, the pads at y 3308 and 3310) */
const MIRRORED_PAD_MAPPING: readonly number[] = BOOST_LOCATIONS.map((p, i) => ({ i, key: p[1] * 10000 - p[0] }))
  .sort((a, b) => a.key - b.key)
  .map((e) => e.i);

// --- obs_builder.py's constants
const POS_COEF = 1 / 5000;
const VEL_COEF = 1 / 2300;
const ANG_VEL_COEF = 1 / 3;
const MAX_PLAYERS = 3;
const CLOSE_BOOST_CAR_OFFSET = 420;
const CLOSE_BOOST_PADS_COUNT = 5;
const BALL_PRED_INIT_STEP = 22;
const BALL_PRED_OBS_MAX = 600;
const BALL_PRED_STEP_INCREASE_MULT = 3;
/** The observation's length, and one player's part of it */
export const WISP_OBS_SIZE = 432;
const PLAYER_SIZE = 51;
/** A step's ticks (its config's TICK_SKIP): "the ball touched this step" looks this far back */
const TICK_SKIP = 8;

// --- arena_sdf.py
const ROUNDNESS = 280;
const INV_SQRT_2 = 1 / Math.sqrt(2);
const ROUNDING = times(v(1, 1, 1), ROUNDNESS);
const ROT_45_MAT: RotF = { forward: v(INV_SQRT_2, INV_SQRT_2, 0), right: v(-INV_SQRT_2, INV_SQRT_2, 0), up: v(0, 0, 1) };
const SEMI_SIZE = v(SIDE_WALL_X, BACK_WALL_Y, CEILING_Z / 2);
const CORNER_SEMI_SIZE = v(INV_SQRT_2 * CORNER_WALL_AX_INTERSECT, INV_SQRT_2 * CORNER_WALL_AX_INTERSECT, CEILING_Z / 2);
const GOALS_SEMI_SIZE = v(GOAL_WIDTH_FROM_CENTER, BACK_NET_Y, GOAL_HEIGHT / 2);
const CENTER = v(0, 0, CEILING_Z / 2);
const GOAL_CENTER = v(0, 0, GOAL_HEIGHT / 2);

/** A rounded box's signed distance (inside negative) */
function boxDist(q: F3): number {
  const outside = lengthF(maxV(q, ZERO));
  const inside = Math.min(maxComp(q), 0);
  return f(outside + inside);
}

/** The distance to the nearest wall (an SDF of rounded boxes: the field, its corners cut at 45°, the goals; negative
 *  outside the arena) */
export function sdfWallDist(point: F3): number {
  const base = boxDist(plus(minus(absV(minus(point, CENTER)), SEMI_SIZE), ROUNDING));
  const corner = boxDist(plus(minus(absV(minus(rotDot(ROT_45_MAT, point), CENTER)), CORNER_SEMI_SIZE), ROUNDING));
  const baseCorner = Math.max(base, corner) - ROUNDNESS;
  const goals = boxDist(plus(minus(absV(minus(point, GOAL_CENTER)), GOALS_SEMI_SIZE), ROUNDING));
  return -Math.min(baseCorner, goals);
}

const SDF_D = 0.0004;
const SDF_STEPS: readonly F3[] = [v(SDF_D, 0, 0), v(0, SDF_D, 0), v(0, 0, SDF_D)];

/** The SDF's normalized gradient (the surface's normal at distance 0) */
function sdfNormal(point: F3): F3 {
  const [dx, dy, dz] = SDF_STEPS.map((d) => sdfWallDist(plus(point, d)) - sdfWallDist(minus(point, d))) as unknown as F3;
  return normalized(v(dx, dy, dz));
}

// --- utils.py
const clip = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Whether the segment from fst to snd passes a goal post or the crossbar */
function isGoalPostBetween(fst: F3, snd: F3): boolean {
  const fstNotGoal = Math.abs(fst[1]) < BACK_WALL_Y;
  if (fstNotGoal && Math.abs(snd[1]) < BACK_WALL_Y) return false;
  let inGoal = fstNotGoal ? snd : fst;
  let other = fstNotGoal ? fst : snd;
  if (inGoal[1] < 0) {
    inGoal = v(inGoal[0], -inGoal[1], inGoal[2]);
    other = v(other[0], -other[1], other[2]);
  }
  let gx = inGoal[0] + GOAL_WIDTH_FROM_CENTER;
  let gy = inGoal[1] - BACK_WALL_Y;
  let bx = other[0] + GOAL_WIDTH_FROM_CENTER;
  let by = other[1] - BACK_WALL_Y;
  if (bx < 0 && gy / gx >= by / bx) return true;
  gx = inGoal[0] - GOAL_WIDTH_FROM_CENTER;
  gy = inGoal[1] - BACK_WALL_Y;
  bx = other[0] - GOAL_WIDTH_FROM_CENTER;
  by = other[1] - BACK_WALL_Y;
  if (bx > 0 && gy / gx <= by / bx) return true;
  gy = inGoal[1] - BACK_WALL_Y;
  const gz = inGoal[2] - GOAL_HEIGHT;
  by = other[1] - BACK_WALL_Y;
  const bz = other[2] - GOAL_HEIGHT;
  return bz > 0 && gz / gy >= bz / by;
}

const distToSideWall = (x: number): number => SIDE_WALL_X - Math.abs(x);
const distToBackWall = (y: number): number => BACK_WALL_Y - Math.abs(y);

function distToCornerWall(x: number, y: number): number {
  const x1 = SIDE_WALL_X - 1152;
  const y1 = BACK_WALL_Y;
  const x2 = SIDE_WALL_X;
  const y2 = BACK_WALL_Y - 1152;
  const a = Math.abs(x) - x1;
  const b = Math.abs(y) - y1;
  const c = x2 - x1;
  const d = y2 - y1;
  const param = (a * c + b * d) / (c * c + d * d);
  const [xx, yy] = param < 0 ? [x1, y1] : param > 1 ? [x2, y2] : [x1 + param * c, y1 + param * d];
  const dx = Math.abs(x) - xx;
  const dy = Math.abs(y) - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

const distToClosestWall = (x: number, y: number): number => Math.min(distToSideWall(x), distToBackWall(y), distToCornerWall(x, y));

/** Where the car would land falling from here (0.25 s steps, 10 s at most): the arena's normal there */
function normalAtLanding(pos0: F3, vel0: F3): F3 {
  const step = 0.25;
  let pos = pos0;
  let vel = vel0;
  let left = 10;
  while (sdfWallDist(pos) > 0 && left > 0) {
    vel = plus(vel, times(GRAVITY, step));
    pos = plus(pos, times(vel, step));
    left -= step;
  }
  pos = minus(pos, times(times(vel, 0.5), step));
  return sdfNormal(pos);
}

function curvature(speed: number): number {
  if (speed >= 0 && speed < 500) return 0.0069 - 5.84e-6 * speed;
  if (speed >= 500 && speed < 1000) return 0.00561 - 3.26e-6 * speed;
  if (speed >= 1000 && speed < 1500) return 0.0043 - 1.95e-6 * speed;
  if (speed >= 1500 && speed < 1750) return 0.003025 - 1.1e-6 * speed;
  if (speed >= 1750 && speed < 2500) return 0.0018 - 4e-7 * speed;
  return 0;
}

const turnRadius = (speed: number): number => (speed === 0 ? 0 : 1 / curvature(speed));

/** Its dodge-relative frame: the forward flattened, the other rows left at identity (the original sets copies of them) */
function dodgeRelative(rot: RotF): RotF {
  return { forward: normalized(to2d(rot.forward)), right: v(0, 1, 0), up: v(0, 0, 1) };
}

// --- eta.py
function solveExpSegment(v0: number, x0: number, vInf: number): number {
  const a = vInf - v0;
  let t = x0 / Math.max(v0, 1);
  for (let i = 0; i < 2; i++) {
    const e = Math.exp(-t);
    const xRem = vInf * t + (v0 - vInf) * (1 - e) - x0;
    const vRem = vInf - a * e;
    t = t - xRem / vRem;
  }
  return t;
}

function solveQuadSegment(v0: number, x0: number, a: number): number {
  const t = x0 / Math.max(v0, 1);
  return t - (v0 * t + 0.5 * a * t * t - x0) / (v0 + a * t);
}

/** Seconds to cover x0 from speed v0 with boostDur seconds of boost (its quirks kept: no boost time added after it runs
 *  out) */
export function linearEta(v0In: number, x0In: number, boostDurIn: number): number {
  const d = 1556;
  const thrMax = CAR_MAX_THROTTLE_SPEED;
  const b = BOOST_ACCELERATION;
  const vInf = d + b;
  let v0 = v0In;
  let x0 = x0In;
  let boostDur = boostDurIn;
  let tSum = 0;
  if (v0 >= CAR_MAX_SPEED) return x0 / CAR_MAX_SPEED;
  if (v0 < thrMax && boostDur > 0) {
    const tDest = solveExpSegment(v0, x0, vInf);
    if (tDest >= 0 && tDest <= boostDur) return tDest;
    const tMax = Math.log((vInf - v0) / (vInf - thrMax));
    const t = Math.min(tMax, boostDur);
    const e = Math.exp(-t);
    const vT = vInf - (vInf - v0) * e;
    const xT = vInf * t + (v0 - vInf) * (1 - e);
    x0 -= xT;
    v0 = vT;
    boostDur -= t;
    tSum += t;
  }
  if (v0 < thrMax && boostDur <= 0) {
    const tDest = solveExpSegment(v0, x0, d);
    const tMax = Math.log((d - v0) / (d - thrMax));
    if (tDest >= 0 && tDest < tMax) return tDest;
    const e = Math.exp(-tMax);
    const vT = d - (d - v0) * e;
    const xT = d * tMax + (v0 - d) * (1 - e);
    x0 -= xT;
    v0 = vT;
    tSum += tMax;
  }
  if (v0 >= thrMax && boostDur > 0) {
    const tDest = solveQuadSegment(v0, x0, b);
    if (tDest >= 0 && tDest <= boostDur) return tDest;
    const tMaxSpeed = (CAR_MAX_SPEED - v0) / b;
    if (tMaxSpeed <= boostDur) {
      x0 -= v0 * tMaxSpeed + 0.5 * b * tMaxSpeed * tMaxSpeed;
      return tSum + tMaxSpeed + x0 / CAR_MAX_SPEED;
    }
    x0 -= v0 * boostDur + 0.5 * b * boostDur * boostDur;
    v0 = v0 + b * boostDur;
    boostDur = 0;
    tSum += boostDur;
  }
  return tSum + x0 / v0;
}

// --- the players
interface Player extends Phys {
  readonly index: number;
  readonly team: 0 | 1;
  readonly car: BotCar;
}

const player = (car: BotCar, index: number): Player => ({
  index,
  team: car.team,
  car,
  pos: fromVec(car.pos),
  rot: { forward: fromVec(car.rot.forward), right: fromVec(car.rot.right), up: fromVec(car.rot.up) },
  vel: fromVec(car.vel),
  angVel: fromVec(car.angVel),
});

/** CarState::HasFlipOrJump as its Player has it */
const hasFlipOrJump = (c: BotCar): boolean => c.onGround || (!c.hasFlipped && !c.doubleJumped && c.airTimeSinceJump < 1.25);
const hasFlipReset = (c: BotCar): boolean => !c.onGround && hasFlipOrJump(c) && !c.hasJumped;
const isProbablyTurtled = (p: Player): boolean => !p.car.onGround && p.rot.up[2] < -0.8 && Math.abs(p.vel[2]) < 50 && p.pos[2] < 50;

const INVERT: F3 = [-1, -1, 1];

/** Orange's view: y and x negated (a half turn) */
function invertY(p: Phys, inv: boolean): Phys {
  if (!inv) return p;
  return {
    pos: timesV(p.pos, INVERT),
    rot: { forward: timesV(p.rot.forward, INVERT), right: timesV(p.rot.right, INVERT), up: timesV(p.rot.up, INVERT) },
    vel: timesV(p.vel, INVERT),
    angVel: timesV(p.angVel, INVERT),
  };
}

function mirrorX(p: Phys, mirror: boolean): Phys {
  if (!mirror) return p;
  return {
    pos: [-p.pos[0], p.pos[1], p.pos[2]],
    rot: { forward: timesV(p.rot.forward, [-1, 1, 1]), right: timesV(p.rot.right, [1, -1, -1]), up: timesV(p.rot.up, [-1, 1, 1]) },
    vel: [-p.vel[0], p.vel[1], p.vel[2]],
    angVel: timesV(p.angVel, [1, -1, -1]),
  };
}

/** Whether a player sees the field mirrored in x (so that it sees itself at +x): blue at x < 0, orange at x >= 0 (its
 *  turned view's x < 0) */
export const mirrorsX = (team: 0 | 1, x: number): boolean => (team === 1) !== (x < 0);

const ballPhys = (ball: BotState["ball"]): Phys => ({ pos: fromVec(ball.pos), rot: { forward: v(1, 0, 0), right: v(0, 1, 0), up: v(0, 0, 1) }, vel: fromVec(ball.vel), angVel: fromVec(ball.angVel) });

/** A ball prediction's slice as Python indexes its 720 (a negative index from the end), its position and velocity */
function slice(path: Float32Array, index: number): { readonly pos: F3; readonly vel: F3 } {
  const count = Math.floor(path.length / 6);
  const i = Math.min(Math.max(index < 0 ? count + index : index, 0), count - 1);
  const at = (k: number): number => path[i * 6 + k] ?? 0;
  return { pos: v(at(0), at(1), at(2)), vel: v(at(3), at(4), at(5)) };
}

/** A builder's state between decisions: rough_eta's last estimate per player index */
type EtaCache = Map<number, number>;

function roughEta(p: Player, path: Float32Array, cache: EtaCache): number {
  let time = cache.get(p.index) ?? 0;
  for (let k = 0; k < 2; k++) {
    const t = Math.trunc(time * 120);
    const tick = Number.isFinite(t) ? Math.min(t, 600 - 1) : 0;
    const carToBall = minus(slice(path, tick).pos, p.pos);
    const dist = lengthF(carToBall);
    const dir = over(carToBall, dist);
    const initVel = dotF(p.vel, dir);
    time = linearEta(initVel, dist - 1.5 * BALL_RADIUS, p.car.boost / 33.3);
  }
  cache.set(p.index, time);
  return time;
}

/** One player's 51 floats in the bot's view */
function addPlayer(obs: number[], p: Player, inv: boolean, mirror: boolean, ball: Phys, path: Float32Array, cache: EtaCache): void {
  const start = obs.length;
  const push = (...xs: readonly number[]): void => {
    obs.push(...xs);
  };
  const phys = mirrorX(invertY(p, inv), mirror);
  const dodge = dodgeRelative(phys.rot);
  const myGoal = BLUE_GOAL_CENTER;
  const oppGoal = ORANGE_GOAL_CENTER;
  push(...times(phys.pos, POS_COEF), ...phys.rot.forward, ...phys.rot.up, ...times(phys.vel, VEL_COEF), ...times(phys.angVel, ANG_VEL_COEF));
  push(...times(rotDot(phys.rot, phys.angVel), ANG_VEL_COEF), dotF(phys.rot.forward, phys.vel) * VEL_COEF);
  push(...times(rotDot(phys.rot, minus(ball.pos, phys.pos)), POS_COEF), ...times(rotDot(phys.rot, minus(ball.vel, phys.vel)), VEL_COEF));
  const dodgeBallPos = times(rotDot(dodge, minus(ball.pos, phys.pos)), POS_COEF);
  const dodgeBallVel = times(rotDot(dodge, minus(ball.vel, phys.vel)), VEL_COEF);
  push(dodgeBallPos[0], dodgeBallPos[1], dodgeBallVel[0], dodgeBallVel[1]);
  const toOwn = normalized(minus(myGoal, ball.pos));
  const toOpp = normalized(minus(oppGoal, ball.pos));
  push(...times(rotDot(phys.rot, toOwn), POS_COEF), ...times(rotDot(phys.rot, toOpp), POS_COEF));
  const dodgeOwn = times(to2d(rotDot(dodge, toOwn)), POS_COEF);
  const dodgeOpp = times(to2d(rotDot(dodge, toOpp)), POS_COEF);
  push(dodgeOwn[0], dodgeOwn[1], dodgeOpp[0], dodgeOpp[1]);
  const c = p.car;
  const flag = (b: boolean): number => (b ? 1 : 0);
  push(c.boost / 100, flag(c.onGround), flag(hasFlipOrJump(c)), flag(c.demoed), flag(c.jumping), flag(hasFlipReset(c)));
  // (its own position, unturned, against the ball as the bot sees it: the original's frames kept)
  push(flag(Math.abs(p.pos[1]) > BACK_WALL_Y - 10), flag(isGoalPostBetween(p.pos, ball.pos)), distToClosestWall(p.pos[0], p.pos[1]) * POS_COEF);
  push(c.demoed ? 10 : roughEta(p, path, cache));
  if (c.demoed) obs.fill(0, start);
  push(flag(c.demoed), c.demoRespawnTimer / DEMO_RESPAWN_TIME);
}

/** Python's random.shuffle (Fisher–Yates from the end), from `random` in [0, 1) */
function shuffle(items: number[][], random: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = items[i] ?? [];
    items[i] = items[j] ?? [];
    items[j] = a;
  }
}

/** The pads in its order, matched to ours by position (within √10 uu across the ground, as its adapter's) */
function padOrder(pads: BotState["pads"]): number[] {
  const used = new Set<number>();
  return BOOST_LOCATIONS.map((want) => {
    let best = -1;
    let bestDist = Infinity;
    pads.forEach((pad, i) => {
      if (used.has(i)) return;
      const d = (pad.pos.x - want[0]) ** 2 + (pad.pos.y - want[1]) ** 2;
      if (d < 10 && d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    if (best < 0) throw new Error("wisp: a pad of its table isn't in the arena");
    used.add(best);
    return best;
  });
}

/** The observation for the bot `view.self` (its previous action as applied, unmirrored), `random` for the shuffles */
export function wispObservation(view: BotView, previous: Controls8, random: () => number, cache: EtaCache, order: readonly number[]): Float32Array {
  const { state } = view;
  const players = state.cars.map(player);
  const me = players[view.self];
  if (!me) throw new Error("wisp: no such car");
  const inv = me.team === 1;
  const mirror = mirrorsX(me.team, me.pos[0]);
  const phys = mirrorX(invertY(me, inv), mirror);
  const ball = mirrorX(invertY(ballPhys(state.ball), inv), mirror);
  const path = state.ballPrediction();
  const obs: number[] = [];
  const push = (...xs: readonly number[]): void => {
    obs.push(...xs);
  };

  // (the ball; its goals as the original has them for orange: the turned field's own goal named by its world side)
  const myGoal = inv ? ORANGE_GOAL_CENTER : BLUE_GOAL_CENTER;
  const oppGoal = inv ? BLUE_GOAL_CENTER : ORANGE_GOAL_CENTER;
  push(...times(ball.pos, POS_COEF), ...times(ball.vel, VEL_COEF), ...times(ball.angVel, ANG_VEL_COEF));
  push(...times(minus(myGoal, ball.pos), POS_COEF), ...times(minus(oppGoal, ball.pos), POS_COEF));
  push(isZero(to2d(ball.pos)) ? 1 : 0);
  for (let i = BALL_PRED_INIT_STEP; i < BALL_PRED_OBS_MAX; i *= BALL_PRED_STEP_INCREASE_MULT) {
    const s = slice(path, i);
    const pred = mirrorX(invertY({ pos: s.pos, vel: s.vel, rot: ballPhys(state.ball).rot, angVel: ZERO }, inv), mirror);
    push(...times(pred.pos, POS_COEF), ...times(pred.vel, VEL_COEF));
    push(...times(rotDot(phys.rot, minus(pred.pos, phys.pos)), POS_COEF), ...times(rotDot(phys.rot, minus(pred.vel, phys.vel)), VEL_COEF));
  }

  // (the pads: up 1, else 1 / (1 + its cooldown); orange's in reverse, mirrored by its x-mirrored order)
  const active = order.map((i) => state.pads[i]?.active ?? false);
  const timers = order.map((i) => state.pads[i]?.cooldown ?? 0);
  const turned = (a: readonly (number | boolean)[]): readonly (number | boolean)[] => (inv ? [...a].reverse() : a);
  const mirrored = <T>(a: readonly T[]): readonly T[] => (mirror ? MIRRORED_PAD_MAPPING.map((i) => a[i] as T) : a);
  const padsUp = mirrored(turned(active));
  const padTimers = mirrored(turned(timers));
  for (let i = 0; i < BOOST_LOCATIONS.length; i++) push(padsUp[i] ? 1 : 1 / (1 + Number(padTimers[i] ?? 0)));
  const soon = plus(me.pos, times(me.rot.forward, CLOSE_BOOST_CAR_OFFSET));
  const near = BOOST_LOCATIONS.map((pos) => ({ pos, d: dotF(minus(pos, soon), minus(pos, soon)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, CLOSE_BOOST_PADS_COUNT);
  for (const { pos } of near) {
    const rel = times(rotDot(me.rot, minus(pos, me.pos)), POS_COEF);
    push(rel[0], mirror ? -rel[1] : rel[1]);
  }

  // (the previous action, mirrored with the field)
  const [throttle, steer, pitch, yaw, roll, jump, boost, handbrake] = previous;
  push(...(mirror ? [throttle, -steer, pitch, -yaw, -roll, jump, boost, handbrake] : previous).map(f));

  // (the walls and where it would land: its own position, its normal into the bot's turned frame)
  push(distToBackWall(me.pos[1]) * POS_COEF, distToSideWall(me.pos[0]) * POS_COEF, distToCornerWall(me.pos[0], me.pos[1]) * POS_COEF);
  push(...rotDot(phys.rot, normalAtLanding(me.pos, me.vel)));
  const diff = me.team === 0 ? state.score[0] - state.score[1] : state.score[1] - state.score[0];
  push(clip(diff, -1, 1));
  const forwardSpeed = dotF(me.vel, phys.rot.forward);
  push(turnRadius(Math.min(Math.abs(forwardSpeed), CAR_MAX_SPEED)) / 1300);
  const hit = me.car.lastBallHitTick;
  push(hit >= 0 && hit >= state.tickCount - TICK_SKIP && hit <= state.tickCount ? 1 : 0, me.car.handbrakeVal);

  addPlayer(obs, me, inv, mirror, ball, path, cache);
  const mates: number[][] = [];
  const opponents: number[][] = [];
  for (const other of players) {
    if (other.index === me.index) continue;
    const row: number[] = [];
    addPlayer(row, other, inv, mirror, ball, path, cache);
    (other.team === me.team ? mates : opponents).push(row);
  }
  while (mates.length < MAX_PLAYERS - 1) mates.push(new Array<number>(PLAYER_SIZE).fill(0));
  while (opponents.length < MAX_PLAYERS) opponents.push(new Array<number>(PLAYER_SIZE).fill(0));
  shuffle(mates, random);
  shuffle(opponents, random);
  for (const row of [...mates, ...opponents]) push(...row);
  if (obs.length !== WISP_OBS_SIZE) throw new Error(`wisp: an observation of ${String(obs.length)}`);
  return Float32Array.from(obs);
}

/** The builder "wisp-v1": its observation as the policy's one input [1, 432] */
export function wispBuilder(random: () => number): ObservationBuilder {
  const cache: EtaCache = new Map();
  let order: number[] | null = null;
  return {
    build(view, previous) {
      order ??= padOrder(view.state.pads);
      return [{ data: wispObservation(view, previous, random, cache, order), shape: [1, WISP_OBS_SIZE] }];
    },
  };
}

/** The action mask "wisp-v1" (action_parser.py's): on the ground its ground rows, in the air its air rows (the aerial
 *  ones without a jump, the first left out as the original has it, and the ground rows that turn in the air), no boost
 *  rows without boost, and every jump row while a jump or dodge is there or the car is probably on its roof */
export function wispMask(table: readonly Controls8[], groundRows: number): (view: BotView) => boolean[] {
  const jump = table.map((r) => r[5] !== 0);
  const boost = table.map((r) => r[6] !== 0);
  const ground = table.map((_, i) => i < groundRows);
  const air = table.map((r, i) => (i > groundRows && !(r[5] !== 0)) || (i < groundRows && r[0] === r[6] && (r[3] !== 0) === (r[7] !== 0)));
  return (view) => {
    const car = view.state.cars[view.self];
    if (!car) return table.map(() => true);
    const p = player(car, view.self);
    let allowed = car.onGround ? [...ground] : [...air];
    if (car.boost === 0) allowed = allowed.map((a, i) => a && !boost[i]);
    if (hasFlipOrJump(car) || isProbablyTurtled(p)) allowed = allowed.map((a, i) => a || (jump[i] ?? false));
    return allowed;
  };
}

/** The mirror "wisp-x-v1": a row picked in the mirrored view, its steer, yaw and roll negated back */
export function wispMirror(view: BotView, row: Controls8): Controls8 {
  const car = view.state.cars[view.self];
  if (!car || !mirrorsX(car.team, f(car.pos.x))) return row;
  const [throttle, steer, pitch, yaw, roll, jump, boost, handbrake] = row;
  return [throttle, -steer, pitch, -yaw, -roll, jump, boost, handbrake];
}

/** The moments "wisp-celebrate-v1" (bot.py celebrate): after a goal it drives on, steering in waves, nose up and
 *  boosting while low and climbing; at the match's end it reverses, steering in waves; else null (it plays) */
export function wispCelebrate(view: BotView): Controls8 | null {
  const { state } = view;
  if (!state.goalScored && !state.matchEnded) return null;
  const car = state.cars[view.self];
  if (!car) return null;
  const t = view.tick / 120;
  const steering = Math.sin(7.2 * t + 1.3 * view.self);
  if (state.goalScored) {
    const pitch = clip(3 * car.rot.up.z + 3 * (car.rot.forward.z < 0 ? 1 : 0), -1, 1);
    const boost = car.pos.z < 1550 && car.rot.forward.z > 0;
    return [1, steering, pitch, 0, 1, 0, boost ? 1 : 0, 0];
  }
  return [-1, steering, 0, 0, 0, 0, Math.abs(steering) >= 1.5 ? 1 : 0, 0];
}
