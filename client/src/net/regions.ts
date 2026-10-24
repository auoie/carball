// The regions a search goes to (notes/matchmaking.md, Regions): the player's choice, kept in this browser, else the
// region with the lowest ping (kept too, and chosen again as the pings change: RV-862), else the first; at least one
// always. The pings kept a few minutes, so a page doesn't measure them again at each load (RV-847)
const REGIONS_KEY = "carball.regions";
const PINGS_KEY = "carball.regionPings";
/** How long kept pings stand for a new page (ms) */
export const PINGS_KEPT_MS = 10 * 60 * 1000;

function local(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The regions kept: their ids, and whether the player ticked them (else the lowest ping's, chosen for them) */
export interface KeptRegions {
  readonly ids: string[];
  readonly manual: boolean;
}

const idList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length <= 64) : []);

/** The regions kept; null: none. A list from before the choice was told apart (619e7e8): one region the lowest ping's
 *  pick (chosen again), more the player's */
export function storedRegions(storage = local()): KeptRegions | null {
  try {
    const value = JSON.parse(storage?.getItem(REGIONS_KEY) ?? "null") as unknown;
    if (Array.isArray(value)) {
      const list = idList(value);
      return list.length > 0 ? { ids: list, manual: list.length > 1 } : null;
    }
    if (typeof value !== "object" || value === null) return null;
    const { ids: kept, manual } = value as { ids?: unknown; manual?: unknown };
    const list = idList(kept);
    return list.length > 0 ? { ids: list, manual: manual === true } : null;
  } catch {
    return null;
  }
}

export function storeRegions(chosen: readonly string[], manual: boolean, storage = local()): void {
  try {
    storage?.setItem(REGIONS_KEY, JSON.stringify({ ids: chosen, manual }));
  } catch {
    // (not kept: chosen again next visit)
  }
}

/** The regions to search, in the list's order: the player's kept ones still listed; else the one with the lowest ping
 *  known; else the kept pick still listed; else the first */
export function chooseRegions(regions: readonly { readonly id: string }[], stored: KeptRegions | null, pings: ReadonlyMap<string, number | null>): string[] {
  const kept = regions.filter((r) => stored?.ids.includes(r.id)).map((r) => r.id);
  if (stored?.manual && kept.length > 0) return kept;
  let best: { id: string; ms: number } | null = null;
  for (const r of regions) {
    const ms = pings.get(r.id);
    if (typeof ms === "number" && (best === null || ms < best.ms)) best = { id: r.id, ms };
  }
  if (best) return [best.id];
  if (kept.length > 0) return kept;
  const first = regions[0];
  return first ? [first.id] : [];
}

/** The pings kept and when they were measured (ms, wall clock); none, or older than PINGS_KEPT_MS at `now` */
export function storedPings(now = Date.now(), storage = local()): { readonly at: number; readonly pings: Map<string, number | null> } | null {
  try {
    const value = JSON.parse(storage?.getItem(PINGS_KEY) ?? "null") as { at?: unknown; pings?: unknown } | null;
    if (!value || typeof value.at !== "number" || !(now - value.at < PINGS_KEPT_MS) || value.at > now) return null;
    if (typeof value.pings !== "object" || value.pings === null) return null;
    const pings = new Map<string, number | null>();
    for (const [id, ms] of Object.entries(value.pings as Record<string, unknown>)) {
      if (id.length <= 64 && (ms === null || (typeof ms === "number" && Number.isFinite(ms) && ms >= 0))) pings.set(id, ms);
    }
    return { at: value.at, pings };
  } catch {
    return null;
  }
}

export function storePings(pings: ReadonlyMap<string, number | null>, at = Date.now(), storage = local()): void {
  try {
    storage?.setItem(PINGS_KEY, JSON.stringify({ at, pings: Object.fromEntries(pings) }));
  } catch {
    // (not kept: measured again next page)
  }
}

/** The ticked regions after a region's box is pressed: it toggled, the last one never unticked */
export function toggleRegion(chosen: readonly string[], id: string, order: readonly string[]): string[] {
  const next = chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id];
  if (next.length === 0) return [...chosen];
  return order.filter((o) => next.includes(o));
}

