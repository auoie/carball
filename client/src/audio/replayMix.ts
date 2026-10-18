// A goal replay's mix (RA1, notes/sound-behaviour.md SND-19): the LiveReplay state's offsets on the buses (PreScore from
// the start, Slomo in the slowed stretches, PostGoal from the goal, None after), moved between over the state group's
// transition times; each replayed car's Replay_InCameraView (how far in front of the replay camera it is) on its own
// sounds; and the replay's pickups' attenuation. Pure, for the tests; src/audio/audio.ts applies it.
import { type Vec3, dot, normalize, sub } from "../math/vec";
import type { ReplayPlan } from "../net/protocol";

/** The LiveReplay state group's states */
export type ReplayState = "none" | "preScore" | "slomo" | "postGoal";

/** The buses a state moves (RA1 §4): the ball's impacts (and loops: none here), the cars' impacts (bodies, bumps, wheels),
 *  engines, boost loops, the other cars' pickups (NonLocal), the arena's ambient bed. Movements (jumps, dodges, flip
 *  resets), tyres, UI and the goal's events stay as they are */
export type MixGroup = "ball" | "carImpact" | "engine" | "boost" | "pickup" | "ambient";

/** A state's offsets on a bus: volume (dB), pitch (cents), Wwise's low- and high-pass filter values (0-100) */
export interface MixOffsets {
  readonly db: number;
  readonly cents: number;
  readonly lpf: number;
  readonly hpf: number;
}

const NONE: MixOffsets = { db: 0, cents: 0, lpf: 0, hpf: 0 };
const o = (offsets: Partial<MixOffsets>): MixOffsets => ({ ...NONE, ...offsets });

/** The states' offsets (RA1 §4: the LiveReplay state chunks of the Init bank's buses; crowd and Crowd_HDR have no bus
 *  here) */
export const REPLAY_MIX: Readonly<Record<ReplayState, Readonly<Partial<Record<MixGroup, MixOffsets>>>>> = {
  none: {},
  preScore: {
    ball: o({ db: -3, hpf: -20 }),
    engine: o({ db: -4, lpf: 15 }),
    boost: o({ db: 3 }),
    ambient: o({ lpf: -10, hpf: -10 }),
  },
  slomo: {
    ball: o({ db: 3, cents: -700, hpf: -20 }),
    carImpact: o({ db: -4 }),
    engine: o({ db: -10, lpf: 30 }),
    boost: o({ cents: -700, lpf: 20 }),
    pickup: o({ db: -108 }),
    ambient: o({ db: -15, cents: -250, lpf: 10, hpf: 10 }),
  },
  postGoal: {
    ball: o({ db: -2 }),
    engine: o({ db: -8, lpf: 5 }),
    pickup: o({ db: -108 }),
    ambient: o({ lpf: 10, hpf: 10 }),
  },
};

const GROUPS: readonly MixGroup[] = ["ball", "carImpact", "engine", "boost", "pickup", "ambient"];

/** The state group's transition times (s): None → PreScore 1, None → Slomo 1.5, Slomo → PostGoal 3, Slomo → PreScore 1,
 *  PreScore → Slomo 0.5, any other the group's default, 1 (RA1 replaystates: LiveReplay 1000 ms) */
export function transitionSeconds(from: ReplayState, to: ReplayState): number {
  if (from === "none" && to === "slomo") return 1.5;
  if (from === "slomo" && to === "postGoal") return 3;
  if (from === "preScore" && to === "slomo") return 0.5;
  return 1;
}

/** Where a replay is: None once it's over; PostGoal from the goal; Slomo inside a slowed stretch; PreScore otherwise
 *  (RA1 §4) */
export function replayState(plan: Pick<ReplayPlan, "goalTick" | "slomo">, tick: number): ReplayState {
  if (tick >= plan.goalTick) return "postGoal";
  return plan.slomo.some(([from, to]) => tick > from && tick < to) ? "slomo" : "preScore";
}

/** The LiveReplay state as heard: a change moves each bus's offsets from where they are to the new state's, linearly
 *  over the transition's time (Wwise's state transition) */
export class LiveReplayState {
  #state: ReplayState = "none";
  #from: Readonly<Record<MixGroup, MixOffsets>> = Object.fromEntries(GROUPS.map((g) => [g, NONE])) as Record<MixGroup, MixOffsets>;
  #since = 0;
  #duration = 0;

  get state(): ReplayState {
    return this.#state;
  }

