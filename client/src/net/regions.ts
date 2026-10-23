// The regions a search goes to (notes/matchmaking.md, Regions): the player's choice, kept in this browser, else the
// region with the lowest ping, else the first; at least one always
const REGIONS_KEY = "carball.regions";

function local(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The regions the player ticked (their ids), as kept; null: no choice kept */
export function storedRegions(storage = local()): string[] | null {
  try {
    const value = JSON.parse(storage?.getItem(REGIONS_KEY) ?? "null") as unknown;
    if (!Array.isArray(value)) return null;
    const ids = value.filter((v): v is string => typeof v === "string" && v.length <= 64);
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

export function storeRegions(ids: readonly string[], storage = local()): void {
  try {
    storage?.setItem(REGIONS_KEY, JSON.stringify(ids));
  } catch {
    // (not kept: chosen again next visit)
  }
}

/** The regions to search, in the list's order: the kept ones still listed; else the one with the lowest ping known; else
 *  the first */
export function chooseRegions(
  regions: readonly { readonly id: string }[],
  stored: readonly string[] | null,
  pings: ReadonlyMap<string, number | null>,
): string[] {
  const kept = regions.filter((r) => stored?.includes(r.id)).map((r) => r.id);
  if (kept.length > 0) return kept;
  let best: { id: string; ms: number } | null = null;
  for (const r of regions) {
    const ms = pings.get(r.id);
    if (typeof ms === "number" && (best === null || ms < best.ms)) best = { id: r.id, ms };
  }
  if (best) return [best.id];
  const first = regions[0];
  return first ? [first.id] : [];
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
