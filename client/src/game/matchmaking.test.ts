import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOIN_COUNTDOWN, Matchmaking, OWN_SEARCH_TEXT, SEARCH_TEXT, type SearchHandlers, timelineLines } from "./matchmaking";

function harness() {
  const sounds: string[] = [];
  const joined: { token: bigint; playlist: number; map: number }[] = [];
  const preloaded: number[] = [];
  const searchedFor: number[] = [];
  const searches: { playlist: number; token: bigint; handlers: SearchHandlers; cancelled: boolean }[] = [];
  const declined: bigint[] = [];
  const mm = new Matchmaking({
    search: (playlist, token, handlers) => {
      const s = { playlist, token, handlers, cancelled: false };
      searches.push(s);
      return () => {
        s.cancelled = true;
      };
    },
    sound: (cue) => sounds.push(cue),
    join: (token, playlist, seconds, map) => {
      joined.push({ token, playlist, map });
      searchedFor.push(seconds);
    },
    preload: (map) => preloaded.push(map),
    decline: (token) => declined.push(token),
  });
  return { mm, sounds, joined, searchedFor, searches, declined, preloaded };
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
    const { mm, sounds, joined, searches, preloaded } = harness();
    mm.frame(10);
    mm.start(2);
    expect(mm.state?.status).toBe("connecting");
    expect(searches[0]?.playlist).toBe(2);
    expect(sounds).toEqual(["start"]);
    searches[0]?.handlers.searching();
    expect(mm.state?.status).toBe("searching");
    mm.frame(16);
    expect(mm.state?.lines.map((l) => l.text)).toEqual([SEARCH_TEXT.findingBestMatch]);
    searches[0]?.handlers.found(77n, 6);
    expect(mm.state?.status).toBe("joining");
    expect(preloaded, "the match's arena fetched as the countdown starts").toEqual([6]);
    const countdown = (): string[] => (mm.state?.lines ?? []).filter((l) => l.kind === "countdown").map((l) => l.text);
    expect(countdown()).toEqual(["Joining in 3"]);
    // (on timers, no frames: a hidden tab's countdown runs and claims on time, RV-354)
    vi.advanceTimersByTime(1000);
    expect(countdown()).toEqual(["Joining in 3", "Joining in 2"]);
    vi.advanceTimersByTime(1000);
    expect(countdown()).toEqual(["Joining in 3", "Joining in 2", "Joining in 1"]);
    expect(joined).toEqual([]);
    vi.advanceTimersByTime(JOIN_COUNTDOWN * 1000 - 2000);
    expect(joined).toEqual([{ token: 77n, playlist: 2, map: 6 }]);
    expect(sounds).toEqual(["start", "countdown", "countdown", "countdown"]);
    expect(mm.state).toBeNull();
  });

  it("Cancel Search closes the session with the cancel sound; a late answer is ignored", () => {
    const { mm, sounds, joined, searches } = harness();
    mm.start(1);
    searches[0]?.handlers.searching();
    mm.cancel();
    expect(searches[0]?.cancelled).toBe(true);
    expect(mm.state).toBeNull();
    expect(sounds).toEqual(["start", "cancel"]);
    searches[0]?.handlers.found(5n, 0);
    mm.frame(100);
    expect(joined).toEqual([]);
    expect(mm.state).toBeNull();
  });

  it("a failed search shows Failed and its warning line, then goes; a new search starts with a warning line", () => {
    const { mm, searches } = harness();
    mm.frame(0);
    mm.start(3);
    searches[0]?.handlers.failed("the connection to the server was lost");
    expect(mm.state?.status).toBe("failed");
    expect(mm.searching).toBe(false);
    expect(mm.state?.lines).toEqual([{ text: `${OWN_SEARCH_TEXT.failedPrefix} the connection to the server was lost`, kind: "warning" }]);
    mm.frame(5.5);
    expect(mm.state).toBeNull();
    mm.start(3, OWN_SEARCH_TEXT.notAllJoined);
    expect(mm.state?.lines).toEqual([{ text: OWN_SEARCH_TEXT.notAllJoined, kind: "warning" }]);
    expect(searches).toHaveLength(2);
  });

  it("Find Match while a search runs keeps it (MM-2: SearchInProgress); after it ends, a new one starts", () => {
    const { mm, searches } = harness();
    expect(mm.start(1)).toBe(true);
    expect(mm.start(2)).toBe(false);
    expect(searches.map((s) => [s.playlist, s.cancelled])).toEqual([[1, false]]);
    expect(mm.playlist).toBe(1);
    searches[0]?.handlers.failed("lost");
    expect(mm.start(2)).toBe(true);
    expect(searches.map((s) => s.playlist)).toEqual([1, 2]);
  });

  it("Cancel Search during Joining in gives the slot up at once and doesn't claim (RV-355)", () => {
    const { mm, joined, searches, declined, sounds } = harness();
    mm.start(1);
    searches[0]?.handlers.searching();
    searches[0]?.handlers.found(9n, 0);
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
    mm.start(1);
    searches[0]?.handlers.searching();
    searches[0]?.handlers.found(4n, 0);
    searches[0]?.handlers.failed("the connection to the server was lost");
    searches[0]?.handlers.cooldown(100, false);
    expect(mm.state?.status).toBe("joining");
    vi.advanceTimersByTime(JOIN_COUNTDOWN * 1000);
    expect(joined).toEqual([{ token: 4n, playlist: 1, map: 0 }]);
  });

  it("a search refused for a no-show says why and how long, and stays until Cancel Search or a new search (RV-367)", () => {
    const { mm, searches, sounds } = harness();
    mm.frame(0);
    mm.start(2);
    searches[0]?.handlers.cooldown(112, false);
    expect(mm.state?.status).toBe("failed");
    expect(mm.state?.lines).toEqual([{ text: OWN_SEARCH_TEXT.cooldown(112), kind: "warning" }]);
    expect(OWN_SEARCH_TEXT.cooldown(112)).toBe("Your last match was cancelled because you didn't join it in time or left before it started. You can search again in 1:52.");
    expect(OWN_SEARCH_TEXT.cooldown(59.2)).toMatch(/in 1:00\.$/);
    mm.frame(60);
    expect(mm.state?.status).toBe("failed");
    mm.cancel();
    expect(mm.state).toBeNull();
    expect(sounds).toEqual(["start"]);
    // The address's block (maybe a neighbour's no-show): words that blame no one (RV-385)
    mm.start(2);
    searches[1]?.handlers.cooldown(75, true);
    expect(mm.state?.lines).toEqual([{ text: "Searches from your network are paused after a recent no-show. You can search again in 1:15.", kind: "warning" }]);
  });

  it("a search back from a cancelled match sends its token and its clock goes on from the first search (RV-367)", () => {
    const { mm, searches, searchedFor } = harness();
    mm.frame(100);
    mm.start(3, OWN_SEARCH_TEXT.notAllJoined, { token: 31n, searchedFor: 4 });
    expect(searches[0]?.token).toBe(31n);
    searches[0]?.handlers.searching();
    mm.frame(101.5);
    expect(mm.state?.lines.map((l) => l.text)).toEqual([SEARCH_TEXT.findingBestMatch, OWN_SEARCH_TEXT.notAllJoined]);
    searches[0]?.handlers.found(32n, 0);
    vi.advanceTimersByTime(JOIN_COUNTDOWN * 1000);
    expect(searchedFor).toEqual([5.5]);
    // A new search: token 0, its own clock
    mm.start(3);
    expect(searches[1]?.token).toBe(0n);
    searches[1]?.handlers.searching();
    mm.frame(104);
    expect(mm.state?.lines).toEqual([]);
  });
});