  /** The state from `now` (s); the same state again changes nothing */
  set(state: ReplayState, now: number): void {
    if (state === this.#state) return;
    this.#from = Object.fromEntries(GROUPS.map((g) => [g, this.offsets(g, now)])) as Record<MixGroup, MixOffsets>;
    this.#duration = transitionSeconds(this.#state, state);
    this.#state = state;
    this.#since = now;
  }

  /** A bus's offsets at `now` */
  offsets(group: MixGroup, now: number): MixOffsets {
    const to = REPLAY_MIX[this.#state][group] ?? NONE;
    const from = this.#from[group];
    const t = this.#duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - this.#since) / this.#duration));
    const mix = (a: number, b: number): number => a + (b - a) * t;
    return { db: mix(from.db, to.db), cents: mix(from.cents, to.cents), lpf: mix(from.lpf, to.lpf), hpf: mix(from.hpf, to.hpf) };
  }
}

/** Wwise's curve shapes between two points (t 0..1 along the segment): Exp3 t³, Log3 1 − (1 − t)³, Constant the
 *  segment's first value, Linear */
type Shape = "exp3" | "log3" | "constant" | "linear";

function shaped(shape: Shape, t: number): number {
  if (shape === "exp3") return t * t * t;
  if (shape === "log3") return 1 - (1 - t) ** 3;
  if (shape === "constant") return 0;
  return t;
}

/** A Wwise RTPC curve: points (x, value, the shape to the next point), clamped at its ends */
function curve(points: readonly (readonly [number, number, Shape])[], x: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 0;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b || x > b[0]) continue;
    return a[1] + (b[1] - a[1]) * shaped(a[2], (x - a[0]) / (b[0] - a[0]));
  }
  return last[1];
}

/** Replay_InCameraView: the cosine between the camera's forward and the way to the car (1 straight ahead, −1 behind) */
export function inCameraView(car: Vec3, camera: Vec3, forward: Vec3): number {
  const to = normalize(sub(car, camera), forward);
  return Math.max(-1, Math.min(1, dot(to, normalize(forward, forward))));
}

/** Its volume (dB, additive) on a car's engine, boost, jumps, landings and bumps: −27 behind, −15 at 0.1, none from
 *  0.31424 (within ~71.7° of the camera's forward) (RA1 §3: (−1, −27, Exp3) (0.1, −15, Log3) (0.31424, 0.03, Exp3)
 *  (1, 0)) */
export function inCameraViewDb(x: number): number {
  return curve(
    [
      [-1, -27, "exp3"],
      [0.1, -15, "log3"],
      [0.31424, 0.03, "exp3"],
      [1, 0, "linear"],
    ],
    x,
  );
}

/** Its low-pass filter value on the same: 20 behind, 10 at 0.1, none from 0.31424 ((−1, 20, Exp3) (0.1, 10, Log3)
 *  (0.31424, 0, Constant) (1, 0)) */
export function inCameraViewLpf(x: number): number {
  return curve(
    [
      [-1, 20, "exp3"],
      [0.1, 10, "log3"],
      [0.31424, 0, "constant"],
      [1, 0, "linear"],
    ],
    x,
  );
}

/** Replay_InCameraView's filtering over time (rampUp and rampDown 0.3 s, FilteringOverTime): here a first-order
 *  smoothing that's 95% there in 0.3 s [approximation: Wwise's filter not extracted] */
export function smoothInCameraView(value: number, target: number, seconds: number): number {
  const TIME_CONSTANT = 0.1;
  return target + (value - target) * Math.exp(-Math.max(0, seconds) / TIME_CONSTANT);
}

/** A Wwise filter value (0-100, its contributions summed on the voice, then clamped) as the cutoff of its 2nd-order
 *  Butterworth (Q 1/√2: a BiquadFilterNode's lowpass or highpass), null for none: at most 0.1 runs no filter at all.
 *  Wwise 2023.1's mapping in the game (RA2, FUN_14103b990): linear from 20000 Hz at 0 to 7000 at 30, then halving every
 *  1/0.12432837 of a step (16.8 Hz at 100); the high-pass the same of 100 − its value. (The exe's fast 2^x is ≤ 0.23%
 *  off the exact one used here; its cap at 0.45 of the sample rate never bites at 48 kHz, and Web Audio's own clamp
 *  stands for it.) */
export function wwiseFilterHz(kind: "lpf" | "hpf", value: number): number | null {
  const v = Math.min(100, value);
  if (v <= 0.1) return null;
  const x = kind === "lpf" ? v : 100 - v;
  return x < 30 ? 7000 + (30 - x) * 433.33334 : 7000 * 2 ** (-(x - 30) * 0.12432837);
}

/** dB to a gain */
export function dbGain(db: number): number {
  return 10 ** (db / 20);
}

/** The replay's pickups (Play_Boost_Pickup_NonLocal, RA1 §8): −5 dB, then by distance 0 dB to 300, −8 by 1850, −14 by
 *  5500, −96 by 14000 (linear between: the curve's shapes not given) */
export function pickupDb(distance: number): number {
  const points: readonly (readonly [number, number])[] = [
    [300, 0],
    [1850, -8],
    [5500, -14],
    [14000, -96],
  ];
  return (
    -5 +
    curve(
      points.map(([x, v]) => [x, v, "linear"] as const),
      distance,
    )
  );
}
