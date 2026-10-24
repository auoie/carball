import { afterEach, describe, expect, it, vi } from "vitest";
import { RefusedError } from "./connection";
import {
  REFUSED_CONCLUDED,
  REFUSED_IN_MATCH,
  REFUSED_MODE,
  REFUSED_QUEUE_BANNED,
  REFUSED_REJOIN_GONE,
  REFUSED_TICKET,
  REFUSED_TOKEN,
  REFUSED_UNCONFIRMED,
  REFUSED_VERSION,
  PROTOCOL_VERSION,
} from "./protocol";
import { QueueBannedError, RejoinGoneError, SignedOutError } from "./tickets";
import {
  type GameServerConfig,
  CLAIM_RETRY_MS,
  CLAIM_TRIES,
  SERVERS_UNREACHABLE,
  claimAddress,
  playlistsOf,
  serverOfUrl,
  claimNotice,
  configServers,
  deployedGameServer,
  holdMatchLock,
  localPage,
  matchLock,
  matchPlayedElsewhere,
  openClaim,
  pageOutdated,
  pageUrl,
  queueAddress,
  queueRegions,
  REJOIN_SECONDS,
  clearRankedSeat,
  clearRankedSeatOf,
  leaveMatchSeat,
  rankedSeat,
  searchGaveUpSeat,
  seatKeptAfter,
  seatSearch,
  storeClaim,
  storeNotice,
  storeRankedSeat,
  takeClaim,
  takeNotice,
} from "./pages";

const memory = (): Pick<Storage, "getItem" | "setItem" | "removeItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

