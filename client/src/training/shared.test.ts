// Shared packs' helpers (training/shared.ts): a code as typed made the API's shape; a shared pack's listing (its url the
// API's), its file played (checked as any pack, its creator the uploader's), a saved copy; a shared listing loaded through
// the API (training/packs.ts loadPack). Made-up packs and codes.
import { describe, expect, it, vi } from "vitest";
import type { SharedPack } from "../account/api";
import { newPack, newPackId, packFile } from "./myPacks";
import { loadPack } from "./packs";
import { SHARED, savedCopy, shareCode, sharedListing, sharedPackOf } from "./shared";

const LISTED: SharedPack = {
  code: "0A1B-2C3D-4E5F-6071",
  name: "Made Up Drills",
  description: "",
  creator: "Some_Creator",
  type: "goalie",
  difficulty: "hard",
  shots: 3,
  downloads: 7,
  createdAt: "2026-10-29T12:00:00Z",
  hidden: false,
  hiddenReason: "",
};

describe("shared training packs", () => {
  it("takes a code as typed: any case, its dashes and spaces optional; else none", () => {
    expect(shareCode("0a1b-2c3d-4e5f-6071")).toBe("0A1B-2C3D-4E5F-6071");
    expect(shareCode(" 0A1B 2C3D 4E5F 6071 ")).toBe("0A1B-2C3D-4E5F-6071");
    expect(shareCode("0a1b2c3d4e5f6071")).toBe("0A1B-2C3D-4E5F-6071");
    // (as the game reads one: any letters, anything else dropped)
    expect(shareCode("GA1B-2C3D-4E5F-6071")).toBe("GA1B-2C3D-4E5F-6071");
    expect(shareCode("0A1B_2C3D/4E5F.6071")).toBe("0A1B-2C3D-4E5F-6071");
    // (en dashes, as chat apps turn dashes into: RV-1200)
    expect(shareCode("0A1B\u20132C3D\u20134E5F\u20136071")).toBe("0A1B-2C3D-4E5F-6071");
    for (const bad of ["", "0A1B-2C3D-4E5F-607", "0A1B-2C3D-4E5F-60712", "not a code"]) expect(shareCode(bad)).toBeNull();
  });

  it("lists a shared pack with the API's url, its type and difficulty as the page knows them", () => {
    expect(sharedListing(LISTED)).toEqual({
      id: "shared-0a1b-2c3d-4e5f-6071",
      name: "Made Up Drills",
      type: "goalie",
      difficulty: "hard",
      shots: 3,
      creator: "Some_Creator",
      url: `${SHARED}0A1B-2C3D-4E5F-6071`,
    });
    expect(sharedListing({ ...LISTED, type: "odd", difficulty: "odd" })).toMatchObject({ type: "striker", difficulty: "easy" });
  });

  it("plays a shared file checked as any pack, its creator the uploader's; a copy saved with an id of its own", () => {
    const file = packFile({ ...newPack(() => 0.5), name: "Made Up Drills", creator: "anyone" });
    const pack = sharedPackOf(file, "Some_Creator");
    if (typeof pack === "string") throw new Error(pack);
    expect(pack.creator).toBe("Some_Creator");
    expect(typeof sharedPackOf({ format: 1, id: "x", shots: [] }, "Some_Creator")).toBe("string");
    const copy = savedCopy(pack, new Set());
    expect(copy.id).not.toBe(pack.id);
    expect(copy.id).toMatch(/^mine-/);
    expect(copy.shots).toEqual(pack.shots);
    // (an id taken drawn again: never one of the player's)
    const draws = [0.25, 0.25, 0.5];
    const taken = savedCopy(pack, new Set([newPackId(() => 0.25)]), () => draws.shift() ?? 0.75);
    expect(taken.id).toBe(newPackId(() => 0.5));
  });

  it("loads a shared listing through the API (its pack checked, its creator the API's); a missing code says so", async () => {
    const file = packFile({ ...newPack(() => 0.5), name: "Made Up Drills" });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...LISTED, pack: file })))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const pack = await loadPack(sharedListing(LISTED), fetcher);
    if (typeof pack === "string") throw new Error(pack);
    expect(pack.creator).toBe("Some_Creator");
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/packs/0A1B-2C3D-4E5F-6071");
    expect(await loadPack(sharedListing(LISTED), fetcher)).toBe("no shared pack 0A1B-2C3D-4E5F-6071");
  });
});
