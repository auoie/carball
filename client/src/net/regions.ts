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

/** The regions a search goes to: the chosen ones (a page with one region: that one), and a returning token's own region
 *  (the token is that server's alone), in the list's order */
export function regionsToSearch(listed: readonly { readonly id: string }[], chosen: readonly string[], tokenRegion?: string): string[] {
  const ids = listed.length > 1 ? chosen : listed.map((r) => r.id);
  return listed.filter((r) => ids.includes(r.id) || r.id === tokenRegion).map((r) => r.id);
}

/** One search ticket for every region a search goes to that takes tickets from the same place (the accounts service's,
 *  for a deployment's regions; a development server's are its own): its nonce is kept per server, so each server takes
 *  it once, and a search costs one ticket however many regions it searches (RX43C-2: the claim's ticket then not refused
 *  by the account's allowance). A rejoin's tickets aren't shared */
export function shareSearchTickets(): (ticket: (rejoin?: bigint) => Promise<string>, source: string) => (rejoin?: bigint) => Promise<string> {
  const shared = new Map<string, Promise<string>>();
  return (ticket, source) => async (rejoin) => {
    if (rejoin !== undefined) return ticket(rejoin);
    let one = shared.get(source);
    if (!one) {
      one = ticket();
      shared.set(source, one);
    }
    return one;
  };
}
