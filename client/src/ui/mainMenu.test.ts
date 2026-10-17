import { describe, expect, it } from "vitest";
import { backFrom } from "./mainMenu";

describe("the main menu's pages", () => {
  it("backs out a page at a time: the bots' setup to Play, Play and the garage to the top", () => {
    expect(backFrom("bots")).toBe("play");
    expect(backFrom("play")).toBe("top");
    expect(backFrom("garage")).toBe("top");
    expect(backFrom("top")).toBe("top");
  });
});
