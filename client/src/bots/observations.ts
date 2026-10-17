// The observation builders and kickoff scripts a bot package can name: each ours, written from the first package's
// SPEC.md that uses it and checked against its test vectors (the original's code never runs). A builder: the match's
// state as the bot sees it (its car, the ball, the others, the pads; mirrored for orange as its spec says), in its
// policy's inputs; it keeps what it needs between ticks itself (its tracker's counters, the previous action, timers).
import type { BotView } from "../local/bots";
import { entityPerceiver } from "./entityPerceiver";
import { nearestLeftKickoff } from "./kickoff";
import type { BotManifest, Controls8, KickoffScript } from "./manifest";

export interface ObservationBuilder {
  /** After every tick, before a decision on it: its tracker */
  track?(view: BotView): void;
  /** A decision's policy inputs (with the previous action), each its values and shape (the entity count resolved) */
  build(view: BotView, previous: Controls8): { readonly data: Float32Array; readonly shape: readonly number[] }[];
}

/** A builder for a match of `teamSize` a side, its policy's entity count (null: none fixed) */
export type ObservationFactory = (manifest: BotManifest, teamSize: number, entities: number | null) => ObservationBuilder;

/** A kickoff script's step (after the schedule's): its row while it runs, else null */
export type KickoffStep = (view: BotView) => Controls8 | null;

export type KickoffFactory = (script: KickoffScript) => KickoffStep;

/** The builders by the name a manifest gives (each from the first package's SPEC that uses it) */
export const OBSERVATIONS: Readonly<Record<string, ObservationFactory>> = { "entity-perceiver-v1": (manifest) => entityPerceiver(manifest) };

/** The kickoff takers by name (as above) */
export const KICKOFFS: Readonly<Record<string, KickoffFactory>> = {
  "nearest-left-v1": (script) => {
    const kickoff = nearestLeftKickoff(script);
    return (view) => kickoff.step(view);
  },
};
