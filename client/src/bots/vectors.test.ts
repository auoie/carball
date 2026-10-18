// The bot packages' test vectors (client/bots/: the packages' runtime files and vectors; skipped without them),
// replayed call by call through our driver, builder and kickoff script: the tracker, the cycle counter, each decision's
// observation (within 1e-6), the policy's logits through onnxruntime (within 1e-4), the pick where it's deterministic,
// the kickoff's index and every call's controls. The recorded action feeds the next decision, so a sampled pick (beta
// under 1) keeps the history the vectors had.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-web";
import { describe, expect, it, vi } from "vitest";
import type { BotState, BotView } from "../local/bots";
import { lookupParser, multiDiscreteParser, parseTable } from "./actions";
import { tickSkipDriver } from "./driver";
import { entityPerceiver } from "./entityPerceiver";
import { nearestLeftKickoff } from "./kickoff";
import { type Controls8, parseManifest, pickBeta, policyFile } from "./manifest";
import { OnnxPolicy } from "./policy";
import { type PackageCache, loadBrain } from "./registry";
import createEngine from "@engine/carball_engine.mjs";
import createHost from "@host/carball_host.mjs";
import { World, initEngine } from "../engine/world";
import { LocalBots } from "../local/bots";
import { LocalHost } from "../local/host";
import { arenaMeshes } from "../testing/arena";

const ROOT = fileURLToPath(new URL("../../bots/", import.meta.url));
const PRESENT = existsSync(`${ROOT}index.json`);

type V3 = [number, number, number];
interface Frame {
  tick: number;
  state: {
    cars: { pos: V3; vel: V3; angVel: V3; rot: { forward: V3; up: V3 }; team: 0 | 1; boost: number; onGround: boolean; doubleJumped: boolean; hasFlipped: boolean; demoed: boolean }[];
    ball: { pos: V3; vel: V3; angVel: V3 };
    pads: { active: boolean }[];
    kickoffPause: boolean;
    matchEnded: boolean;
  };
  controls: Controls8;
  kickoffIndex: number;
  derived: { onGround: boolean[]; hasFlip: boolean[]; groundTicks: number[]; counter: number; updateAction: boolean };
  decision?: { order: number[]; obs: { q: number[]; kv: number[][] }; logits: number[]; beta: number; pick: number | number[]; pickDeterministic: boolean; action: Controls8 };
}
interface Sequence {
  name: string;
  teamSize: number;
  self: number;
  frames: Frame[];
}

const v = ([x, y, z]: V3): { x: number; y: number; z: number } => ({ x, y, z });
const state = (s: Frame["state"]): BotState => ({
  cars: s.cars.map((c) => ({ ...c, pos: v(c.pos), vel: v(c.vel), angVel: v(c.angVel), rot: { forward: v(c.rot.forward), up: v(c.rot.up) } })),
  ball: { pos: v(s.ball.pos), vel: v(s.ball.vel), angVel: v(s.ball.angVel) },
  pads: s.pads,
  kickoffPause: s.kickoffPause,
  matchEnded: s.matchEnded,
});
const json = (path: string): unknown => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));
const far = (a: ArrayLike<number>, b: readonly number[], tolerance: number): number => b.findIndex((x, i) => !(Math.abs((a[i] ?? NaN) - x) <= tolerance));

