// The regions a search goes to (notes/matchmaking.md, Regions), with made-up regions and pings
import { describe, expect, it } from "vitest";
import { chooseRegions, regionsToSearch, shareSearchTickets, storeRegions, storedRegions, toggleRegion } from "./regions";

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
