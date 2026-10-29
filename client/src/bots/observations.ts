// The observation builders, action masks, mirrors and moments' scripts a bot package can name: each ours, ported from
// the bot's published source and checked against it (bots/wisp.ts; notes/bots-ml.md §5). A builder: the match's state
// as the bot sees it (its car, the ball, the others, the pads; turned and mirrored as its source has it), in its policy's
// inputs; it keeps what it needs between decisions itself.
import type { BotView } from "../local/bots";
import type { BotManifest, Controls8 } from "./manifest";
import { wispBuilder, wispCelebrate, wispMask, wispMirror } from "./wisp";

export interface ObservationBuilder {
  /** A decision's policy inputs (with the previous action), each its values and shape */
  build(view: BotView, previous: Controls8): { readonly data: Float32Array; readonly shape: readonly number[] }[];
}

/** A builder for a match of `teamSize` a side, `random` in [0, 1) (its shuffles) */
export type ObservationFactory = (manifest: BotManifest, teamSize: number, random: () => number) => ObservationBuilder;

/** The builders by the name a manifest gives */
export const OBSERVATIONS: Readonly<Record<string, ObservationFactory>> = { "wisp-v1": (_manifest, _teamSize, random) => wispBuilder(random) };

/** The action masks by name (a lookup table's rows allowed at a decision), each made for its table */
export const MASKS: Readonly<Record<string, (table: readonly Controls8[], groundRows: number) => (view: BotView) => readonly boolean[]>> = { "wisp-v1": wispMask };

/** The mirrors by name: a row picked in a mirrored view turned back */
export const MIRRORS: Readonly<Record<string, (view: BotView, row: Controls8) => Controls8>> = { "wisp-x-v1": wispMirror };

/** The moments' scripts by name (manifest moments) */
export const MOMENTS: Readonly<Record<string, (view: BotView) => Controls8 | null>> = { "wisp-celebrate-v1": wispCelebrate };
