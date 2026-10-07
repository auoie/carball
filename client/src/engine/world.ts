// Typed wrapper around the WebAssembly engine (engine/wasm/bindings.cpp).
// The module itself is passed in, so the same code runs in the browser and in Node tests.
import type { MainModule, Sim } from "@engine/rlengine_web.mjs";
import { type Rot3, type Vec3, vec3 } from "../math/vec";

export type Team = 0 | 1; // 0 blue (defends -y), 1 orange (defends +y)

export enum CarBody {
  Octane = 0,
  Dominus = 1,
  Plank = 2,
  Breakout = 3,
  Hybrid = 4,
  Merc = 5,
}

export interface CarControls {
  readonly throttle: number; // -1..1
  readonly steer: number; // -1 left .. 1 right
  readonly pitch: number; // -1 nose down .. 1 nose up
  readonly yaw: number; // -1 left .. 1 right
  readonly roll: number; // -1 left .. 1 right
  readonly jump: boolean;
  readonly boost: boolean;
  readonly handbrake: boolean;
  /** Keyboard air pitch safety is holding nose-down pitch back: air control ignores pitch, dodges still use it. */
  readonly airPitchSafety: boolean;
}

/** The player's control preferences, applied in the car's physics (the game's PRI car preferences). */
export interface CarPreferences {
  readonly dodgeDeadzone: number; // |pitch| + |yaw| + |roll| needed to dodge instead of double jump
  readonly steeringSensitivity: number;
  readonly airControlSensitivity: number;
}

export const NO_CONTROLS: CarControls = {
  throttle: 0,
  steer: 0,
  pitch: 0,
  yaw: 0,
  roll: 0,
  jump: false,
  boost: false,
  handbrake: false,
  airPitchSafety: false,
};

export interface BodyState {
  readonly pos: Vec3;
  readonly vel: Vec3;
  readonly angVel: Vec3;
  readonly rot: Rot3;
}

export interface CarState extends BodyState {
  readonly team: Team;
  readonly boost: number; // 0..100
  readonly onGround: boolean;
  readonly supersonic: boolean;
  readonly boosting: boolean;
  readonly demoed: boolean;
  readonly jumping: boolean; // jump component active (first 0.2 s of a held jump)
  readonly hasJumped: boolean; // jumped since it was last on the ground
  readonly doubleJumped: boolean; // used its second jump without dodging (until it lands)
  readonly hasFlipped: boolean; // dodged since it was last on the ground
  readonly flipping: boolean; // a dodge is turning the car
  /** Seconds in the air since the jump ended: a dodge must start within 1.25 s of it (DOUBLEJUMP_MAX_DELAY) */
  readonly airTimeSinceJump: number;
  /** A jump, double jump or dodge is available (CarState::HasFlipOrJump) */
  readonly hasFlipOrJump: boolean;
  /** In the air with a dodge from touching something, no time limit (CarState::HasFlipReset; also after driving off
   *  something without jumping) */
  readonly hasFlipReset: boolean;
  /** Wheels whose ray hits the arena (the others hit nothing, or a car or the ball) */
  readonly worldWheelContacts: number;
  /** Grounded on a car or the ball: 3+ wheels down, at most 1 of them on the arena (the game's IsOnRBActor) */
  readonly onRbActor: boolean;
  readonly wheelContact: readonly [boolean, boolean, boolean, boolean];
  /** Average contact normal of the wheels touching something, else straight up (Vehicle_TA.GetGroundNormal). */
  readonly groundNormal: Vec3;
}

export interface WheelConfig {
  readonly offset: Vec3; // right-hand wheel; the left one mirrors y
  readonly radius: number;
  readonly suspensionRest: number;
}

export interface CarConfig {
  readonly hitboxSize: Vec3;
  readonly hitboxOffset: Vec3;
  readonly frontWheel: WheelConfig;
  readonly backWheel: WheelConfig;
}

export interface BoostPadState {
  readonly pos: Vec3;
  readonly big: boolean;
  readonly active: boolean;
}

export type GameEvent =
  | { readonly type: "goal"; readonly scoringTeam: Team }
  | { readonly type: "bump"; readonly attacker: number; readonly victim: number }
  | { readonly type: "demo"; readonly attacker: number; readonly victim: number };

/** Reads index `i`; throws instead of returning undefined, since layouts are fixed. */
function at(a: ArrayLike<number>, i: number): number {
  const v = a[i];
  if (v === undefined) throw new RangeError(`engine state index ${i} out of range (${a.length})`);
  return v;
}

