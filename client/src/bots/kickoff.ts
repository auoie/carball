// The kickoff script "rows-v1" with the taker rule "nearest-left-v1" (ours, from the packages' nexto/SPEC.md §6): at the
// kickoff pause's first call the bot decides whether it takes (within 10 uu of the nearest car's distance to the ball, and
// its team's left one among those as near as it); a taker plays the script's rows from then, a row a call, while the
// pause lasts and the ball's y is exactly 0; the pause over, it's ready for the next.
import type { BotView } from "../local/bots";
import type { Controls8, KickoffScript } from "./manifest";

/** The script's rows, a row a call (its phases expanded in order) */
export function scriptRows(script: KickoffScript): Controls8[] {
  return script.phases.flatMap(([ticks, row]) => Array.from({ length: ticks }, () => row));
}

/** Whether the bot takes the kickoff: among the cars as near the ball as the nearest (within the tolerance), its team's
 *  left one (blue's largest x, orange's smallest) */
export function takesKickoff(view: BotView, tolerance: number): boolean {
  const { cars, ball } = view.state;
  const me = cars[view.self];
  if (!me) return false;
  const distance = cars.map((c) => Math.hypot(c.pos.x - ball.pos.x, c.pos.y - ball.pos.y));
  const mine = distance[view.self] ?? Infinity;
  if (Math.abs(Math.min(...distance) - mine) > tolerance) return false;
  return cars.every((c, j) => {
    if (j === view.self || c.team !== me.team || Math.abs((distance[j] ?? Infinity) - mine) > tolerance) return true;
    return me.team === 0 ? c.pos.x < me.pos.x : c.pos.x > me.pos.x;
  });
}

/** The kickoff's step for one bot: its row while it runs, else null; `index` as the vectors' `kickoffIndex` */
export function nearestLeftKickoff(script: KickoffScript): { step(view: BotView): Controls8 | null; readonly index: number } {
  const rows = scriptRows(script);
  let index = -1;
  return {
    get index() {
      return index;
    },
    step(view) {
      if (!view.state.kickoffPause) {
        index = -1;
        return null;
      }
      if (index >= 0) index++;
      else if (index === -1) index = takesKickoff(view, script.takerToleranceUu) ? 0 : -2;
      if (index >= 0 && index < rows.length && view.state.ball.pos.y === 0) return rows[index] ?? null;
      return null;
    },
  };
}
