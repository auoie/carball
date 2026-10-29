// A bot's brain made from its package (in the match's worker): its policy (bots/policy.ts, onnxruntime) on the
// observations its named builder makes (bots/observations.ts), the output read by its named parser (bots/actions.ts), on
// its schedule (bots/driver.ts), at the difficulty level chosen. The packages' listing: bots/listing.ts.
import type { BotBrain } from "../local/bots";
import { type ActionParser, lookupParser, multiDiscreteParser, parseTable } from "./actions";
import { randomControls, tickSkipDriver } from "./driver";
import { json, unplayable } from "./listing";
import { type BotManifest, type Controls8, parseManifest, pickBeta, policyFile } from "./manifest";
import { KICKOFFS, MASKS, MIRRORS, MOMENTS, OBSERVATIONS } from "./observations";
import { OnnxPolicy } from "./policy";

/** A package's parts its bots share in a match of one team size: its manifest, its policy's session (one model run at a
 *  time: the bots decide in turn) and its parser; fetched and created once however many of its bots play (RV-540). A
 *  bot's own state (its builder's tracker and timers, its schedule, its kickoff) stays its own */
interface PackageParts {
  readonly manifest: BotManifest;
  readonly entities: number | null;
  readonly policy: OnnxPolicy;
  readonly parser: ActionParser;
  /** A lookup parser's table (its mask's) */
  readonly table: readonly Controls8[] | null;
}

/** The match's packages' shared parts, by base, id and team size */
export type PackageCache = Map<string, Promise<PackageParts>>;

async function packageParts(base: string, id: string, teamSize: number, fetcher: typeof fetch, runtime?: Parameters<typeof OnnxPolicy.create>[2]): Promise<PackageParts> {
  const manifest = parseManifest(await json(`${base}${id}/bot.json`, fetcher));
  if (typeof manifest === "string") throw new Error(`bot ${id}: bot.json: ${manifest}`);
  const why = unplayable(manifest);
  if (why !== null) throw new Error(`bot ${id}: ${why}`);
  const policyAt = policyFile(manifest, teamSize);
  if (!policyAt) throw new Error(`bot ${id} doesn't play ${String(teamSize)}v${String(teamSize)}`);
  const model = await fetcher(`${base}${id}/${policyAt.file}`);
  if (!model.ok) throw new Error(`bot ${id}: its policy, HTTP ${String(model.status)}`);
  const policy = await OnnxPolicy.create(new Uint8Array(await model.arrayBuffer()), manifest.policy, runtime);
  const action = manifest.action;
  let parser: ActionParser;
  let rows: Controls8[] | null = null;
  if (action.parser === "lookup-v1") {
    const table = parseTable(await json(`${base}${id}/${action.table}`, fetcher));
    if (typeof table === "string") throw new Error(`bot ${id}: its action table: ${table}`);
    rows = table;
    parser = lookupParser(table);
  } else parser = multiDiscreteParser(action);
  return { manifest, entities: policyAt.entities, policy, parser, table: rows };
}

/** A bot's brain from its package, for a match of `teamSize` a side: its builder's observations into its policy, the pick
 *  at the moment's beta read by its parser, on its schedule; its kickoff script; at `strength` (a level it offers:
 *  bots/listing.ts botLevels; else the package's default); `packages`, the match's: the package's parts shared with its
 *  other bots */
export async function loadBrain(
  base: string,
  id: string,
  teamSize: number,
  fetcher: typeof fetch = fetch,
  random: () => number = Math.random,
  runtime?: Parameters<typeof OnnxPolicy.create>[2],
  strength?: number,
  packages?: PackageCache,
): Promise<BotBrain> {
  const key = `${base}${id}/${String(teamSize)}`;
  let shared = packages?.get(key);
  if (!shared) {
    shared = packageParts(base, id, teamSize, fetcher, runtime);
    packages?.set(key, shared);
  }
  const { manifest, entities, policy, parser, table } = await shared;
  const observer = OBSERVATIONS[manifest.observation.builder]?.(manifest, teamSize, entities, random);
  if (!observer) throw new Error(`bot ${id}: no observation builder`);
  const action = manifest.action.parser === "lookup-v1" ? manifest.action : null;
  const mask = action?.mask && table ? MASKS[action.mask.rule]?.(table, action.mask.groundRows) : undefined;
  const mirror = action?.mirror === undefined ? undefined : MIRRORS[action.mirror];
  const moment = manifest.moments === undefined ? undefined : MOMENTS[manifest.moments];
  const kickoff = manifest.kickoff ? KICKOFFS[manifest.kickoff.taker]?.(manifest.kickoff) : undefined;
  const level = manifest.difficulty?.kind === "random-controls-v1" ? (strength ?? manifest.difficulty.defaultStrength) : 1;
  return tickSkipDriver({
    tickSkip: manifest.tickSkip,
    applyAtCounter: manifest.timing?.applyAtCounter ?? manifest.tickSkip,
    track: (view) => observer.track?.(view),
    async decide(view, previous) {
      const logits = await policy.run(observer.build(view, previous));
      const row = parser(logits, pickBeta(manifest.policy.pick, view.state), random, mask?.(view)).row;
      return mirror ? mirror(view, row) : row;
    },
    ...(level < 1 ? { onApply: randomControls(level, random) } : {}),
    ...(kickoff ? { kickoff } : {}),
    ...(moment ? { moment } : {}),
  });
}
