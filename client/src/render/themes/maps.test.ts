import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAP_NAMES, THEMES, createTheme, themeOfMap } from ".";

const serverProtocol = fileURLToPath(new URL("../../../../server/src/protocol.rs", import.meta.url));

describe("the map (a match's map on the wire, its name)", () => {
  it("one, Night, map 0: the server's count of them and its index", () => {
    expect(THEMES).toEqual(["night"]);
    const protocol = readFileSync(serverProtocol, "utf8");
    expect(Number(/pub const MAP_COUNT: u8 = (\d+);/.exec(protocol)?.[1])).toBe(THEMES.length);
    expect(Number(/pub const NIGHT_MAP: u8 = (\d+);/.exec(protocol)?.[1])).toBe(0);
  });

  it("any index (a newer server's) is Night; its name is Night", () => {
    expect([themeOfMap(0), themeOfMap(1), themeOfMap(255)]).toEqual(["night", "night", "night"]);
    expect(MAP_NAMES.night).toBe("Night");
    expect(createTheme().style.walls.blue).toBeDefined();
  });
});
