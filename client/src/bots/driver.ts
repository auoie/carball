// A package bot's schedule (timing.schedule "tick-skip-v1", ours): each call (after every tick of the match; call t gets
// the state after tick t, returns the next tick's controls) its moments' script first (the schedule held while it plays),
// else its cycle counter's step; a decision when one is due (the observation with the previous action, the
// policy, the pick); the decision copied into the controls at `applyAtCounter`. Decisions fall on calls 0, 1, 9, 17, ...
// (the counter starts at the tick skip).
import type { BotBrain, BotView } from "../local/bots";
import type { BotControls } from "../local/host";
import { rowControls } from "./actions";
import type { Controls8 } from "./manifest";

export const ZERO_ROW: Controls8 = [0, 0, 0, 0, 0, 0, 0, 0];

export interface DriverParts {
  readonly tickSkip: number;
  readonly applyAtCounter: number;
  /** A decision: the observation (with the previous action), the policy, the pick; its controls' row */
  readonly decide: (view: BotView, previous: Controls8) => Promise<Controls8>;
  /** First of all: scripted controls for a moment it doesn't play (manifest moments), the schedule held; else null */
  readonly moment?: (view: BotView) => Controls8 | null;
}

/** The driver's state between calls */
export interface DriverState {
  counter: number;
  updateAction: boolean;
  action: Controls8;
  controls: Controls8;
}

export function tickSkipDriver(parts: DriverParts): BotBrain & { readonly state: DriverState } {
  const state: DriverState = { counter: parts.tickSkip, updateAction: true, action: ZERO_ROW, controls: ZERO_ROW };
  return {
    state,
    async tick(view: BotView): Promise<BotControls> {
      const held = parts.moment?.(view) ?? null;
      if (held) return rowControls(held);
      state.counter++;
      if (state.updateAction) {
        state.updateAction = false;
        state.action = await parts.decide(view, state.action);
      }
      if (state.counter >= parts.applyAtCounter) state.controls = state.action;
      if (state.counter >= parts.tickSkip) {
        state.counter = 0;
        state.updateAction = true;
      }
      return rowControls(state.controls);
    },
  };
}