const readVec = (a: ArrayLike<number>, i: number): Vec3 => vec3(at(a, i), at(a, i + 1), at(a, i + 2));
const readRot = (a: ArrayLike<number>, i: number): Rot3 => ({
  forward: readVec(a, i),
  right: readVec(a, i + 3),
  up: readVec(a, i + 6),
});
const toTeam = (v: number): Team => (v === 1 ? 1 : 0);

/** Loads the arena collision meshes (.cmf files). Call once per module, before creating worlds. */
export function initEngine(module: MainModule, meshes: readonly Uint8Array[]): void {
  module.init([...meshes]);
}

export class World {
  readonly #m: MainModule;
  readonly #sim: Sim;

  /** A new soccar arena with the ball at kickoff and no cars. */
  static create(module: MainModule): World {
    return new World(module, new module.Sim());
  }

  private constructor(module: MainModule, sim: Sim) {
    this.#m = module;
    this.#sim = sim;
  }

  dispose(): void {
    this.#sim.delete();
  }

  get tick(): number {
    return this.#sim.tickCount();
  }

  addCar(team: Team, body: CarBody = CarBody.Octane): number {
    return this.#sim.addCar(team, body);
  }

  removeCar(id: number): void {
    this.#sim.removeCar(id);
  }

  carIds(): number[] {
    return Array.from(this.#sim.carIds());
  }

  setControls(id: number, c: CarControls): void {
    this.#sim.setControls(id, c.throttle, c.steer, c.pitch, c.yaw, c.roll, c.jump, c.boost, c.handbrake, c.airPitchSafety);
  }

  setCarPreferences(id: number, p: CarPreferences): void {
    this.#sim.setCarPreferences(id, p.dodgeDeadzone, p.steeringSensitivity, p.airControlSensitivity);
  }

  step(ticks = 1): void {
    this.#sim.step(ticks);
  }

  /** Puts every car on a kickoff spot and the ball in the centre. Always pass a seed (determinism). */
  resetKickoff(seed: number): void {
    this.#sim.resetKickoff(seed);
  }

  /** Ticks left of the kickoff countdown (cars get no input while it runs; a match server starts it). */
  kickoffCountdown(): number {
    return this.#sim.kickoffCountdown();
  }

  ball(): BodyState {
    const m = this.#m;
    const a = this.#sim.ballState();
    return {
      pos: readVec(a, m.BALL_POS),
      vel: readVec(a, m.BALL_VEL),
      angVel: readVec(a, m.BALL_ANG_VEL),
      rot: readRot(a, m.BALL_ROT),
    };
  }

  setBall(state: Pick<BodyState, "pos" | "vel" | "angVel">): void {
    const m = this.#m;
    const a = new Float32Array(m.BALL_SIZE);
    a.set([state.pos.x, state.pos.y, state.pos.z], m.BALL_POS);
    a.set([state.vel.x, state.vel.y, state.vel.z], m.BALL_VEL);
    a.set([state.angVel.x, state.angVel.y, state.angVel.z], m.BALL_ANG_VEL);
    a.set([1, 0, 0, 0, 1, 0, 0, 0, 1], m.BALL_ROT);
    this.#sim.setBallState(a);
  }

  /** Places a car: position, velocity, rotation and boost; its jump and dodge state go back to the defaults. */
  setCar(id: number, state: Pick<CarState, "pos" | "vel" | "angVel" | "rot" | "boost">): void {
    const m = this.#m;
    const a = new Float32Array(m.CAR_SIZE);
    a.set([state.pos.x, state.pos.y, state.pos.z], m.CAR_POS);
    a.set([state.vel.x, state.vel.y, state.vel.z], m.CAR_VEL);
    a.set([state.angVel.x, state.angVel.y, state.angVel.z], m.CAR_ANG_VEL);
    const { forward: f, right: r, up: u } = state.rot;
    a.set([f.x, f.y, f.z, r.x, r.y, r.z, u.x, u.y, u.z], m.CAR_ROT);
    a[m.CAR_BOOST] = state.boost;
    this.#sim.setCarState(id, a);
  }

  car(id: number): CarState {
    const m = this.#m;
    const a = this.#sim.carState(id);
    const flag = (i: number): boolean => at(a, i) !== 0;
    const wheel = m.CAR_WHEEL_CONTACT;
    return {
      pos: readVec(a, m.CAR_POS),
      vel: readVec(a, m.CAR_VEL),
      angVel: readVec(a, m.CAR_ANG_VEL),
      rot: readRot(a, m.CAR_ROT),
      team: toTeam(at(a, m.CAR_TEAM)),
      boost: at(a, m.CAR_BOOST),
      onGround: flag(m.CAR_ON_GROUND),
      supersonic: flag(m.CAR_SUPERSONIC),
      boosting: flag(m.CAR_BOOSTING),
      demoed: flag(m.CAR_DEMOED),
      jumping: flag(m.CAR_IS_JUMPING),
      hasJumped: flag(m.CAR_HAS_JUMPED),
      doubleJumped: flag(m.CAR_HAS_DOUBLE_JUMPED),
      hasFlipped: flag(m.CAR_HAS_FLIPPED),
      airTimeSinceJump: at(a, m.CAR_AIR_TIME_SINCE_JUMP),
      hasFlipOrJump: flag(m.CAR_HAS_FLIP_OR_JUMP),
      hasFlipReset: flag(m.CAR_HAS_FLIP_RESET),
      worldWheelContacts: at(a, m.CAR_WORLD_WHEEL_CONTACTS),
      onRbActor: flag(m.CAR_ON_RB_ACTOR),
      flipping: flag(m.CAR_IS_FLIPPING),
      wheelContact: [flag(wheel), flag(wheel + 1), flag(wheel + 2), flag(wheel + 3)],
      groundNormal: readVec(a, m.CAR_GROUND_NORMAL),
    };
  }

  carConfig(id: number): CarConfig {
    const m = this.#m;
    const a = this.#sim.carConfig(id);
    return {
      hitboxSize: readVec(a, m.CFG_HITBOX_SIZE),
      hitboxOffset: readVec(a, m.CFG_HITBOX_OFFSET),
      frontWheel: {
        offset: readVec(a, m.CFG_FRONT_WHEEL_OFFSET),
        radius: at(a, m.CFG_FRONT_WHEEL_RADIUS),
        suspensionRest: at(a, m.CFG_FRONT_SUSPENSION_REST),
      },
      backWheel: {
        offset: readVec(a, m.CFG_BACK_WHEEL_OFFSET),
        radius: at(a, m.CFG_BACK_WHEEL_RADIUS),
        suspensionRest: at(a, m.CFG_BACK_SUSPENSION_REST),
      },
    };
  }

  boostPads(): BoostPadState[] {
    const m = this.#m;
    const a = this.#sim.boostPads();
    const pads: BoostPadState[] = [];
    for (let i = 0; i < a.length; i += m.PAD_SIZE) {
      pads.push({
        pos: readVec(a, i + m.PAD_POS),
        big: at(a, i + m.PAD_BIG) !== 0,
        active: at(a, i + m.PAD_ACTIVE) !== 0,
      });
    }
    return pads;
  }

  /** Goals, bumps and demos since the last call. */
  takeEvents(): GameEvent[] {
    const m = this.#m;
    const a = this.#sim.takeEvents();
    const events: GameEvent[] = [];
    for (let i = 0; i + 2 < a.length; i += 3) {
      const type = at(a, i);
      const x = at(a, i + 1);
      const y = at(a, i + 2);
      if (type === m.EVENT_GOAL) events.push({ type: "goal", scoringTeam: toTeam(x) });
      else if (type === m.EVENT_BUMP) events.push({ type: "bump", attacker: x, victim: y });
      else if (type === m.EVENT_DEMO) events.push({ type: "demo", attacker: x, victim: y });
    }
    return events;
  }

  saveState(): Uint8Array {
    return this.#sim.saveState();
  }

  /** The server's network state (engine/net/NetState.h): applies exactly onto this world. False if malformed. */
  applyNetState(bytes: Uint8Array): boolean {
    return this.#sim.applyNetState(bytes);
  }

  /** Writes a network state (what the server sends; for tests and local servers). */
  writeNetState(options: { readonly ball: boolean; readonly carIds: readonly number[]; readonly pads: boolean }): Uint8Array {
    return this.#sim.writeNetState(options.ball, Int32Array.from(options.carIds), options.pads);
  }

  /** A car's current controls. */
  carControls(id: number): CarControls {
    const c = this.#sim.carControls(id);
    return {
      throttle: at(c, 0),
      steer: at(c, 1),
      pitch: at(c, 2),
      yaw: at(c, 3),
      roll: at(c, 4),
      jump: at(c, 5) !== 0,
      boost: at(c, 6) !== 0,
      handbrake: at(c, 7) !== 0,
      airPitchSafety: at(c, 8) !== 0,
    };
  }

  loadState(bytes: Uint8Array): void {
    this.#sim.loadState(bytes);
  }
}
