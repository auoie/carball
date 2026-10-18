// The connection's pieces that need no server: the stored key (RV-239) and the queue for messages before the game
// listens (RV-241); the hello's preferences (CM29).
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { type FakeTransportRecord, fakeTransport } from "../testing/fakeTransport";
import { Connection, ControlQueue, RefusedError, serverHost, storeKey, storedKey } from "./connection";
import { joinPreferences } from "./joinPreferences";
import { PROTOCOL_VERSION, REFUSED_TOKEN, decodeControl, decodeDatagram } from "./protocol";

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
      storage.setItem("carball.playerKey", garbage);
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
    const preferences = {
      team: 255,
      model: 0,
      dodgeDeadzone: 0.5,
      steeringSensitivity: 1,
      airControlSensitivity: 1,
      autoSkipReplay: false,
      name: "",
      quickChat: "everyone",
      blockNonTactical: false,
    } as const;
    const opened = Connection.open({ url: "https://game.example:4433/play", certHash: null }, preferences, { intent: "claim", token: 9n });
    await expect(opened).rejects.toBeInstanceOf(RefusedError);
    await expect(opened).rejects.toMatchObject({ reason: REFUSED_TOKEN });
  });
});

describe("a match session's hello", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the garage's car, the one last chosen (its model: CM29), with the player's settings", async () => {
    const welcome = {
      type: "welcome",
      version: PROTOCOL_VERSION,
      carId: 1,
      tickRate: 120,
      frame: 0,
      matchType: "casual",
      teamSize: 1,
      map: 0,
      key: 5n,
      snapshot: new Uint8Array(),
    } as const;
    const record: FakeTransportRecord = { sessions: [] };
    vi.stubGlobal("WebTransport", fakeTransport([welcome], record));
    const stored = new Map([["carball.car", "3"]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) });
    const preferences = joinPreferences(DEFAULT_SETTINGS);
    expect(preferences.model).toBe(3);
    expect(joinPreferences(DEFAULT_SETTINGS, 2).model).toBe(2);
    await Connection.open({ url: "https://game.example:4433/play", certHash: null }, preferences, { intent: "claim", token: 9n });
    const hello = decodeControl(record.sessions[0]?.written[0]?.subarray(2) ?? new Uint8Array());
    expect(hello).toMatchObject({ type: "hello", model: 3, team: 255, intent: "claim", token: 9n });
    expect(hello.type === "hello" && hello.dodgeDeadzone).toBeCloseTo(DEFAULT_SETTINGS.controller.dodgeDeadzone, 6);
  });
});

describe("the input datagrams' count (protocol 24)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("each one's sequence one on from the last, from 0, wrapping at 65536 (RV-529's CM19: the server counts its gaps as lost)", async () => {
    const welcome = {
      type: "welcome",
      version: PROTOCOL_VERSION,
      carId: 1,
      tickRate: 120,
      frame: 0,
      matchType: "casual",
      teamSize: 1,
      map: 0,
      key: 5n,
      snapshot: new Uint8Array(),
    } as const;
    const record: FakeTransportRecord = { sessions: [] };
    vi.stubGlobal("WebTransport", fakeTransport([welcome], record));
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    const { connection } = await Connection.open({ url: "https://game.example:4433/play", certHash: null }, joinPreferences(DEFAULT_SETTINGS), {
      intent: "claim",
      token: 9n,
    });
    const sends = 65_538;
    for (let i = 0; i < sends; i++) connection.sendInputs(i, i + 1, []);
    await new Promise((r) => setTimeout(r, 0));
    const sent = record.sessions[0]?.datagrams ?? [];
    expect(sent).toHaveLength(sends);
    const sequence = (k: number): number => {
      const d = decodeDatagram(sent[k] ?? new Uint8Array());
      return d.type === "inputs" ? d.sequence : -1;
    };
    expect([0, 1, 2, 65_535, 65_536, 65_537].map(sequence)).toEqual([0, 1, 2, 65_535, 0, 1]);
  });
});

describe("a session closed before the game listens", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is told when the game sets its handler (RV-444: a cancel while the match page builds its arena)", async () => {
    const welcome = {
      type: "welcome",
      version: PROTOCOL_VERSION,
      carId: 1,
      tickRate: 120,
      frame: 0,
      matchType: "casual",
      teamSize: 1,
      map: 0,
      key: 5n,
      snapshot: new Uint8Array(),
    } as const;
    vi.stubGlobal("WebTransport", fakeTransport([welcome], { sessions: [] }, true));
    const preferences = {
      team: 255,
      model: 0,
      dodgeDeadzone: 0.5,
      steeringSensitivity: 1,
      airControlSensitivity: 1,
      autoSkipReplay: false,
      name: "",
      quickChat: "everyone",
      blockNonTactical: false,
    } as const;
    const { connection } = await Connection.open({ url: "https://game.example:4433/play", certHash: null }, preferences, { intent: "claim", token: 9n });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(connection.closed).toBe(true);
    const reasons: string[] = [];
    connection.onClose = (reason) => reasons.push(reason);
    expect(reasons).toEqual(["closed by the server"]);
  });
});
