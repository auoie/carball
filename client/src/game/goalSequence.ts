// The goal sequence's timing (notes/camera-respawn-goal.md §3): after a goal the game slows down along
// GameEvent_Soccar's ScoreSlomoCurve for its first 0.625 game seconds, and 3.0 game seconds (PostGoalTime: 360 ticks)
// later the goal replay starts, or the next kickoff. The physics keeps its 120 ticks per game second; only their real
// length changes, the same on the server (server/src/game.rs) and every client, keyed to the goal's server tick.
// The goal replay plays the recording at its own speed: 0.25 round the scoring hit (ReplayDirector_TA.ShouldSlomo).
import { TICK_RATE, TICK_SECONDS, frameTimes } from "../loop/fixedStep";
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

/** The tick after a goal at the curve's lowest point (its second key: 0.225 game s, the 28th tick) */
export const POST_GOAL_LOWEST_TICK = Math.round((SCORE_SLOMO_CURVE[1]?.[0] ?? 0) * TICK_RATE) + 1;

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

/** PostGoalTime: game seconds from the goal to the replay (or the next round) */
export const POST_GOAL_SECONDS = 3;

/**
 * The goal's slow motion on game time, as the game runs it where nothing else keys it (freeplay; RV-1):
 * GameEvent_Soccar_TA.PostGoalScored.Tick adds each frame's world time (UWorld's DeltaSeconds: dilated, clamped) to the
 * time since the goal and sets the next frame's dilation from the curve; the state timer fires PostGoalTime 3.0 s of
 * that time in. A frame whose ticks are capped at 5 still counts its whole world time, so at a low frame rate, or across
 * a hitch, the 3 s pass in fewer ticks. (Online, server and clients key the same curve to the goal's tick instead: equal
 * while no tick is dropped.)
 */
export class PostGoalClock {
  #seconds: number | null = null;
  #dilation = 1;

  /** A goal in this frame's ticks: its Tick runs from the next frame */
  start(): void {
    this.#seconds = 0;
  }

  /** No goal any more (a reset): full speed from the next frame */
  stop(): void {
    this.#seconds = null;
    this.#dilation = 1;
  }

  get active(): boolean {
    return this.#seconds !== null;
  }

  /** The frame's times (from its raw time, at the dilation the last frame set), and whether PostGoalTime is up */
  frame(rawSeconds: number): { readonly world: number; readonly real: number; readonly done: boolean } {
    const times = frameTimes(rawSeconds, this.#dilation);
    if (this.#seconds === null) return { ...times, done: false };
    this.#seconds += times.world;
    if (this.#seconds >= POST_GOAL_SECONDS) {
      this.#seconds = null;
      this.#dilation = 1;
      return { ...times, done: true };
    }
    this.#dilation = scoreSlomo(this.#seconds);
    return { ...times, done: false };
  }
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

/** Freeplay's countdown: Mutator_Freeplay_Base_TA sets CountdownTime 0, so Countdown's timer fires after 0.01 s and
 *  play starts by itself, the car held for the ticks in between (RV-26: not waiting for input) */
export const FREEPLAY_COUNTDOWN_TICKS = 2;
/** Freeplay's second ResetPickups, 0.1 s after the new round */
export const FREEPLAY_PAD_RESET_TICKS = 12;
/** The player's reset (Backspace): at most once per game second */
export const FREEPLAY_RESET_COOLDOWN = 1;
/** Freeplay's new ball stays at its spawn (z 100.49, at rest) for this many ticks, then falls and bounces (live,
 *  2026-10-09: held one tick, the floor 18 ticks later at -97 uu/s, a 2.85 uu hop; no freeze on landing, RV-57) */
export const FREEPLAY_BALL_HOLD_TICKS = 1;

/** Both of freeplay's nets have TeamNum 1, so either scores for the player's team (0): the explosion in its colour,
 *  the replay camera on a team-1 net's side (static analysis RV-41) */
export const FREEPLAY_NET_TEAM = 1;
