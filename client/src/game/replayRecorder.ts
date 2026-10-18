// The goal replay's recording (the game's Replay_TA records at 30 fps and replays them; here every tick): what each
// client frame drew, kept for the longest replay (10 s before the goal + 3 s after, and the replay's own lead).
// Frames are recorded as the prediction settles them: a server correction that replays older frames records them
// again, so the recording ends up with the corrected history.
import type { SoundEvent } from "../audio/detect";
import type { BodyState, CarState, CarWheels } from "../engine/world";

export interface RecordedCar extends BodyState {
  readonly team: CarState["team"];
  readonly boosting: boolean;
  readonly demoed: boolean;
  readonly supersonic: boolean;
  readonly wheelContact: CarState["wheelContact"];
  /** The engine's flip-reset count (the game's DodgesRefreshedCounter): a replay plays the effect where it goes up */
  readonly flipResets: number;
  /** The flags that hold until it lands: a replay hears its jumps, double jumps and dodges where they rise (SND-9) */
  readonly hasJumped: boolean;
  readonly hasFlipped: boolean;
  readonly doubleJumped: boolean;
  /** Its wheels as the vehicle had them (their suspension and steering), for a car drawn with its Blender model: its
   *  replay's wheels as live (RV-581); none for the others */
  readonly wheels?: CarWheels;
  /** Its last touch of the ball (the engine's tick; null none): a replay hears a ball hit where it moves on, from the
   *  frames as corrected (a touch the client learns only from a correction has no live sound: RX29C) */
  readonly lastTouch?: number | null;
}

export interface RecordedFrame {
  readonly cars: ReadonlyMap<number, RecordedCar>;
  readonly ball: BodyState;
  readonly ballExploded: boolean;
  /** The team whose car last touched the ball (its trail's colour: VT-10), null before any touch since the kickoff */
  readonly lastTouchTeam: CarState["team"] | null;
}

/** 16 s of frames */
export const RECORDED_FRAMES = 16 * 120;

/** The live sounds a replay hears again at their frames (RA1 §1: the game's replay bodies collide again, so its impacts
 *  sound again; §8, §9: the pickups and demolitions): the ball's bounces, the cars' landings, impacts and bumps,
 *  pickups, demolitions. Not the jumps and dodges, nor the ball's hits: the replay finds those in its frames (the cars'
 *  flags, SND-9; their last touches, from the corrected history: RX29C) */
export function replayedSound(event: SoundEvent): boolean {
  return event.kind !== "jump" && event.kind !== "doubleJump" && event.kind !== "flip" && event.kind !== "ballHit";
}

export class ReplayRecorder {
  readonly #frames: ({ readonly frame: number; readonly state: RecordedFrame } | undefined)[];
  /** The sounds heard live at each frame (kept apart from the frames: a correction recording a frame again keeps them) */
  readonly #sounds: ({ readonly frame: number; readonly events: SoundEvent[] } | undefined)[];
  #newest: number | null = null;

  constructor(readonly capacity = RECORDED_FRAMES) {
    this.#frames = new Array<{ frame: number; state: RecordedFrame } | undefined>(capacity);
    this.#sounds = new Array<{ frame: number; events: SoundEvent[] } | undefined>(capacity);
  }

  #slot(frame: number): number {
    return ((frame % this.capacity) + this.capacity) % this.capacity;
  }

  record(frame: number, state: RecordedFrame): void {
    const slot = this.#slot(frame);
    this.#frames[slot] = { frame, state };
    if (this.#sounds[slot]?.frame !== frame) this.#sounds[slot] = undefined; // (a lap on: the old frame's sounds gone)
    this.#newest = this.#newest === null ? frame : Math.max(this.#newest, frame);
  }

  /** The sounds a live frame played, kept at the newest frame recorded (those a replay hears again: replayedSound) */
  sounds(events: readonly SoundEvent[]): void {
    const frame = this.#newest;
    const kept = events.filter(replayedSound);
    if (frame === null || kept.length === 0) return;
    const slot = this.#slot(frame);
    const entry = this.#sounds[slot];
    if (entry?.frame === frame) entry.events.push(...kept);
    else this.#sounds[slot] = { frame, events: kept };
  }

  /** The sounds kept at a frame (none: never, or overwritten) */
  soundsAt(frame: number): readonly SoundEvent[] {
    const entry = this.#sounds[this.#slot(frame)];
    return entry?.frame === frame ? entry.events : [];
  }

  /** The recorded frame, or undefined (never recorded, or overwritten) */
  at(frame: number): RecordedFrame | undefined {
    const entry = this.#frames[((frame % this.capacity) + this.capacity) % this.capacity];
    return entry?.frame === frame ? entry.state : undefined;
  }

  /** The nearest recorded frame at or before `frame`, within `within` frames */
  before(frame: number, within = 8): RecordedFrame | undefined {
    for (let f = frame; f >= frame - within; f--) {
      const state = this.at(f);
      if (state) return state;
    }
    return undefined;
  }

  /** The nearest recorded frame after `frame`, within `within` frames (the recording's first, for a replay beginning
   *  before this page drew any frame) */
  after(frame: number, within = this.capacity): RecordedFrame | undefined {
    for (let f = frame + 1; f <= frame + within; f++) {
      const state = this.at(f);
      if (state) return state;
    }
    return undefined;
  }
}

/** A car as recorded */
/** The team of the car that last touched the ball (the newest touch tick of any car's: HitTeamNum, VT-10), null before
 *  any since the kickoff */
export function lastTouchTeam(world: {
  carIds(): number[];
  car(id: number): Pick<CarState, "team">;
  carLastBallTouchTick(id: number): number | null;
}): CarState["team"] | null {
  let newest = -Infinity;
  let team: CarState["team"] | null = null;
  for (const id of world.carIds()) {
    const tick = world.carLastBallTouchTick(id);
    if (tick !== null && tick > newest) {
      newest = tick;
      team = world.car(id).team;
    }
  }
  return team;
}

/** Free play's last touch's team: the player's garage team once its car has touched the ball (its car is the engine's
 *  team 0 for the kickoff spots, painted in the garage's colour), null before */
export function freeplayTouchTeam(world: Parameters<typeof lastTouchTeam>[0], team: CarState["team"]): CarState["team"] | null {
  return lastTouchTeam(world) === null ? null : team;
}

/** A car as a replay keeps it (`wheels`: its vehicle's, for a car whose drawn wheels follow them) */
export function recordCar(car: CarState, wheels: CarWheels | null = null, lastTouch: number | null = null): RecordedCar {
  const { pos, vel, angVel, rot, team, boosting, demoed, supersonic, wheelContact, flipResets, hasJumped, hasFlipped, doubleJumped } = car;
  const recorded = { pos, vel, angVel, rot, team, boosting, demoed, supersonic, wheelContact, flipResets, hasJumped, hasFlipped, doubleJumped, lastTouch };
  return wheels ? { ...recorded, wheels } : recorded;
}
