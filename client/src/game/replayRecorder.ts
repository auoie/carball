// The goal replay's recording (the game's Replay_TA records at 30 fps and replays them; here every tick): what each
// client frame drew, kept for the longest replay (10 s before the goal + 3 s after, and the replay's own lead).
// Frames are recorded as the prediction settles them: a server correction that replays older frames records them
// again, so the recording ends up with the corrected history.
import type { BodyState, CarState } from "../engine/world";

export interface RecordedCar extends BodyState {
  readonly team: CarState["team"];
  readonly boosting: boolean;
  readonly demoed: boolean;
  readonly supersonic: boolean;
  readonly wheelContact: CarState["wheelContact"];
  /** The engine's flip-reset count (the game's DodgesRefreshedCounter): a replay plays the effect where it goes up */
  readonly flipResets: number;
}

export interface RecordedFrame {
  readonly cars: ReadonlyMap<number, RecordedCar>;
  readonly ball: BodyState;
  readonly ballExploded: boolean;
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
}

/** A car as recorded */
export function recordCar(car: CarState): RecordedCar {
  const { pos, vel, angVel, rot, team, boosting, demoed, supersonic, wheelContact, flipResets } = car;
  return { pos, vel, angVel, rot, team, boosting, demoed, supersonic, wheelContact, flipResets };
}
