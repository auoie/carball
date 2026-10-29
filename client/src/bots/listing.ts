// The bot packages there are (client/bots/, served at /bots/ by the dev server and copied into a build with bots:
// vite.config.ts): its index.json, then each package's bot.json, each listed playable when every id it names (builder,
// parser, mask, mirror, schedule, moments) is one of ours. The page reads this alone; a bot's brain (its policy,
// onnxruntime) is made in the match's worker (bots/registry.ts). No package to play: the bots' mode is hidden.
import { type BotManifest, parseManifest } from "./manifest";
import { MASKS, MIRRORS, MOMENTS, OBSERVATIONS } from "./observations";

/** Where the packages are served (the dev server's /bots/; a build's, if it has them) */
export const BOTS_BASE = `${import.meta.env.BASE_URL}bots/`;

/** A package as the menu lists it: playable or not (why not), its team sizes, its credit and licence */
export interface BotListing {
  readonly id: string;
  readonly name: string;
  readonly teamSizes: readonly number[];
  readonly credit: string;
  readonly licence: string;
  /** the licence's text, beside bot.json (the manifest's licenceFile, else LICENSE.txt) */
  readonly licenceFile: string;
  readonly playable: boolean;
  readonly why?: string;
}

const PARSERS: ReadonlySet<string> = new Set(["lookup-v1"]);
const SCHEDULES: ReadonlySet<string> = new Set(["tick-skip-v1"]);

export async function json(url: string, fetcher: typeof fetch): Promise<unknown> {
  const r = await fetcher(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${String(r.status)}`);
  return r.json();
}

/** Why a manifest can't be played here, or null (each id it names needs our implementation) */
export function unplayable(manifest: BotManifest): string | null {
  // (a recurrent policy's state between decisions: none written, so a package with one is refused, not run wrong, RV-546)
  if (manifest.policy.state !== undefined && manifest.policy.state !== null) return "its policy's state isn't written yet";
  if (!(manifest.observation.builder in OBSERVATIONS)) return `its observation builder ${manifest.observation.builder} isn't written yet`;
  if (!PARSERS.has(manifest.action.parser)) return `its action parser ${manifest.action.parser} isn't written yet`;
  const { action } = manifest;
  if (action.mask && !(action.mask.rule in MASKS)) return `its action mask ${action.mask.rule} isn't written yet`;
  if (action.mirror !== undefined && !(action.mirror in MIRRORS)) return `its mirror ${action.mirror} isn't written yet`;
  if (manifest.moments !== undefined && !(manifest.moments in MOMENTS)) return `its moments ${manifest.moments} aren't written yet`;
  if (manifest.timing && !SCHEDULES.has(manifest.timing.schedule)) return `its timing ${manifest.timing.schedule} isn't written yet`;
  return null;
}

/** A package's licence text when its manifest names none */
const LICENCE_FILE = "LICENSE.txt";

/** The packages there are (none: an empty list; a broken one listed as not playable) */
export async function listBots(base = BOTS_BASE, fetcher: typeof fetch = fetch): Promise<BotListing[]> {
  let index: unknown;
  try {
    index = await json(`${base}index.json`, fetcher);
  } catch {
    return [];
  }
  const ids = Array.isArray(index) ? index : typeof index === "object" && index !== null && "bots" in index && Array.isArray(index.bots) ? (index.bots as unknown[]) : [];
  const listings = await Promise.all(
    ids.filter((id): id is string => typeof id === "string").map(async (id): Promise<BotListing> => {
      try {
        const manifest = parseManifest(await json(`${base}${id}/bot.json`, fetcher));
        if (typeof manifest === "string") return { id, name: id, teamSizes: [], credit: "", licence: "", licenceFile: LICENCE_FILE, playable: false, why: `bot.json: ${manifest}` };
        const why = unplayable(manifest);
        return {
          id,
          name: manifest.name,
          teamSizes: manifest.teamSizes,
          credit: manifest.credit ?? manifest.authors ?? "",
          licence: manifest.licence,
          licenceFile: manifest.licenceFile ?? LICENCE_FILE,
          playable: why === null,
          ...(why === null ? {} : { why }),
        };
      } catch (e) {
        return { id, name: id, teamSizes: [], credit: "", licence: "", licenceFile: LICENCE_FILE, playable: false, why: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return listings;
}

