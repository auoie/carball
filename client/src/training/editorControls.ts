// The training editor's free-camera mode, its rules (the game's EditorMode: notes/training-editor.md, TE1 §2-3): the
// invisible fly camera's flight (2000 uu/s across, 1000 up and down, accelerating at 4000, braked 10/s), the look, the
// selection (free cam, the ball, the car) moved and turned by the same inputs, the ball's launch aimed by the look, the
// speeds in steps of 50 (the pad's bumpers repeating), the clamps, the camera snapped behind the selection, the strength
// meter's needle, the tap and the hold, undo and redo. No engine, no page: src/ui/flyEditor.ts is its page side.
import { type Vec3, vec3 } from "../math/vec";
import { PACK_LIMITS, type Shot, type TrainingPack, wrapYaw } from "./pack";

/** Rotator units a radian (65536 a turn) */
export const UNITS_PER_RAD = 32768 / Math.PI;

/** The fly camera's flight (SpectatorCameraSpeed, SpectatorCameraAccel; vertical at half; Brake = min(10 dt, 1)) */
export const FLIGHT = { speed: 2000, accel: 4000, vertical: 0.5, brake: 10 } as const;

/** The look: the mouse's radians a pixel (ours), the pad's stick at full tilt (GamepadLookScale 20 × 1000 units/s) */
export const LOOK = { mouse: 0.0025, pad: 20000 / UNITS_PER_RAD } as const;

/** What the editor does with the speeds and the clock (TE1 §2.4-2.5, §3.2) */
export const EDITOR_STEPS = { speed: 50, timeMin: 1, timeMax: PACK_LIMITS.timeLimit } as const;

/** The pad's bumpers held: a step at once, one every 0.25 s, and from 0.75 s one every 0.02 s
 *  (BallVelocityIncrementSpeedDefault, …FireCountMax 2, …SpeedMax) */
export const REPEAT = { slow: 0.25, fastFrom: 0.75, fast: 0.02 } as const;

/** A press shorter than this is a tap (Tab's Test Shot, R's pitch lock), held this long a hold (R's reset) (TapTime) */
export const TAP_SECONDS = 0.5;

/** The camera behind the selection (GetCameraPositionOffset: the ball's 550 behind and 200 to a side, its view the
 *  launch's with half its pitch; the car's 300 behind and 25 up, its yaw alone), how fast it follows (RInterpTo 3) */
export const BEHIND = { ball: { back: 550, side: 200, pitchShare: 0.5 }, car: { back: 300, up: 25 }, follow: 3 } as const;

/** Where things may go (the panel's clamps, TE1 §3.1 simplified: inside the arena, the ball 100 up at least and in a
 *  goal too, TE1 §9; the fly camera the stadium's field box, 1000 past the field) */
const BALL_RADIUS = 92.75;
const CAR_REACH = 60;
/** The car's origin resting on the floor (uu) */
export const CAR_FLOOR_Z = 17;
export const CLAMPS = {
  camera: { x: 5037, y: 6936, zMin: 15, zMax: 4096 },
  ball: { x: PACK_LIMITS.halfX - BALL_RADIUS, y: 5120 - BALL_RADIUS, zMin: 100, zMax: PACK_LIMITS.top - BALL_RADIUS },
  car: { x: PACK_LIMITS.halfX - CAR_REACH, y: 5120 - CAR_REACH, zMin: CAR_FLOOR_Z, zMax: PACK_LIMITS.top - 50 },
} as const;

/** A goal's mouth (half width, height: the game's) and its back (|y|), the ball allowed inside (TE1 §3.1, §9) */
const GOAL = { halfWidth: 892.755, height: 642.775, back: 6000 } as const;
/** How far along the field a ball may be (|y|: inside a goal, at its back) */
export const GOAL_BACK = GOAL.back - BALL_RADIUS;

export type Selection = "free" | "ball" | "car";

/** The move input: forward, right and up, each -1 to 1 (a key full, a stick its deflection) */
export interface Move {
  readonly forward: number;
  readonly right: number;
  readonly up: number;
}

/** A pose: where, and which way (radians: yaw from +x towards +y, pitch up) */
export interface Pose {
  readonly pos: Vec3;
  readonly yaw: number;
  readonly pitch: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** A pose's forward, right and up (the game's frame: x forward at yaw 0, y right, z up) */
