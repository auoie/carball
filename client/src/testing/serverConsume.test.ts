import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type InputFrame, dequantizeAxis } from "../net/protocol";
import { ServerConsume } from "./serverConsume";

type Step =
  | { readonly r: readonly [number, number, readonly (readonly [number, number])[], number, boolean] }
  | { readonly t: readonly [number, boolean, number, number, boolean, number, number, number, boolean, number, number, number, number, number, number, number, number] }
  | { readonly reset: number };

/** Rust's f32 round: halves away from zero */
const roundAway = (v: number): number => Math.sign(v) * Math.round(Math.abs(v));

describe("the server's input buffer, ported (server/src/input_buffer.rs: its traced run)", () => {
  it("receives, consumes, repeats, zeroes, refills and catches up tick for tick as the Rust one", () => {
    const steps = JSON.parse(readFileSync(new URL("./serverConsume.vectors.json", import.meta.url), "utf8")) as Step[];
    expect(steps.length).toBeGreaterThan(2000);
    const buffer = new ServerConsume();
    const frame = ([throttle, bits]: readonly [number, number]): InputFrame => ({ throttle, steer: 0, pitch: 0, yaw: 0, roll: 0, dodgeForward: 0, bits });
    steps.forEach((step, i) => {
      if ("r" in step) {
        const [timestamp, first, frames, now, newest] = step.r;
        expect(buffer.receive(timestamp, first, frames.map(frame), now), `step ${String(i)}: newest`).toBe(newest);
      } else if ("t" in step) {
        const [now, odd, throttle, jump, repress, ack, len, target, filling, under, over, repeated, zeroed, fillSkips, consumed, neverConsumed, dropped] = step.t;
        const out = buffer.tick(now, odd);
        const s = buffer.stats;
        expect(
          [roundAway(Math.fround(Math.fround(dequantizeAxis(out.frame.throttle)) * 127)), out.jump ? 1 : 0, buffer.repressJump, buffer.ackFrame, buffer.length, buffer.jitter.bufferSize, buffer.filling, s.under, s.over, s.repeated, s.zeroed, s.fillSkips, s.consumed, s.neverConsumed, s.dropped],
          `step ${String(i)} at ${String(now)}`,
        ).toEqual([throttle, jump, repress, ack, len, target, filling, under, over, repeated, zeroed, fillSkips, consumed, neverConsumed, dropped]);
      } else buffer.jitter.reset();
    });
  });
});
