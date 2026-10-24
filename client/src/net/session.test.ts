// Play over the internet stays sane (v1's network check): the client's network core (session.ts) against the server's
// own match in process (the local host's module: src/testing/netRun.ts) on a clean path and on a realistic one: 80 ms
// round trip, 20 ms of jitter, 2 % loss each way.
import createEngine from "@engine/carball_engine.mjs";
import createHost from "@host/carball_host.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { initEngine } from "../engine/world";
import { LocalHost } from "../local/host";
import { arenaMeshes } from "../testing/arena";
import { type NetRunResult, circleDriver, netRun } from "../testing/netRun";
import { type Profile, constantProfile } from "../testing/netsim";

let engine: Awaited<ReturnType<typeof createEngine>>;
let host: LocalHost;

beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, arenaMeshes());
  host = LocalHost.create(await createHost(), arenaMeshes());
});

/** One way of an 80 ms round trip with 20 ms of jitter on it (σ 14 ms each way) and 2 % loss */
const REALISTIC: Profile = { baseMs: 40, jitter: { kind: "normal", sigmaMs: 14 }, loss: { kind: "iid", p: 0.02 }, duplicate: 0, stalls: [] };

function report(name: string, r: NetRunResult): void {
  const f = (s: { mean: number; p95: number; max: number }) => `mean ${s.mean.toFixed(2)} p95 ${s.p95.toFixed(2)} max ${s.max.toFixed(2)}`;
  console.info(
    `${name}: ${String(r.updates)} updates, ${String(r.corrections)} replays ( ${r.depth.mean.toFixed(1)} frames, at most ${String(r.depth.max)} in a frame), local mispredictions ${String(r.localMispredictions)}; ` +
      `local ${f(r.local)} uu; bot ${f(r.remote)} uu; ball ${f(r.ball)} uu; moved a second: local ${r.movedPerSecond.local.toFixed(1)}, ` +
      `bot ${r.movedPerSecond.remote.toFixed(1)}, ball ${r.movedPerSecond.ball.toFixed(1)} uu/s; ping ${r.ping?.toFixed(1) ?? "-"} ms; ` +
      `buffer target ${String(r.buffer.target)}, under ${String(r.buffer.under)} over ${String(r.buffer.over)} of ${String(r.buffer.ticks)} ticks, ` +
      `input datagrams lost ${String(r.buffer.lost)} of ${String(r.buffer.sent)}; down ${r.downKBps.toFixed(2)} KB/s; ` +
      `phases ${r.phases.map((p) => `${p.phase}@${p.at.toFixed(2)}`).join(" ")}`,
  );
}

