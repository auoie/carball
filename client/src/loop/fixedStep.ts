// Fixed-rate simulation clock, as the game's (notes/client-loop-timing.md LT-2, LT-3): each frame's world time (the
// real frame time times the time dilation, clamped to 0.0005 .. 0.4 s) goes into a 32-bit float accumulator; whole
// ticks of 1/120 s come out of it, at most 5 per frame (the rest are dropped, keeping only the fraction: below 24 fps
// the game runs slower than real time). Rendering interpolates between the last two ticks.

export const TICK_RATE = 120;
export const TICK_SECONDS = 1 / TICK_RATE;

/** MaxPhysicsSubsteps (EngineShare_TA): ticks per frame, the rest dropped */
export const MAX_TICKS_PER_FRAME = 5;

/** A frame's world time (UWorld::Tick's DeltaSeconds): the raw frame time times the time dilation, clamped */
export function worldSeconds(rawSeconds: number, dilation = 1): number {
  return Math.min(0.4, Math.max(0.0005, rawSeconds * dilation));
}

/** A frame's times from its raw (unclamped) frame time, as UWorld::Tick's: the world's (dilated, clamped) and the real
 *  one (RealDeltaSeconds: clamped alike), so a zero or negative raw time never reaches the camera (RV-2) */
export function frameTimes(rawSeconds: number, dilation = 1): { readonly world: number; readonly real: number } {
  return { world: worldSeconds(rawSeconds, dilation), real: worldSeconds(rawSeconds) };
}

const f32 = Math.fround;

export class FixedStep {
  #accumulator = 0; // f32, as the game's
  readonly #step: number;

  constructor(
    readonly tickSeconds: number = TICK_SECONDS,
    readonly maxTicksPerFrame = MAX_TICKS_PER_FRAME,
  ) {
    this.#step = f32(tickSeconds);
  }

  /** Adds a frame's world time (worldSeconds) and returns how many ticks to simulate now. */
  advance(frameSeconds: number): number {
    this.#accumulator = f32(this.#accumulator + f32(Math.max(0, frameSeconds)));
    if (this.#accumulator < this.#step) return 0;
    const ticks = Math.trunc(f32(this.#accumulator / this.#step));
    this.#accumulator = f32(this.#accumulator - f32(ticks * this.#step));
    return Math.min(ticks, this.maxTicksPerFrame);
  }

  /** How far rendering is between the previous tick (0) and the latest one (1). */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.#accumulator / this.#step));
  }
}
