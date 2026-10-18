// The training packs on offer: Carball's own starter packs (src/training/starterPacks.ts, a chunk of their own), and on
// the dev server alone the user's own packs, other creators' work converted locally (out/bsim/assets_local/training/
// packs/, git-ignored: never committed, never in a build; the dev server serves them at /local-assets/), read by this
// loader only where import.meta.env.DEV holds, so a build has neither the loader nor the path.
import { type TrainingPack, parsePack } from "./pack";
import { storedPacks } from "./myPacks";

/** A pack as the menu lists it: its name, type, difficulty and shots, and where it's read from */
export interface PackListing {
  readonly id: string;
  readonly name: string;
  readonly type: TrainingPack["type"];
  readonly difficulty: TrainingPack["difficulty"];
  readonly shots: number;
  readonly creator: string;
  readonly url: string;
  /** The player's own (the editor's: editable) */
  readonly mine?: true;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An index's listings (`{ format: 1, packs: [{ id, name, type, difficulty, shots, creator }] }`), each read from `base` */
export function readIndex(json: unknown, base: string): PackListing[] {
  if (!isRecord(json) || json["format"] !== 1 || !Array.isArray(json["packs"])) return [];
  return json["packs"].flatMap((p): PackListing[] => {
    if (!isRecord(p) || typeof p["id"] !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(p["id"])) return [];
    const type = p["type"] === "goalie" || p["type"] === "aerial" ? p["type"] : "striker";
    const difficulty = p["difficulty"] === "medium" || p["difficulty"] === "hard" ? p["difficulty"] : "easy";
    const str = (v: unknown): string => (typeof v === "string" ? v.slice(0, 64) : "");
    return [{ id: p["id"], name: str(p["name"]) || p["id"], type, difficulty, shots: typeof p["shots"] === "number" ? p["shots"] : 0, creator: str(p["creator"]), url: `${base}${p["id"]}.json` }];
  });
}

/** Where a starter pack and the player's own are read from (their listings' url) */
const STARTER = "starter:";
const MINE = "mine:";

/** A pack's listing */
export function listingOf(pack: TrainingPack, url: string): PackListing {
  return { id: pack.id, name: pack.name, type: pack.type, difficulty: pack.difficulty, shots: pack.shots.length, creator: pack.creator, url };
}

/** The packs there are: the player's own, Carball's, then (the dev server's) the user's */
export async function listPacks(fetcher: typeof fetch = fetch): Promise<PackListing[]> {
  const mine = storedPacks().map((p): PackListing => ({ ...listingOf(p, `${MINE}${p.id}`), mine: true }));
  const starter = [...mine, ...(await import("./starterPacks")).STARTER_PACKS.map((p) => listingOf(p, `${STARTER}${p.id}`))];
  if (!import.meta.env.DEV) return starter;
  try {
    const base = "/local-assets/training/packs/";
    const r = await fetcher(`${base}index.json`);
    return r.ok ? [...starter, ...readIndex(await r.json(), base)] : starter;
  } catch {
    return starter;
  }
}

/** A listed pack, read and checked (else what's wrong) */
export async function loadPack(listing: PackListing, fetcher: typeof fetch = fetch): Promise<TrainingPack | string> {
  if (listing.url.startsWith(MINE)) {
    const id = listing.url.slice(MINE.length);
    return storedPacks().find((p) => p.id === id) ?? `no pack ${id}`;
  }
  if (listing.url.startsWith(STARTER)) {
    const id = listing.url.slice(STARTER.length);
    return (await import("./starterPacks")).STARTER_PACKS.find((p) => p.id === id) ?? `no starter pack ${id}`;
  }
  try {
    const r = await fetcher(listing.url);
    if (!r.ok) return `HTTP ${String(r.status)}`;
    return parsePack(await r.json());
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
