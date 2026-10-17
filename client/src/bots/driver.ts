// A package bot's schedule (FORMAT.md timing.schedule "tick-skip-v1", ours): each call (after every tick of the match;
// call t gets the state after tick t, returns the next tick's controls) its cycle counter and tracker step; a decision when
// one is due (the observation with the previous action, the policy, the pick); the decision copied into the controls at
// `applyAtCounter`; the kickoff's script last, its row both the action and the controls while it runs. Decisions fall on
// calls 0, 1, 9, 17, ... (the counter starts at the tick skip).
import type { BotBrain, BotView } from "../local/bots";
import type { BotControls } from "../local/host";
import { rowControls } from "./actions";
import type { Controls8 } from "./manifest";

export const ZERO_ROW: Controls8 = [0, 0, 0, 0, 0, 0, 0, 0];

export interface DriverParts {
  readonly tickSkip: number;
  readonly applyAtCounter: number;
  /** Each call, first: the builder's tracker */
  readonly track?: (view: BotView) => void;
  /** A decision: the observation (with the previous action), the policy, the pick; its controls' row */
  readonly decide: (view: BotView, previous: Controls8) => Promise<Controls8>;
  /** A controls update (a decision's or the script's applied over the current controls): the difficulty's change to it,
   *  if any */
  readonly onApply?: (row: Controls8, current: Controls8) => Controls8;
  /** The kickoff's step, last: its script's row while it runs, else null */
  readonly kickoff?: (view: BotView) => Controls8 | null;
}

/** The driver's state between calls (exposed for the vectors' comparison: `derived.counter`, `derived.updateAction`) */
export interface DriverState {
  counter: number;
  updateAction: boolean;
  action: Controls8;
  controls: Controls8;
}

export function tickSkipDriver(parts: DriverParts): BotBrain & { readonly state: DriverState } {
  const state: DriverState = { counter: parts.tickSkip, updateAction: true, action: ZERO_ROW, controls: ZERO_ROW };
  const apply = (row: Controls8): Controls8 => (parts.onApply ? parts.onApply(row, state.controls) : row);
  return {
    state,
    async tick(view: BotView): Promise<BotControls> {
      state.counter++;
      parts.track?.(view);
      if (state.updateAction) {
        state.updateAction = false;
        state.action = await parts.decide(view, state.action);
      }
      if (state.counter >= parts.applyAtCounter) state.controls = apply(state.action);
      if (state.counter >= parts.tickSkip) {
        state.counter = 0;
        state.updateAction = true;
      }
      // (the script's row the action too: the next decision's previous action, and re-applied after it ends)
      const scripted = parts.kickoff?.(view) ?? null;
      if (scripted) {
        state.action = scripted;
        state.controls = apply(scripted);
      }
      return rowControls(state.controls);
    },
  };
}

/** The difficulty "random-controls-v1" (FORMAT.md, Nexto_EZ's): with probability 1 − strength a controls update is
 *  skipped for random axes (throttle U[0, 1), steer, pitch, yaw and roll U[−1, 1)), the buttons kept at their current
 *  values, not the new row's (RV-535) */
export function randomControls(strength: number, random: () => number): (row: Controls8, current: Controls8) => Controls8 {
  return (row, current) => {
    if (random() >= 1 - strength) return row;
    const [, , , , , jump, boost, handbrake] = current;
    return [random(), random() * 2 - 1, random() * 2 - 1, random() * 2 - 1, random() * 2 - 1, jump, boost, handbrake];
  };
}
