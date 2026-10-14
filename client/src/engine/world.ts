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
  /** The dodge's forward input, made a byte on its own: the game's -pitch from before the air pitch safety, so
   *  q(-pitch), not -q(pitch) (the byte scales by 127 up, 128 down; controls audit C-2). Without it: -pitch. */
  readonly dodgeForward?: number;
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

/** What a wheel's ray touches. */
export type WheelSurface = "none" | "arena" | "ball" | "car";
const WHEEL_SURFACES: readonly WheelSurface[] = ["none", "arena", "ball", "car"];

/** What a grounded car stands on, when it's not the arena: the ball, or a car (by id). */
export type RbActor = { readonly kind: "ball" } | { readonly kind: "car"; readonly id: number };

/** A respawn spot (respawnSpots, SpawnSelection). */
export interface RespawnSpot {
  readonly pos: Vec3;
  readonly yaw: number;
}

/** A side of the field for respawning, from the car's team's own point of view (as it faces the other goal). */
export type SpawnSide = "left" | "right";
const SPAWN_SIDES: readonly (SpawnSide | null)[] = [null, "left", "right"];

/** A demolished car's respawn spot selection: for the first 2.5 s of the 3 s, a push of the steer input past 0.3
 *  picks the next spot on that side (the inner one first); 0.5 s before the respawn the spot locks in. */
export interface SpawnSelection {
  readonly side: SpawnSide | null;
  readonly index: number; // the spot on that side: respawnSpots(team, side)[index]
  readonly locked: RespawnSpot | null;
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
  /** What each wheel touches (RocketSim's order, as wheelContact: front right, front left, back right, back left) */
  readonly wheelGround: readonly [WheelSurface, WheelSurface, WheelSurface, WheelSurface];
  /** When on a car or the ball: which (the one most wheels touch; a tie goes to the ball) */
  readonly rbActor: RbActor | null;
  /** Each wheel touching something (RocketSim's order: front right, front left, back right, back left) */
  readonly wheelContact: readonly [boolean, boolean, boolean, boolean];
  /** Average contact normal of the wheels touching something, else straight up (Vehicle_TA.GetGroundNormal). */
  readonly groundNormal: Vec3;
  /** Each wheel's suspension ray-hit normal, zero when not touching (RocketSim's order: the landing trigger's, IT-5) */
  readonly wheelNormals: readonly [Vec3, Vec3, Vec3, Vec3];
  /** Seconds until a demolished car respawns */
  readonly demoRespawnTimer: number;
  readonly spawnSelection: SpawnSelection;
  /** Landings on the ball or a car that gave the jump back (wraps at 65536): a change is a flip reset (the game's
   *  DodgesRefreshedCounter, which drives its indicator) */
  readonly flipResets: number;
  /** Placements by a kickoff reset, a respawn or a state set (wraps at 65536): a server correction that changes it
   *  is a new car there, drawn at once; every other correction is smoothed (as the game's) */
  readonly spawnCount: number;
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

/** What a car touched (takeImpacts) */
export type ImpactPartner = "world" | "ball" | "car";

/** The ball's own impacts' `car` (with the world: notes/impact-triggers.md §2b, RV-172) */
export const BALL_IMPACT = -1;

/** One car's contacts with one partner in one physics step, as the game's HandleCollision gets them (engine patch 96:
 *  notes/impact-triggers.md IT-1..3; speeds of 50 uu/s or more); or the ball's with the world */
export interface Impact {
  readonly tick: number;
  /** the car's id, or BALL_IMPACT for the ball's own */
  readonly car: number;
  readonly partner: ImpactPartner;
  /** the partner car's id, for a car */
  readonly partnerId: number;
  /** |dv . n|, uu/s */
  readonly speed: number;
  readonly pos: Vec3;
  /** from the partner toward the car */
  readonly normal: Vec3;
}

/** A car's boost at a kickoff or respawn (RLConst BOOST_SPAWN_AMOUNT: a third of the tank) */
export const BOOST_SPAWN_AMOUNT = 100 / 3;

export interface BoostPadState {
  readonly pos: Vec3;
  readonly big: boolean;
  readonly active: boolean;
  /** Seconds until a taken pad is back (4 small, 10 big) */
  readonly cooldown: number;
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
    this.#sim.setControls(id, c.throttle, c.steer, c.pitch, c.yaw, c.roll, c.jump, c.boost, c.handbrake, c.airPitchSafety, c.dodgeForward ?? Number.NaN);
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

