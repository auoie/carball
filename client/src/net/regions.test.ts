// The regions a search goes to (notes/matchmaking.md, Regions), with made-up regions and pings
import { describe, expect, it } from "vitest";
import { chooseRegions, storeRegions, storedRegions, toggleRegion } from "./regions";

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};
const regions = [{ id: "us-east" }, { id: "eu" }, { id: "asia" }];

describe("the regions searched", () => {
  it("the kept choice (still listed), else the lowest ping known, else the first", () => {
    const pings = new Map<string, number | null>([
      ["us-east", 120],
      ["eu", 31],
      ["asia", null],
    ]);
    expect(chooseRegions(regions, ["asia", "us-east"], pings)).toEqual(["us-east", "asia"]);
    expect(chooseRegions(regions, ["gone"], pings)).toEqual(["eu"]);
    expect(chooseRegions(regions, null, pings)).toEqual(["eu"]);
    expect(chooseRegions(regions, null, new Map())).toEqual(["us-east"]);
    expect(chooseRegions(regions, null, new Map([["us-east", null]]))).toEqual(["us-east"]);
    expect(chooseRegions([], null, pings)).toEqual([]);
  });

  it("a box pressed toggles its region, in the list's order; the last one stays ticked", () => {
    const order = regions.map((r) => r.id);
    expect(toggleRegion(["eu"], "us-east", order)).toEqual(["us-east", "eu"]);
    expect(toggleRegion(["us-east", "eu"], "us-east", order)).toEqual(["eu"]);
    expect(toggleRegion(["eu"], "eu", order)).toEqual(["eu"]);
  });

  it("kept in this browser; anything else read as no choice", () => {
    const storage = memory();
    expect(storedRegions(storage)).toBeNull();
    storeRegions(["eu", "asia"], storage);
    expect(storedRegions(storage)).toEqual(["eu", "asia"]);
    storage.setItem("carball.regions", "{bad");
    expect(storedRegions(storage)).toBeNull();
    storage.setItem("carball.regions", JSON.stringify([]));
    expect(storedRegions(storage)).toBeNull();
    storage.setItem("carball.regions", JSON.stringify([3, "eu"]));
    expect(storedRegions(storage)).toEqual(["eu"]);
  });
});
