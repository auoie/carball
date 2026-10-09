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

/** What the match says on screen, if anything (the goal message comes first) */
export function matchMessage(state: Pick<MatchState, "phase" | "overtime" | "clockTicks" | "winner" | "forfeit">): string | null {
  if (state.phase === "ended") return `${state.winner === 1 ? "ORANGE" : "BLUE"} WINS${state.forfeit ? " BY FORFEIT" : ""}!`;
  if (state.phase === "countdown" && state.overtime && state.clockTicks === 0) return "OVERTIME";
  return null;
}
