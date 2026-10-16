import { describe, expect, it } from "vitest";
import type { Update } from "./protocol";
import { type CompleteUpdate, UpdateAssembler } from "./updates";

const part = (serverTick: number, index: number, parts: number): Update => ({
  serverTick,
  ackFrame: serverTick,
  receivedFrame: serverTick,
  echoTimestamp: 0,
  echoDelay: 0,
  bufferTarget: 7,
  bufferSize: 7,
  bufferLow: 0,
  bufferHigh: 0,
  bufferOver: 0,
  bufferUnder: 0,
  inputLoss: 0,
  part: index,
  parts,
  state: Uint8Array.of(serverTick, index),
});

/** [server tick, part numbers] of each yielded update */
const summary = (us: readonly CompleteUpdate[]): [number, number[]][] =>
  us.map((u) => [u.update.serverTick, u.states.map((s) => s[1] ?? -1)]);

describe("UpdateAssembler", () => {
  it("yields an update once all parts are in, in any order; a part is yielded once", () => {
    const a = new UpdateAssembler();
    expect(a.add(part(10, 1, 2))).toEqual([]);
    expect(a.add(part(10, 1, 2))).toEqual([]); // duplicate
    expect(summary(a.add(part(10, 0, 2)))).toEqual([[10, [0, 1]]]);
    expect(a.add(part(10, 0, 2))).toEqual([]); // already yielded
  });

  it("an older update missing a part is yielded before a newer complete one (its bodies may have nothing newer)", () => {
    const a = new UpdateAssembler();
    expect(a.add(part(10, 0, 2))).toEqual([]); // its second part is late
    expect(summary(a.add(part(12, 0, 1)))).toEqual([[10, [0]], [12, [0]]]);
  });

  it("a late part, or a reordered update, is yielded on its own", () => {
    const a = new UpdateAssembler();
    expect(a.add(part(10, 0, 2))).toEqual([]);
    a.add(part(12, 0, 1));
    expect(summary(a.add(part(10, 1, 2)))).toEqual([[10, [1]]]);
    expect(a.add(part(10, 1, 2))).toEqual([]); // (once)
    expect(summary(a.add(part(11, 0, 1)))).toEqual([[11, [0]]]);
    expect(summary(a.add(part(14, 0, 1)))).toEqual([[14, [0]]]);
  });

  it("flush gives the parts that came of updates missing one (a lost datagram costs only its bodies)", () => {
    const a = new UpdateAssembler();
    expect(a.add(part(10, 0, 2))).toEqual([]);
    expect(a.add(part(12, 1, 3))).toEqual([]);
    expect(summary(a.flush())).toEqual([[10, [0]], [12, [1]]]);
    expect(a.flush()).toEqual([]);
    // A part arriving after its update was flushed still applies, once
    expect(summary(a.add(part(12, 0, 3)))).toEqual([[12, [0]]]);
    expect(a.add(part(12, 1, 3))).toEqual([]);
    expect(a.flush()).toEqual([]);
  });

  it("ignores malformed part numbers", () => {
    const a = new UpdateAssembler();
    expect(a.add(part(10, 2, 2))).toEqual([]);
    expect(a.add(part(10, 0, 0))).toEqual([]);
  });
});
