import { describe, expect, it } from "vitest";
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
  });
  return { mm, sounds, joined, searches };
}

describe("matchmaking (notes/matchmaking.md MM-4..14)", () => {
  it("logs FindingBestMatch at 5 s and WaitingForMorePlayers at 150 s", () => {
    expect(timelineLines(4.9)).toEqual([]);
    expect(timelineLines(5).map((l) => l.text)).toEqual([SEARCH_TEXT.findingBestMatch]);
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
    mm.frame(17.01);
    expect(countdown()).toEqual(["Joining in 3", "Joining in 2"]);
    mm.frame(18.01);
    expect(countdown()).toEqual(["Joining in 3", "Joining in 2", "Joining in 1"]);
    expect(joined).toEqual([]);
    mm.frame(16 + JOIN_COUNTDOWN + 0.01);
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

  it("a second Find Match replaces the search", () => {
    const { mm, searches } = harness();
    mm.start(1);
    mm.start(2);
    expect(searches.map((s) => [s.playlist, s.cancelled])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(mm.playlist).toBe(2);
  });
});