export function axes(yaw: number, pitch: number): { readonly forward: Vec3; readonly right: Vec3; readonly up: Vec3 } {
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  return { forward: vec3(cp * cy, cp * sy, sp), right: vec3(-sy, cy, 0), up: vec3(-sp * cy, -sp * sy, cp) };
}

/** The flight's velocity after `dt` s (UpdateSpectatorLocation): towards the input along the camera's yaw (across) and
 *  the world's up, at the acceleration, up to the input's share of the top speed; what's off the input braked by
 *  min(10 dt, 1), all of it with no input */
export function flyVelocity(vel: Vec3, move: Move, yaw: number, dt: number): Vec3 {
  const { forward, right } = axes(yaw, 0);
  const across = vec3(forward.x * move.forward + right.x * move.right, forward.y * move.forward + right.y * move.right, 0);
  const reach = Math.min(1, Math.hypot(across.x, across.y));
  const brake = Math.min(FLIGHT.brake * dt, 1);
  // (across: the input's direction speeded up, the rest braked)
  let [vx, vy] = [vel.x, vel.y];
  if (reach > 0) {
    const [dx, dy] = [across.x / Math.hypot(across.x, across.y), across.y / Math.hypot(across.x, across.y)];
    const along = vx * dx + vy * dy;
    const [ox, oy] = [vx - along * dx, vy - along * dy];
    const top = FLIGHT.speed * reach;
    const sped = Math.min(top, Math.max(along, 0) + FLIGHT.accel * dt);
    [vx, vy] = [dx * sped + ox * (1 - brake), dy * sped + oy * (1 - brake)];
  } else {
    [vx, vy] = [vx * (1 - brake), vy * (1 - brake)];
  }
  // (up and down: the same at half)
  const up = clamp(move.up, -1, 1);
  let vz = vel.z;
  if (up !== 0) {
    const top = FLIGHT.speed * FLIGHT.vertical * Math.abs(up);
    const along = vz * Math.sign(up);
    vz = Math.sign(up) * Math.min(top, Math.max(along, 0) + FLIGHT.accel * FLIGHT.vertical * dt);
  } else vz *= 1 - brake;
  return vec3(vx, vy, vz);
}

/** A point kept inside a box (`kind`'s clamp); the ball past a goal line only within its mouth, up to its back */
export function clampTo(kind: keyof typeof CLAMPS, p: Vec3): Vec3 {
  const c = CLAMPS[kind];
  const [x, z] = [clamp(p.x, -c.x, c.x), clamp(p.z, c.zMin, c.zMax)];
  const inGoal = kind === "ball" && Math.abs(x) <= GOAL.halfWidth - BALL_RADIUS && z <= GOAL.height - BALL_RADIUS;
  const y = inGoal ? GOAL.back - BALL_RADIUS : c.y;
  return vec3(x, clamp(p.y, -y, y), z);
}

/** A pack as the editor takes it (an import: TE1 §3.2's limits, which a pack file can exceed): its name 30 characters at
 *  most, its tags 4 at most without repeats, each shot's time limit 1-59 and its ball and car within the clamps */
export function editorPack(pack: TrainingPack): TrainingPack {
  return {
    ...pack,
    name: pack.name.trim().slice(0, 30),
    tags: [...new Set(pack.tags)].slice(0, 4),
    shots: pack.shots.map((s) => ({
      ...s,
      timeLimit: clamp(Math.round(s.timeLimit), EDITOR_STEPS.timeMin, EDITOR_STEPS.timeMax),
      ball: { ...s.ball, location: clampTo("ball", s.ball.location) },
      car: { ...s.car, location: clampTo("car", s.car.location) },
    })),
  };
}

/** The look's turn applied to a camera's pose (pitch within ±90°, no roll) */
export function lookPose(pose: Pose, yaw: number, pitch: number): Pose {
  return { pos: pose.pos, yaw: pose.yaw + yaw, pitch: clamp(pose.pitch + pitch, -Math.PI / 2, Math.PI / 2) };
}

/** The ball moved and its launch turned by the look (AddVelocityStartRotation: its pitch within ±90°, its yaw any) */
export function editBall(shot: Shot, move: Vec3, yaw: number, pitch: number): Shot {
  const b = shot.ball;
  const at = clampTo("ball", vec3(b.location.x + move.x, b.location.y + move.y, b.location.z + move.z));
  const launch = { ...b.launch, yaw: wrapYaw(b.launch.yaw + yaw * UNITS_PER_RAD), pitch: Math.round(clamp(b.launch.pitch + pitch * UNITS_PER_RAD, -PACK_LIMITS.pitch, PACK_LIMITS.pitch)) };
  return { ...shot, ball: { ...b, location: at, launch } };
}

