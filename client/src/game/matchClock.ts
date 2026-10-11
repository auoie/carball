// The match clock as the game shows it (Active.UpdateGameTime: SecondsRemaining = int(t) + 1, 0 at t ≤ 0;
// notes/visual-timing.md VT-23): regulation 5:00 until the clock first runs, then int(t) + 1 (0:01 in the last
// second); overtime +0:00 until the clock runs, then +0:01 at once.
import type { MatchState } from "../net/protocol";

export const TICK_RATE = 120;
/** The regulation clock (GameTime 300 s), what it shows before it first runs */
const MATCH_TICKS = 300 * TICK_RATE;

/** The seconds the clock shows */
export function shownSeconds(state: Pick<MatchState, "overtime" | "clockTicks">): number {
  if (!state.overtime && state.clockTicks >= MATCH_TICKS) return MATCH_TICKS / TICK_RATE;
  return state.clockTicks <= 0 ? 0 : Math.floor(state.clockTicks / TICK_RATE) + 1;
}

export function formatClock(state: Pick<MatchState, "overtime" | "clockTicks">): string {
  const seconds = shownSeconds(state);
  const text = `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
  return state.overtime ? `+${text}` : text;
}

/** What the match says on screen, if anything (the goal message comes first; the winner has its banner: MIO-18) */
export function matchMessage(state: Pick<MatchState, "phase" | "overtime" | "clockTicks">): string | null {
  if (state.phase === "countdown" && state.overtime && state.clockTicks === 0) return "OVERTIME";
  return null;
}

/** The kickoff countdown's announcements (VT-24): "3", "2", "1" a second apart from a second in, "GO!" when the cars
 *  can drive, each with its beep. `before`: the whole seconds left last frame; `ticks`: the countdown's ticks left now.
 *  Returns the whole seconds left now, and what to announce (null: nothing). */
export function countdownStep(before: number, ticks: number): { readonly left: number; readonly say: string | null } {
  const left = Math.ceil(ticks / TICK_RATE);
  const say = left < before && left <= 3 ? (left === 0 ? "GO!" : String(left)) : null;
  return { left, say };
}
