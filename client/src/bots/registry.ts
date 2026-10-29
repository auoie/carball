// A bot's brain made from its package (in the match's worker): its policy (bots/policy.ts, onnxruntime) on the
// observations its named builder makes (bots/observations.ts), the pick over its table's rows its mask allows
// (bots/actions.ts), turned back by its mirror, on its schedule (bots/driver.ts). The packages' listing: bots/listing.ts.
import type { BotBrain } from "../local/bots";
import { type ActionParser, lookupParser, parseTable } from "./actions";
import { tickSkipDriver } from "./driver";
import { json, unplayable } from "./listing";
import { type BotManifest, type Controls8, parseManifest, pickBeta, policyFile } from "./manifest";
import { MASKS, MIRRORS, MOMENTS, OBSERVATIONS } from "./observations";
import { OnnxPolicy } from "./policy";

/** A package's parts its bots share in a match of one team size: its manifest, its policy's session (one model run at a
 *  time: the bots decide in turn), its table and parser; fetched and created once however many of its bots play
 *  (RV-540). A bot's own state (its builder's, its schedule) stays its own */
interface PackageParts {
  readonly manifest: BotManifest;
  readonly policy: OnnxPolicy;
  readonly parser: ActionParser;
  readonly table: readonly Controls8[];
}

/** The match's packages' shared parts, by base, id and team size */
export type PackageCache = Map<string, Promise<PackageParts>>;

async function packageParts(base: string, id: string, teamSize: number, fetcher: typeof fetch, runtime?: Parameters<typeof OnnxPolicy.create>[2]): Promise<PackageParts> {
  const manifest = parseManifest(await json(`${base}${id}/bot.json`, fetcher));
  if (typeof manifest === "string") throw new Error(`bot ${id}: bot.json: ${manifest}`);
  const why = unplayable(manifest);
  if (why !== null) throw new Error(`bot ${id}: ${why}`);
  const file = policyFile(manifest, teamSize);
  if (file === null) throw new Error(`bot ${id} doesn't play ${String(teamSize)}v${String(teamSize)}`);
  const model = await fetcher(`${base}${id}/${file}`);
  if (!model.ok) throw new Error(`bot ${id}: its policy, HTTP ${String(model.status)}`);
  const policy = await OnnxPolicy.create(new Uint8Array(await model.arrayBuffer()), manifest.policy, runtime);
  const table = parseTable(await json(`${base}${id}/${manifest.action.table}`, fetcher));
  if (typeof table === "string") throw new Error(`bot ${id}: its action table: ${table}`);
  return { manifest, policy, parser: lookupParser(table), table };
}

/** A bot's brain from its package, for a match of `teamSize` a side: its builder's observations into its policy, the pick
 *  read by its parser from its mask's rows, turned back by its mirror, on its schedule, its moments scripted; `packages`,
 *  the match's: the package's parts shared with its other bots */
export async function loadBrain(
  base: string,
  id: string,
  teamSize: number,
  fetcher: typeof fetch = fetch,
  random: () => number = Math.random,
  runtime?: Parameters<typeof OnnxPolicy.create>[2],
  packages?: PackageCache,
): Promise<BotBrain> {
  const key = `${base}${id}/${String(teamSize)}`;
  let shared = packages?.get(key);
  if (!shared) {
    shared = packageParts(base, id, teamSize, fetcher, runtime);
    packages?.set(key, shared);
  }
  const { manifest, policy, parser, table } = await shared;
  const observer = OBSERVATIONS[manifest.observation.builder]?.(manifest, teamSize, random);
  if (!observer) throw new Error(`bot ${id}: no observation builder`);
  const { action } = manifest;
  const mask = action.mask ? MASKS[action.mask.rule]?.(table, action.mask.groundRows) : undefined;
  const mirror = action.mirror === undefined ? undefined : MIRRORS[action.mirror];
  const moment = manifest.moments === undefined ? undefined : MOMENTS[manifest.moments];
  const beta = pickBeta(manifest.policy.pick);
  return tickSkipDriver({
    tickSkip: manifest.tickSkip,
    applyAtCounter: manifest.timing?.applyAtCounter ?? manifest.tickSkip,
    async decide(view, previous) {
      const logits = await policy.run(observer.build(view, previous));
      const row = parser(logits, beta, random, mask?.(view)).row;
      return mirror ? mirror(view, row) : row;
    },
    ...(moment ? { moment } : {}),
  });
}