/** The car moved and turned by the look: its yaw any, its pitch untouched while locked (Reset Pitch puts it back to 0),
 *  else within ±90° */
export function editCar(shot: Shot, move: Vec3, yaw: number, pitch: number, pitchLocked: boolean): Shot {
  const c = shot.car;
  const at = clampTo("car", vec3(c.location.x + move.x, c.location.y + move.y, c.location.z + move.z));
  const turned = pitchLocked ? c.rotation.pitch : Math.round(clamp(c.rotation.pitch + pitch * UNITS_PER_RAD, -PACK_LIMITS.pitch, PACK_LIMITS.pitch));
  return { ...shot, car: { ...c, location: at, rotation: { ...c.rotation, yaw: wrapYaw(c.rotation.yaw + yaw * UNITS_PER_RAD), pitch: turned } } };
}

/** The selection's speed `steps` steps of 50 on (the ball's 0-6000, the car's start 0-2300) */
export function stepSpeed(shot: Shot, selection: Selection, steps: number): Shot {
  if (selection === "ball") return { ...shot, ball: { ...shot.ball, speed: clamp(shot.ball.speed + steps * EDITOR_STEPS.speed, 0, PACK_LIMITS.ballSpeed) } };
  if (selection === "car") return { ...shot, car: { ...shot.car, startSpeed: clamp(shot.car.startSpeed + steps * EDITOR_STEPS.speed, 0, PACK_LIMITS.carSpeed) } };
  return shot;
}

/** The time limit a second on or back (1 to 59) */
export function stepTime(shot: Shot, by: 1 | -1): Shot {
  return { ...shot, timeLimit: clamp(Math.round(shot.timeLimit) + by, EDITOR_STEPS.timeMin, EDITOR_STEPS.timeMax) };
}

/** The car's pitch back to 0 (Reset Car Rotation) */
export function resetPitch(shot: Shot): Shot {
  return { ...shot, car: { ...shot.car, rotation: { ...shot.car.rotation, pitch: 0 } } };
}

/** The next selection (EditorCycleActor: the ball's car, else the ball) */
export function cycle(selection: Selection): "ball" | "car" {
  return selection === "ball" ? "car" : "ball";
}

/** The camera behind the selection: its pose (the ball's to `side`, -1 left or 1 right), kept in the camera's box (TE1
 *  §3.1: a low ball launched upward would put it under the floor, RX25) */
export function behind(shot: Shot, selection: "ball" | "car", side: 1 | -1): Pose {
  const pose = behindUnclamped(shot, selection, side);
  return { ...pose, pos: clampTo("camera", pose.pos) };
}

function behindUnclamped(shot: Shot, selection: "ball" | "car", side: 1 | -1): Pose {
  if (selection === "ball") {
    const yaw = shot.ball.launch.yaw / UNITS_PER_RAD;
    const pitch = (shot.ball.launch.pitch / UNITS_PER_RAD) * BEHIND.ball.pitchShare;
    const { forward, right } = axes(yaw, pitch);
    const b = shot.ball.location;
    const [back, aside] = [BEHIND.ball.back, side * BEHIND.ball.side];
    return { pos: vec3(b.x - forward.x * back + right.x * aside, b.y - forward.y * back + right.y * aside, b.z - forward.z * back + right.z * aside), yaw, pitch };
  }
  const yaw = shot.car.rotation.yaw / UNITS_PER_RAD;
  const { forward } = axes(yaw, 0);
  const c = shot.car.location;
  return { pos: vec3(c.x - forward.x * BEHIND.car.back, c.y - forward.y * BEHIND.car.back, c.z + BEHIND.car.up), yaw, pitch: 0 };
}

/** A pose eased towards another (VInterpTo/RInterpTo at BEHIND.follow: the share min(dt × 3, 1); the yaw the short way) */
export function follow(from: Pose, to: Pose, dt: number): Pose {
  const t = Math.min(1, dt * BEHIND.follow);
  const turn = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
  const p = from.pos;
  return { pos: vec3(p.x + (to.pos.x - p.x) * t, p.y + (to.pos.y - p.y) * t, p.z + (to.pos.z - p.z) * t), yaw: from.yaw + turn * t, pitch: from.pitch + (to.pitch - from.pitch) * t };
}