describe("play over a network path (in process)", () => {
  it("keeps the local car predicted and the server's input buffer steady on a clean 77 ms path", () => {
    // (37 ms up: the refill after the start ends. 45 ms's packets land just before the server's odd frames, one frame
    // short of the clear check each time, so the refill never ends: an odd frame's frame skipped, a double consume each
    // update instead, 60 a second until the first goal's slow motion moves the packets' phase; the game's own rule,
    // notes/netcode-live.md §6: ServerConsume 0x140f23c10, bFillingBuffer cleared only at a newer packet with the
    // queue at BufferSize before its frames merge, TA:71134, the frame's parity counted before the consumes, RV-1032)
    const stuck = netRun(engine, host, { seconds: 30, up: constantProfile(45), down: constantProfile(40), seed: 3 });
    report("clean 85 ms, packets before the odd frames", stuck);
    expect(stuck.buffer.over).toBeGreaterThan(400);
    expect(stuck.localMispredictions).toBeLessThanOrEqual(20);
    const r = netRun(engine, host, { seconds: 30, up: constantProfile(37), down: constantProfile(40), seed: 3 });
    report("clean 77 ms", r);
    expect(r.buffer.over).toBe(0);
    // (the only mispredictions: contacts with the bot, whose wheels and contacts the client predicts itself)
    expect(r.localMispredictions).toBeLessThanOrEqual(15);
    // (the measures come from the corrections' smoothing: there are some, RV-314)
    expect(r.errors.remote.length).toBeGreaterThan(0);
    expect(r.errors.local.length).toBeGreaterThan(0);
    expect(r.local.p95).toBe(0);
    // (a contact's correction now and then, never a large one: RV-1035)
    expect(r.local.max).toBeLessThanOrEqual(20);
    // No frame missed nor repeated (double consumes can alternate with the fill's skips at some round trips: harmless,
    // RV-316), none passed over on the server for good (RV-1034)
    expect(r.buffer.under + r.buffer.lost).toBe(0);
    expect(r.serverInput?.neverConsumed).toBe(0);
    expect(r.buffer.target).toBe(7);
    // Each correction replays the round trip and the server's buffer: 77 ms = 9 frames, + 5 to 12 (§13 T3)
    expect(r.depth.mean).toBeGreaterThanOrEqual(9 + 5);
    expect(r.depth.mean).toBeLessThanOrEqual(9 + 12);
    expect(r.ping).toBeGreaterThan(77);
    expect(r.ping).toBeLessThan(97); // (+ up to a frame: updates apply at the client's frames)
  }, 120_000);

  it("the refill stuck at one-way delays a frame's width apart: its edges pinned, the game's parity (RV-1032, RV-1037)", () => {
    // (one player circling, no goal: the packets' phase against the server's frames fixed by the delay; stuck from 26 to
    // 33 and 42 to 49 ms up, clear between, the exe's parity; ours before RV-1032 had them a frame's half apart)
    const over = (up: number): number =>
      netRun(engine, host, { seconds: 12, up: constantProfile(up), down: constantProfile(40), seed: 3, players: 1, drive: circleDriver }).buffer.over;
    expect(over(33)).toBeGreaterThan(300);
    expect(over(34)).toBe(0);
    expect(over(41)).toBe(0);
    expect(over(42)).toBeGreaterThan(300);
  }, 120_000);

  it("stays sane at an 80 ms round trip with 20 ms of jitter and 2 % loss", () => {
    for (const seed of [3, 4, 5, 8]) {
      const r = netRun(engine, host, { seconds: 30, up: REALISTIC, down: REALISTIC, seed });
      report(`realistic, seed ${String(seed)}`, r);
      // The 10 frames each packet repeats cover the losses (the server's "lost" counts every gap in the packets'
      // sequence, those the jitter reorders too: not a measure of frames missed); the jitter buffer grows to the
      // jitter, rarely runs dry
      expect(r.buffer.target).toBeLessThanOrEqual(14);
      expect(r.buffer.under).toBeLessThanOrEqual(r.buffer.ticks * 0.005);
      expect(r.ping).toBeGreaterThan(60);
      expect(r.ping).toBeLessThan(110);
      // The local car stays where it was predicted: a correction now and then (a repeated or skipped input, a contact,
      // the first moments after a kickoff), small, all of them moving it at most 10 uu a second (RV-325, RV-1035;
      // against the server's own match since design 5: its p95 up to 3 here, 1 against the TypeScript port); and there
      // are corrections to measure: a client that never reconciled would pass the rest (RV-1035)
      expect(r.corrections).toBeGreaterThan(0);
      expect(r.errors.local.length).toBeGreaterThan(0);
      expect(r.local.p95).toBeLessThanOrEqual(4);
      expect(r.local.mean).toBeLessThanOrEqual(1);
      expect(r.movedPerSecond.local).toBeLessThanOrEqual(10);
      // (measured: 23, 32, 11, 23 for seeds 3, 4, 5, 8: the bound a quarter over the worst, RV-1079)
      expect(r.localMispredictions).toBeLessThanOrEqual(40);
      // (no frame passed over for good on the server: its own count, not the datagrams' gaps, RV-1034)
      expect(r.serverInput?.neverConsumed).toBe(0);
      // The bot's and the ball's corrections stay small (each smoothed when drawn): measured while the client predicts.
      // (A demolished client's states apply as they come, no prediction to correct (G5): not counted, RV-1029; the
      // resume after its respawn exact, predictor.test.ts, RV-1065)
      expect(r.remote.p95).toBeLessThanOrEqual(30);
      expect(r.ball.p95).toBe(0);
      expect(r.downKBps).toBeLessThanOrEqual(6);
      // One replay a frame, however many updates came in it (G3): never more than the round trip and the buffer's
      // depth, ≈ 16 frames here, with the jitter's spread
      expect(r.depth.max).toBeLessThanOrEqual(40);
    }
  }, 300_000);

  it("stays sane at a 144 Hz display and a 59.94 Hz one, their frames jittered (RV-1033)", () => {
    for (const [frameHz, frameJitterMs, seed] of [
      [144, 1, 3],
      [144, 1, 5],
      [59.94, 2, 3],
      [59.94, 2, 5],
      [59.94, 2, 10],
    ] as const) {
      const r = netRun(engine, host, { seconds: 30, up: REALISTIC, down: REALISTIC, seed, frameHz, frameJitterMs });
      report(`realistic, ${String(frameHz)} Hz ± ${String(frameJitterMs)} ms, seed ${String(seed)}`, r);
      expect(r.buffer.under).toBeLessThanOrEqual(r.buffer.ticks * 0.005);
      expect(r.serverInput?.neverConsumed).toBe(0);
      expect(r.errors.local.length).toBeGreaterThan(0);
      // (59.94 Hz drifts against the server's 120: now and then a frame's input repeated or skipped, its correction a
      // little larger than 60 Hz's: p95 up to 4.1, mean up to 0.98 (seeds 5, 10; 1.33 at 144 Hz seed 1, RX57), 11.0 uu a
      // second moved, mispredictions up to 37 (seed 10): moved and mispredictions bounded a quarter to a third over, the
      // mean half again over, RV-1079, RV-1089)
      expect(r.local.p95).toBeLessThanOrEqual(6);
      expect(r.local.mean).toBeLessThanOrEqual(1.5);
      expect(r.movedPerSecond.local).toBeLessThanOrEqual(15);
      expect(r.localMispredictions).toBeLessThanOrEqual(46);
      expect(r.ball.p95).toBe(0);
    }
  }, 300_000);

  it("a burst of updates after a stall replays once in its frame (G3)", () => {
    // A 150 ms stall on the way down every 2 s: the updates held back arrive together
    const stalled: Profile = { ...constantProfile(40), stalls: [{ atS: 4, ms: 150, everyS: 2 }] };
    const r = netRun(engine, host, { seconds: 20, up: constantProfile(40), down: stalled, seed: 3 });
    report("stalls down", r);
    expect(r.depth.max).toBeLessThanOrEqual(40);
    // (the held updates applied together: fewer replays than updates)
    expect(r.updates).toBeGreaterThan(r.corrections * 1.05);
    // Before G3 each update replayed on its own: a burst's frame replayed each of them
    const before = netRun(engine, host, { seconds: 20, up: constantProfile(40), down: stalled, seed: 3, replayEachUpdate: true });
    report("stalls down, a replay each update (before G3)", before);
    expect(r.depth.max).toBeLessThan(before.depth.max);
    expect(r.depth.mean * r.depth.count).toBeLessThan(before.depth.mean * before.depth.count);
  }, 120_000);

  // (T7, T8: the local car alone, so "exact again" is the network's: with the bot its contacts mispredict too)
  it("T7: a stalled client (a hidden tab) comes back: one reset 2 s later, the server's buffer back to 7, exact again", () => {
    for (const seconds of [0.3, 2, 10]) {
      const r = netRun(engine, host, {
        seconds: 30,
        up: constantProfile(43),
        down: constantProfile(40),
        seed: 3,
        players: 1,
        drive: circleDriver,
        clientStalls: [{ atS: 10, seconds }],
      });
      report(`a ${String(seconds)} s client stall`, r);
      console.info(`  buffer targets by second: ${r.bufferTargets.join(" ")}; resets ${String(r.resets)}, direct ${String(r.direct)}`);
      expect(r.resets, `${String(seconds)} s`).toBe(1); // (the frame after it a hitch: the reset 2 s on)
      // (the gap, clamped to 0.25 s, takes the server's buffer to 18; the reset back to 7: RV-336)
      expect(Math.max(...r.bufferTargets.slice(10)), `${String(seconds)} s`).toBe(18);
      expect(r.bufferTargets.at(-1), `${String(seconds)} s`).toBe(7);
      expect(r.lateMispredictions, `${String(seconds)} s`).toBe(0);
      // (the server's states for frames this client hadn't reached, applied at its present)
      if (seconds >= 2) expect(r.direct, `${String(seconds)} s`).toBeGreaterThan(0);
      // (each frame one replay: the round trip and the buffer's depth, with a stall's catch-up)
      expect(r.depth.max, `${String(seconds)} s`).toBeLessThanOrEqual(40);
    }
  }, 300_000);

  it("T8: a 3 s outage both ways recovers: no storm of corrections, exact again once the server's buffer is back", () => {
    const outage: Profile = { ...constantProfile(40), outages: [{ atS: 10, ms: 3000 }] };
    const r = netRun(engine, host, { seconds: 60, up: { ...outage, baseMs: 43 }, down: outage, seed: 3, players: 1, drive: circleDriver });
    report("a 3 s outage both ways", r);
    console.info(`  buffer targets by second: ${r.bufferTargets.join(" ")}`);
    expect(r.direct).toBeLessThanOrEqual(5);
    expect(r.depth.max).toBeLessThanOrEqual(40);
    expect(r.buffer.lost).toBeGreaterThan(0); // (the datagrams sent in the outage, never received)
    // (the outage's gap raised the server's buffer, not reset: no client hitch; the game's rule brings it down a frame
    // every few seconds, steadily; its double consumes meanwhile mispredict now and then)
    const after = r.bufferTargets.slice(13);
    expect(after[0]).toBe(18);
    expect(after.every((v, i) => i === 0 || v <= (after[i - 1] ?? v))).toBe(true);
    expect(r.bufferTargets.at(-1)).toBe(7);
    expect(r.lateMispredictions).toBe(0); // (back at its floor: exact again)
  }, 120_000);
});
