// A run of a custom training pack (notes/custom-training.md §2, CTR-5..13): its playlist (the pack's order, or shuffled
// keeping the current shot), the shot's state (Countdown until input, Active with its timer, the shot's end, Finished),
// each shot's progress (NotAttempted, Attempted, Completed: only rising), the striker's and goalie's rules; the world's
// part (placing, holding, launching) is the free play session's (src/game/freeplay.ts). Game seconds throughout.
import { type Vec3, scale } from "../math/vec";
import { type Shot, type TrainingPack, direction, mirrorShot } from "./pack";
import type { Variance } from "./variance";

/** A shot's progress (TrainingPackProgress_TA): only rises; Attempted looks like NotAttempted on the pips */
export const ShotStatus = { NotAttempted: 0, Attempted: 1, Completed: 2 } as const;
export type ShotStatus = (typeof ShotStatus)[keyof typeof ShotStatus];

/** The shot's state: held until input, playing, its end (the explosion's slow motion, the replay), the pack done */
export type RunState = "countdown" | "active" | "ended" | "finished";

/** How a shot ended: the striker's goal or the goalie's save; a goal against the goalie, or the timer run out */
export type ShotResult = "success" | "failure";

/** The editor's tests (notes/training-editor.md §1.2, §1.4, TE-2: PlayTestType): Test Shot plays the one shot over and
 *  over, Test Sequence loops the pack from its first shot; neither ends, nor marks a shot completed (no points) */
export type TestKind = "shot" | "sequence";

/** The goalie's save: the ball touched this long ago (s) and not heading for the goal (TA:36168); the speed under which
 *  it heads nowhere (uu/s), the goal's depth behind its line and half width (IsBallMovingTowardsGoal, TA:34644) */
export const GOALIE = { touchedAgo: 1, minSpeed: 200, depth: 870, halfWidth: 960 } as const;

/** The goals' line (uu: the goal's Location, blue's at -y) */
const GOAL_Y = 5120;

/** Whether the ball heads for the goal at `goalSign` × GOAL_Y (IsBallMovingTowardsGoal: its 2D velocity's direction
 *  closer to the goal's back than to either post's line, from where the ball is) */
export function movingTowardGoal(pos: Vec3, vel: Vec3, goalSign: 1 | -1): boolean {
  if (Math.hypot(vel.x, vel.y, vel.z) <= GOALIE.minSpeed) return false;
  const norm = (x: number, y: number): [number, number] => {
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };
  const goalY = goalSign * GOAL_Y;
  // (the goal's facing into the field: -goalSign along y; its back 870 behind the line)
  const backY = goalY + goalSign * GOALIE.depth;
  const d = norm(-pos.x, backY - pos.y);
  const m = norm(vel.x, vel.y);
  const r = norm(GOALIE.halfWidth - pos.x, goalY - pos.y);
  const l = norm(-GOALIE.halfWidth - pos.x, goalY - pos.y);
  const dot = (a: [number, number], b: [number, number]): number => a[0] * b[0] + a[1] * b[1];
  return dot(d, m) > Math.min(dot(d, r), dot(d, l));
}

/** The pack's order shuffled (ArrayFuncs.ShuffleArray: Fisher-Yates from the end, j = Rand(i)) */
export function shuffled(order: readonly number[], random: () => number): number[] {
  const a = [...order];
  for (let i = a.length; i > 0;) {
    const j = Math.floor(random() * i);
    i -= 1;
    [a[i], a[j]] = [a[j] ?? 0, a[i] ?? 0];
  }
  return a;
}

export class TrainingRun {
  readonly pack: TrainingPack;
  /** The editor's test this run is (null: the pack played) */
  readonly test: TestKind | null;
  /** Each shot's progress, by its place in the pack */
  readonly status: ShotStatus[];
  #order: number[];
  #position = 0;
  #shuffle = false;
  #mirror = false;
  #state: RunState = "countdown";
  /** s left on the shot's timer (Active only); whether it ran out (the shot fails at the ball's next ground contact) */
  #timeLeft = 0;
  #timedOut = false;
  /** Since the countdown began, and since the shot began (s) */
  #sinceCountdown = 0;
  #sinceStart = 0;
  /** When (s since the shot's start) the car first and last touched the ball; null: not yet */
  #firstTouch: number | null = null;
  #lastTouch: number | null = null;
  /** Every shot completed for the first time: the next shot's start ends the pack instead (bShouldEndTraining) */
  #endPending = false;
  #result: ShotResult | null = null;
  /** The shot's variance as drawn (kept through retries and the mirror; drawn again by a countdown's reset or a new
   *  shot: CachedLocationModifiers) */
  #variance: Variance | null = null;

