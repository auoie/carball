// The display's refresh as the page sees it (ours: the browser gives no such number): the fastest frames' rate (a low
// percentile of the recent intervals, past a stray short one), as the nearest common rate, the highest seen kept. A page
// that drops to 30 a second on a 60 Hz display still reads 60 (RV-514: the Stat Graphs' target); a 30 Hz display or a
// browser's 30 cap reads 30 (RV-519: the video guard's cap, not the GPU's load).

/** The displays' common refresh rates (Hz) */
export const COMMON_RATES = [30, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240, 360] as const;

/** The recent intervals kept, the measure's percentile, how often it's taken (intervals) */
const KEPT = 120;
const PERCENTILE = 0.1;
const EVERY = 30;

/** The nearest common rate to `hz` */
export function nearestRate(hz: number): number {
  return COMMON_RATES.reduce((best: number, r) => (Math.abs(r - hz) < Math.abs(best - hz) ? r : best), 60);
}

export class RefreshMeter {
  readonly #recent: number[] = [];
  #added = 0;
  #latched: number | null = null;

  /** A frame's interval (ms; a stall's or a hidden tab's, 250 or more, not counted) */
  add(ms: number): void {
    if (!(ms > 0) || ms >= 250) return;
    this.#recent.push(ms);
    if (this.#recent.length > KEPT) this.#recent.shift();
    this.#added++;
    if (this.#recent.length < EVERY || this.#added % EVERY !== 0) return;
    const sorted = [...this.#recent].sort((a, b) => a - b);
    const fast = sorted[Math.floor(sorted.length * PERCENTILE)] ?? sorted[0] ?? 1000 / 60;
    this.#latched = Math.max(this.#latched ?? 0, nearestRate(1000 / fast));
  }

  /** The refresh (Hz), null before a measure */
  get hz(): number | null {
    return this.#latched;
  }
}
