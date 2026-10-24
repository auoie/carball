// The regions' pings against a stand-in server
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeTransport, type FakeTransportRecord } from "../testing/fakeTransport";
import { decodeControl, encodeControl } from "./protocol";
import { pingServer } from "./search";

describe("the pings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a region's ping: a hello with intent ping, no ticket, timed to the server's answer, the better of two; none, null (Regions)", async () => {
    const record: FakeTransportRecord = { sessions: [] };
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "pong", server: "game-eu.example:4433" }], record));
    const answer = await pingServer({ url: "https://game-eu.example:4433/play", certHash: null, ticket: () => Promise.reject(new Error("not asked")) });
    if (answer === null || answer === "outdated") throw new Error(`no pong: ${String(answer)}`);
    expect(answer.ms).toBeGreaterThanOrEqual(0);
    // (the server's name as its Pong says it: the matchmaker's for it, RV-863)
    expect(answer.server).toBe("game-eu.example:4433");
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
    // (the first message read alone, the rest of its chunk left: a Pong and more bytes in one read, RV-913's K11)
    const pong = encodeControl({ type: "pong", server: "b.example:4433" });
    const more = encodeControl({ type: "refused", reason: 1 });
    class OneChunk {
      readonly ready = Promise.resolve();
      readonly closed = new Promise<void>(() => undefined);
      createBidirectionalStream(): Promise<{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }> {
        return Promise.resolve({
          readable: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Uint8Array.of(...pong, ...more));
            },
          }),
          writable: new WritableStream<Uint8Array>(),
        });
      }
      close(): void {
        // (nothing held)
      }
    }
    vi.stubGlobal("WebTransport", OneChunk);
    expect(await pingServer({ url: "https://b.example:4433/play", certHash: null }, 1)).toMatchObject({ server: "b.example:4433" });
    // (the first message read alone: a Pong followed by more bytes still answers, RV-887's K11)
    vi.stubGlobal(
      "WebTransport",
      fakeTransport([
        { type: "pong", server: "a.example:4433" },
        { type: "refused", reason: 1 },
      ]),
    );
    expect(await pingServer({ url: "https://a.example:4433/play", certHash: null }, 1)).toMatchObject({ server: "a.example:4433" });
    // (refused on version: this page is older than the server, which updated since it loaded: "outdated", for the
    // menu's reload modal, not an unreached region, RV-1021; not tried again)
    const refusing: FakeTransportRecord = { sessions: [] };
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "refused", reason: 1 }], refusing));
    expect(await pingServer({ url: "https://game-eu.example:4433/play", certHash: null })).toBe("outdated");
    expect(refusing.sessions.length).toBe(1);
    // (anything else but a Pong: unreached, RV-864)
    vi.stubGlobal("WebTransport", fakeTransport([{ type: "refused", reason: 0 }]));
    expect(await pingServer({ url: "https://game-eu.example:4433/play", certHash: null })).toBeNull();
  });
});
