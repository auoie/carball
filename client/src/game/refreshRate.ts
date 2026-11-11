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

/** How long a measure counts for `recentHz` (ms of frames) */
const RECENT_MS = 10_000;

/** A frame this long (ms) is a stall, and the frames just after one aren't the screen's: a browser may run the callbacks
 *  it owes in a burst, 2 or 3 ms apart, and two dozen of those were the fastest tenth of the window: 360 Hz read for the
 *  10 s a measure counts (RV-1302). Neither it nor the `AFTER_STALL` frames after it are counted */
const STALL_MS = 100;
const AFTER_STALL = 30;

/** The fastest frames are a cluster about the screen's interval (the rest are two and three of it): its mean is the
 *  interval, not its fast edge, which a timer's jitter of a millisecond puts a rate too high (75 read as 90, 144 as
 *  180: RV-1305). From the fast percentile, the cluster is the intervals within this factor of its mean either way,
 *  found in a few rounds (the edge first, then each round's mean) */
const CLUSTER = 1.5;
const CLUSTER_ROUNDS = 4;

/** The feel's rate holds while this share of the recent frames still read as it (or faster), where it takes
 *  `PERCENTILE` of them to raise it. One threshold for both flipped the feel between the screen's rate and half of it
 *  when about nine frames in ten were doubled (RV-1303) */
const HOLD_PERCENTILE = 0.04;

/** The middle of the cluster of fast intervals in `sorted` (ms) */
function fastInterval(sorted: readonly number[]): number {
  let fast = sorted[Math.floor(sorted.length * PERCENTILE)] ?? sorted[0] ?? 1000 / 60;
  for (let round = 0; round < CLUSTER_ROUNDS; round++) {
    const cluster = sorted.filter((v) => v <= fast * CLUSTER && v >= fast / CLUSTER);
    if (cluster.length === 0) break;
    fast = cluster.reduce((a, b) => a + b, 0) / cluster.length;
  }
  return fast;
}

export class RefreshMeter {
  readonly #recent: number[] = [];
  #added = 0;
  #skip = 0;
  #latched: number | null = null;
  /** The feel's measures of the last `RECENT_MS`: when (the frames' time added, ms) and what */
  #measures: { readonly at: number; readonly hz: number }[] = [];
  #time = 0;

  /** A frame's interval (ms; a hidden tab's, 250 or more, not counted; nor a stall and the frames just after it) */
  add(ms: number): void {
    if (!(ms > 0) || ms >= 250) {
      if (ms >= 250) this.#skip = AFTER_STALL;
      return;
    }
    this.#time += ms;
    if (ms >= STALL_MS) this.#skip = AFTER_STALL;
    else if (this.#skip > 0) this.#skip--;
    else this.#count(ms);
  }

  #count(ms: number): void {
    this.#recent.push(ms);
    if (this.#recent.length > KEPT) this.#recent.shift();
    this.#added++;
    if (this.#recent.length < EVERY || this.#added % EVERY !== 0) return;
    const sorted = [...this.#recent].sort((a, b) => a - b);
    // (the latched refresh from the fast edge, as ever: the video guard's cap and the Stat Graphs' target read it, and
    // on a variable-refresh screen with a slow page the fast frames' middle read a lower rate, the page then taken
    // for one at its display's cap, RV-1321)
    const edge = sorted[Math.floor(sorted.length * PERCENTILE)] ?? sorted[0] ?? 1000 / 60;
    this.#latched = Math.max(this.#latched ?? 0, nearestRate(1000 / edge));
    // (the feel's from the fast frames' middle; it holds while a few frames still read as the held rate: by the
    // rate they read as, not by a margin on its interval, which a rate within a quarter below it always met, so 75
    // never came down to 60, nor 144 to 120, RV-1318)
    const hz = nearestRate(1000 / fastInterval(sorted));
    const held = this.recentHz;
    const holds = held !== null && nearestRate(1000 / (sorted[Math.floor(sorted.length * HOLD_PERCENTILE)] ?? Infinity)) >= held;
    const counted = holds ? Math.max(hz, held) : hz;
    this.#measures = [...this.#measures.filter((m) => m.at > this.#time - RECENT_MS), { at: this.#time, hz: counted }];
  }

  /** The refresh (Hz), null before a measure */
  get hz(): number | null {
    return this.#latched;
  }

  /** The rate the page's frames have had of late: the highest measure of the last 10 s of frames (so it comes down: a
   *  window moved to a slower screen, a phone's Frame Rate lowered), null before a measure. Rough and steady, which is
   *  all the camera's feel needs of it (camera/frameCamera.ts: notes/camera.md) */
  get recentHz(): number | null {
    return this.#measures.length > 0 ? Math.max(...this.#measures.map((m) => m.hz)) : null;
  }
}
