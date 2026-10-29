// The bot packages: their manifests checked, listed playable only with our observation builder, parser, mask, mirror and
// moments for them; the parser's choice from a policy's output; the schedule's decisions and its moments
import { describe, expect, it } from "vitest";
import type { BotView } from "../local/bots";
import { lookupParser, parseTable, pickIndex, rowControls } from "./actions";
import { tickSkipDriver } from "./driver";
import { type Controls8, parseManifest, pickBeta, policyFile } from "./manifest";
import { listBots } from "./listing";

const MANIFEST = {
  format: 1,
  id: "wisp",
  name: "Wisp",
  licence: "MIT",
  credit: "Wisp v2 by its author, MIT",
  policy: {
    opset: 17,
    file: "policy.onnx",
    inputs: [{ name: "obs", shape: [1, 432] }],
    outputs: [{ name: "logits", shape: [1, 90] }],
    pick: "argmax",
  },
  observation: { builder: "wisp-v1" },
  action: { parser: "lookup-v1", table: "actions.json", mask: { rule: "wisp-v1", groundRows: 24 }, mirror: "wisp-x-v1" },
  tickSkip: 8,
  teamSizes: [1, 2],
  moments: "wisp-celebrate-v1",
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
    expect(policyFile(m, 1)).toBe("policy.onnx");
    expect(policyFile(m, 3)).toBeNull();
    expect([pickBeta("argmax"), pickBeta("sample")]).toEqual([1, 0.5]);
    expect(parseManifest({ ...MANIFEST, id: "../x" })).toBe("its id");
    expect(parseManifest({ ...MANIFEST, tickSkip: 0 })).toBe("its tick skip");
    expect(parseManifest({ ...MANIFEST, policy: { file: 3 } })).toBe("its policy");
    expect(parseManifest({ ...MANIFEST, policy: { ...MANIFEST.policy, pick: { mode: "beta", beta: 1 } } })).toBe("its policy");
    // (its licence file: one file beside bot.json, RV-558)
    expect(parseManifest({ ...MANIFEST, licenceFile: "../LICENSE" })).toBe("its licence file");
    expect(parseManifest({ ...MANIFEST, licenceFile: "a/LICENSE" })).toBe("its licence file");
    expect(parseManifest({ ...MANIFEST, licenceFile: "COPYING.md" })).toMatchObject({ licenceFile: "COPYING.md" });
  });

  it("lists none without an index; a package playable with every rule it names ours, else not, with why", async () => {
    expect(await listBots("/bots/", files({}))).toEqual([]);
    const seer = { ...MANIFEST, id: "seer", name: "Seer", observation: { builder: "seer-v1" } };
    const listed = await listBots("/bots/", files({ "/bots/index.json": { format: 1, bots: ["wisp", "seer", "gone"] }, "/bots/wisp/bot.json": MANIFEST, "/bots/seer/bot.json": seer }));
    expect(listed[0]).toMatchObject({ id: "wisp", name: "Wisp", teamSizes: [1, 2], playable: true, credit: MANIFEST.credit, licence: "MIT" });
    // (the licence's text: LICENSE.txt unless the manifest names its own, RV-558)
    expect(listed[0]?.licenceFile).toBe("LICENSE.txt");
    const named = await listBots("/bots/", files({ "/bots/index.json": { format: 1, bots: ["wisp"] }, "/bots/wisp/bot.json": { ...MANIFEST, licenceFile: "COPYING.md" } }));
    expect(named[0]?.licenceFile).toBe("COPYING.md");
    expect(listed[1]).toMatchObject({ id: "seer", playable: false, why: "its observation builder seer-v1 isn't written yet" });
    expect(listed[2]).toMatchObject({ id: "gone", playable: false });
    // (a mask, mirror or moments not ours: refused, not run without them)
    const unknown = async (over: Record<string, unknown>): Promise<string | undefined> =>
      (await listBots("/bots/", files({ "/bots/index.json": { format: 1, bots: ["x"] }, "/bots/x/bot.json": { ...MANIFEST, id: "x", ...over } })))[0]?.why;
    expect(await unknown({ action: { ...MANIFEST.action, mask: { rule: "other-v1", groundRows: 24 } } })).toBe("its action mask other-v1 isn't written yet");
    expect(await unknown({ action: { ...MANIFEST.action, mirror: "other-v1" } })).toBe("its mirror other-v1 isn't written yet");
    expect(await unknown({ moments: "other-v1" })).toBe("its moments other-v1 aren't written yet");
    expect(await unknown({ action: { parser: "multidiscrete-v1" } })).toBe("its action parser multidiscrete-v1 isn't written yet");
    // (a recurrent policy's state: refused, not run without it, RV-546; null as the packages write none)
    const recurrent = { ...MANIFEST, id: "lstm", policy: { ...MANIFEST.policy, state: { kind: "lstm-v1" } } };
    const stateless = { ...MANIFEST, id: "plain", policy: { ...MANIFEST.policy, state: null } };
    const more = await listBots("/bots/", files({ "/bots/index.json": { format: 1, bots: ["lstm", "plain"] }, "/bots/lstm/bot.json": recurrent, "/bots/plain/bot.json": stateless }));
    expect(more[0]).toMatchObject({ id: "lstm", playable: false, why: "its policy's state isn't written yet" });
    expect(more[1]).toMatchObject({ id: "plain", playable: true });
  });

  it("picks at beta: 1 the likeliest (ties to the lowest), -1 the least, 0 uniform, else from the scaled softmax", () => {
    expect(pickIndex([0.1, 2, -1, 2], 1, 0.9)).toBe(1);
    expect(pickIndex([0.1, 2, -1, 2], -1, 0.9)).toBe(2);
    expect(pickIndex([5, 0, 1, 9], 1, 0, 1, 2)).toBe(1);
    expect([0, 0.3, 0.6, 0.99].map((r) => pickIndex([9, 0, 0], 0, r))).toEqual([0, 0, 1, 2]);
    // (beta 0.5, "sample": log₃(3) = 1, the softmax of the logits themselves, p₀ = 1 / (1 + e) ≈ 0.2689: drawn either side
    // of it; RV-538 BM30)
    expect([0.268, 0.27].map((r) => pickIndex([0, 1], 0.5, r))).toEqual([0, 1]);
    expect(pickIndex([0, Math.log(3)], 0.5, 0.2)).toBe(0);
    expect(pickIndex([0, Math.log(3)], 0.5, 0.3)).toBe(1);
  });

  it("parses a table's row, buttons pressed over 0", () => {
    const table: Controls8[] = [
      [1, 0, 0, 0, 0, 0, 0, 0],
      [1, -1, 0, 0.5, 0, 1, 0, 1],
    ];
    expect(lookupParser(table)([0, 3], 1, Math.random)).toEqual({ pick: 1, row: table[1] });
    // (a mask's rows alone: the likelier row left out)
    expect(lookupParser(table)([0, 3], 1, Math.random, [true, false])).toEqual({ pick: 0, row: table[0] });
    expect(rowControls([1, -1, 0, 0.5, 0, 1, 0, 1])).toEqual({ throttle: 1, steer: -1, pitch: 0, yaw: 0.5, roll: 0, jump: true, boost: false, handbrake: true });
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

  it("a moment's script plays instead of the schedule, which waits for it: no decision, its counter held", async () => {
    const decided: number[] = [];
    let held = false;
    const driver = tickSkipDriver({
      tickSkip: 8,
      applyAtCounter: 7,
      decide: (view) => {
        decided.push(view.tick);
        return Promise.resolve([1, 0, 0, 0, 0, 0, 0, 0]);
      },
      moment: () => (held ? [-1, 0.5, 0, 0, 0, 0, 0, 0] : null),
    });
    await driver.tick({ tick: 0 } as unknown as BotView);
    held = true;
    const during = await driver.tick({ tick: 1 } as unknown as BotView);
    expect([during.throttle, during.steer]).toEqual([-1, 0.5]);
    expect(decided).toEqual([0]);
    held = false;
    await driver.tick({ tick: 2 } as unknown as BotView);
    expect(decided).toEqual([0, 2]);
  });
});
