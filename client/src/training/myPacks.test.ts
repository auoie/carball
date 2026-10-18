// The player's own packs (src/training/myPacks.ts): a new pack's default shot (CTR-3), the pack file read back as written,
// kept, replaced and deleted in the browser's storage
import { describe, expect, it } from "vitest";
import { defaultShot, deletePack, newPack, packFile, storePack, storePacks, storedPacks } from "./myPacks";
import { parsePack } from "./pack";
import { ShotStatus } from "./run";
import { storeProgress, storedProgress } from "./settings";

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

describe("the player's packs", () => {
  it("a new pack: our id, one default shot (the striker's ball 1000 uu before the orange goal at 45° and 1500, the car at the centre)", () => {
    const pack = newPack(() => 0.5);
    expect(pack.id).toMatch(/^mine-[a-z0-9]{8}$/);
    expect(pack.shots).toEqual([defaultShot("striker")]);
    const s = defaultShot("striker");
    expect([s.ball.location.y, s.ball.launch.pitch, s.ball.speed, s.car.location.y, s.timeLimit]).toEqual([4120, 8192, 1500, 0, 10]);
    const g = defaultShot("goalie");
    expect([g.ball.location.y, g.car.location.y]).toEqual([0, -5000]);
  });

  it("a pack's file reads back as the pack", () => {
    const pack = { ...newPack(), name: "Mine", tags: ["Aerials"], shots: [defaultShot("striker"), defaultShot("goalie")] };
    expect(parsePack(JSON.parse(JSON.stringify(packFile(pack))))).toEqual(pack);
  });

  it("kept, replaced by id and deleted in the browser's storage", () => {
    const store = memory();
    const a = newPack(() => 0.1);
    const b = newPack(() => 0.2);
    storePack(a, store);
    storePack(b, store);
    storePack({ ...a, name: "Renamed" }, store);
    expect(storedPacks(store).map((p) => [p.id, p.name])).toEqual([
      [a.id, "Renamed"],
      [b.id, b.name],
    ]);
    deletePack(a.id, store);
    expect(storedPacks(store).map((p) => p.id)).toEqual([b.id]);
  });

  it("a pack's progress under its own prefix: a pack with the id \"mine\" can't overwrite the player's packs (RX25); 437863a's key still read", () => {
    const store = memory();
    for (let i = 0; i < 3; i++)
      storePack(
        newPack(() => i / 10),
        store,
      );
    storeProgress("mine", [ShotStatus.Completed], store);
    expect(storedPacks(store)).toHaveLength(3);
    expect(storedProgress("mine", store)).toEqual([ShotStatus.Completed]);
    store.setItem("carball.training.starter-a", "[2,1]");
    expect(storedProgress("starter-a", store)).toEqual([ShotStatus.Completed, ShotStatus.Attempted]);
    storeProgress("starter-a", [ShotStatus.Attempted], store);
    expect(storedProgress("starter-a", store)).toEqual([ShotStatus.Attempted]);
  });

  it("a save the browser refuses (its storage full) says so", () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(storePack(newPack(), full)).toBe(false);
    expect(storePacks([], memory())).toBe(true);
  });
});
