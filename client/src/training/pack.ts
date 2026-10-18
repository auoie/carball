// Custom training's packs in Carball's own format (the user's decision, 2026-10-17; notes/custom-training.md §1.2,
// §1.4, CTR-1/2): a pack's metadata and 1 to 50 shots, each a time limit, the ball's start (its location, the launch's
// rotator and speed: no spin) and the car's (its location, rotation and start speed). Rotators in Unreal units (65536 a
// turn), the game's frame (blue's goal at -y), uu, uu/s, s. Packs are data: checked here before they're played.
import { type Rot3, type Vec3, vec3 } from "../math/vec";

export const PACK_FORMAT = 1;

/** Only Goalie changes the rules; Aerial plays as Striker (CTR-1) */
export type TrainingType = "striker" | "goalie" | "aerial";
export type Difficulty = "easy" | "medium" | "hard";

/** The game's training tags (ETrainingTag), by name */
export const TRAINING_TAGS = [
  "Aerials",
  "Bounces",
  "Shots",
  "Saves",
  "Clears",
  "Rebounds",
  "Redirects",
  "Freestyles",
  "Dribbles",
  "AirDribbles",
  "Kickoffs",
  "WallShots",
  "LongShots",
  "CloseShots",
  "AngleShots",
  "BackwardsShots",
  "Offense",
  "Defense",
  "PinchShots",
] as const;

/** An Unreal rotator (65536 units a turn) */
export interface Rotator {
  readonly pitch: number;
  readonly yaw: number;
  readonly roll: number;
}

export interface BallStart {
  /** The ball's centre (uu) */
  readonly location: Vec3;
  /** The launch's direction, vector(pitch, yaw) (its roll has no effect) */
  readonly launch: Rotator;
  /** uu/s, 0 to 6000: 0 floats until touched */
  readonly speed: number;
}

export interface CarStart {
  readonly location: Vec3;
  readonly rotation: Rotator;
  /** uu/s along the car's facing at the shot's start, 0 to 2300 */
  readonly startSpeed: number;
}

export interface Shot {
  /** s; 0 never times out */
  readonly timeLimit: number;
  readonly ball: BallStart;
  readonly car: CarStart;
}

export interface TrainingPack {
  readonly id: string;
  readonly name: string;
  readonly type: TrainingType;
  readonly difficulty: Difficulty;
  readonly tags: readonly string[];
  readonly description: string;
  readonly creator: string;
  readonly shots: readonly Shot[];
}

/** The format's limits (§1.3): shots a pack, the time limit, the speeds, the launch's pitch (a quarter turn), the arena's
 *  box a start must be in (the goals' depth past the back walls) */
export const PACK_LIMITS = { shots: 50, timeLimit: 59, ballSpeed: 6000, carSpeed: 2300, pitch: 16384, halfX: 4096, halfY: 6000, top: 2044 } as const;

const TYPES: readonly TrainingType[] = ["striker", "goalie", "aerial"];
const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A yaw in [0, 65536) (packs hold several turns), a pitch within a quarter turn */
export const wrapYaw = (yaw: number): number => ((Math.trunc(yaw) % 65536) + 65536) % 65536;
const clampPitch = (pitch: number): number => Math.max(-PACK_LIMITS.pitch, Math.min(PACK_LIMITS.pitch, Math.trunc(pitch)));

function location(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(finite)) return null;
  const [x, y, z] = v as [number, number, number];
  if (Math.abs(x) > PACK_LIMITS.halfX || Math.abs(y) > PACK_LIMITS.halfY || z < 0 || z > PACK_LIMITS.top) return null;
  return vec3(x, y, z);
}

function rotator(v: unknown): Rotator | null {
  if (!isRecord(v) || !finite(v["pitch"]) || !finite(v["yaw"]) || (v["roll"] !== undefined && !finite(v["roll"]))) return null;
  return { pitch: clampPitch(v["pitch"]), yaw: wrapYaw(v["yaw"]), roll: Math.trunc(finite(v["roll"]) ? v["roll"] : 0) };
}

