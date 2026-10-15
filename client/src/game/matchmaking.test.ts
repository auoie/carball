import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOIN_COUNTDOWN, Matchmaking, OWN_SEARCH_TEXT, SEARCH_TEXT, timelineLines } from "./matchmaking";

interface Handlers {
  searching(): void;
  found(token: bigint): void;
  failed(reason: string): void;
}

function harness() {
  const sounds: string[] = [];
  const joined: { token: bigint; playlist: number }[] = [];
  const searches: { playlist: number; handlers: Handlers; cancelled: boolean }[] = [];
  const declined: bigint[] = [];
  const mm = new Matchmaking({
    search: (playlist, handlers) => {
      const s = { playlist, handlers, cancelled: false };
      searches.push(s);
      return () => {
        s.cancelled = true;
      };
    },
    sound: (cue) => sounds.push(cue),
    join: (token, playlist) => joined.push({ token, playlist }),
    decline: (token) => declined.push(token),
  });
  return { mm, sounds, joined, searches, declined };
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
    mm.start(2);
    expect(mm.state?.status).toBe("connecting");
    expect(searches[0]?.playlist).toBe(2);
    expect(sounds).toEqual(["start"]);
    searches[0]?.handlers.searching();
    expect(mm.state?.status).toBe("searching");
    mm.frame(16);
    expect(mm.state?.lines.map((l) => l.text)).toEqual([SEARCH_TEXT.findingBestMatch]);
    searches[0]?.handlers.found(77n);
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
    expect(joined).toEqual([{ token: 77n, playlist: 2 }]);
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
    searches[0]?.handlers.found(5n);
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
    searches[0]?.handlers.found(9n);
    vi.advanceTimersByTime(1500);
    mm.cancel();
    expect(declined).toEqual([9n]);
    expect(mm.state).toBeNull();
    expect(sounds.at(-1)).toBe("cancel");
    vi.advanceTimersByTime(5000);
    expect(joined).toEqual([]);
  });
});
