import { describe, expect, it } from "vitest";
import { migrateStorageKeys } from "./storageKeys";

const memory = (): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

describe("the storage keys' new names (carball.*)", () => {
  it("carry a player's settings, playlist and browser key over once, never over newer values", () => {
    const store = memory();
    store.setItem("rl-clone.settings.v1", '{"camera":{"fov":110}}');
    store.setItem("rl-clone.playlist", "2");
    store.setItem("rl-clone.browserKey", "123456789");
    store.setItem("carball.playlist", "3"); // (already the new name's: kept)
    store.setItem("other", "x");
    expect(migrateStorageKeys(store)).toBe(3);
    expect(Object.fromEntries(store.map)).toEqual({
      "carball.settings.v1": '{"camera":{"fov":110}}',
      "carball.playlist": "3",
      "carball.browserKey": "123456789",
      other: "x",
    });
    expect(migrateStorageKeys(store), "once").toBe(0);
    expect(migrateStorageKeys(null)).toBe(0);
  });
});
