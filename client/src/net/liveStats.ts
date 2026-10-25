// The menu's live counts (GET /api/stats: the top page's line, each playlist's and region's count), read as the menu
// opens and every STATS_EVERY_MS while it shows and the page is seen; one read at a time (an interval's and a page seen
// again never overlap, an older answer never landing after a newer); counts older than STATS_STALE_MS hidden as the
// menu opens, until read again (after a match, not the counts from before it: RV-1160)
import type { LiveStats } from "../account/api";

/** How often the counts are read while the menu shows (ms; the API keeps its count a few seconds) */
export const STATS_EVERY_MS = 15_000;
/** How old counts may be when the menu opens and still be shown while they're read again (ms) */
export const STATS_STALE_MS = 30_000;

export class LiveStatsPoller {
  readonly #read: () => Promise<LiveStats>;
  readonly #show: (stats: LiveStats | null) => void;
  readonly #reading: () => boolean;
  readonly #now: () => number;
  #busy = false;
  /** When the counts shown were read (ms on `now`'s clock; none yet: -Infinity) */
  #at = -Infinity;

  /** `read`: the API's; `show`: the menu's (null: none to show); `reading`: whether a read is wanted now (the menu open,
   *  the page seen) */
  constructor(read: () => Promise<LiveStats>, show: (stats: LiveStats | null) => void, reading: () => boolean, now: () => number = () => performance.now()) {
    this.#read = read;
    this.#show = show;
    this.#reading = reading;
    this.#now = now;
  }

  /** The menu opened: counts too old hidden at once, then read */
  opened(): Promise<void> {
    if (this.#now() - this.#at > STATS_STALE_MS) this.#show(null);
    return this.poll();
  }

  /** A read now (the interval's, the page seen again), unless none is wanted or one is under way; a failed one hides
   *  the counts */
  async poll(): Promise<void> {
    if (this.#busy || !this.#reading()) return;
    this.#busy = true;
    try {
      const stats = await this.#read();
      this.#at = this.#now();
      this.#show(stats);
    } catch {
      this.#at = -Infinity;
      this.#show(null);
    } finally {
      this.#busy = false;
    }
  }
}