describe("the pages' handoffs", () => {
  it("hands the match page its claim once, a 64-bit token intact", () => {
    const storage = memory();
    expect(takeClaim(storage)).toBeNull();
    storeClaim({ token: 0x8000000000000001n, playlist: 2, searchedAt: 1_700_000_000_123 }, storage);
    expect(takeClaim(storage)).toEqual({ token: 0x8000000000000001n, playlist: 2, searchedAt: 1_700_000_000_123 });
    expect(takeClaim(storage), "taken out").toBeNull();
    storage.setItem("carball.claim", '{"token":"0","playlist":1}');
    expect(takeClaim(storage), "no token").toBeNull();
    storage.setItem("carball.claim", "{broken");
    expect(takeClaim(storage)).toBeNull();
    expect(takeClaim(null)).toBeNull();
    // A search time that isn't a number (or isn't finite) is now's, never NaN (RX14's K9)
    for (const bad of ['"x"', "null", "1e999"]) {
      storage.setItem("carball.claim", `{"token":"5","playlist":1,"searchedAt":${bad}}`);
      const at = takeClaim(storage)?.searchedAt;
      expect(Number.isFinite(at), bad).toBe(true);
    }
    // The match's map from its MatchFound (its arena loads while the claim connects); one that isn't a map index dropped
    storeClaim({ token: 9n, playlist: 1, searchedAt: 5, map: 12 }, storage);
    expect(takeClaim(storage)).toEqual({ token: 9n, playlist: 1, searchedAt: 5, map: 12 });
    for (const bad of ['"3"', "-1", "2.5", "300"]) {
      storage.setItem("carball.claim", `{"token":"5","playlist":1,"searchedAt":1,"map":${bad}}`);
      expect(takeClaim(storage), bad).toEqual({ token: 5n, playlist: 1, searchedAt: 1 });
    }
  });

  it("keeps a ranked team match's seat for its account, re-saved at each join, offered within 900 s of the latest; a 1v1 join clears it (RJ1)", () => {
    const storage = memory();
    const seat = { matchId: 0x8000000000000007n, teamSize: 2, joinedAt: 1_000_000, account: "0f0e0d0c-0b0a-4908-8706-050403020100" };
    storeRankedSeat(seat, storage);
    expect(rankedSeat(1_000_000 + 899_000, storage)).toEqual(seat);
    expect(rankedSeat(1_000_000 + REJOIN_SECONDS * 1000, storage)).toBeNull();
    // (a rejoin's join saves it anew: the window from it)
    storeRankedSeat({ ...seat, joinedAt: 1_800_000 }, storage);
    expect(rankedSeat(1_800_000 + 899_000, storage)?.joinedAt).toBe(1_800_000);
    // (a development page's: no account)
    storeRankedSeat({ ...seat, account: null }, storage);
    expect(rankedSeat(1_000_000, storage)?.account).toBeNull();
    // (a 1v1 joined: no rejoin there, the record cleared; cleared outright too)
    storeRankedSeat({ ...seat, teamSize: 1 }, storage);
    expect(rankedSeat(1_000_000, storage)).toBeNull();
    storeRankedSeat(seat, storage);
    clearRankedSeat(storage);
    expect(rankedSeat(1_000_000, storage)).toBeNull();
    // (a rejoin's claim: its match, its team size, the account)
    storeClaim({ token: seat.matchId, playlist: 2, searchedAt: 5, rejoin: true, account: seat.account }, storage);
    expect(takeClaim(storage)).toEqual({ token: seat.matchId, playlist: 2, searchedAt: 5, rejoin: true, account: seat.account });
  });

  it("hands the menu page its notice once, unknown fields dropped", () => {
    const storage = memory();
    storeNotice({ search: [1, 3], warning: "again" }, storage);
    expect(takeNotice(storage)).toEqual({ search: [1, 3], warning: "again" });
    expect(takeNotice(storage)).toBeNull();
    storage.setItem("carball.menuNotice", '{"modal":"idle","search":"2","other":1}');
    expect(takeNotice(storage)).toEqual({ modal: "idle" });
    storage.setItem("carball.menuNotice", '{"modal":"boom"}');
    expect(takeNotice(storage)).toEqual({});
    // A search back from a cancelled match: its first search's time (RV-367), a bad one dropped; playlists from before
    // (one number) or not team sizes, none
    storeNotice({ search: [2], warning: "w", back: { searchedAt: 42 } }, storage);
    expect(takeNotice(storage)).toEqual({ search: [2], warning: "w", back: { searchedAt: 42 } });
    storage.setItem("carball.menuNotice", '{"search":[1],"back":{"searchedAt":"1"}}');
    expect(takeNotice(storage)).toEqual({ search: [1] });
    storage.setItem("carball.menuNotice", '{"search":1}');
    expect(takeNotice(storage)).toEqual({});
    storage.setItem("carball.menuNotice", '{"search":[1,1,4]}');
    expect(takeNotice(storage)).toEqual({});
    // (a rejoin refused for a ban from another match: the ban's end with it, none without, RX31)
    storeNotice({ modal: "banned", until: 1234 }, storage);
    expect(takeNotice(storage)).toEqual({ modal: "banned", until: 1234 });
    storage.setItem("carball.menuNotice", '{"modal":"banned"}');
    expect(takeNotice(storage)).toEqual({});
    // (each modal kept as stored: another tab's, a match over, the sign-in gone, RX31)
    for (const modal of ["elsewhere", "concluded", "signedOut", "lost", "idle"] as const) {
      storeNotice({ modal }, storage);
      expect(takeNotice(storage)).toEqual({ modal });
    }
  });

  it("says why a claim failed: the match gone, another tab, a match over, a ban, the sign-in gone, else the connection (RX31)", () => {
    const claim = { token: 7n, playlist: 2, searchedAt: 40 };
    const rejoin = { ...claim, rejoin: true as const };
    const refused = (reason: number): RefusedError => new RefusedError(reason);
    // (a claim refused as gone: a match cancelled for someone else, its search again (its place the matchmaker's); a
    // rejoin's: lost)
    expect(claimNotice(refused(REFUSED_TOKEN), claim, "gone")).toEqual({ search: [2], warning: "gone", back: { searchedAt: 40 } });
    expect(claimNotice(refused(REFUSED_TOKEN), rejoin, "gone")).toEqual({ modal: "lost" });
    // (a rejoin's seat live in another tab: said so; a claim's Refused 5 is no such thing)
    expect(claimNotice(refused(REFUSED_IN_MATCH), rejoin, "gone")).toEqual({ modal: "elsewhere" });
    // (a rejoin's ticket the matchmaker refused: said as such, RV-882)
    expect(claimNotice(new RejoinGoneError(), rejoin, "gone")).toEqual({ modal: "rejoinGone" });
    // (the game server's word for the matchmaker at the rejoin: the account searched or played since; or the matchmaker
    // not asked, offered again; a claim's are no such thing, RV-1008)
    expect(claimNotice(refused(REFUSED_REJOIN_GONE), rejoin, "gone")).toEqual({ modal: "rejoinGone" });
    expect(claimNotice(refused(REFUSED_UNCONFIRMED), rejoin, "gone")).toEqual({ modal: "rejoinUnconfirmed" });
    expect(claimNotice(refused(REFUSED_REJOIN_GONE), claim, "gone")).toEqual({ modal: "lost" });
    expect(claimNotice(refused(REFUSED_UNCONFIRMED), claim, "gone")).toEqual({ modal: "lost" });
    // (refused on version, a claim or a rejoin: reload, as a search is told, RV-865)
    expect(claimNotice(refused(REFUSED_VERSION), claim, "gone")).toEqual({ modal: "reload" });
    expect(claimNotice(refused(REFUSED_VERSION), rejoin, "gone")).toEqual({ modal: "reload" });
    expect(claimNotice(refused(REFUSED_IN_MATCH), claim, "gone")).toEqual({ modal: "lost" });
    expect(claimNotice(refused(REFUSED_CONCLUDED), rejoin, "gone")).toEqual({ modal: "concluded" });
    // (a rejoin's ticket refused for another match's ban: the ban)
    expect(claimNotice(new QueueBannedError(99_000), rejoin, "gone")).toEqual({ modal: "banned", until: 99_000 });
    expect(claimNotice(new QueueBannedError(99_000), claim, "gone")).toEqual({ modal: "lost" });
    expect(claimNotice(new SignedOutError(), rejoin, "gone")).toEqual({ modal: "signedOut" });
    for (const other of [refused(REFUSED_TICKET), refused(REFUSED_MODE), refused(REFUSED_QUEUE_BANNED), new Error("unreachable")]) {
      expect(claimNotice(other, rejoin, "gone")).toEqual({ modal: "lost" });
    }
  });

  it("opens a claim's session once more after its ticket is refused, not after any other refusal (RX30C)", async () => {
    const once = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new RefusedError(REFUSED_TICKET)).mockResolvedValue("in");
    expect(await openClaim(once)).toBe("in");
    expect(once).toHaveBeenCalledTimes(2);
    const twice = vi.fn<() => Promise<string>>().mockRejectedValue(new RefusedError(REFUSED_TICKET));
    await expect(openClaim(twice)).rejects.toBeInstanceOf(RefusedError);
    expect(twice).toHaveBeenCalledTimes(2);
    const gone = vi.fn<() => Promise<string>>().mockRejectedValue(new RefusedError(REFUSED_TOKEN));
    await expect(openClaim(gone)).rejects.toBeInstanceOf(RefusedError);
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it("tries a claim's config.json and its ticket again inside its window, not a sign-in gone or a ban (RX31)", async () => {
    const pauses: number[] = [];
    const pause = (ms: number): Promise<void> => {
      pauses.push(ms);
      return Promise.resolve();
    };
    const deployedConfig: GameServerConfig = {
      kind: "deployed",
      url: "https://game.example:4433/play",
      servers: [{ id: "default", name: "", url: "https://game.example:4433/play" }],
    };
    // (config.json unreadable twice, then read: the claim goes on)
    const flaky = vi.fn<() => Promise<GameServerConfig>>();
    flaky.mockResolvedValueOnce({ kind: "unreachable" }).mockResolvedValueOnce({ kind: "unreachable" }).mockResolvedValue(deployedConfig);
    const address = await claimAddress(flaky, pause);
    expect(address.url).toBe("https://game.example:4433/play");
    expect(flaky).toHaveBeenCalledTimes(3);
    expect(pauses).toEqual([CLAIM_RETRY_MS, CLAIM_RETRY_MS]);
    // (unreadable every time: CLAIM_TRIES tries, then the failure)
    const down = vi.fn(() => Promise.resolve<GameServerConfig>({ kind: "unreachable" }));
    await expect(claimAddress(down, pause)).rejects.toThrow(SERVERS_UNREACHABLE);
    expect(down).toHaveBeenCalledTimes(CLAIM_TRIES);
    // (the ticket: the service down once, then given)
    const post = vi.fn<typeof fetch>();
    post
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }))
      .mockResolvedValue(new Response(JSON.stringify({ ticket: "VGlj.a2V0.c2ln" })));
    vi.stubGlobal("fetch", post);
    expect(await address.ticket?.(5n)).toBe("VGlj.a2V0.c2ln");
    expect(post).toHaveBeenCalledTimes(2);
    // (a ban is an answer: asked once)
    post.mockReset();
    post.mockResolvedValue(new Response(JSON.stringify({ error: "queue-banned", seconds: 60 }), { status: 403 }));
    await expect(address.ticket?.(5n)).rejects.toBeInstanceOf(QueueBannedError);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("keeps the page's other parameters across the pages, without a development server's or the match page's", () => {
    expect(pageUrl("match", { pathname: "/", search: "" })).toBe("/?match");
    expect(pageUrl("match", { pathname: "/", search: "?render=off" })).toBe("/?render=off&match");
    expect(pageUrl("menu", { pathname: "/", search: "?render=off&match" })).toBe("/?render=off");
    expect(pageUrl("menu", { pathname: "/x/", search: "?match&server=a:1" })).toBe("/x/");
    // (the offline match against bots: its own page, ?bots)
    expect(pageUrl("bots", { pathname: "/", search: "?render=off" })).toBe("/?render=off&bots");
    expect(pageUrl("menu", { pathname: "/", search: "?bots" })).toBe("/");
  });

  it("a match played in another tab is one whose lock is held (Web Locks); none where they aren't (RX30C)", async () => {
    const request = vi.fn(() => Promise.resolve());
    const locks = {
      query: () => Promise.resolve({ held: [{ name: matchLock(5n), mode: "exclusive" as const, clientId: "a" }], pending: [] }),
      request,
    } as unknown as LockManager;
    expect(await matchPlayedElsewhere(5n, locks)).toBe(true);
    expect(await matchPlayedElsewhere(6n, locks)).toBe(false);
    expect(await matchPlayedElsewhere(5n, undefined)).toBe(false);
    holdMatchLock(7n, locks);
    expect(request).toHaveBeenCalledWith("carball.match.7", expect.any(Function));
  });

  it("forgets the seat a search gave up at the server: its own account's, not one another tab plays (RX31, RX32)", async () => {
    const storage = memory();
    const seat = { matchId: 5n, teamSize: 2, joinedAt: Date.now(), account: "acct-1" };
    const held = (name: string | null): LockManager => ({
      query: () => Promise.resolve({ held: name === null ? [] : [{ name, mode: "exclusive" as const, clientId: "a" }], pending: [] }),
      request: () => Promise.resolve(),
    });
    storeRankedSeat(seat, storage);
    // (another account's search in this browser: kept)
    await searchGaveUpSeat("acct-2", storage, held(null));
    expect(rankedSeat(Date.now(), storage)?.matchId).toBe(5n);
    // (another tab plays that match: the server refuses the search, the seat live: kept)
    await searchGaveUpSeat("acct-1", storage, held(matchLock(5n)));
    expect(rankedSeat(Date.now(), storage)?.matchId).toBe(5n);
    // (its own account's, no tab playing it: forgotten)
    await searchGaveUpSeat("acct-1", storage, held(matchLock(6n)));
    expect(rankedSeat(Date.now(), storage)).toBeNull();
    // (a development page's seat has no account: a development search forgets it)
    storeRankedSeat({ ...seat, account: null }, storage);
    await searchGaveUpSeat(null, storage, undefined);
    expect(rankedSeat(Date.now(), storage)).toBeNull();
  });

  it("gives the seat up once the matchmaker accepts the search (RV-846)", async () => {
    const storage = memory();
    const seat = { matchId: 5n, teamSize: 2, joinedAt: Date.now() - 60_000, account: "acct-1" };
    storeRankedSeat(seat, storage);
    seatSearch("acct-1", storage, undefined).sent();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rankedSeat(Date.now(), storage)).toBeNull();
  });

  it("reads the regions' servers from config.json: good entries in order, else the lone gameServer (notes/matchmaking.md, Regions)", () => {
    const eu = { id: "eu", name: "Europe", url: "https://game-eu.example:4433/play" };
    const us = { id: "us-east", name: "US-East", url: "https://game.example:4433/play" };
    expect(configServers({ gameServer: us.url, gameServers: [us, eu] })).toEqual([us, eu]);
    // (a bad entry dropped: an id twice, a bad id, a long or non-ASCII name, an http URL, not an object)
    expect(
      configServers({
        gameServers: [
          us,
          { ...eu, id: "us-east" },
          { ...eu, id: "EU" },
          { ...eu, name: "x".repeat(41) },
          { ...eu, name: "Eur\u00f6pe" },
          { ...eu, url: "http://game-eu.example/play" },
          "eu",
          null,
          eu,
        ],
      }),
    ).toEqual([us, eu]);
    // (no good entry, or a deployment from before the list: its gameServer alone, a lone server with no name)
    expect(configServers({ gameServer: us.url, gameServers: [{ id: "x" }] })).toEqual([{ id: "default", name: "", url: us.url }]);
    expect(configServers({ gameServer: us.url })).toEqual([{ id: "default", name: "", url: us.url }]);
    expect(configServers({ gameServer: "ftp://x" })).toEqual([]);
  });

  it("this page apart from its deployment only when the deployment's version (its build's, never cached) differs (RV-1030, RV-1066)", async () => {
    const version =
      (body: unknown, status = 200, type = "application/json") =>
      () =>
        Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": type } }));
    expect(await pageOutdated(version({ protocol: PROTOCOL_VERSION + 1 }))).toBe(true);
    // (older too, a rollback: the reload brings the deployment's page; the same: a server refusing this page is the one
    // apart, a reload changes nothing)
    expect(await pageOutdated(version({ protocol: PROTOCOL_VERSION - 1 }))).toBe(true);
    expect(await pageOutdated(version({ protocol: PROTOCOL_VERSION }))).toBe(false);
    // (none to read: a development page's page in its place, a 404, nothing, a failed request)
    expect(await pageOutdated(() => Promise.resolve(new Response("<!doctype html>", { headers: { "content-type": "text/html" } })))).toBe(false);
    expect(await pageOutdated(version({ protocol: PROTOCOL_VERSION + 1 }, 404))).toBe(false);
    expect(await pageOutdated(version({}))).toBe(false);
    expect(await pageOutdated(() => Promise.reject(new Error("offline")))).toBe(false);
  });

  it("finds each region's address, a region by its id (else the first); a development page none", async () => {
    const eu = { id: "eu", name: "Europe", url: "https://game-eu.example:4433/play" };
    const us = { id: "us-east", name: "US-East", url: "https://game.example:4433/play" };
    const deployed = (): Promise<GameServerConfig> => Promise.resolve({ kind: "deployed", url: us.url, servers: [us, eu] });
    const regions = await queueRegions(deployed);
    expect(regions.map((r) => [r.id, r.name, r.address.url, r.address.certHash])).toEqual([
      ["us-east", "US-East", us.url, null],
      ["eu", "Europe", eu.url, null],
    ]);
    expect((await queueAddress(deployed, "eu")).url).toBe(eu.url);
    expect((await queueAddress(deployed, "gone")).url).toBe(us.url);
    expect((await queueAddress(deployed)).url).toBe(us.url);
    expect((await claimAddress(deployed, () => Promise.resolve(), "eu")).url).toBe(eu.url);
    // (a claim's ticket its match ticket, not one fetched: RV-887's P01)
    const claiming = await claimAddress(deployed, () => Promise.resolve(), "eu", "bWF0Y2g");
    expect(await claiming.ticket?.(5n)).toBe("bWF0Y2g");
    // (its server's URL handed over by the menu: opened with it at once, config.json not read again: the flow audit's 1)
    const unread = (): Promise<GameServerConfig> => Promise.reject(new Error("config.json read"));
    const direct = await claimAddress(unread, () => Promise.resolve(), "eu", "bWF0Y2g", eu.url);
    expect([direct.url, direct.certHash, await direct.ticket?.(5n)]).toEqual([eu.url, null, "bWF0Y2g"]);
    // (each region's server as the matchmaker names it, 443 when its URL has no port: P02)
    expect(regions.map((r) => r.server)).toEqual(["game.example:4433", "game-eu.example:4433"]);
    expect(serverOfUrl("https://Game.Example/play")).toBe("game.example:443");
    expect(serverOfUrl("not a url")).toBe("");
    // (a development page: no regions, no queue: the deployment's services alone)
    expect(await queueRegions(() => Promise.resolve<GameServerConfig>({ kind: "development" }))).toEqual([]);
  });

  it("keeps the match's region and match ticket with a claim, and the region with a saved seat; a bad one dropped", () => {
    const storage = memory();
    storeClaim({ token: 5n, playlist: 2, searchedAt: 1, server: "eu" }, storage);
    expect(takeClaim(storage)?.server).toBe("eu");
    storeClaim({ token: 5n, playlist: 2, searchedAt: 1 }, storage);
    expect(takeClaim(storage)?.server).toBeUndefined();
    storage.setItem("carball.claim", JSON.stringify({ token: "5", playlist: 2, searchedAt: 1, server: "eu <script>" }));
    expect(takeClaim(storage)?.server).toBeUndefined();
    storeClaim({ token: 5n, playlist: 2, searchedAt: 1, ticket: "dGlj.-_0.c2ln", playlists: [2, 3] }, storage);
    expect(takeClaim(storage)).toMatchObject({ ticket: "dGlj.-_0.c2ln", playlists: [2, 3] });
    // (a match ticket is a JWT: its dots kept, 1024 characters at most, the claim then made with it, not a fetched one)
    storeClaim({ token: 5n, playlist: 2, searchedAt: 1, ticket: "eyJh.eyJz.c2ln" }, storage);
    expect(takeClaim(storage)?.ticket).toBe("eyJh.eyJz.c2ln");
    storeClaim({ token: 5n, playlist: 2, searchedAt: 1, ticket: "A".repeat(1025) }, storage);
    expect(takeClaim(storage)?.ticket).toBeUndefined();
    // (its server's URL kept, an https one alone)
    storeClaim({ token: 5n, playlist: 2, searchedAt: 1, url: "https://game-eu.example:4433/play" }, storage);
    expect(takeClaim(storage)?.url).toBe("https://game-eu.example:4433/play");
    storeClaim({ token: 5n, playlist: 2, searchedAt: 1, url: "javascript:alert(1)" }, storage);
    expect(takeClaim(storage)?.url).toBeUndefined();
    // (a rejoin's saved seat's join kept with it, a number alone: the seat kept again if the matchmaker can't be asked)
    storeClaim({ token: 5n, playlist: 2, searchedAt: 1, rejoin: true, seatJoinedAt: 1234 }, storage);
    expect(takeClaim(storage)?.seatJoinedAt).toBe(1234);
    storage.setItem("carball.claim", JSON.stringify({ token: "5", playlist: 2, searchedAt: 1, seatJoinedAt: "soon" }));
    expect(takeClaim(storage)?.seatJoinedAt).toBeUndefined();
    storage.setItem("carball.claim", JSON.stringify({ token: "5", playlist: 2, searchedAt: 1, ticket: "not a ticket!", playlists: [9] }));
    expect(takeClaim(storage)).toEqual({ token: 5n, playlist: 2, searchedAt: 1 });
    // (a claim refused as gone: its playlists searched again, its clock kept; the matchmaker keeps its place)
    const notice = claimNotice(new RefusedError(REFUSED_TOKEN), { token: 9n, playlist: 1, searchedAt: 3, server: "asia", playlists: [1, 2] }, "gone");
    expect(notice).toEqual({ search: [1, 2], warning: "gone", back: { searchedAt: 3 } });
    storeRankedSeat({ matchId: 7n, teamSize: 2, joinedAt: Date.now(), account: null, server: "eu" }, storage);
    expect(rankedSeat(Date.now(), storage)?.server).toBe("eu");
  });

  it("forgets the saved seat at its match's end, not another match's (RX33)", () => {
    const storage = memory();
    storeRankedSeat({ matchId: 5n, teamSize: 2, joinedAt: Date.now(), account: null }, storage);
    clearRankedSeatOf(6n, storage);
    expect(rankedSeat(Date.now(), storage)?.matchId).toBe(5n);
    clearRankedSeatOf(5n, storage);
    expect(rankedSeat(Date.now(), storage)).toBeNull();
  });

  it("leaving a match forgets its own saved seat, never another match's; kicked for idling or the connection lost, kept (RV-770, RV-800)", () => {
    const storage = memory();
    const seat = { matchId: 5n, teamSize: 2, joinedAt: Date.now(), account: null };
    storeRankedSeat(seat, storage);
    // (Exit, Play Again, the match over: another match's record kept)
    leaveMatchSeat(6n, undefined, storage);
    expect(rankedSeat(Date.now(), storage)?.matchId).toBe(5n);
    // (kicked for idling, the connection lost: this match's kept, its rejoin offered)
    leaveMatchSeat(5n, "idle", storage);
    leaveMatchSeat(5n, "lost", storage);
    expect(rankedSeat(Date.now(), storage)?.matchId).toBe(5n);
    // (left on purpose, or with another notice: this match's forgotten)
    leaveMatchSeat(5n, "concluded", storage);
    expect(rankedSeat(Date.now(), storage)).toBeNull();
    storeRankedSeat(seat, storage);
    leaveMatchSeat(5n, undefined, storage);
    expect(rankedSeat(Date.now(), storage)).toBeNull();
  });

  it("finds the deployment's game server in config.json; none, a development server's; one that can't be read fails closed", async () => {
    const json =
      (body: unknown, status = 200) =>
      () =>
        Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    const unreachable = { kind: "unreachable" } as const;
    expect(await deployedGameServer(json({ gameServer: "https://game.carball.zolt.top:4433/play" }))).toEqual({
      kind: "deployed",
      url: "https://game.carball.zolt.top:4433/play",
      servers: [{ id: "default", name: "", url: "https://game.carball.zolt.top:4433/play" }],
    });
    // (no config on a local page: a development page, 404 or a development server's own page in its place; on any other,
    // a deployment's config missing (404, or its site's page): closed)
    const page = (): Promise<Response> => Promise.resolve(new Response("<!doctype html>", { headers: { "content-type": "text/html" } }));
    expect(await deployedGameServer(json({ gameServer: "https://x/play" }, 404), true)).toEqual({ kind: "development" });
    expect(await deployedGameServer(page, true)).toEqual({ kind: "development" });
    expect(await deployedGameServer(json({ gameServer: "https://x/play" }, 404), false)).toEqual(unreachable);
    expect(await deployedGameServer(page, false)).toEqual(unreachable);
    expect(await deployedGameServer(json({ gameServer: "https://game.carball.zolt.top:4433/play" }), false)).toEqual({
      kind: "deployed",
      url: "https://game.carball.zolt.top:4433/play",
      servers: [{ id: "default", name: "", url: "https://game.carball.zolt.top:4433/play" }],
    });
    expect([localPage(false, "localhost"), localPage(false, "127.0.0.1"), localPage(false, "[::1]"), localPage(true, "carball.zolt.top")]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([localPage(false, "carball.zolt.top"), localPage(false, "192.168.1.2"), localPage(false, "127.example")]).toEqual([false, false, false]);
    // (by default the page's own host: what keeps a deployment's page closed, RX31)
    vi.stubGlobal("location", { hostname: "carball.zolt.top" });
    expect(localPage(false)).toBe(false);
    vi.stubGlobal("location", { hostname: "127.0.0.1" });
    expect(localPage(false)).toBe(true);
    vi.unstubAllGlobals();
    // (config.json not answering in time: unreachable, not a page waiting for ever, RX31)
    const hangs = (signal: AbortSignal): Promise<Response> =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          reject(signal.reason as Error);
        });
      });
    expect(await deployedGameServer(hangs, false, 10)).toEqual(unreachable);
    // (a deployment's that can't be read: closed, RX29C)
    expect(await deployedGameServer(json({ gameServer: "http://insecure:4433/play" }))).toEqual(unreachable);
    expect(await deployedGameServer(json({}))).toEqual(unreachable);
    expect(await deployedGameServer(json({ gameServer: "https://x/play" }, 503))).toEqual(unreachable);
    expect(await deployedGameServer(() => Promise.resolve(new Response("not json")))).toEqual(unreachable);
    expect(await deployedGameServer(() => Promise.reject(new Error("offline")))).toEqual(unreachable);
    await expect(queueAddress(() => Promise.resolve(unreachable))).rejects.toThrow(SERVERS_UNREACHABLE);
    // (the deployment's: by name, its real certificate)
    const deployed = (): Promise<GameServerConfig> =>
      Promise.resolve({
        kind: "deployed",
        url: "https://game.carball.zolt.top:4433/play",
        servers: [{ id: "default", name: "", url: "https://game.carball.zolt.top:4433/play" }],
      });
    const deployedAddress = await queueAddress(deployed);
    expect(deployedAddress).toEqual({
      url: "https://game.carball.zolt.top:4433/play",
      certHash: null,
      ticket: expect.any(Function) as unknown,
    });
    // (its tickets the accounts service's: a rejoin's for that match, which a ban from it doesn't stop: RV-702, RX31)
    const post = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ ticket: "UmVq.b2lu.c2ln" }))));
    vi.stubGlobal("fetch", post);
    expect(await deployedAddress.ticket?.(0xabcn)).toBe("UmVq.b2lu.c2ln");
    expect(String((post.mock.calls[0] as unknown[])[0])).toBe("/api/ticket?rejoin=0000000000000abc");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a rejoin's seat again when the matchmaker couldn't be asked, its join as it was; never for another failure (RV-1022's Q8)", () => {
    const claim = { token: 7n, playlist: 2, searchedAt: 1, rejoin: true as const, seatJoinedAt: 1234, account: "acct", server: "eu" };
    expect(seatKeptAfter({ modal: "rejoinUnconfirmed" }, claim)).toEqual({ matchId: 7n, teamSize: 2, joinedAt: 1234, account: "acct", server: "eu" });
    expect(seatKeptAfter({ modal: "rejoinGone" }, claim)).toBeNull();
    expect(seatKeptAfter({ modal: "lost" }, claim)).toBeNull();
    expect(seatKeptAfter({ modal: "rejoinUnconfirmed" }, { token: 7n, playlist: 2, searchedAt: 1, rejoin: true })).toBeNull();
  });

  it("keeps a notice's playlists (1-3 team sizes, each once) and its reload and rejoin-refused modals (RV-887's P03, K09)", () => {
    expect(playlistsOf([1, 3])).toEqual([1, 3]);
    for (const bad of [[], [1, 1], [4], [1, 2, 3, 1], "1", null]) expect(playlistsOf(bad)).toBeNull();
    const storage = memory();
    for (const modal of ["reload", "rejoinGone", "rejoinUnconfirmed"] as const) {
      storeNotice({ modal }, storage);
      expect(takeNotice(storage)).toEqual({ modal });
    }
  });

  it("a rejoin's ticket the matchmaker refuses (409) is its answer, not tried again (RV-882)", async () => {
    const post = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ error: "in-match" }), { status: 409 })));
    vi.stubGlobal("fetch", post);
    const deployedConfig: GameServerConfig = {
      kind: "deployed",
      url: "https://game.example:4433/play",
      servers: [{ id: "default", name: "", url: "https://game.example:4433/play" }],
    };
    const address = await claimAddress(
      () => Promise.resolve(deployedConfig),
      () => Promise.resolve(),
    );
    await expect(address.ticket?.(5n)).rejects.toBeInstanceOf(RejoinGoneError);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
