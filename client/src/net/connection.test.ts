// The connection's pieces that need no server: the stored key (RV-239) and the queue for messages before the game
// listens (RV-241).
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeTransport } from "../testing/fakeTransport";
import { Connection, ControlQueue, RefusedError, serverHost, storeKey, storedKey } from "./connection";
import { REFUSED_TOKEN } from "./protocol";

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

describe("the connection", () => {
  it("keeps the server's key for the next connection; none, or garbage, is 0 (the server gives one)", () => {
    const storage = memory();
    expect(storedKey(storage)).toBe(0n);
    storeKey(0xdeadbeefcafef00dn, storage);
    expect(storedKey(storage)).toBe(0xdeadbeefcafef00dn); // (64 bits: SEC-9)
    storeKey(0xffffffffffffffffn, storage);
    expect(storedKey(storage)).toBe(0xffffffffffffffffn);
    for (const garbage of ["1.5", "-3", "0", "18446744073709551616", "0x10", " 7", "123456789012345678901"]) {
      storage.setItem("rl-clone.playerKey", garbage);
      expect(storedKey(storage), garbage).toBe(0n);
    }
    expect(storedKey(null)).toBe(0n);
    const failing: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(storedKey(failing)).toBe(0n);
    expect(() => {
      storeKey(7n, failing);
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

  it("reaches localhost at 127.0.0.1 (Windows tries ::1 first, which a WSL server's UDP never sees)", () => {
    expect([serverHost("localhost"), serverHost("LOCALHOST"), serverHost(""), serverHost("127.0.0.1"), serverHost("game.example")]).toEqual([
      "127.0.0.1",
      "127.0.0.1",
      "127.0.0.1",
      "127.0.0.1",
      "game.example",
    ]);
  });
});

describe("a refused hello", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a RefusedError with the server's reason (a claim's dead token: back to the queue, RV-363; RX13's C11)", async () => {
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "refused", reason: REFUSED_TOKEN }]));
    const preferences = { team: 255, body: 0, dodgeDeadzone: 0.5, steeringSensitivity: 1, airControlSensitivity: 1, autoSkipReplay: false, name: "", quickChat: "everyone", blockNonTactical: false } as const;
    const opened = Connection.open({ url: "https://game.example:4433/play", certHash: null }, preferences, { intent: "claim", token: 9n });
    await expect(opened).rejects.toBeInstanceOf(RefusedError);
    await expect(opened).rejects.toMatchObject({ reason: REFUSED_TOKEN });
  });
});
