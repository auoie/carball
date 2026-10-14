// Play over the internet stays sane (v1's network check): the client's network core (session.ts) against an in-process
// server (src/testing/netRun.ts) on a clean path and on a realistic one: 80 ms round trip, 20 ms of jitter, 2 % loss
// each way.
import createEngine from "@engine/rlengine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { initEngine } from "../engine/world";
import { arenaMeshes } from "../testing/arena";
import { type NetRunResult, netRun } from "../testing/netRun";
import { HISTORY_FRAMES } from "./predictor";
import { type Profile, constantProfile } from "../testing/netsim";

let engine: Awaited<ReturnType<typeof createEngine>>;

beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, arenaMeshes());
});

/** One way of an 80 ms round trip with 20 ms of jitter on it (σ 14 ms each way) and 2 % loss */
const REALISTIC: Profile = { baseMs: 40, jitter: { kind: "normal", sigmaMs: 14 }, loss: { kind: "iid", p: 0.02 }, duplicate: 0, stalls: [] };

function report(name: string, r: NetRunResult): void {
  const f = (s: { mean: number; p95: number; max: number }) => `mean ${s.mean.toFixed(2)} p95 ${s.p95.toFixed(2)} max ${s.max.toFixed(2)}`;
  console.info(
    `${name}: ${String(r.updates)} updates, ${String(r.corrections)} replays ( ${r.depth.mean.toFixed(1)} frames, at most ${String(r.depth.max)} in a frame), local mispredictions ${String(r.localMispredictions)}; ` +
      `local ${f(r.local)} uu; bot ${f(r.remote)} uu; ball ${f(r.ball)} uu; moved a second: local ${r.movedPerSecond.local.toFixed(1)}, ` +
      `bot ${r.movedPerSecond.remote.toFixed(1)}, ball ${r.movedPerSecond.ball.toFixed(1)} uu/s; ping ${r.ping?.toFixed(1) ?? "-"} ms; ` +
      `buffer target ${String(r.buffer.target)}, under ${String(r.buffer.under)} over ${String(r.buffer.over)} repeated ${String(r.buffer.repeated)} ` +
      `never consumed ${String(r.buffer.neverConsumed)} of ${String(r.buffer.ticks)} ticks; down ${r.downKBps.toFixed(2)} KB/s`,
  );
}

