// The match clock as the game shows it: regulation counts down in whole seconds, rounded up (5:00 until the clock
// starts, 0:01 in the last second); overtime counts up from +0:00.
import type { MatchState } from "../net/protocol";

export const TICK_RATE = 120;

export function formatClock(state: Pick<MatchState, "overtime" | "clockTicks">): string {
  const seconds = state.overtime ? Math.floor(state.clockTicks / TICK_RATE) : Math.ceil(state.clockTicks / TICK_RATE);
  const text = `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
  return state.overtime ? `+${text}` : text;
}

/** What the match says on screen, if anything (the goal message comes first) */
export function matchMessage(state: Pick<MatchState, "phase" | "overtime" | "clockTicks" | "winner" | "forfeit">): string | null {
  if (state.phase === "ended") return `${state.winner === 1 ? "ORANGE" : "BLUE"} WINS${state.forfeit ? " BY FORFEIT" : ""}!`;
  if (state.phase === "countdown" && state.overtime && state.clockTicks === 0) return "OVERTIME";
  return null;
}
