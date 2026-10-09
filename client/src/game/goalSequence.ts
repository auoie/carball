// The goal sequence's timing (notes/camera-respawn-goal.md §3): after a goal the game slows down along
// GameEvent_Soccar's ScoreSlomoCurve for its first 0.625 game seconds, and 3.0 game seconds (PostGoalTime: 360 ticks)
// later the goal replay starts, or the next kickoff. The physics keeps its 120 ticks per game second; only their real
// length changes, the same on the server (server/src/game.rs) and every client, keyed to the goal's server tick.
// The goal replay plays the recording at its own speed: 0.25 round the scoring hit (ReplayDirector_TA.ShouldSlomo).
import { TICK_RATE, TICK_SECONDS } from "../loop/fixedStep";
import type { ReplayPlan } from "../net/protocol";

/** PostGoalTime 3.0 game s: the goal replay (or the next kickoff) starts this many ticks after the goal */
export const POST_GOAL_TICKS = 3 * TICK_RATE;

/** ScoreSlomoCurve (Archetypes.GameEvent.GameEvent_Soccar): (game seconds since the goal, time dilation), linear,
 *  clamped to its end values outside */
const SCORE_SLOMO_CURVE: readonly (readonly [number, number])[] = [
  [0.125, 1],
  [0.225, 0.1875],
  [0.625, 1],
];

/** The time dilation `gameSeconds` after a goal */
export function scoreSlomo(gameSeconds: number): number {
  const first = SCORE_SLOMO_CURVE[0];
  if (!first || gameSeconds <= first[0]) return first?.[1] ?? 1;
  for (let i = 1; i < SCORE_SLOMO_CURVE.length; i++) {
    const [x0, y0] = SCORE_SLOMO_CURVE[i - 1] ?? [0, 1];
    const [x1, y1] = SCORE_SLOMO_CURVE[i] ?? [0, 1];
    if (gameSeconds <= x1) return y0 + ((y1 - y0) * (gameSeconds - x0)) / (x1 - x0);
  }
  return SCORE_SLOMO_CURVE.at(-1)?.[1] ?? 1;
}

/** The time dilation of the `n`-th tick after a goal's (n = 1 ..): the curve at the tick's start (game time
 *  (n - 1) / 120), as PostGoalScored.Tick sets it for the next frame; 1 outside the 360 ticks */
export function postGoalDilation(n: number): number {
  return n >= 1 && n <= POST_GOAL_TICKS ? scoreSlomo((n - 1) / TICK_RATE) : 1;
}

/** Real seconds the `n`-th tick after a goal's lasts */
export function postGoalTickSeconds(n: number): number {
  return TICK_SECONDS / postGoalDilation(n);
}

/** ReplayDirector archetype SlomoTimeDilation: the goal replay's speed round the scoring hit */
export const REPLAY_SLOMO = 0.25;

/** The replay's speed at replay tick `tick` */
export function replayDilation(plan: ReplayPlan, tick: number): number {
  return plan.slomo.some(([from, to]) => tick > from && tick < to) ? REPLAY_SLOMO : 1;
}

/** Real seconds the replay lasts: its length, each slowed stretch four times over (L + 3 S_slomo) */
export function replaySeconds(plan: ReplayPlan): number {
  const slowed = plan.slomo.reduce((s, [from, to]) => s + Math.max(0, Math.min(to, plan.endTick) - Math.max(from, plan.startTick)), 0);
  return (plan.endTick - plan.startTick + slowed * (1 / REPLAY_SLOMO - 1)) / TICK_RATE;
}
