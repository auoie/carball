// The search session against a stand-in server: its hello (the browser's key, a returning token) and its answers (RV-367)
import { afterEach, describe, expect, it, vi } from "vitest";
import { type SearchHandlers } from "../game/matchmaking";
import { fakeTransport, type FakeTransportRecord } from "../testing/fakeTransport";
import { decodeControl } from "./protocol";
import { Search, browserKey } from "./search";

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
    found: (token) => {
      got.push(`found ${token.toString()}`);
      finish();
    },
    failed: (reason) => {
      got.push(`failed ${reason}`);
      finish();
    },
    cooldown: (seconds) => {
      got.push(`cooldown ${String(seconds)}`);
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
    storage.setItem("rl-clone.browserKey", "garbage");
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

  it("sends the browser's key and a returning token, and passes a no-show's cooldown on (RV-367)", async () => {
    const record: FakeTransportRecord = { sessions: [] };
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "searchCooldown", seconds: 112 }], record));
    const { handlers, got, done } = answers();
    Search.start({ url: "https://game.example:4433/play", certHash: null }, 2, 77n, handlers);
    await done;
    expect(got).toEqual(["searching", "cooldown 112"]);
    const written = record.sessions[0]?.written[0] ?? new Uint8Array();
    const hello = decodeControl(written.subarray(2));
    expect(hello).toMatchObject({ type: "hello", intent: "search", playlist: 2, token: 77n });
    expect(hello.type === "hello" && hello.key).toBe(browserKey());
  });

  it("passes a match found on", async () => {
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "matchFound", token: 5n }]));
    const { handlers, got, done } = answers();
    Search.start({ url: "https://game.example:4433/play", certHash: null }, 1, 0n, handlers);
    await done;
    expect(got).toEqual(["searching", "found 5"]);
  });
});
