import { describe, expect, it } from "vitest";
import type { Update } from "./protocol";
import { UpdateAssembler } from "./updates";

const part = (serverTick: number, index: number, parts: number): Update => ({
  serverTick,
  ackFrame: serverTick,
  receivedFrame: serverTick,
  echoTimestamp: 0,
  echoDelay: 0,
  bufferTarget: 7,
  bufferSize: 7,
  part: index,
  parts,
  state: Uint8Array.of(serverTick, index),
});

describe("UpdateAssembler", () => {
  it("yields an update once all parts are in, in any order", () => {
    const a = new UpdateAssembler();
    expect(a.add(part(10, 1, 2))).toBeNull();
    expect(a.add(part(10, 1, 2))).toBeNull(); // duplicate
    const done = a.add(part(10, 0, 2));
    expect(done?.states).toEqual([Uint8Array.of(10, 0), Uint8Array.of(10, 1)]);
    expect(a.add(part(10, 0, 2))).toBeNull(); // already yielded
  });

  it("drops updates older than the newest complete one, and incomplete leftovers", () => {
    const a = new UpdateAssembler();
    expect(a.add(part(10, 0, 2))).toBeNull(); // its second part is lost
    expect(a.add(part(12, 0, 1))?.update.serverTick).toBe(12);
    expect(a.add(part(10, 1, 2))).toBeNull(); // too old now
    expect(a.add(part(11, 0, 1))).toBeNull(); // reordered: older than 12
    expect(a.add(part(14, 0, 1))?.update.serverTick).toBe(14);
  });

  it("ignores malformed part numbers", () => {
    const a = new UpdateAssembler();
    expect(a.add(part(10, 2, 2))).toBeNull();
    expect(a.add(part(10, 0, 0))).toBeNull();
  });
});
