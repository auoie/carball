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

/** "OVERTIME" in the clock's slot: overtime's kickoff, until its clock runs (HUD-3) */
export function overtimeLabel(state: Pick<MatchState, "phase" | "overtime" | "clockTicks">): boolean {
  return state.phase === "countdown" && state.overtime && state.clockTicks === 0;
}

/** The HUD's messages, verbatim (TAGame.int [Messages], notes/hud-menus.md HT-2; the message view upper-cases them) */
export const HUD_TEXT = {
  go: "Go!",
  overtime: "Overtime!",
  oneMinute: "One Minute Remaining!",
  thirtySeconds: "30 Seconds Remaining!",
} as const;

/** The clock's announcements (HUD-10): "One Minute Remaining!" as it shows 1:00, "30 Seconds Remaining!" at 0:30, then
 *  each of the last ten seconds, as the shown second steps down to it (regulation, while it runs). `before` and `now`:
 *  the shown seconds last frame and now */
export function clockWarning(before: number, now: number): string | null {
  if (now >= before) return null;
  if (now === 60) return HUD_TEXT.oneMinute;
  if (now === 30) return HUD_TEXT.thirtySeconds;
  if (now >= 1 && now <= 10) return String(now);
  return null;
}

/** The kickoff countdown's announcements (VT-24): "3", "2", "1" a second apart from a second in, "GO!" when the cars
 *  can drive, each with its beep. `before`: the whole seconds left last frame; `ticks`: the countdown's ticks left now.
 *  Returns the whole seconds left now, and what to announce (null: nothing). */
export function countdownStep(before: number, ticks: number): { readonly left: number; readonly say: string | null } {
  const left = Math.ceil(ticks / TICK_RATE);
  const say = left < before && left <= 3 ? (left === 0 ? HUD_TEXT.go : String(left)) : null;
  return { left, say };
}
