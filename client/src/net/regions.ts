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
