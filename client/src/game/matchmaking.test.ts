import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FoundMatch, JOIN_COUNTDOWN, Matchmaking, OWN_SEARCH_TEXT, SEARCH_TEXT, type SearchHandlers, timelineLines } from "./matchmaking";

/** A match found (made up): its id, map and playlist */
function match(id: bigint, map = 0, playlist = 1): FoundMatch {
  return { id, server: "game-eu.example:4433", ticket: `t${id.toString()}`, playlist, map };
}

function harness() {
  const sounds: string[] = [];
  const joined: { token: bigint; playlists: readonly number[]; map: number }[] = [];
  const searchedFor: number[] = [];
  const searches: { playlists: readonly number[]; handlers: SearchHandlers; cancelled: boolean; finished: (() => void) | null }[] = [];
  const declined: bigint[] = [];
  const mm = new Matchmaking({
    search: (playlists, handlers) => {
      const s: (typeof searches)[number] = { playlists, handlers, cancelled: false, finished: null };
      searches.push(s);
      return {
        cancel: () => {
          s.cancelled = true;
        },
        finish: () =>
          new Promise<void>((resolve) => {
            s.finished = resolve;
          }),
      };
    },
    sound: (cue) => sounds.push(cue),
    join: (found, playlists, seconds) => {
      joined.push({ token: found.id, playlists, map: found.map });
      searchedFor.push(seconds);
    },
    decline: (found) => declined.push(found.id),
  });
  return { mm, sounds, joined, searchedFor, searches, declined };
}