  /** `stored`: the pack's progress kept from before (anything short of Completed starts over: ClearUncompletedShots);
   *  `test`: an editor's test (its progress none) */
  constructor(pack: TrainingPack, stored: readonly ShotStatus[] = [], test: TestKind | null = null) {
    this.pack = pack;
    this.test = test;
    this.status = pack.shots.map((_, i) => (stored[i] === ShotStatus.Completed && !test ? ShotStatus.Completed : ShotStatus.NotAttempted));
    this.#order = pack.shots.map((_, i) => i);
    this.#startCountdown();
  }

  get state(): RunState {
    return this.#state;
  }

  /** The shot's place in the pack (SHOT n / total: n - 1) */
  get shotIndex(): number {
    return this.#order[this.#position] ?? 0;
  }

  /** The shot as played (mirrored when the mirror is on) */
  get shot(): Shot {
    const s = this.pack.shots[this.shotIndex] ?? this.pack.shots[0];
    if (!s) throw new Error("a pack without shots");
    return this.#mirror ? mirrorShot(s) : s;
  }

  get shuffle(): boolean {
    return this.#shuffle;
  }

  get mirror(): boolean {
    return this.#mirror;
  }

  /** s left on the timer (the time limit in Countdown); null: the shot never times out */
  get timeLeft(): number | null {
    return this.shot.timeLimit > 0 ? Math.max(0, this.#state === "countdown" ? this.shot.timeLimit : this.#timeLeft) : null;
  }

  get timedOut(): boolean {
    return this.#timedOut;
  }

  get result(): ShotResult | null {
    return this.#result;
  }

  get touched(): boolean {
    return this.#firstTouch !== null;
  }

  /** COMPLETION x %: round(100 × completed / total) */
  get completion(): number {
    return Math.round((100 * this.status.filter((s) => s === ShotStatus.Completed).length) / this.status.length);
  }

  /** Whether input may start the shot now (`inputDelay`: the setting's least time in Countdown, s) */
  canStart(inputDelay: number): boolean {
    return this.#state === "countdown" && this.#sinceCountdown >= inputDelay;
  }

  /** The shot started (input, or a touch in Countdown): Active, its timer from now, the shot Attempted */
  begin(): void {
    if (this.#state !== "countdown") return;
    this.#state = "active";
    this.#timeLeft = this.shot.timeLimit;
    this.#sinceStart = 0;
    if (!this.test) this.#raise(this.shotIndex, ShotStatus.Attempted);
  }

  /** `seconds` of game time: Countdown's wait, or the shot's timer (out at 0: CTR-7) */
  tick(seconds: number): void {
    if (this.#state === "countdown") this.#sinceCountdown += seconds;
    if (this.#state !== "active") return;
    this.#sinceStart += seconds;
    if (this.shot.timeLimit > 0) {
      this.#timeLeft -= seconds;
      if (this.#timeLeft <= 0) this.#timedOut = true;
    }
  }

  /** The car touched the ball this tick */
  touch(): void {
    if (this.#state !== "active" && this.#state !== "countdown") return;
    this.#firstTouch ??= this.#sinceStart;
    this.#lastTouch = this.#sinceStart;
  }

  /** The goalie's save this tick: the ball touched over a second ago, not heading for the own goal (TA:36168) */
  saved(ball: { readonly pos: Vec3; readonly vel: Vec3 }): boolean {
    if (this.pack.type !== "goalie" || this.#state !== "active" || this.#lastTouch === null) return false;
    return this.#sinceStart - this.#lastTouch > GOALIE.touchedAgo && !movingTowardGoal(ball.pos, ball.vel, -1);
  }

  /** Where a goal counts this tick (the target's sign along y, or null: none): the striker's (the orange goal) once the
   *  car has touched the ball, untouched entries ignored; any entry into the goalie's own (blue) goal (CTR-8, CTR-9) */
  scoringGoal(): 1 | -1 | null {
    if (this.#state !== "active" && this.#state !== "countdown") return null;
    if (this.pack.type === "goalie") return -1;
    return this.touched ? 1 : null;
  }

  /** The shot's end: a success completes it (the pack ends with its last shot completed for the first time) */
  end(result: ShotResult): void {
    if (this.#state !== "active" && this.#state !== "countdown") return;
    this.#state = "ended";
    this.#result = result;
    if (result === "success" && !this.test) {
      const before = this.status.every((s) => s === ShotStatus.Completed);
      this.#raise(this.shotIndex, ShotStatus.Completed);
      if (!before && this.status.every((s) => s === ShotStatus.Completed)) this.#endPending = true;
    }
  }

  /** The shot's end played out (OnCurrentShotCompleted): the next shot in the playlist (wrapping), or Finished; Test
   *  Shot's the same shot again */
  advance(): void {
    if (this.test === "shot") {
      this.#startCountdown();
      return;
    }
    if (this.#endPending) {
      this.#endPending = false;
      this.#state = "finished";
      return;
    }
    this.#move(1);
  }

  /** Next (+1) or previous (-1) shot, wrapping, at once from any state (CTR-13) */
  navigate(step: 1 | -1): void {
    if (this.#state === "finished") return;
    this.#move(step);
  }

  /** The shot at this place in the pack (Select Shot: the pack's order) */
  select(index: number): void {
    const at = this.#order.indexOf(index);
    if (at < 0) return;
    this.#position = at;
    this.#mirror = false;
    this.#variance = null;
    this.#startCountdown();
  }

  /** Reset: in Countdown it re-rolls the variance (the same shot again); during or after a shot, the same shot again,
   *  its variance kept (CTR-11) */
  retry(): void {
    if (this.#state === "finished") return;
    if (this.#state === "countdown") this.#variance = null;
    this.#startCountdown();
  }

  /** The shot's variance: as drawn for it, else drawn now by `roll` */
  variance(roll: () => Variance): Variance {
    return (this.#variance ??= roll());
  }

  /** Shuffle on (the pack's order shuffled, the current shot kept) or off (the pack's order, the same shot) */
  toggleShuffle(random: () => number = Math.random): void {
    const current = this.shotIndex;
    this.#shuffle = !this.#shuffle;
    const order = this.pack.shots.map((_, i) => i);
    this.#order = this.#shuffle ? shuffled(order, random) : order;
    this.#position = Math.max(0, this.#order.indexOf(current));
  }

  /** Mirror on or off for this shot (kept until the shot changes), the shot started over */
  toggleMirror(): void {
    if (this.#state === "finished") return;
    this.#mirror = !this.#mirror;
    this.#startCountdown();
  }

  /** The pack from its first shot, its progress kept (Restart Training) or cleared (Reset Progress); Test Shot's the same
   *  shot again (RestartPlayTest: only Test Sequence starts over at shot 1) */
  restart(clearProgress = false): void {
    if (clearProgress) this.status.fill(ShotStatus.NotAttempted);
    this.#endPending = false;
    if (this.test !== "shot") this.#position = 0;
    this.#mirror = false;
    this.#variance = null;
    this.#startCountdown();
  }

  #move(step: 1 | -1): void {
    const n = this.#order.length;
    this.#position = (((this.#position + step) % n) + n) % n;
    this.#mirror = false;
    this.#variance = null;
    this.#startCountdown();
  }

  #startCountdown(): void {
    this.#state = "countdown";
    this.#sinceCountdown = 0;
    this.#sinceStart = 0;
    this.#timeLeft = this.shot.timeLimit;
    this.#timedOut = false;
    this.#firstTouch = null;
    this.#lastTouch = null;
    this.#result = null;
  }

  #raise(index: number, status: ShotStatus): void {
    if ((this.status[index] ?? 0) < status) this.status[index] = status;
  }
}

/** The ball's launch at the shot's start: vector(launch) × speed, no spin (Ball_GameEditor_TA.Fire) */
export function launchVelocity(shot: Shot): Vec3 {
  return scale(direction(shot.ball.launch), shot.ball.speed);
}
