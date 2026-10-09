// The goal replay's plan (ReplayDirector_TA: GoalScored, GetReplayStartTime, ShouldSlomo, BuildFocusCars;
// notes/camera-respawn-goal.md GS-7..9), as the server plans it for a match (server/src/game.rs plan_replay): freeplay
// plans its own (no freeplay special case: it plays the replay unless the player skips goal replays).
import type { ReplayPlan } from "../net/protocol";
import { POST_GOAL_TICKS } from "./goalSequence";

/** Shown from the scoring touch less the padding, at most 10 s before the goal, at least 4 s + the padding (ticks) */
const MIN_REPLAY_TICKS = 4 * 120;
const MAX_REPLAY_TICKS = 10 * 120;
const REPLAY_PADDING_TICKS = 2 * 120;
/** Slowed round the scoring touch (SlomoPreScoreTime 0.25 s, SlomoPostScoreTime 0.1 s) and before the goal when a
 *  defender was close (SlomoDefendTime 0.25 s) */
const SLOMO_PRE_SCORE_TICKS = 30;
const SLOMO_POST_SCORE_TICKS = 12;
const SLOMO_DEFEND_TICKS = 30;
/** Ball touches kept (Ball_TA keeps 50) */
const MAX_TOUCHES = 50;

/** A run of one car's touches on the ball (consecutive ones by a car merged): its last tick */
export interface Touch {
  readonly car: number;
  readonly team: number;
  readonly tick: number;
}

/** The ball's touches this round, as runs per car (the game's touches, consecutive ones merged) */
export class TouchLog {
  #touches: Touch[] = [];
  readonly #last = new Map<number, number>();

  get touches(): readonly Touch[] {
    return this.#touches;
  }

  /** A car's last touch tick now (the engine's; null: never): a new one is a touch */
  update(car: number, team: number, lastTouch: number | null): void {
    if (lastTouch === null || this.#last.get(car) === lastTouch) return;
    this.#last.set(car, lastTouch);
    const last = this.#touches.at(-1);
    if (last?.car === car) this.#touches[this.#touches.length - 1] = { ...last, tick: lastTouch };
    else this.#touches.push({ car, team, tick: lastTouch });
    if (this.#touches.length > MAX_TOUCHES) this.#touches.shift();
  }

  /** A new ball (the round's reset) */
  clear(): void {
    this.#touches = [];
  }
}

/** The replay of a goal at `goalTick` scored by `team`; `ballSpawnTick`: when the round's ball appeared (the earliest
 *  start); `slomoForDefender`: a defender was close at a goal this match (SetSlomoForDefender, sticky) */
export function planReplay(touches: readonly Touch[], goalTick: number, team: number, ballSpawnTick: number, slomoForDefender: boolean): ReplayPlan {
  // The scoring touch: the newest by the scoring team, else the newest (DetermineScoreTouchIndex)
  let scoreHit = touches.findLastIndex((t) => t.team === team);
  if (scoreHit < 0) scoreHit = touches.length - 1;
  const hit = touches[scoreHit]?.tick ?? null;
  const start = Math.max(Math.min(hit ?? 0, goalTick - MIN_REPLAY_TICKS) - REPLAY_PADDING_TICKS, 0, goalTick - MAX_REPLAY_TICKS, ballSpawnTick);
  const end = goalTick + POST_GOAL_TICKS;
  const windows: [number, number][] = [];
  if (hit !== null) windows.push([hit - SLOMO_PRE_SCORE_TICKS, hit + SLOMO_POST_SCORE_TICKS]);
  if (slomoForDefender) windows.push([goalTick - SLOMO_DEFEND_TICKS, goalTick]);
  windows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const slomo: [number, number][] = [];
  for (const [a, b] of windows) {
    const [from, to] = [Math.max(a, start), Math.min(b, end)];
    if (to <= from) continue;
    const last = slomo.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else slomo.push([from, to]);
  }
  // The camera follows each car that touched the ball in the replay, in turn, up to the scoring touch
  const focus: { car: number; tick: number }[] = [];
  for (const t of touches.slice(0, scoreHit + 1)) {
    if (t.tick < start) continue;
    const run = focus.at(-1);
    if (run?.car === t.car) run.tick = t.tick;
    else focus.push({ car: t.car, tick: t.tick });
  }
  return { startTick: start, goalTick, endTick: end, scoringTeam: team, slomo, focus };
}
