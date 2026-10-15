import { describe, expect, it } from "vitest";
import { pageUrl, storeClaim, storeNotice, takeClaim, takeNotice } from "./pages";

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
});
