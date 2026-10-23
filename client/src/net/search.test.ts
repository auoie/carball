// The search session against a stand-in server: its hello (the browser's key, a returning token) and its answers (RV-367)
import { afterEach, describe, expect, it, vi } from "vitest";
import { type SearchHandlers } from "../game/matchmaking";
import { fakeTransport, type FakeTransportRecord } from "../testing/fakeTransport";
import { KICK_REPLACED, REFUSED_QUEUE_BANNED, decodeControl } from "./protocol";
import { SEARCH_ENDED, Search, browserKey, declineSlot, pingServer } from "./search";

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

function answers(): { handlers: SearchHandlers; got: string[]; done: Promise<void> } {
  const got: string[] = [];
  let finish = (): void => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const handlers: SearchHandlers = {
    searching: () => got.push("searching"),
    found: (token, map) => {
      got.push(`found ${token.toString()} on map ${String(map)}`);
      finish();
    },
    failed: (reason) => {
      got.push(`failed ${reason}`);
      finish();
    },
    refused: (reason) => got.push(`refused ${String(reason)}`),
    cooldown: (seconds, network) => {
      got.push(`cooldown ${String(seconds)}${network ? " network" : ""}`);
      finish();
    },
    replaced: () => {
      got.push("replaced");
      finish();
    },
  };
  return { handlers, got, done };
}

describe("a search", () => {
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

  it("passes a refusal on with its reason, then in words (RX32: a refused search's seat put back)", async () => {
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "refused", reason: REFUSED_QUEUE_BANNED }]));
    const { handlers, got, done } = answers();
    Search.start({ url: "https://game.example:4433/play", certHash: null }, 2, 0n, handlers);
    await done;
    expect(got).toEqual(["searching", `refused ${String(REFUSED_QUEUE_BANNED)}`, "failed you left a ranked match: you can search again in a few minutes"]);
  });

  it("sends the browser's key and a returning token, and passes a no-show's cooldown on (RV-367)", async () => {
    const record: FakeTransportRecord = { sessions: [] };
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "searchCooldown", seconds: 112, network: true }], record));
    const { handlers, got, done } = answers();
    Search.start({ url: "https://game.example:4433/play", certHash: null }, 2, 77n, handlers);
    await done;
    expect(got).toEqual(["searching", "cooldown 112 network"]);
    const written = record.sessions[0]?.written[0] ?? new Uint8Array();
    const hello = decodeControl(written.subarray(2));
    expect(hello).toMatchObject({ type: "hello", intent: "search", playlist: 2, token: 77n });
    expect(hello.type === "hello" && hello.key).toBe(browserKey());
    expect(hello.type === "hello" && hello.ticket).toBe("");
    // (the account's ticket, asked for each search, in its hello)
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "searchCooldown", seconds: 1, network: false }], record));
    const second = answers();
    Search.start({ url: "https://game.example:4433/play", certHash: null, ticket: () => Promise.resolve("Zm9v-_") }, 1, 0n, second.handlers);
    await second.done;
    const ticketed = decodeControl(record.sessions[1]?.written[0]?.subarray(2) ?? new Uint8Array());
    expect(ticketed).toMatchObject({ type: "hello", intent: "search", playlist: 1, ticket: "Zm9v-_", key: 0n });
  });

  it("says another tab's search took its place (Kicked, KICK_REPLACED: RV-460), not that the connection was lost", async () => {
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "kicked", reason: KICK_REPLACED }]));
    const { handlers, got, done } = answers();
    Search.start({ url: "https://game.example:4433/play", certHash: null }, 2, 0n, handlers);
    await done;
    expect(got).toEqual(["searching", "replaced"]);
  });

  it("finishing closes its stream and waits for what the server sent before it saw that: a match formed as the page went reaches it (RV-443, CM8)", async () => {
    const record: FakeTransportRecord = { sessions: [] };
    vi.stubGlobal("WebTransport", fakeTransport([], record, false, [{ type: "matchFound", token: 8n, map: 2 }]));
    const { handlers, got } = answers();
    const search = Search.start({ url: "https://game.example:4433/play", certHash: null }, 1, 0n, handlers);
    await vi.waitFor(() => {
      expect(got).toEqual(["searching"]);
    });
    const started = performance.now();
    await search.finish();
    expect(record.sessions[0]?.finished).toBe(true);
    expect(got).toEqual(["searching", "found 8 on map 2"]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("a kick it doesn't know ends it in neutral words, not as a lost connection (RV-485)", async () => {
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "kicked", reason: 99 }]));
    const { handlers, got, done } = answers();
    Search.start({ url: "https://game.example:4433/play", certHash: null }, 2, 0n, handlers);
    await done;
    expect(got).toEqual(["searching", `failed ${SEARCH_ENDED}`]);
  });

  it("passes a match found on", async () => {
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "matchFound", token: 5n, map: 4 }]));
    const { handlers, got, done } = answers();
    Search.start({ url: "https://game.example:4433/play", certHash: null }, 1, 0n, handlers);
    await done;
    expect(got).toEqual(["searching", "found 5 on map 4"]);
  });

  it("a region's ping: a hello with intent ping, no ticket, timed to the server's answer, the better of two; none, null (Regions)", async () => {
    const record: FakeTransportRecord = { sessions: [] };
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "pong" }], record));
    const ms = await pingServer({ url: "https://game-eu.example:4433/play", certHash: null, ticket: () => Promise.reject(new Error("not asked")) });
    expect(typeof ms === "number" && ms >= 0).toBe(true);
    expect(record.sessions.length).toBe(2);
    for (const session of record.sessions) {
      const hello = decodeControl((session.written[0] ?? new Uint8Array()).subarray(2));
      expect(hello).toMatchObject({ type: "hello", intent: "ping", token: 0n, ticket: "", key: 0n });
      expect(session.closed).toBe(true);
    }
    // (no answer: the stream ended without one)
    vi.stubGlobal("WebTransport", fakeTransport([]));
    expect(await pingServer({ url: "https://game-eu.example:4433/play", certHash: null })).toBeNull();
  });

  it("gives up a slot found in another region: a hello with intent decline, its token and a ticket; the session closed (Regions)", async () => {
    const record: FakeTransportRecord = { sessions: [] };
    vi.stubGlobal("WebTransport", fakeTransport([], record));
    await declineSlot({ url: "https://game-asia.example:4433/play", certHash: null, ticket: () => Promise.resolve("dGlj") }, 41n);
    const session = record.sessions[0];
    expect(session?.url).toBe("https://game-asia.example:4433/play");
    const hello = decodeControl((session?.written[0] ?? new Uint8Array()).subarray(2));
    expect(hello).toMatchObject({ type: "hello", intent: "decline", token: 41n, ticket: "dGlj", key: 0n });
    expect(session?.closed).toBe(true);
    // (a ticket refused: nothing sent, nothing thrown)
    const none: FakeTransportRecord = { sessions: [] };
    vi.stubGlobal("WebTransport", fakeTransport([], none));
    await declineSlot({ url: "https://game-asia.example:4433/play", certHash: null, ticket: () => Promise.reject(new Error("signed out")) }, 41n);
    expect(none.sessions).toEqual([]);
  });
});
