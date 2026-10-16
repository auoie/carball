// The stat graphs' network rows fed (HUD-21, SG2, protocol 24)
import { describe, expect, it } from "vitest";
import { StatGraphData, type StatContext } from "../game/statGraphs";
import { EXPECTED_PACKETS, NetGraphFeed, UPDATE_HEADER_BYTES, rawRoundTrip } from "./netStats";
import type { Update } from "./protocol";

const CONTEXT: StatContext = { targetFps: 60, maxBytesRate: 150_000, expectedOutPackets: EXPECTED_PACKETS.out, expectedInPackets: EXPECTED_PACKETS.in, metric: true };

const update = (serverTick: number, more: Partial<Update> = {}): Update => ({
  serverTick,
  ackFrame: 0,
  receivedFrame: 0,
  echoTimestamp: 0,
  echoDelay: 0,
  bufferTarget: 4,
  bufferSize: 3,
  bufferLow: 2,
  bufferHigh: 5,
  bufferOver: 0,
  bufferUnder: 0,
  inputLoss: 0,
  part: 0,
  parts: 1,
  state: new Uint8Array(70),
  ...more,
});

/** A row's summaries at `now` on the Network graph (long) */
const row = (data: StatGraphData, title: string, now: number): (number | null)[] => data.view("networkLong", now, CONTEXT).find((r) => r.title === title)?.summaries.map((s) => s.value) ?? [];

describe("the network rows fed (HUD-21, SG2)", () => {
  it("counts per 1-second period, stepping once a second: packets and bytes each way, the updates the server skipped (In Loss), its inputs lost (Out Loss)", () => {
    const data = new StatGraphData();
    const feed = new NetGraphFeed(data);
    let now = 0;
    const run = (to: number): void => {
      for (let i = Math.round(now * 60) + (now > 0 ? 1 : 0); i <= to; i++) {
        now = i / 60;
        if (i < 60) {
          feed.sent(25);
          // (every update but the 30th: one lost, the next's tick two updates on)
          if (i !== 30) feed.received(update(1000 + 2 * i, { inputLoss: i === 40 ? 2 : 0 }), null);
        }
        feed.frame(now);
        data.sample(now);
      }
    };
    run(90);
    // (the first second's counts, the rows' values through the second: Latest)
    expect(row(data, "Out Pkt", now)[0]).toBe(60);
    expect(row(data, "In Pkt", now)[0]).toBe(59);
    expect(row(data, "Out Bytes", now)[0]).toBe(60 * 25);
    expect(row(data, "In Bytes", now)[0]).toBe(59 * (70 + UPDATE_HEADER_BYTES));
    expect(row(data, "In Loss", now)[0]).toBe(1);
    expect(row(data, "Out Loss", now)[0]).toBe(2);
    // (and the next second's: nothing sent or received)
    run(130);
    expect(row(data, "Out Pkt", now)[0]).toBe(0);
    expect(row(data, "Out Pkt", now)[1]).toBe(60);
  });

  it("the server's window per update: IBuf its fewest and most frames, its target, IBuf Miss its skipped less missing frames; offline every row 0", () => {
    const data = new StatGraphData();
    const feed = new NetGraphFeed(data);
    feed.received(update(10, { bufferOver: 1 }), 42);
    data.sample(0.5);
    feed.received(update(12, { bufferUnder: 2 }), 40);
    data.sample(0.52);
    expect(row(data, "IBuf", 0.52)).toEqual([2, 5, 2]);
    expect(row(data, "IBuf Target", 0.52)[0]).toBe(4);
    expect(row(data, "IBuf Miss", 0.52)).toEqual([3, 1, -2]);
    expect(row(data, "Latency", 0.52)).toEqual([41, 42, 40]);
    expect(row(data, "Phys Rate", 0.52)[0]).toBe(120);
    const offline = new StatGraphData();
    NetGraphFeed.offline(offline);
    offline.sample(0);
    expect(row(offline, "Out Pkt", 0)[0]).toBe(0);
    expect(row(offline, "IBuf Miss", 0)[0]).toBe(0);
  });

  it("the latency: the raw round trip (now less the echoed stamp and the server's hold), none without an echo", () => {
    expect(rawRoundTrip({ echoTimestamp: 1000, echoDelay: 8 }, 1050)).toBe(42);
    expect(rawRoundTrip({ echoTimestamp: 0, echoDelay: 0 }, 1050)).toBeNull();
    expect(rawRoundTrip({ echoTimestamp: 1000, echoDelay: 80 }, 1050)).toBeNull();
  });
});
