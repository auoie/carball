// The menu's live counts' reads (src/net/liveStats.ts): one at a time, only when wanted, too old hidden as the menu opens
// (RV-1160), a failure hiding them
import { describe, expect, it, vi } from "vitest";
import type { LiveStats } from "../account/api";
import { LiveStatsPoller, STATS_STALE_MS } from "./liveStats";

const stats = (playing: number): LiveStats => ({ playlists: [], servers: new Map(), playing, matches: 0 });

function setup() {
  let clock = 0;
  let wanted = true;
  const answers: ((s: LiveStats) => void)[] = [];
  const failures: ((e: Error) => void)[] = [];
  const read = vi.fn(
    () =>
      new Promise<LiveStats>((resolve, reject) => {
        answers.push(resolve);
        failures.push(reject);
      }),
  );
  const shown: (number | null)[] = [];
  const poller = new LiveStatsPoller(
    read,
    (s) => shown.push(s?.playing ?? null),
    () => wanted,
    () => clock,
  );
  return {
    poller,
    read,
    shown,
    answer: async (n: number, i = answers.length - 1) => {
      answers[i]?.(stats(n));
      await Promise.resolve();
      await Promise.resolve();
    },
    fail: async (i = failures.length - 1) => {
      failures[i]?.(new Error("down"));
      await Promise.resolve();
      await Promise.resolve();
    },
    set: (at: number, want = true) => {
      clock = at;
      wanted = want;
    },
  };
}

describe("the menu's live counts' reads", () => {
  it("one at a time: a tick while a read's under way skips; none while the menu's closed or the page hidden", async () => {
    const s = setup();
    const first = s.poller.poll();
    void s.poller.poll();
    expect(s.read).toHaveBeenCalledTimes(1);
    await s.answer(5);
    await first;
    expect(s.shown).toEqual([5]);
    s.set(1000, false);
    await s.poller.poll();
    expect(s.read).toHaveBeenCalledTimes(1);
  });

  it("as the menu opens: counts read within STATS_STALE_MS kept while read again; older ones hidden at once", async () => {
    const s = setup();
    const p = s.poller.poll();
    await s.answer(7);
    await p;
    s.set(STATS_STALE_MS - 1);
    const fresh = s.poller.opened();
    expect(s.shown).toEqual([7]);
    await s.answer(8);
    await fresh;
    expect(s.shown).toEqual([7, 8]);
    // (a match later: the menu opened long after the last read)
    s.set(STATS_STALE_MS * 100);
    const stale = s.poller.opened();
    expect(s.shown).toEqual([7, 8, null]);
    await s.answer(3);
    await stale;
    expect(s.shown).toEqual([7, 8, null, 3]);
  });

  it("a failed read hides the counts", async () => {
    const s = setup();
    const p = s.poller.poll();
    await s.fail();
    await p;
    expect(s.shown).toEqual([null]);
    expect(s.read).toHaveBeenCalledTimes(1);
  });
});
