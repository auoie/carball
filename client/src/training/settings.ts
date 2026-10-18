// Custom training's settings (notes/custom-training.md §5, CTR-15: the game's ranges and defaults; §4.2 the variance's
// modifiers) and each pack's progress, kept in the browser by pack id (TrainingProgressSave_TA's: the shots' statuses).
import type { Range } from "../settings/settings";
import { ShotStatus } from "./run";

/** The settings' numbers */
export interface TrainingNumbers {
  /** Game Speed: the game's time dilation (physics and the timer slow together) */
  readonly gameSpeed: number;
  /** Round Start Input Delay: the least time (s) in Countdown before input starts the shot */
  readonly inputDelay: number;
  /** The variance (Actor Modifiers): the ball's speed ± this % (shown as %), its place ± this along x and y and in height
   *  (uu); the car's place ± this along x and y (uu) and its yaw ± this (degrees) */
  readonly ballSpeedModifier: number;
  readonly ballLocationModifier: number;
  readonly ballHeightModifier: number;
  readonly carLocationModifier: number;
  readonly carRotationModifier: number;
  /** Starting Boost (0-100) each shot, with Unlimited Boost off */
  readonly startingBoost: number;
}

/** The settings' switches */
export interface TrainingFlags {
  /** Skip Goal Replay (training's own, not the profile's): the next shot right after the shot's end */
  readonly skipReplay: boolean;
  /** Spawn Vehicle On Ground: the car on the floor, its pitch 0 */
  readonly spawnOnGround: boolean;
  readonly unlimitedBoost: boolean;
}

export type TrainingSettings = TrainingNumbers & TrainingFlags;

export const TRAINING_LIMITS: Readonly<Record<keyof TrainingNumbers, Range>> = {
  gameSpeed: { min: 0.5, max: 1, step: 0.05 },
  inputDelay: { min: 0, max: 0.1, step: 0.01 },
  ballSpeedModifier: { min: 0, max: 100, step: 1 },
  ballLocationModifier: { min: 0, max: 1000, step: 10 },
  ballHeightModifier: { min: 0, max: 1000, step: 10 },
  carLocationModifier: { min: 0, max: 1000, step: 10 },
  carRotationModifier: { min: 0, max: 100, step: 1 },
  startingBoost: { min: 0, max: 100, step: 1 },
};

export const TRAINING_DEFAULTS: TrainingSettings = {
  gameSpeed: 1,
  inputDelay: 0,
  ballSpeedModifier: 0,
  ballLocationModifier: 0,
  ballHeightModifier: 0,
  carLocationModifier: 0,
  carRotationModifier: 0,
  startingBoost: 33,
  skipReplay: false,
  spawnOnGround: true,
  unlimitedBoost: true,
};

/** The settings' names (the game's, by its setting keys: §5) */
export const TRAINING_SETTINGS_TEXT: Readonly<Record<keyof TrainingSettings, string>> = {
  gameSpeed: "Game Speed",
  inputDelay: "Round Start Input Delay",
  ballSpeedModifier: "Ball Speed Modifier",
  ballLocationModifier: "Ball Location Modifier",
  ballHeightModifier: "Ball Height Modifier",
  carLocationModifier: "Vehicle Location Modifier",
  carRotationModifier: "Vehicle Rotation Modifier",
  startingBoost: "Starting Boost",
  skipReplay: "Skip Goal Replay",
  spawnOnGround: "Spawn Vehicle On Ground",
  unlimitedBoost: "Unlimited Boost",
};

/** Whether any modifier varies the shots (the HUD's "to Randomize Shot": HasModifiers) */
export function hasModifiers(s: TrainingSettings): boolean {
  return s.ballSpeedModifier > 0 || s.ballLocationModifier > 0 || s.ballHeightModifier > 0 || s.carLocationModifier > 0 || s.carRotationModifier > 0;
}

/** Starting Boost's amount (the game's tank, 0-100): its slider's 33 is exactly a third (DefaultStartingBoost 0.333) */
export function startingBoost(settings: TrainingSettings): number {
  return settings.startingBoost === 33 ? 33.3 : settings.startingBoost;
}

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};
const KEY = (id: string): string => `carball.training.${id}`;

/** A pack's kept progress (none: an empty list) */
export function storedProgress(id: string, storage: Store | null = local()): ShotStatus[] {
  try {
    const v: unknown = JSON.parse(storage?.getItem(KEY(id)) ?? "[]");
    return Array.isArray(v) ? v.map((s) => (s === ShotStatus.Completed ? ShotStatus.Completed : s === ShotStatus.Attempted ? ShotStatus.Attempted : ShotStatus.NotAttempted)) : [];
  } catch {
    return [];
  }
}

const WARNED = "carball.training.resetWarned";

/** Whether the reset's first-time warning was answered Yes before (UserTrainingResetRoundWarning: once ever) */
export function resetWarned(storage: Store | null = local()): boolean {
  try {
    return storage?.getItem(WARNED) === "1";
  } catch {
    return false;
  }
}

export function storeResetWarned(storage: Store | null = local()): void {
  try {
    storage?.setItem(WARNED, "1");
  } catch {
    // (not kept: asked again next time)
  }
}

export function storeProgress(id: string, status: readonly ShotStatus[], storage: Store | null = local()): void {
  try {
    storage?.setItem(KEY(id), JSON.stringify(status));
  } catch {
    // (not kept)
  }
}
