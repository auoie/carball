// One search across several regions (notes/matchmaking.md, Regions): a search session per region, in parallel, seen by
// Matchmaking as one. It says Searching once any region searches. The first match found wins: the other regions'
// searches are finished (their streams closed, so their servers take them out of their queues and write out anything
// they had sent), and a match one of them found meanwhile, the race, is given up (declined: no no-show once per window
// on its server). A region that fails while another still searches is dropped with a line; the search fails only once
// every region has (a cooldown's words first, else the last failure's), and is refused only if every region refused it.
// Another tab's search taking this one's place ends it everywhere.
import { OWN_SEARCH_TEXT, type SearchHandlers, type SearchSession } from "./matchmaking";

/** One region's part of the search */
export interface RegionSearch {
  /** Its id (Region's: kept with the claim) and its name (the log's lines; empty: a lone region) */
  readonly id: string;
  readonly name: string;
  /** Opens its search session */
  readonly search: (handlers: SearchHandlers) => SearchSession;
  /** Gives up a slot its server found (another region's match found first) */
  readonly decline: (token: bigint) => void;
}

/** The regions' search as one session; `handlers` Matchmaking's (its `found` told the region) */
export function searchRegions(regions: readonly RegionSearch[], handlers: SearchHandlers): SearchSession {
  const sessions = new Map<string, SearchSession>();
  const ended = new Set<string>();
  /** A match found (the first): the rest finishing, their matches declined */
  let won = false;
  /** Cancelled, or over without a match (failed, refused, replaced) */
  let over = false;
  let searchingTold = false;
  const refusals: number[] = [];
  let lastFailure = "";
  let cooldown: { seconds: number; network: boolean } | null = null;
  /** The reasons a dropped region's line has said (a ticket refused fails every region alike: said once, RX43C) */
  const said = new Set<string>();
  const live = (): boolean => !won && !over;
  const named = (region: RegionSearch, text: string): string => (region.name === "" ? text : `${region.name}: ${text}`);
  /** A region over without a match: dropped with a line while another goes on, else the search's end */
  const end = (region: RegionSearch, line: string): void => {
    ended.add(region.id);
    if (ended.size < regions.length) {
      if (!said.has(line)) handlers.warning?.(named(region, line));
      said.add(line);
      return;
    }
    over = true;
    // (refused only if every region refused it before taking it: the saved seat given back, pages.ts seatSearch)
    const refusal = refusals[0];
    if (refusal !== undefined && refusals.length === regions.length) handlers.refused?.(refusal);
    if (cooldown) handlers.cooldown(cooldown.seconds, cooldown.network);
    else handlers.failed(lastFailure);
  };
  for (const region of regions) {
    sessions.set(
      region.id,
      region.search({
        searching: () => {
          if (!live() || searchingTold) return;
          searchingTold = true;
          handlers.searching();
        },
        found: (token, map) => {
          // (the race: another region's match first, this one's slot given up)
          if (won) {
            region.decline(token);
            return;
          }
          if (over) return;
          won = true;
          ended.add(region.id);
          for (const [id, session] of sessions) if (id !== region.id) void session.finish();
          handlers.found(token, map, region.id);
        },
        failed: (reason) => {
          if (!live() || ended.has(region.id)) return;
          lastFailure = reason;
          end(region, reason);
        },
        refused: (reason) => {
          if (live()) refusals.push(reason);
        },
        cooldown: (seconds, network) => {
          if (!live() || ended.has(region.id)) return;
          cooldown = { seconds, network };
          end(region, network ? OWN_SEARCH_TEXT.cooldownNetwork(seconds) : OWN_SEARCH_TEXT.cooldown(seconds));
        },
        replaced: () => {
          if (!live()) return;
          over = true;
          for (const [id, session] of sessions) if (id !== region.id) session.cancel();
          handlers.replaced();
        },
      }),
    );
  }
  return {
    cancel: () => {
      over = true;
      for (const session of sessions.values()) session.cancel();
    },
    // (the page going: every region's search finished and its last answers read; a match found meanwhile wins, a second
    // one declined)
    finish: async () => {
      await Promise.all([...sessions.values()].map(async (session) => session.finish()));
    },
  };
}
