import { describe, expect, it } from "vitest";
import { backFrom, pingText } from "./mainMenu";

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
