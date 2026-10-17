// A bot's brain made from its package (in the match's worker): its policy (bots/policy.ts, onnxruntime) on the
// observations its named builder makes (bots/observations.ts), the output read by its named parser (bots/actions.ts), on
// its schedule (bots/driver.ts), at the difficulty level chosen. The packages' listing: bots/listing.ts.
import type { BotBrain } from "../local/bots";
import { lookupParser, multiDiscreteParser, parseTable } from "./actions";
import { randomControls, rlgymCompatDriver } from "./driver";
import { json, unplayable } from "./listing";
import { parseManifest, pickBeta, policyFile } from "./manifest";
import { KICKOFFS, OBSERVATIONS } from "./observations";
import { OnnxPolicy } from "./policy";

/** A bot's brain from its package, for a match of `teamSize` a side: its builder's observations into its policy, the pick
 *  at the moment's beta read by its parser, on its schedule; its kickoff script; at `strength` (a level it offers:
 *  bots/listing.ts botLevels; else the package's default) */
export async function loadBrain(
  base: string,
  id: string,
  teamSize: number,
  fetcher: typeof fetch = fetch,
  random: () => number = Math.random,
  runtime?: Parameters<typeof OnnxPolicy.create>[2],
  strength?: number,
): Promise<BotBrain> {
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
  let parser;
  if (action.parser === "lookup-v1") {
    const table = parseTable(await json(`${base}${id}/${action.table}`, fetcher));
    if (typeof table === "string") throw new Error(`bot ${id}: its action table: ${table}`);
    parser = lookupParser(table);
  } else parser = multiDiscreteParser(action);
  const observer = OBSERVATIONS[manifest.observation.builder]?.(manifest, teamSize, policyAt.entities);
  if (!observer) throw new Error(`bot ${id}: no observation builder`);
  const kickoff = manifest.kickoff ? KICKOFFS[manifest.kickoff.taker]?.(manifest.kickoff) : undefined;
  const level = manifest.difficulty?.kind === "random-controls-v1" ? (strength ?? manifest.difficulty.defaultStrength) : 1;
  return rlgymCompatDriver({
    tickSkip: manifest.tickSkip,
    applyAtCounter: manifest.timing?.applyAtCounter ?? manifest.tickSkip,
    track: (view) => observer.track?.(view),
    async decide(view, previous) {
      const logits = await policy.run(observer.build(view, previous));
      return parser(logits, pickBeta(manifest.policy.pick, view.state), random).row;
    },
    ...(level < 1 ? { onApply: randomControls(level, random) } : {}),
    ...(kickoff ? { kickoff } : {}),
  });
}
