import { describe, expect, it } from "vitest";
import { deployedGameServer, pageUrl, queueAddress, storeClaim, storeNotice, takeClaim, takeNotice } from "./pages";

const memory = (): Pick<Storage, "getItem" | "setItem" | "removeItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

describe("the pages' handoffs", () => {
  it("hands the match page its claim once, a 64-bit token intact", () => {
    const storage = memory();
    expect(takeClaim(storage)).toBeNull();
    storeClaim({ token: 0x8000000000000001n, playlist: 2 }, storage);
    expect(takeClaim(storage)).toEqual({ token: 0x8000000000000001n, playlist: 2 });
    expect(takeClaim(storage), "taken out").toBeNull();
    storage.setItem("rl-clone.claim", '{"token":"0","playlist":1}');
    expect(takeClaim(storage), "no token").toBeNull();
    storage.setItem("rl-clone.claim", "{broken");
    expect(takeClaim(storage)).toBeNull();
    expect(takeClaim(null)).toBeNull();
  });

  it("hands the menu page its notice once, unknown fields dropped", () => {
    const storage = memory();
    storeNotice({ search: 3, warning: "again" }, storage);
    expect(takeNotice(storage)).toEqual({ search: 3, warning: "again" });
    expect(takeNotice(storage)).toBeNull();
    storage.setItem("rl-clone.menuNotice", '{"modal":"idle","search":"2","other":1}');
    expect(takeNotice(storage)).toEqual({ modal: "idle" });
    storage.setItem("rl-clone.menuNotice", '{"modal":"boom"}');
    expect(takeNotice(storage)).toEqual({});
  });

  it("keeps the page's other parameters across the pages, without a development server's or the match page's", () => {
    expect(pageUrl("match", { pathname: "/", search: "" })).toBe("/?match");
    expect(pageUrl("match", { pathname: "/", search: "?queue=127.0.0.1:14440&render=off" })).toBe("/?queue=127.0.0.1%3A14440&render=off&match");
    expect(pageUrl("menu", { pathname: "/", search: "?queue=q&match" })).toBe("/?queue=q");
    expect(pageUrl("menu", { pathname: "/x/", search: "?match&server=a:1" })).toBe("/x/");
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
  });
});
