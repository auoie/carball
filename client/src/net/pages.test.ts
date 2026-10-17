import { afterEach, describe, expect, it, vi } from "vitest";
import { deployedGameServer, freePlayUrl, pageUrl, queueAddress, storeClaim, storeNotice, takeClaim, takeNotice } from "./pages";

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
    // Free play at once: the map select picked another map, the page loaded it
    storeNotice({ freePlay: true }, storage);
    expect(takeNotice(storage)).toEqual({ freePlay: true });
    storage.setItem("carball.menuNotice", '{"freePlay":"yes"}');
    expect(takeNotice(storage)).toEqual({});
  });

  it("keeps the page's other parameters across the pages, without a development server's or the match page's", () => {
    expect(pageUrl("match", { pathname: "/", search: "" })).toBe("/?match");
    expect(pageUrl("match", { pathname: "/", search: "?queue=127.0.0.1:14440&render=off" })).toBe("/?queue=127.0.0.1%3A14440&render=off&match");
    expect(pageUrl("menu", { pathname: "/", search: "?queue=q&match" })).toBe("/?queue=q");
    expect(pageUrl("menu", { pathname: "/x/", search: "?match&server=a:1" })).toBe("/x/");
    // (the offline match against bots: its own page, ?bots)
    expect(pageUrl("bots", { pathname: "/", search: "?render=off" })).toBe("/?render=off&bots");
    expect(pageUrl("menu", { pathname: "/", search: "?bots" })).toBe("/");
    // (the map select's pick: without a development ?theme, which would load its own map instead)
    expect(freePlayUrl({ pathname: "/", search: "?theme=meadow&render=off" })).toBe("/?render=off");
    expect(freePlayUrl({ pathname: "/x/", search: "?theme=lake" })).toBe("/x/");
  });

  it("finds the deployment's game server in config.json, else a development server's", async () => {
    const json = (body: unknown, ok = true) => () => Promise.resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 404 }));
    expect(await deployedGameServer(json({ gameServer: "https://game.carball.zolt.top:4433/play" }))).toBe("https://game.carball.zolt.top:4433/play");
    expect(await deployedGameServer(json({ gameServer: "http://insecure:4433/play" }))).toBeNull();
    expect(await deployedGameServer(json({}))).toBeNull();
    expect(await deployedGameServer(json({ gameServer: "https://x/play" }, false))).toBeNull();
    expect(await deployedGameServer(() => Promise.resolve(new Response("not json")))).toBeNull();
    expect(await deployedGameServer(() => Promise.reject(new Error("offline")))).toBeNull();
    // (the deployment's: by name, its real certificate; a development page's ?queue wins over it)
    const deployed = (): Promise<string | null> => Promise.resolve("https://game.carball.zolt.top:4433/play");
    expect(await queueAddress(new URLSearchParams(""), "carball.zolt.top", deployed)).toEqual({ url: "https://game.carball.zolt.top:4433/play", certHash: null });
    // ?queue= wins: the development server's info, its certificate by hash, config.json not even read (RX13's C7)
    const info = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ port: 14439, certHash: "ab".repeat(32) }))));
    vi.stubGlobal("fetch", info);
    const notRead = vi.fn(deployed);
    const address = await queueAddress(new URLSearchParams("queue=127.0.0.1:14440"), "carball.zolt.top", notRead);
    expect(address.url).toBe("https://127.0.0.1:14439/play");
    expect(address.certHash?.length).toBe(32);
    expect(info).toHaveBeenCalledWith("http://127.0.0.1:14440/info", { cache: "no-store" });
    expect(notRead).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
