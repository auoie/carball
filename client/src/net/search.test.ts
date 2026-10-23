// The regions' pings against a stand-in server, and this browser's key
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeTransport, type FakeTransportRecord } from "../testing/fakeTransport";
import { decodeControl } from "./protocol";
import { browserKey, pingServer } from "./search";

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

describe("the pings and the browser's key", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the browser's key: random, 64 bits, the same next time; this page's own if storage fails", () => {
    const storage = memory();
    const key = browserKey(storage);
    expect(key > 0n && key < 1n << 64n).toBe(true);
    expect(browserKey(storage)).toBe(key);
    storage.setItem("carball.browserKey", "garbage");
    expect(browserKey(storage)).not.toBe(0n);
    const failing: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const page = browserKey(failing);
    expect(page).not.toBe(0n);
    expect(browserKey(null)).toBe(page);
  });

  it("a region's ping: a hello with intent ping, no ticket, timed to the server's answer, the better of two; none, null (Regions)", async () => {
    const record: FakeTransportRecord = { sessions: [] };
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "pong", server: "game-eu.example:4433" }], record));
    const answer = await pingServer({ url: "https://game-eu.example:4433/play", certHash: null, ticket: () => Promise.reject(new Error("not asked")) });
    expect(answer !== null && answer.ms >= 0).toBe(true);
    // (the server's name as its Pong says it: the matchmaker's for it, RV-863)
    expect(answer?.server).toBe("game-eu.example:4433");
    expect(record.sessions.length).toBe(2);
    for (const session of record.sessions) {
      const hello = decodeControl((session.written[0] ?? new Uint8Array()).subarray(2));
      expect(hello).toMatchObject({ type: "hello", intent: "ping", token: 0n, ticket: "", key: 0n });
      expect(session.closed).toBe(true);
    }
    // (no answer: the stream ended without one; not tried again, RV-842)
    const unanswered: FakeTransportRecord = { sessions: [] };
    vi.stubGlobal("WebTransport", fakeTransport([], unanswered));
    expect(await pingServer({ url: "https://game-eu.example:4433/play", certHash: null })).toBeNull();
    expect(unanswered.sessions.length).toBe(1);
    // (anything but a Pong: a server of another protocol version refusing the hello is unreached, RV-864)
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "refused", reason: 1 }]));
    expect(await pingServer({ url: "https://game-eu.example:4433/play", certHash: null })).toBeNull();
  });
});
