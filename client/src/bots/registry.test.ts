// The bot packages: their manifests checked, listed playable only with our observation builder and action parser for
// them; the parsers' choices from a policy's output
import { describe, expect, it } from "vitest";
import type { BotView } from "../local/bots";
import { lookupParser, multiDiscreteParser, parseTable, pickIndex, rowControls } from "./actions";
import { randomControls, tickSkipDriver } from "./driver";
import { type Controls8, type MultiDiscreteAction, parseManifest, pickBeta, policyFile } from "./manifest";
import { botLevels, listBots } from "./listing";

const MANIFEST = {
  format: 1,
  id: "nexto",
  name: "Nexto",
  licence: "CC BY-NC-SA 4.0",
  credit: "Rolv-Arild and the Nexto authors",
  policy: {
    opset: 17,
    files: { "1": { file: "policy-1v1.onnx", entities: 37 }, "2": { file: "policy-2v2.onnx", entities: 39 } },
    inputs: [{ name: "q", shape: [1, 1, 32] }, { name: "kv", shape: [1, "N", 24] }],
    outputs: [{ name: "logits", shape: [1, 90] }],
    pick: { mode: "beta", beta: 1, overrides: [{ when: "matchEnded", beta: 0 }, { when: "kickoffPause", beta: 0.5 }] },
  },
  observation: { builder: "entity-perceiver-v1" },
  action: { parser: "lookup-v1", table: "actions.json" },
  tickSkip: 8,
  teamSizes: [1, 2],
};

/** Necto's heads (FORMAT.md): throttle and pitch one head, steer/yaw/roll another with the handbrake switching yaw to roll */
const NECTO_ACTION: MultiDiscreteAction = {
  parser: "multidiscrete-v1",
  heads: [3, 3, 2, 2, 2],
  columns: ["throttle", "steer", "pitch", "yaw", "roll", "jump", "boost", "handbrake"],
  controls: {
    throttle: [{ head: 0, values: [-1, 0, 1] }],
    steer: [{ head: 1, values: [-1, 0, 1] }],
    pitch: [{ head: 0, values: [-1, 0, 1] }],
    yaw: [{ head: 1, values: [-1, 0, 1] }, { head: 4, values: [1, 0] }],
    roll: [{ head: 1, values: [-1, 0, 1] }, { head: 4, values: [0, 1] }],
    jump: [{ head: 2, values: [0, 1] }],
    boost: [{ head: 3, values: [0, 1] }],
    handbrake: [{ head: 4, values: [0, 1] }],
  },
};

/** A fetch over these files (others 404) */
const files =
  (served: Record<string, unknown>): typeof fetch =>
  (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = served[url];
    return Promise.resolve(body === undefined ? new Response(null, { status: 404 }) : new Response(JSON.stringify(body)));
  };

