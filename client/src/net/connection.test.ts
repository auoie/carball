// The connection's pieces that need no server: the stored key (RV-239) and the queue for messages before the game
// listens (RV-241).
import { describe, expect, it } from "vitest";
import { ControlQueue, storeKey, storedKey } from "./connection";

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

describe("the connection", () => {
  it("keeps the server's key for the next connection; none, or garbage, is 0 (the server gives one)", () => {
    const storage = memory();
    expect(storedKey(storage)).toBe(0);
    storeKey(0xdeadbeef, storage);
    expect(storedKey(storage)).toBe(0xdeadbeef);
    storage.setItem("rl-clone.playerKey", "1.5");
    expect(storedKey(storage)).toBe(0);
    expect(storedKey(null)).toBe(0);
    const failing: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(storedKey(failing)).toBe(0);
    expect(() => {
      storeKey(7, failing);
    }).not.toThrow();
  });

  it("messages before the game listens wait, in order; later ones go straight through", () => {
    const queue = new ControlQueue<number>();
    const got: number[] = [];
    queue.push(1);
    queue.push(2);
    queue.listen((m) => got.push(m));
    queue.push(3);
    expect(got).toEqual([1, 2, 3]);
  });
});
