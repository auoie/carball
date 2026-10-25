import { describe, expect, it } from "vitest";
import { MIN_SHOWN, backFrom, liveText, pingText, playlistLiveText, regionText, storedPlaylists } from "./mainMenu";

describe("the main menu's pages", () => {
  it("backs out a page at a time: the bots' setup to Play, Play and the garage to the top", () => {
    expect(backFrom("bots")).toBe("play");
    expect(backFrom("play")).toBe("top");
    expect(backFrom("garage")).toBe("top");
    expect(backFrom("leaderboard")).toBe("top");
    expect(backFrom("top")).toBe("top");
  });
});

describe("the region picker's pings (notes/matchmaking.md, Regions)", () => {
  it("in ms; a dash for a region not reached; an ellipsis while measured", () => {
    expect([pingText(31), pingText(null), pingText(undefined)]).toEqual(["31 ms", "—", "…"]);
  });
});

describe("the live counts' words (ours)", () => {
  it("the menu's line, a playlist's two lines, a region's beside its ping (not known: the ping alone)", () => {
    expect([liveText(5, 2), liveText(1, 1), liveText(0, 0)]).toEqual(["5 playing · 2 matches", "1 playing · 1 match", "0 playing · 0 matches"]);
    expect(playlistLiveText(4, 1)).toBe("4 in matches\n1 searching");
    expect([regionText(31, 6), regionText(null, 0), regionText(31, undefined)]).toEqual(["31 ms · 6 playing", "— · 0 playing", "31 ms"]);
    // (shown from MIN_SHOWN players: 0 for now, every count shown)
    expect(MIN_SHOWN).toBe(0);
  });
});

describe("the ticked playlists as kept (RV-887's U01, U02)", () => {
  it("a list of team sizes; one from before the boxes; none or none good, 1v1", () => {
    const store = (v: string | null): Pick<Storage, "getItem"> => ({ getItem: () => v });
    expect(storedPlaylists(store("1,3"))).toEqual([1, 3]);
    expect(storedPlaylists(store("3"))).toEqual([3]);
    expect(storedPlaylists(store("3,1,9"))).toEqual([1, 3]);
    expect(storedPlaylists(store(null))).toEqual([1]);
    expect(storedPlaylists(store("x"))).toEqual([1]);
  });
});