function shot(v: unknown): Shot | string {
  if (!isRecord(v)) return "not an object";
  const { timeLimit, ball, car } = v;
  if (!finite(timeLimit) || timeLimit < 0 || timeLimit > PACK_LIMITS.timeLimit) return "its time limit";
  if (!isRecord(ball) || !isRecord(car)) return "its ball or car";
  const ballAt = location(ball["location"]);
  const launch = rotator(ball["launch"]);
  const speed = ball["speed"];
  if (!ballAt || !launch || !finite(speed) || speed < 0 || speed > PACK_LIMITS.ballSpeed) return "its ball";
  const carAt = location(car["location"]);
  const rotation = rotator(car["rotation"]);
  const startSpeed = car["startSpeed"] ?? 0;
  if (!carAt || !rotation || !finite(startSpeed) || startSpeed < 0 || startSpeed > PACK_LIMITS.carSpeed) return "its car";
  return { timeLimit, ball: { location: ballAt, launch: { ...launch, roll: 0 }, speed }, car: { location: carAt, rotation, startSpeed } };
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** A pack checked (else what's wrong): its metadata as given (unknown tags dropped), every shot within the limits */
export function parsePack(json: unknown): TrainingPack | string {
  if (!isRecord(json)) return "not an object";
  if (json["format"] !== PACK_FORMAT) return "its format";
  const id = json["id"];
  if (typeof id !== "string" || !ID.test(id)) return "its id";
  const type = TYPES.find((t) => t === json["type"]);
  if (!type) return "its type";
  const difficulty = DIFFICULTIES.find((d) => d === json["difficulty"]) ?? "easy";
  const tags = Array.isArray(json["tags"]) ? json["tags"].filter((t): t is string => (TRAINING_TAGS as readonly unknown[]).includes(t)) : [];
  const shots = json["shots"];
  if (!Array.isArray(shots) || shots.length < 1 || shots.length > PACK_LIMITS.shots) return "its shots (1 to 50)";
  const parsed: Shot[] = [];
  for (const [i, s] of shots.entries()) {
    const checked = shot(s);
    if (typeof checked === "string") return `shot ${String(i + 1)}: ${checked}`;
    parsed.push(checked);
  }
  return {
    id,
    name: text(json["name"], 64) || id,
    type,
    difficulty,
    tags,
    description: text(json["description"], 500),
    creator: text(json["creator"], 64),
    shots: parsed,
  };
}

const RADIANS = Math.PI / 32768;

/** vector(rotator): the unit direction a rotator faces (UE's FRotator::Vector) */
export function direction(r: Pick<Rotator, "pitch" | "yaw">): Vec3 {
  const [p, y] = [r.pitch * RADIANS, r.yaw * RADIANS];
  return vec3(Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p));
}

/** A rotator's axes (UE's FRotationMatrix: forward X, right Y, up Z) */
export function rotatorAxes(r: Rotator): Rot3 {
  const [p, y, ro] = [r.pitch * RADIANS, r.yaw * RADIANS, r.roll * RADIANS];
  const [sp, cp, sy, cy, sr, cr] = [Math.sin(p), Math.cos(p), Math.sin(y), Math.cos(y), Math.sin(ro), Math.cos(ro)];
  return {
    forward: vec3(cp * cy, cp * sy, sp),
    right: vec3(sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, -sr * cp),
    up: vec3(-(cr * sp * cy + sr * sy), cy * sr - cr * sp * sy, cr * cp),
  };
}

/** A shot mirrored across the field's long axis (CTR-13: x to -x, yaw to 32768 - yaw; y and z kept) */
export function mirrorShot(s: Shot): Shot {
  const flip = (v: Vec3): Vec3 => vec3(-v.x, v.y, v.z);
  // (the yaw alone, as MirrorUtils_X: pitch and roll kept)
  const yaw = (r: Rotator): Rotator => ({ ...r, yaw: wrapYaw(32768 - r.yaw) });
  return {
    ...s,
    ball: { ...s.ball, location: flip(s.ball.location), launch: yaw(s.ball.launch) },
    car: { ...s.car, location: flip(s.car.location), rotation: yaw(s.car.rotation) },
  };
}