describe.skipIf(!PRESENT)("the bot packages' vectors, replayed", () => {
  for (const id of ["nexto", "necto"]) {
    it(`${id}: every call's tracker, counter, kickoff and controls; each decision's obs, logits and pick`, async () => {
      const manifest = parseManifest(json(`${id}/bot.json`));
      if (typeof manifest === "string") throw new Error(manifest);
      const vectors = json(`${id}/vectors.json`) as { sequences: Sequence[] };
      const action = manifest.action;
      const parser = action.parser === "lookup-v1" ? lookupParser(parseTable(json(`${id}/${action.table}`)) as Controls8[]) : multiDiscreteParser(action);
      const mismatches: string[] = [];
      let decisions = 0;
      for (const sequence of vectors.sequences) {
        const file = policyFile(manifest, sequence.teamSize);
        if (!file) throw new Error(`no policy for ${String(sequence.teamSize)}`);
        const policy = await OnnxPolicy.create(new Uint8Array(readFileSync(`${ROOT}${id}/${file.file}`)), manifest.policy, ort);
        const builder = entityPerceiver(manifest);
        const kickoff = manifest.kickoff ? nearestLeftKickoff(manifest.kickoff) : null;
        let frame: Frame | undefined;
        let calls = 0;
        const where = (what: string): string => `${sequence.name} tick ${String(frame?.tick)}: ${what}`;
        const driver = tickSkipDriver({
          tickSkip: manifest.tickSkip,
          applyAtCounter: manifest.timing?.applyAtCounter ?? manifest.tickSkip,
          track: (view) => {
            builder.track?.(view);
          },
          async decide(view: BotView, previous: Controls8) {
            calls++;
            const d = frame?.decision;
            if (!d) {
              mismatches.push(where("a decision the vectors don't have"));
              return previous;
            }
            decisions++;
            const [q, kv] = builder.build(view, previous);
            if (JSON.stringify(builder.order(view)) !== JSON.stringify(d.order)) mismatches.push(where(`order ${JSON.stringify(builder.order(view))}`));
            const qAt = far(q?.data ?? [], d.obs.q, 1e-6);
            if (qAt >= 0) mismatches.push(where(`q[${String(qAt)}] ${String(q?.data[qAt])} vs ${String(d.obs.q[qAt])}`));
            const kvAt = far(kv?.data ?? [], d.obs.kv.flat(), 1e-6);
            if (kvAt >= 0) mismatches.push(where(`kv[${String(Math.floor(kvAt / 24))}][${String(kvAt % 24)}] ${String(kv?.data[kvAt])} vs ${String(d.obs.kv.flat()[kvAt])}`));
            const logits = await policy.run([q, kv].filter((x) => x !== undefined));
            const lAt = far(logits, d.logits, 1e-4);
            if (lAt >= 0) mismatches.push(where(`logit ${String(lAt)} ${String(logits[lAt])} vs ${String(d.logits[lAt])}`));
            const beta = pickBeta(manifest.policy.pick, view.state);
            if (beta !== d.beta) mismatches.push(where(`beta ${String(beta)} vs ${String(d.beta)}`));
            if (d.pickDeterministic) {
              const { pick } = parser(logits, beta, Math.random);
              if (JSON.stringify(pick) !== JSON.stringify(d.pick)) mismatches.push(where(`pick ${JSON.stringify(pick)} vs ${JSON.stringify(d.pick)}`));
            }
            return d.action;
          },
          ...(kickoff ? { kickoff: (view: BotView) => kickoff.step(view) } : {}),
        });
        for (frame of sequence.frames) {
          const before = calls;
          const view: BotView = { state: state(frame.state), self: sequence.self, tick: frame.tick };
          await driver.tick(view);
          if (frame.decision && calls === before) mismatches.push(where("no decision"));
          const derived = builder.derived(view);
          for (const key of ["onGround", "hasFlip", "groundTicks"] as const) {
            if (JSON.stringify(derived[key]) !== JSON.stringify(frame.derived[key])) mismatches.push(where(`${key} ${JSON.stringify(derived[key])} vs ${JSON.stringify(frame.derived[key])}`));
          }
          if (driver.state.counter !== frame.derived.counter || driver.state.updateAction !== frame.derived.updateAction) mismatches.push(where(`counter ${String(driver.state.counter)}/${String(driver.state.updateAction)}`));
          if (kickoff && kickoff.index !== frame.kickoffIndex) mismatches.push(where(`kickoff index ${String(kickoff.index)} vs ${String(frame.kickoffIndex)}`));
          if (JSON.stringify(driver.state.controls) !== JSON.stringify(frame.controls)) mismatches.push(where(`controls ${JSON.stringify(driver.state.controls)} vs ${JSON.stringify(frame.controls)}`));
        }
      }
      expect(mismatches.slice(0, 12)).toEqual([]);
      expect(decisions).toBeGreaterThan(30);
    }, 120_000);
  }

  it("Nexto against Necto, each from its package, in the local host's 1v1: they play the kickoff and the ball moves", async () => {
    const files: typeof fetch = (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = `${ROOT}${url.replace(/^\/bots\//, "")}`;
      return Promise.resolve(existsSync(path) ? new Response(readFileSync(path)) : new Response(null, { status: 404 }));
    };
    const meshes = arenaMeshes();
    const engine = await createEngine();
    initEngine(engine, meshes);
    const host = LocalHost.create(await createHost({ printErr: () => undefined }), meshes);
    host.open(1, 5);
    const bots = new LocalBots(World.create(engine), 2);
    bots.join(host, 2, { team: 0, name: "Nexto", brain: "nexto" }, await loadBrain("/bots/", "nexto", 1, files, Math.random, ort), 0);
    bots.join(host, 3, { team: 1, name: "Necto", brain: "necto" }, await loadBrain("/bots/", "necto", 1, files, Math.random, ort), 0);
    let now = 0;
    let moved = 0;
    const world = World.create(engine);
    for (let i = 0; i < 14 * 120; i++) {
      now = host.nextTick() ?? now + 1 / 120;
      await bots.beforeTick(host);
      host.tick(now);
      host.drain();
      if (i % 60 === 0) {
        world.loadState(host.state(2));
        moved = Math.max(moved, Math.hypot(world.ball().pos.x, world.ball().pos.y));
      }
    }
    expect(moved).toBeGreaterThan(200);
  }, 300_000);

  it("two bots of one package through one cache keep their own state: in lockstep on the vectors, each decides as a lone one (RV-549)", async () => {
    const files: typeof fetch = (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = `${ROOT}${url.replace(/^\/bots\//, "")}`;
      return Promise.resolve(existsSync(path) ? new Response(readFileSync(path)) : new Response(null, { status: 404 }));
    };
    // (each brain its own random stream, the same seed: a sampled pick the same for all three)
    const seeded = (seed: number): (() => number) => {
      let a = seed;
      return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const differ: string[] = [];
    for (const id of ["nexto", "necto"]) {
      for (const sequence of (json(`${id}/vectors.json`) as { sequences: Sequence[] }).sequences) {
        const view = (frame: Frame): BotView => ({ state: state(frame.state), self: sequence.self, tick: frame.tick });
        // (the lone bot's run first, through the whole sequence: nothing it holds is touched by the pair's after)
        const lone = await loadBrain("/bots/", id, sequence.teamSize, files, seeded(7), ort);
        const expected: string[] = [];
        for (const frame of sequence.frames) expected.push(JSON.stringify(await lone.tick(view(frame))));
        const packages: PackageCache = new Map();
        const pair = [
          await loadBrain("/bots/", id, sequence.teamSize, files, seeded(7), ort, undefined, packages),
          await loadBrain("/bots/", id, sequence.teamSize, files, seeded(7), ort, undefined, packages),
        ];
        expect(packages.size).toBe(1);
        for (const [i, frame] of sequence.frames.entries()) {
          for (const [k, brain] of pair.entries()) {
            const got = JSON.stringify(await brain.tick(view(frame)));
            if (got !== expected[i]) differ.push(`${id} ${sequence.name} bot ${String(k)} tick ${String(frame.tick)}: ${got} vs ${String(expected[i])}`);
          }
        }
      }
    }
    expect(differ.slice(0, 6)).toEqual([]);
  }, 300_000);

  it("a 2v2 of package bots (Nexto and Necto on each side, teammates too): every brain runs, none fails, each package fetched once (RV-540)", async () => {
    const fetched: string[] = [];
    const files: typeof fetch = (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      fetched.push(url);
      const path = `${ROOT}${url.replace(/^\/bots\//, "")}`;
      return Promise.resolve(existsSync(path) ? new Response(readFileSync(path)) : new Response(null, { status: 404 }));
    };
    const failures = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const meshes = arenaMeshes();
    const engine = await createEngine();
    initEngine(engine, meshes);
    const host = LocalHost.create(await createHost({ printErr: () => undefined }), meshes);
    host.open(2, 9);
    const bots = new LocalBots(World.create(engine), 4);
    const slots = [
      { team: 0, name: "Nexto 1", brain: "nexto" },
      { team: 0, name: "Necto 1", brain: "necto" },
      { team: 1, name: "Nexto 2", brain: "nexto" },
      { team: 1, name: "Necto 2", brain: "necto" },
    ] as const;
    // (the match's packages: a package's manifest, policy and table fetched once for its two bots, one session each)
    const packages: PackageCache = new Map();
    for (const [i, slot] of slots.entries()) bots.join(host, 2 + i, slot, await loadBrain("/bots/", slot.brain, 2, files, Math.random, ort, undefined, packages), 0);
    expect(packages.size).toBe(2);
    expect(fetched.filter((u) => u.endsWith(".onnx")).sort()).toEqual(["/bots/necto/policy-2v2.onnx", "/bots/nexto/policy-2v2.onnx"]);
    expect(fetched.filter((u) => u.endsWith("bot.json"))).toHaveLength(2);
    let now = 0;
    for (let i = 0; i < 10 * 120; i++) {
      now = host.nextTick() ?? now + 1 / 120;
      await bots.beforeTick(host);
      host.tick(now);
      host.drain();
    }
    const world = World.create(engine);
    world.loadState(host.state(2));
    expect(failures).not.toHaveBeenCalled();
    expect(world.carIds()).toHaveLength(4);
    failures.mockRestore();
  }, 300_000);
});