describe("the bot packages", () => {
  it("checks a manifest's fields, and its policy for a team size", () => {
    const m = parseManifest(MANIFEST);
    if (typeof m === "string") throw new Error(m);
    expect(policyFile(m, 1)).toEqual({ file: "policy-1v1.onnx", entities: 37 });
    expect(policyFile(m, 3)).toBeNull();
    // (beta: 1, 0.5 in a kickoff's pause, 0 at the match's end, the later override winning)
    expect([pickBeta(m.policy.pick, { kickoffPause: false, matchEnded: false }), pickBeta(m.policy.pick, { kickoffPause: true, matchEnded: false }), pickBeta(m.policy.pick, { kickoffPause: true, matchEnded: true })]).toEqual([1, 0.5, 0.5]);
    expect(parseManifest({ ...MANIFEST, id: "../x" })).toBe("its id");
    expect(parseManifest({ ...MANIFEST, tickSkip: 0 })).toBe("its tick skip");
    expect(parseManifest({ ...MANIFEST, policy: { file: 3 } })).toBe("its policy");
  });

  it("lists none without an index; a package playable with our builder and parser for it, else not, with why", async () => {
    expect(await listBots("/bots/", files({}))).toEqual([]);
    const seer = { ...MANIFEST, id: "seer", name: "Seer", observation: { builder: "seer-v1" } };
    const listed = await listBots("/bots/", files({ "/bots/index.json": { format: 1, bots: ["nexto", "seer", "gone"] }, "/bots/nexto/bot.json": MANIFEST, "/bots/seer/bot.json": seer }));
    expect(listed[0]).toMatchObject({ id: "nexto", name: "Nexto", teamSizes: [1, 2], playable: true, credit: MANIFEST.credit, licence: "CC BY-NC-SA 4.0" });
    expect(listed[1]).toMatchObject({ id: "seer", playable: false, why: "its observation builder seer-v1 isn't written yet" });
    expect(listed[2]).toMatchObject({ id: "gone", playable: false });
    // (a recurrent policy's state: refused, not run without it, RV-546; null as the packages write none)
    const recurrent = { ...MANIFEST, id: "lstm", policy: { ...MANIFEST.policy, state: { kind: "lstm-v1" } } };
    const stateless = { ...MANIFEST, id: "plain", policy: { ...MANIFEST.policy, state: null } };
    const more = await listBots("/bots/", files({ "/bots/index.json": { format: 1, bots: ["lstm", "plain"] }, "/bots/lstm/bot.json": recurrent, "/bots/plain/bot.json": stateless }));
    expect(more[0]).toMatchObject({ id: "lstm", playable: false, why: "its policy's state isn't written yet" });
    expect(more[1]).toMatchObject({ id: "plain", playable: true });
  });

  it("offers full strength, and the package's own easier level where it defines one (Nexto's EZ)", () => {
    const nexto = parseManifest({ ...MANIFEST, difficulty: { kind: "random-controls-v1", defaultStrength: 1, nextoEzStrength: 0.8 } });
    const necto = parseManifest(MANIFEST);
    if (typeof nexto === "string" || typeof necto === "string") throw new Error("manifest");
    expect(botLevels(nexto)).toEqual([{ id: "full", name: "Full", strength: 1 }, { id: "ez", name: "EZ", strength: 0.8 }]);
    expect(botLevels(necto)).toEqual([{ id: "full", name: "Full", strength: 1 }]);
  });

  it("picks at beta: 1 the likeliest (ties to the lowest), -1 the least, 0 uniform, else from the scaled softmax", () => {
    expect(pickIndex([0.1, 2, -1, 2], 1, 0.9)).toBe(1);
    expect(pickIndex([0.1, 2, -1, 2], -1, 0.9)).toBe(2);
    expect(pickIndex([5, 0, 1, 9], 1, 0, 1, 2)).toBe(1);
    expect([0, 0.3, 0.6, 0.99].map((r) => pickIndex([9, 0, 0], 0, r))).toEqual([0, 0, 1, 2]);
    // (beta 0.5: log₃(3) = 1, the softmax of the logits themselves, p₀ = 1 / (1 + e) ≈ 0.2689: drawn either side of it;
    // RV-538 BM30)
    expect([0.268, 0.27].map((r) => pickIndex([0, 1], 0.5, r))).toEqual([0, 1]);
    // (beta 0.5: log3(3) = 1, the plain softmax: weights 1 and 3)
    expect(pickIndex([0, Math.log(3)], 0.5, 0.2)).toBe(0);
    expect(pickIndex([0, Math.log(3)], 0.5, 0.3)).toBe(1);
  });

  it("parses a table's row, or a pick per head as the controls' products; buttons pressed over 0", () => {
    const table: Controls8[] = [[1, 0, 0, 0, 0, 0, 0, 0], [1, -1, 0, 0.5, 0, 1, 0, 1]];
    expect(lookupParser(table)([0, 3], 1, Math.random)).toEqual({ pick: 1, row: table[1] });
    expect(rowControls([1, -1, 0, 0.5, 0, 1, 0, 1])).toEqual({ throttle: 1, steer: -1, pitch: 0, yaw: 0.5, roll: 0, jump: true, boost: false, handbrake: true });
    // (heads 3,3,2,2,2: throttle/pitch 1, steer -1 as roll with the handbrake, jump, no boost)
    const logits = [0, 0, 5, 5, 0, 0, 0, 5, 5, 0, 0, 5];
    expect(multiDiscreteParser(NECTO_ACTION)(logits, 1, Math.random)).toEqual({ pick: [2, 0, 1, 0, 1], row: [1, -1, 1, -0, -1, 1, 0, 1] });
    expect(parseTable([[1, 0, 0, 0, 0, 0, 0, 0]])).toHaveLength(1);
    expect(parseTable([[1, 0]])).toBe("a row not 8 numbers");
  });

  it("decides on calls 0, 1, 9, 17 and applies each decision at the cycle counter's applyAtCounter", async () => {
    const decided: number[] = [];
    const driver = tickSkipDriver({
      tickSkip: 8,
      applyAtCounter: 7,
      decide: (view) => {
        decided.push(view.tick);
        return Promise.resolve([view.tick, 0, 0, 0, 0, 0, 0, 0]);
      },
    });
    const throttles: number[] = [];
    for (let tick = 0; tick < 20; tick++) throttles.push((await driver.tick({ tick } as unknown as BotView)).throttle);
    expect(decided).toEqual([0, 1, 9, 17]);
    // (tick 0's applied at once (its ticks count from the skip); tick 1's from tick 7; tick 9's from 15)
    expect(throttles).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 9, 9, 9, 9, 9]);
  });

  it("Nexto's EZ: with probability 1 − strength an update is random axes over the current buttons, else the new row (RV-535)", async () => {
    const draws = (...values: number[]): (() => number) => () => values.shift() ?? Number.NaN;
    const jumping: Controls8 = [1, 0, 0, 0, 0, 1, 0, 1];
    const row: Controls8 = [0.5, 1, 0, 0, 0, 0, 1, 0];
    // (strength 0.8: random under 0.2; its axes the next five draws, throttle U[0, 1), the rest U[−1, 1))
    expect(randomControls(0.8, draws(0.19, 0.5, 0.25, 0.75, 0, 0.999))(row, jumping)).toEqual([0.5, -0.5, 0.5, -1, 0.998, 1, 0, 1]);
    expect(randomControls(0.8, draws(0.2))(row, jumping)).toEqual(row);
    expect(randomControls(1, draws(0))(row, jumping)).toEqual(row);
    // (in the driver: the jump held from the last update stays through a random one whose row lets go)
    const driver = tickSkipDriver({
      tickSkip: 8,
      applyAtCounter: 7,
      decide: (view) => Promise.resolve(view.tick === 0 ? jumping : row),
      onApply: randomControls(0.5, draws(0.9, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5)),
    });
    const at: { jump: boolean; boost: boolean; throttle: number }[] = [];
    for (let tick = 0; tick < 8; tick++) at.push(await driver.tick({ tick } as unknown as BotView));
    expect(at[0]).toMatchObject({ jump: true, boost: false, throttle: 1 });
    // (the old row's buttons, not the new row's boost)
    expect(at[7]).toMatchObject({ jump: true, boost: false, throttle: 0.5 });
  });
});
