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

/** A screen's refresh (ms) from animation frames' intervals (ms): each over the whole refreshes it spans (a dropped frame
 *  two), averaged (a timer's jitter cancels). Seeded from their median (a timer's jitter doesn't move it), or from the
 *  median of the short ones when they're a sixth or more of them (most frames doubled, the median a doubled one:
 *  RV-1268). A page too busy to get every refresh's frame never shows the refresh itself: frames two refreshes apart
 *  and now and then three (a 120 Hz phone or a 144 Hz desktop in a slow browser: the user's Firefox, 2026-11-10) are no
 *  whole numbers of the seed, so a half or a third of it is taken, the first that every interval is a whole number of
 *  (all but 2 %, each within 0.12 of it). Two screens' frames mixed (a window on its way from one to the other) fit
 *  none but by chance, and whatever fits has every frame on its grid. Shared by the camera's steps on a desktop
 *  (camera/pacedCamera.ts) and a touch device's frame pacer (input/touchSettings.ts) */
export function refreshOf(intervals: readonly number[]): number {
  const median = (v: readonly number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 1000 / 60;
  let refresh = median(intervals);
  const short = intervals.filter((v) => v <= 0.6 * refresh);
  if (short.length >= 0.15 * intervals.length) refresh = median(short);
  const seen = intervals.filter((v) => v <= 4.5 * refresh);
  const fits = (part: number, within: number): boolean =>
    seen.filter((v) => Math.round(v / part) < 1 || Math.abs(v / part - Math.round(v / part)) > within).length <= 0.02 * seen.length;
  if (!fits(refresh, 0.2)) {
    // (the seed's own length: the mean of the frames about it, the median an edge of them when half are longer; no part
    // under 4 ms: a jitter's two lengths are no 360 Hz screen's two and three refreshes. None fitting, the seed as it was)
    const about = intervals.filter((v) => Math.abs(v / refresh - 1) < 0.1);
    const centre = about.reduce((a, b) => a + b, 0) / Math.max(1, about.length);
    const k = [1, 2, 3].find((n) => (n === 1 || centre / n >= 4) && fits(centre / n, n === 1 ? 0.2 : 0.12));
    if (k !== undefined) refresh = centre / k;
  }
  for (let pass = 0; pass < 2; pass++) {
    const shares = intervals.filter((v) => v <= 4.5 * refresh).map((v) => v / Math.max(1, Math.round(v / refresh)));
    if (shares.length > 0) refresh = shares.reduce((a, b) => a + b, 0) / shares.length;
  }
  return refresh;
}
