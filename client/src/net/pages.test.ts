import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueBannedError } from "./tickets";
import {
  type GameServerConfig,
  CLAIM_RETRY_MS,
  CLAIM_TRIES,
  SERVERS_UNREACHABLE,
  claimAddress,
  deployedGameServer,
  holdMatchLock,
  localPage,
  matchLock,
  matchPlayedElsewhere,
  pageUrl,
  queueAddress,
  REJOIN_SECONDS,
  clearRankedSeat,
  rankedSeat,
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
    storeNotice({ search: 3, warning: "again" }, storage);
    expect(takeNotice(storage)).toEqual({ search: 3, warning: "again" });
    expect(takeNotice(storage)).toBeNull();
    storage.setItem("carball.menuNotice", '{"modal":"idle","search":"2","other":1}');
    expect(takeNotice(storage)).toEqual({ modal: "idle" });
    storage.setItem("carball.menuNotice", '{"modal":"boom"}');
    expect(takeNotice(storage)).toEqual({});
    // A search back from a cancelled match: its token and its first search's time (RV-367), a bad one dropped
    storeNotice({ search: 1, warning: "w", back: { token: 0xffffffffffffffffn, searchedAt: 42 } }, storage);
    expect(takeNotice(storage)).toEqual({ search: 1, warning: "w", back: { token: 0xffffffffffffffffn, searchedAt: 42 } });
    storage.setItem("carball.menuNotice", '{"search":1,"back":{"token":"0","searchedAt":1}}');
    expect(takeNotice(storage)).toEqual({ search: 1 });
    // (a rejoin refused for a ban from another match: the ban's end with it, none without, RX31)
    storeNotice({ modal: "banned", until: 1234 }, storage);
    expect(takeNotice(storage)).toEqual({ modal: "banned", until: 1234 });
    storage.setItem("carball.menuNotice", '{"modal":"banned"}');
    expect(takeNotice(storage)).toEqual({});
  });

  it("tries a claim's config.json and its ticket again inside its window, not a sign-in gone or a ban (RX31)", async () => {
    const pauses: number[] = [];
    const pause = (ms: number): Promise<void> => {
      pauses.push(ms);
      return Promise.resolve();
    };
    const deployedConfig: GameServerConfig = { kind: "deployed", url: "https://game.example:4433/play" };
    // (config.json unreadable twice, then read: the claim goes on)
    const flaky = vi.fn<() => Promise<GameServerConfig>>();
    flaky.mockResolvedValueOnce({ kind: "unreachable" }).mockResolvedValueOnce({ kind: "unreachable" }).mockResolvedValue(deployedConfig);
    const address = await claimAddress(new URLSearchParams(""), "carball.zolt.top", flaky, pause);
    expect(address.url).toBe("https://game.example:4433/play");
    expect(flaky).toHaveBeenCalledTimes(3);
    expect(pauses).toEqual([CLAIM_RETRY_MS, CLAIM_RETRY_MS]);
    // (unreadable every time: CLAIM_TRIES tries, then the failure)
    const down = vi.fn(() => Promise.resolve<GameServerConfig>({ kind: "unreachable" }));
    await expect(claimAddress(new URLSearchParams(""), "carball.zolt.top", down, pause)).rejects.toThrow(SERVERS_UNREACHABLE);
    expect(down).toHaveBeenCalledTimes(CLAIM_TRIES);
    // (the ticket: the service down once, then given)
    const post = vi.fn<typeof fetch>();
    post
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }))
      .mockResolvedValue(new Response(JSON.stringify({ ticket: "VGlja2V0" })));
    vi.stubGlobal("fetch", post);
    expect(await address.ticket?.()).toBe("VGlja2V0");
    expect(post).toHaveBeenCalledTimes(2);
    // (a ban is an answer: asked once)
    post.mockReset();
    post.mockResolvedValue(new Response(JSON.stringify({ error: "queue-banned", until: new Date(Date.now() + 60_000).toISOString() }), { status: 403 }));
    await expect(address.ticket?.(5n)).rejects.toBeInstanceOf(QueueBannedError);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("keeps the page's other parameters across the pages, without a development server's or the match page's", () => {
    expect(pageUrl("match", { pathname: "/", search: "" })).toBe("/?match");
    expect(pageUrl("match", { pathname: "/", search: "?queue=127.0.0.1:14440&render=off" })).toBe("/?queue=127.0.0.1%3A14440&render=off&match");
    expect(pageUrl("menu", { pathname: "/", search: "?queue=q&match" })).toBe("/?queue=q");
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

  it("finds the deployment's game server in config.json; none, a development server's; one that can't be read fails closed", async () => {
    const json =
      (body: unknown, status = 200) =>
      () =>
        Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    const unreachable = { kind: "unreachable" } as const;
    expect(await deployedGameServer(json({ gameServer: "https://game.carball.zolt.top:4433/play" }))).toEqual({
      kind: "deployed",
      url: "https://game.carball.zolt.top:4433/play",
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
    });
    expect([localPage(false, "localhost"), localPage(false, "127.0.0.1"), localPage(false, "[::1]"), localPage(true, "carball.zolt.top")]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([localPage(false, "carball.zolt.top"), localPage(false, "192.168.1.2"), localPage(false, "127.example")]).toEqual([false, false, false]);
    // (a deployment's that can't be read: closed, RX29C)
    expect(await deployedGameServer(json({ gameServer: "http://insecure:4433/play" }))).toEqual(unreachable);
    expect(await deployedGameServer(json({}))).toEqual(unreachable);
    expect(await deployedGameServer(json({ gameServer: "https://x/play" }, 503))).toEqual(unreachable);
    expect(await deployedGameServer(() => Promise.resolve(new Response("not json")))).toEqual(unreachable);
    expect(await deployedGameServer(() => Promise.reject(new Error("offline")))).toEqual(unreachable);
    await expect(queueAddress(new URLSearchParams(""), "carball.zolt.top", () => Promise.resolve(unreachable))).rejects.toThrow(SERVERS_UNREACHABLE);
    // (the deployment's: by name, its real certificate; a development page's ?queue wins over it)
    const deployed = (): Promise<GameServerConfig> => Promise.resolve({ kind: "deployed", url: "https://game.carball.zolt.top:4433/play" });
    expect(await queueAddress(new URLSearchParams(""), "carball.zolt.top", deployed)).toEqual({
      url: "https://game.carball.zolt.top:4433/play",
      certHash: null,
      ticket: expect.any(Function) as unknown,
    });
    // ?queue= wins: the development server's info, its certificate by hash, config.json not even read (RX13's C7)
    const info = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ port: 14439, certHash: "ab".repeat(32) }))));
    vi.stubGlobal("fetch", info);
    const notRead = vi.fn(deployed);
    const address = await queueAddress(new URLSearchParams("queue=127.0.0.1:14440"), "carball.zolt.top", notRead);
    expect(address.url).toBe("https://127.0.0.1:14439/play");
    expect(address.certHash?.length).toBe(32);
    expect(info).toHaveBeenCalledWith("http://127.0.0.1:14440/info", { cache: "no-store" });
    expect(notRead).not.toHaveBeenCalled();
    // (its tickets the development server's own: from its info server, for this browser's key and the settings' name)
    info.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ticket: "AbC-_9" }))));
    expect(await address.ticket?.()).toBe("AbC-_9");
    expect(info).toHaveBeenLastCalledWith(expect.stringMatching(/^http:\/\/127\.0\.0\.1:14440\/dev-ticket\?name=[^&]*&id=[0-9a-f]{32}$/), {
      cache: "no-store",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
