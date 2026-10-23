// The regions a search goes to (notes/matchmaking.md, Regions), with made-up regions and pings
import { describe, expect, it } from "vitest";
import {
  PINGS_KEPT_MS,
  chooseRegions,
  pingAnswer,
  searchPlan,
  searchRequest,
  storePings,
  storeRegions,
  storedPings,
  storedRegions,
  toggleRegion,
} from "./regions";

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};
const regions = [{ id: "us-east" }, { id: "eu" }, { id: "asia" }];

describe("the regions searched", () => {
  it("the player's kept choice (still listed), else the lowest ping known, else the kept pick, else the first (RV-862)", () => {
    const pings = new Map<string, number | null>([
      ["us-east", 120],
      ["eu", 31],
      ["asia", null],
    ]);
    expect(chooseRegions(regions, { ids: ["asia", "us-east"], manual: true }, pings)).toEqual(["us-east", "asia"]);
    expect(chooseRegions(regions, { ids: ["gone"], manual: true }, pings)).toEqual(["eu"]);
    // (an automatic pick chosen again as the pings change; with none known, kept)
    expect(chooseRegions(regions, { ids: ["asia"], manual: false }, pings)).toEqual(["eu"]);
    expect(chooseRegions(regions, { ids: ["asia"], manual: false }, new Map())).toEqual(["asia"]);
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

  it("kept in this browser, the player's or the lowest ping's; a list from before told apart by its length; else none", () => {
    const storage = memory();
    expect(storedRegions(storage)).toBeNull();
    storeRegions(["eu", "asia"], true, storage);
    expect(storedRegions(storage)).toEqual({ ids: ["eu", "asia"], manual: true });
    storeRegions(["eu"], false, storage);
    expect(storedRegions(storage)).toEqual({ ids: ["eu"], manual: false });
    // (619e7e8's lists: one region its pick, more the player's)
    storage.setItem("carball.regions", JSON.stringify(["eu"]));
    expect(storedRegions(storage)).toEqual({ ids: ["eu"], manual: false });
    storage.setItem("carball.regions", JSON.stringify(["eu", "asia"]));
    expect(storedRegions(storage)).toEqual({ ids: ["eu", "asia"], manual: true });
    storage.setItem("carball.regions", "{bad");
    expect(storedRegions(storage)).toBeNull();
    storage.setItem("carball.regions", JSON.stringify([]));
    expect(storedRegions(storage)).toBeNull();
    storage.setItem("carball.regions", JSON.stringify([3, "eu"]));
    expect(storedRegions(storage)).toEqual({ ids: ["eu"], manual: false });
    storage.setItem("carball.regions", JSON.stringify({ ids: ["eu"], manual: "yes" }));
    expect(storedRegions(storage)).toEqual({ ids: ["eu"], manual: false });
  });

  it("keeps the pings a few minutes for the next page; older, from ahead, or bad, none (RV-847)", () => {
    const storage = memory();
    const pings = new Map<string, number | null>([
      ["eu", 31],
      ["asia", null],
    ]);
    storePings(pings, 1_000_000, storage);
    expect(storedPings(1_000_000 + 60_000, storage)).toEqual({ at: 1_000_000, pings });
    expect(storedPings(1_000_000 + PINGS_KEPT_MS, storage)).toBeNull();
    expect(storedPings(999_000, storage)).toBeNull();
    storage.setItem("carball.regionPings", JSON.stringify({ at: 1_000_000, pings: { eu: -5, asia: "x", us: 40 } }));
    expect(storedPings(1_000_000, storage)?.pings).toEqual(new Map([["us", 40]]));
    storage.setItem("carball.regionPings", "{bad");
    expect(storedPings(1_000_000, storage)).toBeNull();
  });

  it("asks for the ticked regions' servers with every server that answered its ping, ticked or not (MX1R-19)", () => {
    const listed = [
      { id: "us-east", server: "game-us.example:4433" },
      { id: "eu", server: "game-eu.example:4433" },
      { id: "asia", server: "game-asia.example:4433" },
    ];
    const pings = new Map<string, number | null>([
      ["us-east", 90.4],
      ["eu", 31],
      ["asia", null],
    ]);
    expect(searchRequest(listed, ["eu", "asia"], pings, [1, 3])).toEqual({
      playlists: [1, 3],
      pings: { "game-us.example:4433": 90, "game-eu.example:4433": 31 },
      regions: ["game-eu.example:4433", "game-asia.example:4433"],
    });
    // (a server whose name isn't one left out, a name given twice once, RV-868)
    const odd = [
      { id: "us-east", server: "bad_name:4433" },
      { id: "eu", server: "game-eu.example:4433" },
      { id: "eu2", server: "game-eu.example:4433" },
    ];
    expect(
      searchRequest(
        odd,
        ["us-east", "eu", "eu2"],
        new Map([
          ["us-east", 10],
          ["eu", 30],
          ["eu2", 31],
        ]),
        [1],
      ),
    ).toEqual({ playlists: [1], pings: { "game-eu.example:4433": 31 }, regions: ["game-eu.example:4433"] });
    // (a page of one region: that one, ticked or not)
    expect(searchRequest([{ id: "default", server: "localhost:4433" }], [], new Map([["default", 5]]), [2]).regions).toEqual(["localhost:4433"]);
  });

  it("plans a search from its own pings: an automatic pick from them alone, never a kept ping's; the player's ticks kept (RV-879)", () => {
    const listed = [
      { id: "a", server: "a.example:4433" },
      { id: "c", server: "c.example:4433" },
    ];
    // (C the kept automatic pick, its kept ping 0 ms, silent now; A answered: A searched)
    const measured = new Map<string, number | null>([["a", 40]]);
    const plan = searchPlan(listed, { ids: ["c"], manual: false }, ["c"], measured, [1]);
    expect(plan).toEqual({ chosen: ["a"], automatic: true, request: { playlists: [1], pings: { "a.example:4433": 40 }, regions: ["a.example:4433"] } });
    // (the player's ticks kept, whatever answered)
    expect(searchPlan(listed, { ids: ["c"], manual: true }, ["c"], measured, [1])).toMatchObject({ chosen: ["c"], automatic: false });
    // (one region: that one, no pick)
    expect(searchPlan([{ id: "a", server: "a.example:4433" }], null, [], measured, [2]).automatic).toBe(false);
  });

  it("a ping's answer: its ms and its name; a name the matchmaker wouldn't take, no answer; none, from before the name, its URL's (RV-893, RV-913)", () => {
    expect(pingAnswer({ ms: 31, server: "game-eu.example:4433" })).toEqual({ ms: 31, name: "game-eu.example:4433" });
    expect(pingAnswer({ ms: 31, server: "bad_name:4433" })).toBeNull();
    expect(pingAnswer({ ms: 31, server: "" })).toEqual({ ms: 31, name: null });
    expect(pingAnswer(null)).toBeNull();
  });
});
