import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AVAILABLE_MAP, MAP_CHOICES, MAP_NAMES, THEMES, preloadTheme, themeName, themeOfMap } from ".";

const serverProtocol = fileURLToPath(new URL("../../../../server/src/protocol.rs", import.meta.url));

describe("maps (a match's map on the wire, the map select's names)", () => {
  it("keep their order, the server's count of them: a map's index names the same theme in every version", () => {
    expect(THEMES).toEqual(["night", "stadium", "meadow", "forest", "city", "infested", "kawaii", "platformer", "haunted", "ghosts", "dimension", "summit", "crater", "temple", "island", "lake", "greenhouse"]);
    expect(Number(/pub const MAP_COUNT: u8 = (\d+);/.exec(readFileSync(serverProtocol, "utf8"))?.[1])).toBe(THEMES.length);
  });

  it("a map's index is its theme; one this page doesn't know (a newer server's) is the default", () => {
    THEMES.forEach((theme, i) => {
      expect(themeOfMap(i)).toBe(theme);
    });
    expect(themeOfMap(THEMES.length)).toBe("night");
    expect(themeOfMap(255)).toBe("night");
  });

  it("each has its own name in the map select", () => {
    expect(new Set(Object.values(MAP_NAMES)).size).toBe(MAP_CHOICES.length);
    for (const theme of THEMES.filter((t) => t !== "greenhouse")) expect(MAP_NAMES[theme]).toMatch(/^[A-Z][a-z]+$/);
  });

  it("Night's greenhouse: the one map offered (free play's, every match's: map 16, appended), beside Night in the kept map select", () => {
    expect(AVAILABLE_MAP).toBe("greenhouse");
    expect(themeOfMap(16)).toBe("greenhouse");
    expect(Number(/pub const GREENHOUSE_MAP: u8 = (\d+);/.exec(readFileSync(serverProtocol, "utf8"))?.[1])).toBe(16);
    expect(MAP_CHOICES).toEqual(["night", "greenhouse", ...THEMES.slice(1, 16)]);
    expect(MAP_NAMES.greenhouse).toBe("Night · Greenhouse");
    expect(themeName("greenhouse")).toBe("greenhouse");
  });

  it("a theme's chunk downloads ahead without being built", async () => {
    await expect(preloadTheme("meadow")).resolves.toBeUndefined();
    await expect(preloadTheme("night")).resolves.toBeUndefined();
  });
});
