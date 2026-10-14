// Play over the internet stays sane (v1's network check): the client's network core (session.ts) against an in-process
// server (src/testing/netRun.ts) on a clean path and on a realistic one: 80 ms round trip, 20 ms of jitter, 2 % loss
// each way.
import createEngine from "@engine/rlengine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { initEngine } from "../engine/world";
import { arenaMeshes } from "../testing/arena";
import { type NetRunResult, netRun } from "../testing/netRun";
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
    `${name}: ${String(r.corrections)} corrections (replay ${r.depth.mean.toFixed(1)} frames), local mispredictions ${String(r.localMispredictions)}; ` +
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
    }
  }, 300_000);

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
