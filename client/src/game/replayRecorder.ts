// The goal replay's recording (the game's Replay_TA records at 30 fps and replays them; here every tick): what each
// client frame drew, kept for the longest replay (10 s before the goal + 3 s after, and the replay's own lead).
// Frames are recorded as the prediction settles them: a server correction that replays older frames records them
// again, so the recording ends up with the corrected history.
import type { BodyState, CarState, CarWheels } from "../engine/world";

export interface RecordedCar extends BodyState {
  readonly team: CarState["team"];
  readonly boosting: boolean;
  readonly demoed: boolean;
  readonly supersonic: boolean;
  readonly wheelContact: CarState["wheelContact"];
  /** The engine's flip-reset count (the game's DodgesRefreshedCounter): a replay plays the effect where it goes up */
  readonly flipResets: number;
  /** Its wheels as the vehicle had them (their suspension and steering), for a car drawn with its Blender model: its
   *  replay's wheels as live (RV-581); none for the others */
  readonly wheels?: CarWheels;
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

export class ReplayRecorder {
  readonly #frames: ({ readonly frame: number; readonly state: RecordedFrame } | undefined)[];

  constructor(readonly capacity = RECORDED_FRAMES) {
    this.#frames = new Array<{ frame: number; state: RecordedFrame } | undefined>(capacity);
  }

  record(frame: number, state: RecordedFrame): void {
    this.#frames[((frame % this.capacity) + this.capacity) % this.capacity] = { frame, state };
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
export function lastTouchTeam(world: { carIds(): number[]; car(id: number): Pick<CarState, "team">; carLastBallTouchTick(id: number): number | null }): CarState["team"] | null {
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
export function recordCar(car: CarState, wheels: CarWheels | null = null): RecordedCar {
  const { pos, vel, angVel, rot, team, boosting, demoed, supersonic, wheelContact, flipResets } = car;
  const recorded = { pos, vel, angVel, rot, team, boosting, demoed, supersonic, wheelContact, flipResets };
  return wheels ? { ...recorded, wheels } : recorded;
}