  /** Freeplay's new round: car i at the session's kickoff spots S[(spawnIndex + i) mod 10] (S: each of the 5 spots,
   *  shuffled from `seed`, as blue's, then mirrored), the ball at its spawn (z 100.49, at rest, to fall), the pads back. */
  resetFreeplay(seed: number, spawnIndex: number): void {
    this.#sim.resetFreeplay(seed, spawnIndex);
  }

  /** The tick (as `tick` after it) a car last touched the ball, or null: never (for the goal replay's plan). */
  carLastBallTouchTick(id: number): number | null {
    const tick = this.#sim.carLastBallTouchTick(id);
    return tick < 0 ? null : tick;
  }

  /** Every pad back (freeplay's second ResetPickups, 0.1 s after the new round). */
  resetBoostPads(): void {
    this.#sim.resetBoostPads();
  }

  /** Freeplay's Unlimited boost: never used up, 100 at every spawn (every car at 100 now); off: the game's rates. */
  setUnlimitedBoost(on: boolean): void {
    this.#sim.setUnlimitedBoost(on);
  }

  /** The match's end (FreezePawns): while frozen nothing simulates; ticks still count (online: the server's phase) */
  setFrozen(on: boolean): void {
    this.#sim.setFrozen(on);
  }

  /** Podium mode (EnablePodiumMode, the podium and after: PD1): every car held at its X/Y, Z and rotation free, its
   *  jumps short (online: the server's phase, so the prediction agrees) */
  setPodium(on: boolean): void {
    this.#sim.setPodium(on);
  }

  /** Demolitions on (the default: an authority, freeplay) or off (an online client's prediction: the server demolishes,
   *  supersonic hits predicted as bumps: RV-112). */
  setDemolitions(on: boolean): void {
    this.#demolitions = on;
    this.#sim.setDemolitions(on);
  }

  /** Whether demolitions are on (this world's own setting: kept over a loaded state's, RV-137) */
  #demolitions = true;

  /** Ticks left of the kickoff countdown (cars get no input while it runs; a match server starts it). */
  kickoffCountdown(): number {
    return this.#sim.kickoffCountdown();
  }

  /** Starts (or ends, 0) the kickoff countdown: cars get no input while it runs. */
  setKickoffCountdown(ticks: number): void {
    this.#sim.setKickoffCountdown(ticks);
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

  /** Placements of the ball by a reset or a state set (see CarState.spawnCount) */
  ballSpawnCount(): number {
    return at(this.#sim.ballState(), this.#m.BALL_SPAWN_COUNT);
  }

  /** The ball scored and exploded: frozen and not colliding (not drawn) until a reset or a ball state set. */
  ballExploded(): boolean {
    return at(this.#sim.ballState(), this.#m.BALL_EXPLODED) !== 0;
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
    const surface = (i: number): WheelSurface => WHEEL_SURFACES[at(a, m.CAR_WHEEL_GROUND + i)] ?? "none";
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
      wheelGround: [surface(0), surface(1), surface(2), surface(3)],
      rbActor: !flag(m.CAR_ON_RB_ACTOR) ? null : at(a, m.CAR_RB_ACTOR) < 0 ? { kind: "ball" } : { kind: "car", id: at(a, m.CAR_RB_ACTOR) },
      flipping: flag(m.CAR_IS_FLIPPING),
      wheelContact: [flag(wheel), flag(wheel + 1), flag(wheel + 2), flag(wheel + 3)],
      groundNormal: readVec(a, m.CAR_GROUND_NORMAL),
      wheelNormals: [readVec(a, m.CAR_WHEEL_NORMALS), readVec(a, m.CAR_WHEEL_NORMALS + 3), readVec(a, m.CAR_WHEEL_NORMALS + 6), readVec(a, m.CAR_WHEEL_NORMALS + 9)],
      demoRespawnTimer: at(a, m.CAR_DEMO_RESPAWN_TIMER),
      spawnSelection: {
        side: SPAWN_SIDES[at(a, m.CAR_DEMO_SPAWN_SIDE)] ?? null,
        index: at(a, m.CAR_DEMO_SPAWN_INDEX),
        locked: flag(m.CAR_PRESPAWN_SET) ? { pos: readVec(a, m.CAR_PRESPAWN_POS), yaw: at(a, m.CAR_PRESPAWN_YAW) } : null,
      },
      flipResets: at(a, m.CAR_FLIP_RESETS),
      spawnCount: at(a, m.CAR_SPAWN_COUNT),
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
        cooldown: at(a, i + m.PAD_COOLDOWN),
      });
    }
    return pads;
  }

