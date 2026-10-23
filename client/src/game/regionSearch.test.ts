// One search across several regions (notes/matchmaking.md, Regions), with made-up regions and fake sessions
import { describe, expect, it } from "vitest";
import { OWN_SEARCH_TEXT, type SearchHandlers } from "./matchmaking";
import { type RegionSearch, searchRegions } from "./regionSearch";

function harness(names: readonly string[]) {
  const opened = new Map<string, { handlers: SearchHandlers; cancelled: boolean; finished: boolean }>();
  const declined: [string, bigint][] = [];
  const told: string[] = [];
  const regions: RegionSearch[] = names.map((name, i) => {
    const id = `r${String(i)}`;
    return {
      id,
      name,
      search: (handlers) => {
        const s = { handlers, cancelled: false, finished: false };
        opened.set(id, s);
        return {
          cancel: () => {
            s.cancelled = true;
          },
          finish: () => {
            s.finished = true;
            return Promise.resolve();
          },
        };
      },
      decline: (token) => declined.push([id, token]),
    };
  });
  const session = searchRegions(regions, {
    searching: () => told.push("searching"),
    found: (token, map, region) => told.push(`found ${String(token)} ${String(map)} ${region ?? ""}`),
    failed: (reason) => told.push(`failed ${reason}`),
    warning: (text) => told.push(`warning ${text}`),
    refused: (reason) => told.push(`refused ${String(reason)}`),
    cooldown: (seconds, network) => told.push(`cooldown ${String(seconds)} ${String(network)}`),
    replaced: () => told.push("replaced"),
  });
  const region = (i: number): { handlers: SearchHandlers; cancelled: boolean; finished: boolean } => {
    const s = opened.get(`r${String(i)}`);
    if (!s) throw new Error("no such region");
    return s;
  };
  return { session, region, declined, told };
}

describe("a search across regions", () => {
  it("opens a search per region; Searching once; the first match found wins, the others finished", () => {
    const { region, told } = harness(["US-East", "Europe", "Asia"]);
    region(1).handlers.searching();
    region(0).handlers.searching();
    expect(told).toEqual(["searching"]);
    region(2).handlers.found(7n, 0);
    expect(told).toEqual(["searching", "found 7 0 r2"]);
    expect([region(0).finished, region(1).finished, region(2).finished]).toEqual([true, true, false]);
  });

  it("the race: another region's match during that finish is declined at its server, not joined", () => {
    const { region, declined, told } = harness(["US-East", "Europe"]);
    region(0).handlers.found(5n, 0);
    region(1).handlers.found(6n, 0);
    expect(declined).toEqual([["r1", 6n]]);
    expect(told).toEqual(["found 5 0 r0"]);
    // (and the finished regions' ends after it say nothing)
    region(1).handlers.failed("the connection to the server was lost");
    expect(told).toEqual(["found 5 0 r0"]);
  });

  it("a region failing while another searches is dropped with a line; the search fails only once every region has", () => {
    const { region, told } = harness(["US-East", "Europe"]);
    region(0).handlers.searching();
    region(1).handlers.failed("the server can't be reached");
    expect(told).toEqual(["searching", "warning Europe: the server can't be reached"]);
    region(0).handlers.failed("the connection to the server was lost");
    expect(told.at(-1)).toBe("failed the connection to the server was lost");
    // (nothing after the end)
    region(1).handlers.failed("again");
    region(0).handlers.found(1n, 0);
    expect(told.length).toBe(3);
  });

  it("a reason every region fails for alike (a ticket refused) said once, not once a region (RX43C)", () => {
    const { region, told } = harness(["US-East", "Europe", "Asia"]);
    region(0).handlers.failed("too many requests");
    region(1).handlers.failed("too many requests");
    region(2).handlers.failed("too many requests");
    expect(told).toEqual(["warning US-East: too many requests", "failed too many requests"]);
  });

  it("a cooldown's words first at the end; a region's cooldown while another searches, a line", () => {
    const { region, told } = harness(["US-East", "Europe"]);
    region(0).handlers.cooldown(90, false);
    expect(told).toEqual([`warning US-East: ${OWN_SEARCH_TEXT.cooldown(90)}`]);
    region(1).handlers.failed("lost");
    expect(told.at(-1)).toBe("cooldown 90 false");
  });

  it("refused only if every region refused it (the saved seat given back then)", () => {
    const some = harness(["US-East", "Europe"]);
    some.region(0).handlers.refused?.(5);
    some.region(0).handlers.failed("refused");
    some.region(1).handlers.failed("lost");
    expect(some.told.some((t) => t.startsWith("refused"))).toBe(false);
    const all = harness(["US-East", "Europe"]);
    all.region(0).handlers.refused?.(7);
    all.region(0).handlers.failed("refused");
    all.region(1).handlers.refused?.(7);
    all.region(1).handlers.failed("refused");
    expect(all.told).toEqual(["warning US-East: refused", "refused 7", "failed refused"]);
  });

  it("a lone region's lines without its name, as a search of one", () => {
    const { region, told } = harness([""]);
    region(0).handlers.failed("lost");
    expect(told).toEqual(["failed lost"]);
  });

  it("another tab's search ends it everywhere; Cancel Search cancels every region", () => {
    const replaced = harness(["US-East", "Europe"]);
    replaced.region(1).handlers.replaced();
    expect(replaced.told).toEqual(["replaced"]);
    expect(replaced.region(0).cancelled).toBe(true);
    const cancelled = harness(["US-East", "Europe"]);
    cancelled.session.cancel();
    expect([cancelled.region(0).cancelled, cancelled.region(1).cancelled]).toEqual([true, true]);
    cancelled.region(0).handlers.found(3n, 0);
    expect(cancelled.told).toEqual([]);
  });

  it("the page going: every region finished; a match found meanwhile wins, a second declined", async () => {
    const { session, region, declined, told } = harness(["US-East", "Europe"]);
    const finishing = session.finish();
    region(1).handlers.found(8n, 0);
    region(0).handlers.found(9n, 0);
    await finishing;
    expect(told).toEqual(["found 8 0 r1"]);
    expect(declined).toEqual([["r0", 9n]]);
    expect([region(0).finished, region(1).finished]).toEqual([true, true]);
  });
});
