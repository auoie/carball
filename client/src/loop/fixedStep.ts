// Fixed-rate simulation clock: the physics runs at exactly 120 Hz whatever the display rate;
// rendering interpolates between the last two ticks.

export const TICK_RATE = 120;
export const TICK_SECONDS = 1 / TICK_RATE;

export class FixedStep {
  #accumulator = 0;

  constructor(
    readonly tickSeconds: number = TICK_SECONDS,
    /** Cap per frame, so a long stall (tab in background) doesn't trigger a burst of catch-up ticks. */
    readonly maxTicksPerFrame = 12,
  ) {}

  /** Adds frame time and returns how many ticks to simulate now. */
  advance(frameSeconds: number): number {
    this.#accumulator += Math.max(0, frameSeconds);
    let ticks = Math.floor(this.#accumulator / this.tickSeconds);
    if (ticks > this.maxTicksPerFrame) {
      ticks = this.maxTicksPerFrame;
      this.#accumulator = 0; // drop the backlog instead of spiralling
    } else {
      this.#accumulator -= ticks * this.tickSeconds;
    }
    return ticks;
  }

  /** How far rendering is between the previous tick (0) and the latest one (1). */
  get alpha(): number {
    return Math.min(1, this.#accumulator / this.tickSeconds);
  }
}
