// The training packs' index (src/training/packs.ts): each listing checked, read from the index's folder (a build has no
// loader for the user's packs: the shipped-data guard checks no local asset path ships)
import { describe, expect, it } from "vitest";
import { listPacks, loadPack, readIndex } from "./packs";
import { SHARED } from "./shared";
import { STARTER_PACKS } from "./starterPacks";

describe("the training packs' index", () => {
  it("lists each pack by id, name, type, difficulty and shots, read from its folder; a broken entry left out", () => {
    const index = {
      format: 1,
      packs: [{ id: "abc123", name: "Air", type: "aerial", difficulty: "hard", shots: 12, creator: "Someone" }, { id: "../x" }, { id: "plain" }],
    };
    expect(readIndex(index, "/p/")).toEqual([
      { id: "abc123", name: "Air", type: "aerial", difficulty: "hard", shots: 12, creator: "Someone", url: "/p/abc123.json" },
      { id: "plain", name: "plain", type: "striker", difficulty: "easy", shots: 0, creator: "", url: "/p/plain.json" },
    ]);
    expect(readIndex({ format: 2, packs: [] }, "/p/")).toEqual([]);
  });
});

describe("the packs listed", () => {
  it("marks Carball's starter packs (their own tab), and only them: the dev server's packs not", async () => {
    const index = { format: 1, packs: [{ id: "local1", name: "Local", type: "striker", difficulty: "easy", shots: 3, creator: "" }] };
    const fetcher = (() => Promise.resolve(new Response(JSON.stringify(index)))) as typeof fetch;
    const packs = await listPacks(fetcher);
    expect(packs.filter((p) => p.starter).map((p) => p.id)).toEqual(STARTER_PACKS.map((p) => p.id));
    expect(packs.filter((p) => p.starter && p.mine)).toEqual([]);
    expect(packs.filter((p) => !p.starter).map((p) => p.id)).toEqual(import.meta.env.DEV ? ["local1"] : []);
  });
});

describe("a shared pack's read (SEC-API-04)", () => {
  it("carries the page's header: the API counts a download for it alone", async () => {
    const calls: { url: string; headers: unknown }[] = [];
    const fetcher = ((url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers });
      return Promise.resolve(new Response("{}", { status: 404 }));
    }) as typeof fetch;
    const listing = { id: "shared-x", name: "X", type: "striker", difficulty: "easy", shots: 1, url: `${SHARED}ABCD-EFGH-JKLM-NPQR` } as unknown as Parameters<
      typeof loadPack
    >[0];
    expect(await loadPack(listing, fetcher)).toBe("no shared pack ABCD-EFGH-JKLM-NPQR");
    expect(calls).toEqual([{ url: "/api/packs/ABCD-EFGH-JKLM-NPQR", headers: { "X-Carball": "1" } }]);
  });
});