/** A search's plan from the pings measured for it alone (RV-879: a kept ping from before is no answer now): the regions
 *  chosen (the player's ticked ones; else, `automatic`, the lowest of these pings, kept as the automatic pick), the
 *  request, its regions without those whose server refused this page's version (`outdated`: one such region never stops
 *  a search of the others, RV-1030), and whether that left none (`outdatedOnly`: every region it would search refused) */
export function searchPlan(
  listed: readonly { readonly id: string; readonly server: string }[],
  stored: KeptRegions | null,
  chosen: readonly string[],
  measured: ReadonlyMap<string, number | null>,
  playlists: readonly number[],
  outdated: ReadonlySet<string> = new Set(),
): { chosen: string[]; automatic: boolean; request: ReturnType<typeof searchRequest>; outdatedOnly: boolean } {
  const automatic = listed.length > 1 && stored?.manual !== true;
  const regions = automatic ? chooseRegions(listed, stored, measured) : [...chosen];
  const searched = listed.length > 1 ? regions : listed.map((r) => r.id);
  const open = searched.filter((id) => !outdated.has(id));
  const outdatedOnly = searched.length > 0 && open.length === 0;
  return { chosen: regions, automatic, request: searchRequest(listed, open, measured, playlists, outdated), outdatedOnly };
}

/** A ping's answer on the regions whose server refused this page's version (RV-1030, RV-1063): a refusal on version marks
 *  its region, a pong clears it, no answer leaves it as it was. Whether the page's version is to be checked (a refusal) */
export function markVersion(marks: Set<string>, id: string, answer: { readonly ms: number; readonly server: string } | "outdated" | null): boolean {
  if (answer === "outdated") {
    marks.add(id);
    return true;
  }
  if (answer !== null) marks.delete(id);
  return false;
}

/** What a refusal on version comes to (RV-1030, RV-1063): the reload's modal when this page's version isn't its
 *  deployment's (`pageApart`: a reload brings the deployment's page) and none was shown yet; a search left with only such
 *  regions (`outdatedOnly`) refused with the reload's words then, else as those servers being updated; null, it goes on */
export function versionVerdict(
  outdatedOnly: boolean,
  pageApart: boolean,
  reloadShown: boolean,
): { readonly showReload: boolean; readonly refuse: "reload" | "updating" | null } {
  return { showReload: pageApart && !reloadShown, refuse: outdatedOnly ? (pageApart ? "reload" : "updating") : null };
}

/** A region's ping from its server's answer (pingServer's): its ms and the name its Pong gives (the search sends it); a
 *  server naming itself outside the matchmaker's pattern counted as unanswered (no search can go there, RV-893), one
 *  naming none (from before the name) known by its URL: no name */
export function pingAnswer(answer: { readonly ms: number; readonly server: string } | "outdated" | null): { ms: number; name: string | null } | null {
  if (answer === null || answer === "outdated" || (answer.server !== "" && !serverNameOk(answer.server))) return null;
  return { ms: answer.ms, name: answer.server === "" ? null : answer.server };
}

/** A server's name as the matchmaker takes it: host:port (the API's pattern) */
export function serverNameOk(name: string): boolean {
  return /^[A-Za-z0-9.-]{1,58}:[0-9]{1,5}$/.test(name);
}

/** A search's request from the regions (each its server's name), the ticked ones (a page with one region: that one) and
 *  the pings just measured: every listed region's server that answered, and the ticked ones' servers, each once (MX1R-19:
 *  the matchmaker reads a match's server's ping whether it's ticked or not), but those `outdated` (their server refused
 *  this page's version: never a match there, RV-1030); a server whose name isn't one left out, so one region's odd name
 *  never fails the search (RV-868) */
export function searchRequest(
  listed: readonly { readonly id: string; readonly server: string }[],
  chosen: readonly string[],
  pings: ReadonlyMap<string, number | null>,
  playlists: readonly number[],
  outdated: ReadonlySet<string> = new Set(),
): { playlists: readonly number[]; pings: Record<string, number>; regions: string[] } {
  const ticked = (listed.length > 1 ? listed.filter((r) => chosen.includes(r.id)) : listed).filter((r) => !outdated.has(r.id));
  const answered: Record<string, number> = {};
  for (const r of listed) {
    const ms = pings.get(r.id);
    if (typeof ms === "number" && serverNameOk(r.server)) answered[r.server] = Math.round(ms);
  }
  return { playlists, pings: answered, regions: [...new Set(ticked.map((r) => r.server).filter(serverNameOk))] };
}
