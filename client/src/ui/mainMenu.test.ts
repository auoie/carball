import { describe, expect, it } from "vitest";
import { backFrom, pingText, storedPlaylists } from "./mainMenu";

describe("the main menu's pages", () => {
  it("backs out a page at a time: the bots' setup to Play, Play and the garage to the top", () => {
    expect(backFrom("bots")).toBe("play");
    expect(backFrom("play")).toBe("top");
    expect(backFrom("garage")).toBe("top");
    expect(backFrom("top")).toBe("top");
  });
});

describe("the region picker's pings (notes/matchmaking.md, Regions)", () => {
  it("in ms; a dash for a region not reached; an ellipsis while measured", () => {
    expect([pingText(31), pingText(null), pingText(undefined)]).toEqual(["31 ms", "—", "…"]);
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
