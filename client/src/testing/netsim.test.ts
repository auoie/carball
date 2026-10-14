import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NetSim, Pcg32, type Profile, constantProfile } from "./netsim";

describe("the simulated network path (the Rust one's twin: notes/netcode-live.md §13.0)", () => {
  it("draws O'Neill's PCG32 reference sequence", () => {
    const rng = new Pcg32(42n, 54n);
    expect(Array.from({ length: 6 }, () => rng.nextU32())).toEqual([0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e]);
  });

  it("delivers as the Rust one for the same seed and profiles (its vectors)", () => {
    const vectors = JSON.parse(readFileSync(new URL("./netsim.vectors.json", import.meta.url), "utf8")) as Record<string, number[][]>;
    const profiles: Record<string, Profile> = {
      jitter: { baseMs: 50, jitter: { kind: "normal", sigmaMs: 10 }, loss: { kind: "iid", p: 0.05 }, duplicate: 0.05, stalls: [] },
      ar1: { baseMs: 100, jitter: { kind: "ar1", sigmaMs: 8, rho: 0.9 }, loss: { kind: "none" }, duplicate: 0, stalls: [{ atS: 0.5, ms: 150, everyS: 2 }] },
      burst: { ...constantProfile(30), loss: { kind: "gilbertElliott", pGb: 0.05, pBg: 0.3, lossGood: 0.01, lossBad: 0.6 } },
    };
    for (const [name, profile] of Object.entries(profiles)) {
      const sim = new NetSim(profile, 11);
      const expected = vectors[name] ?? [];
      expect(expected.length, name).toBe(300);
      expected.forEach((arrivals, i) => {
        const got = sim.send(i / 60);
        expect(got.length, `${name} packet ${String(i)}`).toBe(arrivals.length);
        got.forEach((a, k) => {
          expect(a, `${name} packet ${String(i)}`).toBeCloseTo(arrivals[k] ?? NaN, 8);
        });
      });
    }
  });
});
