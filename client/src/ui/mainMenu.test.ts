import { describe, expect, it } from "vitest";
import { THEMES } from "../render/themes";
import { backFrom, mapChoices, storeMap, storedMap } from "./mainMenu";

const memory = (): Pick<Storage, "getItem" | "setItem"> & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

describe("Free Play's map select", () => {
  it("lists every map by its name, the one picked checked", () => {
    const choices = mapChoices("meadow");
    expect(choices.map((c) => c.map)).toEqual([...THEMES]);
    expect(choices.slice(0, 3).map((c) => c.label)).toEqual(["Night", "Stadium", "Meadow"]);
    expect(choices.filter((c) => c.checked).map((c) => c.map)).toEqual(["meadow"]);
  });

  it("keeps the last pick in the browser (carball.freeplayMap), night before any or for a map this page doesn't know", () => {
    const storage = memory();
    expect(storedMap(storage)).toBe("night");
    storeMap("lake", storage);
    expect(storage.map.get("carball.freeplayMap")).toBe("lake");
    expect(storedMap(storage)).toBe("lake");
    storage.setItem("carball.freeplayMap", "nope");
    expect(storedMap(storage)).toBe("night");
    expect(storedMap(null)).toBe("night");
    const blocked = { getItem: (): string => { throw new Error("blocked"); }, setItem: (): void => { throw new Error("blocked"); } };
    expect(storedMap(blocked)).toBe("night");
    expect(() => { storeMap("city", blocked); }).not.toThrow();
  });

  it("backs out a page at a time: the map select to Play, Play to the top", () => {
    expect(backFrom("maps")).toBe("play");
    expect(backFrom("play")).toBe("top");
    expect(backFrom("top")).toBe("top");
  });
});
