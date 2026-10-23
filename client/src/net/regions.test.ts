// The regions a search goes to (notes/matchmaking.md, Regions), with made-up regions and pings
import { describe, expect, it } from "vitest";
import {
  PINGS_KEPT_MS,
  chooseRegions,
  regionsToSearch,
  shareSearchTickets,
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

  it("searches the chosen regions and a returning token's own; a page of one region, that one (RX43C-1)", () => {
    expect(regionsToSearch(regions, ["eu"])).toEqual(["eu"]);
    expect(regionsToSearch(regions, ["eu"], "asia")).toEqual(["eu", "asia"]);
    expect(regionsToSearch(regions, ["asia", "us-east"])).toEqual(["us-east", "asia"]);
    expect(regionsToSearch([{ id: "default" }], [])).toEqual(["default"]);
  });

  it("shares one search ticket among the regions of one source; a rejoin's and another source's apart (RX43C-2)", async () => {
    let issued = 0;
    const ticket = (rejoin?: bigint): Promise<string> => {
      issued++;
      return Promise.resolve(rejoin === undefined ? `t${String(issued)}` : `rejoin${String(issued)}`);
    };
    const share = shareSearchTickets();
    const [a, b, c] = [share(ticket, "account"), share(ticket, "account"), share(ticket, "dev:127.0.0.1:14448")];
    expect(await Promise.all([a(), b(), a()])).toEqual(["t1", "t1", "t1"]);
    expect(await c()).toBe("t2");
    expect(await a(5n)).toBe("rejoin3");
    // (a refusal shared as one: asked for once)
    let asked = 0;
    const refusing = (): Promise<string> => {
      asked++;
      return Promise.reject(new Error("429"));
    };
    const again = shareSearchTickets();
    const [x, y] = [again(refusing, "account"), again(refusing, "account")];
    await expect(x()).rejects.toThrow("429");
    await expect(y()).rejects.toThrow("429");
    expect(asked).toBe(1);
  });
});