describe("matchmaking (notes/matchmaking.md MM-4..14)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs FindingBestMatch at 5 s and WaitingForMorePlayers at 150 s", () => {
    expect(timelineLines(4.9)).toEqual([]);
    expect(timelineLines(5).map((l) => l.text)).toEqual([SEARCH_TEXT.findingBestMatch]);
    expect(timelineLines(149.9).map((l) => l.text)).toEqual([SEARCH_TEXT.findingBestMatch]);
    expect(timelineLines(150).map((l) => l.text)).toEqual([SEARCH_TEXT.findingBestMatch, SEARCH_TEXT.waitingForMorePlayers]);
  });

  it("connects, searches, then counts Joining in 3, 2, 1 with a beep each and claims at 0", () => {
    const { mm, sounds, joined, searches } = harness();
    mm.frame(10);
    mm.start([2]);
    expect(mm.state?.status).toBe("connecting");
    expect(searches[0]?.playlists).toEqual([2]);
    expect(sounds).toEqual(["start"]);
    searches[0]?.handlers.searching();
    expect(mm.state?.status).toBe("searching");
    mm.frame(16);
    expect(mm.state?.lines.map((l) => l.text)).toEqual([SEARCH_TEXT.findingBestMatch]);
    searches[0]?.handlers.found(match(77n, 6));
    expect(mm.state?.status).toBe("joining");
    const countdown = (): string[] => (mm.state?.lines ?? []).filter((l) => l.kind === "countdown").map((l) => l.text);
    expect(countdown()).toEqual(["Joining in 3"]);
    // (on timers, no frames: a hidden tab's countdown runs and claims on time, RV-354)
    vi.advanceTimersByTime(1000);
    expect(countdown()).toEqual(["Joining in 3", "Joining in 2"]);
    vi.advanceTimersByTime(1000);
    expect(countdown()).toEqual(["Joining in 3", "Joining in 2", "Joining in 1"]);
    expect(joined).toEqual([]);
    vi.advanceTimersByTime(JOIN_COUNTDOWN * 1000 - 2000);
    expect(joined).toEqual([{ token: 77n, playlists: [2], map: 6 }]);
    expect(sounds).toEqual(["start", "countdown", "countdown", "countdown"]);
    expect(mm.state).toBeNull();
  });

  it("Cancel Search closes the session with the cancel sound; a late answer is ignored", () => {
    const { mm, sounds, joined, searches } = harness();
    mm.start([1]);
    searches[0]?.handlers.searching();
    mm.cancel();
    expect(searches[0]?.cancelled).toBe(true);
    expect(mm.state).toBeNull();
    expect(sounds).toEqual(["start", "cancel"]);
    searches[0]?.handlers.found(match(5n, 0));
    mm.frame(100);
    expect(joined).toEqual([]);
    expect(mm.state).toBeNull();
  });

  it("a failed search shows Failed and its warning line, then goes; a new search starts with a warning line", () => {
    const { mm, searches } = harness();
    mm.frame(0);
    mm.start([3]);
    searches[0]?.handlers.failed("the connection to the server was lost");
    expect(mm.state?.status).toBe("failed");
    expect(mm.searching).toBe(false);
    expect(mm.state?.lines).toEqual([{ text: `${OWN_SEARCH_TEXT.failedPrefix} the connection to the server was lost`, kind: "warning" }]);
    mm.frame(5.5);
    expect(mm.state).toBeNull();
    mm.start([3], OWN_SEARCH_TEXT.notAllJoined);
    expect(mm.state?.lines).toEqual([{ text: OWN_SEARCH_TEXT.notAllJoined, kind: "warning" }]);
    expect(searches).toHaveLength(2);
  });

  it("Find Match while a search runs keeps it (MM-2: SearchInProgress); after it ends, a new one starts", () => {
    const { mm, searches } = harness();
    expect(mm.start([1])).toBe(true);
    expect(mm.start([2])).toBe(false);
    expect(searches.map((s) => [s.playlists, s.cancelled])).toEqual([[[1], false]]);
    expect(mm.playlists).toEqual([1]);
    searches[0]?.handlers.failed("lost");
    expect(mm.start([2])).toBe(true);
    expect(searches.map((s) => s.playlists)).toEqual([[1], [2]]);
  });

  it("Cancel Search during Joining in gives the slot up at once and doesn't claim (RV-355)", () => {
    const { mm, joined, searches, declined, sounds } = harness();
    mm.start([1]);
    searches[0]?.handlers.searching();
    searches[0]?.handlers.found(match(9n, 0));
    vi.advanceTimersByTime(1500);
    const beeps = sounds.filter((c) => c === "countdown").length;
    mm.cancel();
    expect(declined).toEqual([9n]);
    expect(mm.state).toBeNull();
    expect(sounds.at(-1)).toBe("cancel");
    vi.advanceTimersByTime(5000);
    expect(joined).toEqual([]);
    // (its timers gone too: no "Joining in 1" and beep come back after the cancel, RX13's C5)
    expect(mm.state).toBeNull();
    expect(sounds.filter((c) => c === "countdown")).toHaveLength(beeps);
  });

  it("a failure after the match was found doesn't fail the search: the join goes on (RX13's C12)", () => {
    const { mm, joined, searches } = harness();
    mm.start([1]);
    searches[0]?.handlers.searching();
    searches[0]?.handlers.found(match(4n, 0));
    searches[0]?.handlers.failed("the connection to the server was lost");
    searches[0]?.handlers.cooldown(100);
    expect(mm.state?.status).toBe("joining");
    vi.advanceTimersByTime(JOIN_COUNTDOWN * 1000);
    expect(joined).toEqual([{ token: 4n, playlists: [1], map: 0 }]);
  });

  it("a search finished as the page goes: a match found meanwhile is followed, else it ends quietly (RV-443)", async () => {
    const { mm, joined, searches, sounds } = harness();
    // (no match: the session's end is no failure, no cancel sound, no search left)
    mm.start([1]);
    searches[0]?.handlers.searching();
    const quiet = mm.finish();
    expect(mm.finish()).toBe(quiet);
    searches[0]?.handlers.failed("the connection to the server was lost");
    expect(mm.state?.status).toBe("searching");
    searches[0]?.finished?.();
    expect(await quiet).toBe(false);
    expect(mm.state).toBeNull();
    expect(sounds).toEqual(["start"]);
    // (a match found before the end: the join goes on, the page follows it)
    mm.start([1]);
    searches[1]?.handlers.searching();
    const followed = mm.finish();
    searches[1]?.handlers.found(match(9n, 3));
    searches[1]?.finished?.();
    expect(await followed).toBe(true);
    expect(mm.state?.status).toBe("joining");
    vi.advanceTimersByTime(JOIN_COUNTDOWN * 1000);
    expect(joined).toEqual([{ token: 9n, playlists: [1], map: 3 }]);
    // (nothing running, or already joining: answered at once)
    expect(await mm.finish()).toBe(false);
  });

  it("a search another tab of this browser took the place of says so plainly, not as a failure (RV-460)", () => {
    const { mm, searches } = harness();
    mm.frame(0);
    mm.start([2]);
    searches[0]?.handlers.replaced();
    // (its summary "Ended", not the game's "Failed": RV-491; no longer searching, and it stays till Cancel Search)
    expect(mm.state?.status).toBe("ended");
    expect(mm.searching).toBe(false);
    expect(mm.state?.lines).toEqual([{ text: "You started searching in another tab.", kind: "status" }]);
    mm.frame(60);
    expect(mm.state?.status).toBe("ended");
  });

  it("a search refused for a no-show says why and how long, and stays until Cancel Search or a new search (RV-367)", () => {
    const { mm, searches, sounds } = harness();
    mm.frame(0);
    mm.start([2]);
    searches[0]?.handlers.cooldown(112);
    expect(mm.state?.status).toBe("failed");
    expect(mm.state?.lines).toEqual([{ text: OWN_SEARCH_TEXT.cooldown(112), kind: "warning" }]);
    expect(OWN_SEARCH_TEXT.cooldown(112)).toBe(
      "Your last match was cancelled because you didn't join it in time or left before it started. You can search again in 1:52.",
    );
    expect(OWN_SEARCH_TEXT.cooldown(59.2)).toMatch(/in 1:00\.$/);
    mm.frame(60);
    expect(mm.state?.status).toBe("failed");
    mm.cancel();
    expect(mm.state).toBeNull();
    expect(sounds).toEqual(["start"]);
  });

  it("a search back from a cancelled match: its clock goes on from the first search (RV-367; its place the matchmaker's)", () => {
    const { mm, searches, searchedFor } = harness();
    mm.frame(100);
    mm.start([3], OWN_SEARCH_TEXT.notAllJoined, { searchedFor: 4 });
    searches[0]?.handlers.searching();
    mm.frame(101.5);
    expect(mm.state?.lines.map((l) => l.text)).toEqual([SEARCH_TEXT.findingBestMatch, OWN_SEARCH_TEXT.notAllJoined]);
    searches[0]?.handlers.found(match(32n, 0));
    vi.advanceTimersByTime(JOIN_COUNTDOWN * 1000);
    expect(searchedFor).toEqual([5.5]);
    // A new search: its own clock
    mm.start([3]);
    searches[1]?.handlers.searching();
    mm.frame(104);
    expect(mm.state?.lines).toEqual([]);
  });

  it("searches several playlists at once; the match found's own joined; a line during the search; the MoreRegions tip", () => {
    const { mm, searches, joined, declined } = harness();
    let regions = 1;
    mm.frame(0);
    mm.start([1, 3]);
    expect(searches[0]?.playlists).toEqual([1, 3]);
    searches[0]?.handlers.searching();
    searches[0]?.handlers.warning?.("a line");
    expect(mm.state?.lines).toEqual([{ text: "a line", kind: "warning" }]);
    searches[0]?.handlers.found(match(9n, 0, 3));
    vi.advanceTimersByTime(JOIN_COUNTDOWN * 1000);
    expect(joined).toEqual([{ token: 9n, playlists: [1, 3], map: 0 }]);
    // (Cancel Search in "Joining in": that match's seat given up)
    mm.start([1]);
    searches[1]?.handlers.searching();
    searches[1]?.handlers.found(match(10n));
    mm.cancel();
    expect(declined).toEqual([10n]);
    // (the tip with one region ticked of several)
    const tipped = new Matchmaking({
      search: () => ({ cancel: () => undefined, finish: () => Promise.resolve() }),
      sound: () => undefined,
      join: () => undefined,
      decline: () => undefined,
      moreRegions: () => regions === 1,
    });
    tipped.frame(0);
    tipped.start([1]);
    regions = 2;
    expect(timelineLines(31, true).map((l) => l.text)).toEqual([SEARCH_TEXT.findingBestMatch, SEARCH_TEXT.moreRegions]);
    expect(timelineLines(29, true).map((l) => l.text)).toEqual([SEARCH_TEXT.findingBestMatch]);
  });
});