  /** A team's respawn spots: all, or one side's (the team's own left or right; the inner spot first). */
  respawnSpots(team: Team, side: SpawnSide | null = null): RespawnSpot[] {
    const m = this.#m;
    const a = this.#sim.respawnSpots(team, side === null ? 0 : side === "left" ? 1 : 2);
    const spots: RespawnSpot[] = [];
    for (let i = 0; i < a.length; i += m.SPOT_SIZE) spots.push({ pos: readVec(a, i + m.SPOT_POS), yaw: at(a, i + m.SPOT_YAW) });
    return spots;
  }

  /** The impacts since the last call (engine patch 96: the ball's own too, as BALL_IMPACT), oldest first */
  takeImpacts(): Impact[] {
    const m = this.#m;
    const a = this.#sim.takeImpacts();
    const out: Impact[] = [];
    for (let i = 0; i + m.IMPACT_SIZE <= a.length; i += m.IMPACT_SIZE) {
      const kind = at(a, i + m.IMPACT_KIND);
      out.push({
        tick: at(a, i + m.IMPACT_TICK),
        car: at(a, i + m.IMPACT_CAR),
        partner: kind === 1 ? "ball" : kind === 2 ? "car" : "world",
        partnerId: at(a, i + m.IMPACT_PARTNER),
        speed: at(a, i + m.IMPACT_SPEED),
        pos: readVec(a, i + m.IMPACT_POS),
        normal: readVec(a, i + m.IMPACT_NORMAL),
      });
    }
    return out;
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

  /** The server's network state (engine/net/NetState.h): laid over this world (the compact form: a value it holds that
   *  sends the same stays as it is; the exact form: exactly). False if malformed. */
  applyNetState(bytes: Uint8Array): boolean {
    return this.#sim.applyNetState(bytes);
  }

  /** Writes a network state (what the server sends; for tests and local servers). */
  writeNetState(options: { readonly ball: boolean; readonly carIds: readonly number[]; readonly pads: boolean; readonly exact?: boolean }): Uint8Array {
    return this.#sim.writeNetState(options.ball, Int32Array.from(options.carIds), options.pads, options.exact ?? false);
  }

  /** The cars the last applied network state held. */
  netStateCars(): number[] {
    return Array.from(this.#sim.netStateCars());
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
      ...(Number.isNaN(at(c, 9)) ? {} : { dodgeForward: at(c, 9) }),
    };
  }

  loadState(bytes: Uint8Array): void {
    this.#sim.loadState(bytes);
    // (a saved state carries its arena's mutators, the server's demolitions among them: this world's setting again,
    // or an online client predicts demolitions after every join and leave, RV-137)
    if (!this.#demolitions) this.#sim.setDemolitions(false);
  }
}