describe("play over a network path (in process)", () => {
  it("keeps the local car predicted and the server's input buffer steady on a clean 80 ms path", () => {
    const r = netRun(engine, { seconds: 30, up: constantProfile(40), down: constantProfile(40), seed: 3 });
    report("clean 80 ms", r);
    // (the only mispredictions: contacts with the bot, whose wheels and contacts the client predicts itself)
    expect(r.localMispredictions).toBeLessThanOrEqual(10);
    // (the measures come from the corrections' smoothing: there are some, RV-314)
    expect(r.errors.remote.length).toBeGreaterThan(0);
    expect(r.errors.local.length).toBeGreaterThan(0);
    expect(r.local.p95).toBe(0);
    // No frame missed nor repeated (double consumes can alternate with the fill's skips at some round trips: harmless,
    // RV-316)
    expect(r.buffer.under + r.buffer.neverConsumed).toBe(0);
    expect(r.buffer.target).toBe(7);
    // Each correction replays the round trip and the server's buffer: 80 ms = 9.6 frames, + 5 to 12 (§13 T3)
    expect(r.depth.mean).toBeGreaterThanOrEqual(9.6 + 5);
    expect(r.depth.mean).toBeLessThanOrEqual(9.6 + 12);
    expect(r.ping).toBeGreaterThan(80);
    expect(r.ping).toBeLessThan(100); // (+ up to a frame: updates apply at the client's frames)
  }, 120_000);

  it("stays sane at an 80 ms round trip with 20 ms of jitter and 2 % loss", () => {
    for (const seed of [3, 5, 8]) {
      const r = netRun(engine, { seconds: 30, up: REALISTIC, down: REALISTIC, seed });
      report(`realistic, seed ${String(seed)}`, r);
      // The 10 frames each packet repeats cover the losses; the jitter buffer grows to the jitter, rarely runs dry
      expect(r.buffer.neverConsumed).toBe(0);
      expect(r.buffer.target).toBeLessThanOrEqual(14);
      expect(r.buffer.under).toBeLessThanOrEqual(r.buffer.ticks * 0.005);
      expect(r.ping).toBeGreaterThan(60);
      expect(r.ping).toBeLessThan(110);
      // The local car stays where it was predicted: a correction now and then (a repeated or skipped input, a contact),
      // small, all of them moving it at most 40 uu a second (seed 3: 19.5)
      expect(r.local.p95).toBeLessThanOrEqual(20);
      expect(r.movedPerSecond.local).toBeLessThanOrEqual(40);
      expect(r.localMispredictions).toBeLessThanOrEqual(3 * 27);
      // The bot's and the ball's corrections stay small (each smoothed when drawn)
      expect(r.remote.p95).toBeLessThanOrEqual(40);
      expect(r.ball.p95).toBeLessThanOrEqual(5);
      expect(r.downKBps).toBeLessThanOrEqual(6);
      // One replay a frame, however many updates came in it (G3): never more than the round trip and the buffer's
      // depth, ≈ 16 frames here, with the jitter's spread
      expect(r.depth.max).toBeLessThanOrEqual(40);
    }
  }, 300_000);

  it("a burst of updates after a stall replays once in its frame (G3)", () => {
    // A 150 ms stall on the way down every 2 s: the updates held back arrive together
    const stalled: Profile = { ...constantProfile(40), stalls: [{ atS: 4, ms: 150, everyS: 2 }] };
    const r = netRun(engine, { seconds: 20, up: constantProfile(40), down: stalled, seed: 3 });
    report("stalls down", r);
    expect(r.depth.max).toBeLessThanOrEqual(40);
    // (the held updates applied together: fewer replays than updates)
    expect(r.updates).toBeGreaterThan(r.corrections * 1.05);
    // Before G3 each update replayed on its own: a burst's frame replayed each of them
    const before = netRun(engine, { seconds: 20, up: constantProfile(40), down: stalled, seed: 3, replayEachUpdate: true });
    report("stalls down, a replay each update (before G3)", before);
    expect(r.depth.max).toBeLessThan(before.depth.max);
    expect(r.depth.mean * r.depth.count).toBeLessThan(before.depth.mean * before.depth.count);
  }, 120_000);

  // (T7, T8: the local car alone, so "exact again" is the network's: with the bot its contacts mispredict too)
  it("T7: a stalled client (a hidden tab) comes back: one reset 2 s later, the server's buffer back to 7, exact again", () => {
    for (const seconds of [0.3, 2, 10]) {
      const r = netRun(engine, { seconds: 30, up: constantProfile(40), down: constantProfile(40), seed: 3, players: 1, clientStalls: [{ atS: 6, seconds }] });
      report(`a ${String(seconds)} s client stall`, r);
      console.info(`  buffer targets by second: ${r.bufferTargets.join(" ")}; resets ${String(r.resets)}, direct ${String(r.direct)}`);
      expect(r.resets, `${String(seconds)} s`).toBe(1); // (the frame after it a hitch: the reset 2 s on)
      expect(Math.max(...r.bufferTargets.slice(6)), `${String(seconds)} s`).toBeGreaterThan(7);
      expect(r.bufferTargets.at(-1), `${String(seconds)} s`).toBe(7);
      expect(r.lateMispredictions, `${String(seconds)} s`).toBe(0);
      expect(r.depth.max, `${String(seconds)} s`).toBeLessThan(HISTORY_FRAMES);
    }
  }, 300_000);

  it("T8: a 3 s outage both ways recovers: no storm of corrections, exact again once the server's buffer is back", () => {
    const outage: Profile = { ...constantProfile(40), outages: [{ atS: 6, ms: 3000 }] };
    const r = netRun(engine, { seconds: 60, up: outage, down: outage, seed: 3, players: 1 });
    report("a 3 s outage both ways", r);
    console.info(`  buffer targets by second: ${r.bufferTargets.join(" ")}`);
    expect(r.direct).toBeLessThanOrEqual(5);
    expect(r.depth.max).toBeLessThan(HISTORY_FRAMES);
    expect(r.buffer.neverConsumed).toBeGreaterThan(0); // (the frames sent in the outage, never received)
    // (the outage's gap raised the server's buffer, not reset: no client hitch; the game's rule brings it down a frame
    // every few seconds, steadily; its double consumes meanwhile mispredict now and then)
    const after = r.bufferTargets.slice(9);
    expect(after[0]).toBe(18);
    expect(after.every((v, i) => i === 0 || v <= (after[i - 1] ?? v))).toBe(true);
    expect(r.bufferTargets.at(-1)).toBe(7);
    expect(r.lateMispredictions).toBe(0); // (back at its floor: exact again)
  }, 120_000);

  it("G1: an eighth of the bytes for corrections like before on the same path", () => {
    const after = netRun(engine, { seconds: 30, up: REALISTIC, down: REALISTIC, seed: 3 });
    const before = netRun(engine, { seconds: 30, up: REALISTIC, down: REALISTIC, seed: 3, legacy: true });
    report("realistic, G1", after);
    report("realistic, before G1 (exact states, the ball every update, cars by it too)", before);
    expect(after.downKBps).toBeLessThan(before.downKBps / 8);
    expect(after.localMispredictions).toBeLessThanOrEqual(before.localMispredictions);
    // (how far corrections move each class a second: a correction's size depends on how often its body's state comes,
    // a car's now ≈ 12 a second, not up to 60)
    expect(after.movedPerSecond.local).toBeLessThanOrEqual(before.movedPerSecond.local * 1.5);
    expect(after.movedPerSecond.remote).toBeLessThanOrEqual(before.movedPerSecond.remote * 1.5);
    expect(after.movedPerSecond.ball).toBeLessThanOrEqual(Math.max(1, before.movedPerSecond.ball * 1.5));
  }, 300_000);
});