/** A new pack's first free camera (SetupInitialPawnOrientation): 700 behind the car's spawn, 600 to its right and 500
 *  up, turned by its yaw; looking 25° left of it and 15° down */
export function firstCamera(shot: Shot): Pose {
  const yaw = shot.car.rotation.yaw / UNITS_PER_RAD;
  const { forward, right } = axes(yaw, 0);
  const c = shot.car.location;
  const pos = clampTo("camera", vec3(c.x - forward.x * 700 + right.x * 600, c.y - forward.y * 700 + right.y * 600, c.z + 500));
  return { pos, yaw: yaw - (25 * Math.PI) / 180, pitch: (-15 * Math.PI) / 180 };
}

/** The strength meter's needle (degrees: +39 at no speed, on the left, to -39 at the most, on the right) */
export function needleDegrees(speed: number, max: number): number {
  return 39 - 78 * clamp(max > 0 ? speed / max : 0, 0, 1);
}

/** The pad's bumpers held: the steps due (a step at once, then on REPEAT's timing) */
export class Repeat {
  #dir: -1 | 0 | 1 = 0;
  #held = 0;
  #next = 0;

  /** Pressed (1 up, -1 down) or let go (0): the step due at once */
  set(dir: -1 | 0 | 1): number {
    if (dir === this.#dir) return 0;
    this.#dir = dir;
    this.#held = 0;
    this.#next = REPEAT.slow;
    return dir;
  }

  /** `dt` s more held: the steps due (signed) */
  tick(dt: number): number {
    if (this.#dir === 0) return 0;
    this.#held += dt;
    let steps = 0;
    while (this.#held >= this.#next - 1e-9) {
      steps += 1;
      this.#next += this.#next >= REPEAT.fastFrom - 1e-9 ? REPEAT.fast : REPEAT.slow;
    }
    return steps * this.#dir;
  }
}

/** A key's tap or hold: "tap" when let go within TAP_SECONDS, "hold" once when held that long */
export class TapHold {
  #down: number | null = null;
  #held = false;

  press(now: number): void {
    if (this.#down !== null) return;
    this.#down = now;
    this.#held = false;
  }

  /** Let go: a tap if short (and not already a hold) */
  release(now: number): "tap" | null {
    const down = this.#down;
    this.#down = null;
    return down !== null && !this.#held && now - down < TAP_SECONDS ? "tap" : null;
  }

  /** Still held now: "hold" the once it's held long enough */
  poll(now: number): "hold" | null {
    if (this.#down === null || this.#held || now - this.#down < TAP_SECONDS) return null;
    this.#held = true;
    return "hold";
  }
}

/** A shot's undo and redo (GameEvent_GameEditor_TA's history: an entry once the edits pause 0.5 s, 1000 at most; cleared
 *  when the shot changes) */
export class ShotHistory {
  static readonly settle = 0.5;
  static readonly max = 1000;
  #undo: Shot[] = [];
  #redo: Shot[] = [];
  /** The shot before the edits in progress, and when they last moved it */
  #pending: Shot | null = null;
  #last = -Infinity;

  /** An edit at `now` (s) from `before` */
  edited(before: Shot, now: number): void {
    if (this.#pending === null || now - this.#last > ShotHistory.settle) {
      this.#flush();
      this.#pending = before;
    }
    this.#last = now;
  }

  /** The shot as it was before the last edits (`current` kept for redo), or null */
  undo(current: Shot): Shot | null {
    this.#flush();
    const back = this.#undo.pop();
    if (!back) return null;
    this.#redo.push(current);
    return back;
  }

  redo(current: Shot): Shot | null {
    this.#flush();
    const ahead = this.#redo.pop();
    if (!ahead) return null;
    this.#undo.push(current);
    return ahead;
  }

  clear(): void {
    this.#undo = [];
    this.#redo = [];
    this.#pending = null;
  }

  #flush(): void {
    if (this.#pending === null) return;
    const last = this.#undo[this.#undo.length - 1];
    if (JSON.stringify(last) !== JSON.stringify(this.#pending)) this.#undo.push(this.#pending);
    if (this.#undo.length > ShotHistory.max) this.#undo.shift();
    this.#redo = [];
    this.#pending = null;
  }
}
