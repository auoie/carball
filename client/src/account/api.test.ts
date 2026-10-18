import { describe, expect, it, vi } from "vitest";
import { AccountError, AccountsApi, signInReturn, signInUrl, withoutSignInReturn } from "./api";

const reply = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
const api = (...responses: Response[]) => {
  const call = vi.fn<typeof fetch>();
  for (const r of responses) call.mockResolvedValueOnce(r);
  return { call, api: new AccountsApi(call) };
};
const ACCOUNT = {
  id: "0f0e0d0c-0b0a-4908-8706-050403020100",
  name: "Ziggy",
  providers: ["steam", "unknown"],
  createdAt: "2026-01-02T03:04:05Z",
  ratings: [
    { playlist: 1, rating: 1523, deviation: 80, provisional: false, games: 12 },
    { playlist: 2, rating: 1500, deviation: 500, provisional: true, games: 0 },
  ],
  queueBanUntil: "2026-10-18T12:05:00Z",
};

describe("the accounts service's calls", () => {
  it("reads the signed-in account, null signed out; writes carry the API's header, JSON with a body", async () => {
    const { call, api: a } = api(reply(200, ACCOUNT), reply(401, { error: "signed-out" }), reply(200, ACCOUNT), reply(204));
    expect(await a.me()).toEqual({
      id: ACCOUNT.id,
      name: "Ziggy",
      providers: ["steam"],
      ratings: [
        { playlist: 1, rating: 1523, provisional: false, games: 12 },
        { playlist: 2, rating: 1500, provisional: true, games: 0 },
      ],
      queueBanUntil: Date.parse("2026-10-18T12:05:00Z"),
    });
    expect(await a.me()).toBeNull();
    expect(call).toHaveBeenNthCalledWith(1, "/api/me", { method: "GET", headers: {}, credentials: "same-origin", cache: "no-store" });
    await a.rename("Stardust");
    expect(call).toHaveBeenNthCalledWith(3, "/api/me/name", {
      method: "PUT",
      headers: { "X-Carball": "1", "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ name: "Stardust" }),
    });
    await a.signOut();
    expect(call).toHaveBeenNthCalledWith(4, "/api/signout", { method: "POST", headers: { "X-Carball": "1" }, credentials: "same-origin", cache: "no-store" });
  });

  it("asks deletion in so many words, and makes the account with the name and the Turnstile token", async () => {
    const { call, api: a } = api(reply(204), reply(201, ACCOUNT));
    const body = (i: number): unknown => call.mock.calls[i]?.[1]?.body;
    await a.deleteAccount();
    expect(body(0)).toBe(JSON.stringify({ confirm: true }));
    expect((await a.createAccount("Ziggy", "tok")).name).toBe("Ziggy");
    expect(call.mock.calls[1]?.[0]).toBe("/api/signup");
    expect(body(1)).toBe(JSON.stringify({ name: "Ziggy", turnstile: "tok" }));
  });

  it("reads a waiting sign-up, null for none", async () => {
    const { api: a } = api(
      reply(200, { provider: "google", suggestion: "Player 4821", turnstileSiteKey: "0x4AAA", nameMaxBytes: 32 }),
      reply(404, { error: "no-signup" }),
      reply(200, { provider: "twitter", suggestion: "x", turnstileSiteKey: "", nameMaxBytes: 32 }),
    );
    expect(await a.signup()).toEqual({ provider: "google", suggestion: "Player 4821", turnstileSiteKey: "0x4AAA", nameMaxBytes: 32 });
    expect(await a.signup()).toBeNull();
    await expect(a.signup()).rejects.toEqual(new AccountError("server"));
  });

  it("names the API's refusals by its codes; anything else server, a gateway's or no answer unavailable", async () => {
    const code = async (r: Response | Error): Promise<string> => {
      const call = vi.fn<typeof fetch>(() => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r)));
      try {
        await new AccountsApi(call).createAccount("Ziggy", "");
      } catch (e) {
        return (e as AccountError).code;
      }
      return "none";
    };
    expect(await code(reply(400, { error: "name-too-long" }))).toBe("name-too-long");
    expect(await code(reply(403, { error: "turnstile" }))).toBe("turnstile");
    expect(await code(reply(409, { error: "taken" }))).toBe("taken");
    expect(await code(reply(429, { error: "busy" }))).toBe("busy");
    expect(await code(reply(403, { error: "forbidden" }))).toBe("server");
    expect(await code(new Response("<html>bad gateway</html>", { status: 502 }))).toBe("unavailable");
    expect(await code(new TypeError("offline"))).toBe("unavailable");
  });
});

describe("a sign-in's return", () => {
  it("is a sign-up to finish, or a notice (an unknown reason a failure; a date only as a date)", () => {
    expect(signInUrl("steam")).toBe("/api/auth/steam/start");
    expect(signInReturn(new URLSearchParams("signup="))).toEqual({ kind: "signup" });
    expect(signInReturn(new URLSearchParams("signin=cancelled"))).toEqual({ kind: "notice", reason: "cancelled", until: null });
    expect(signInReturn(new URLSearchParams("signin=banned&until=2026-12-01"))).toEqual({ kind: "notice", reason: "banned", until: "2026-12-01" });
    expect(signInReturn(new URLSearchParams("signin=banned&until=<b>soon</b>"))).toEqual({ kind: "notice", reason: "banned", until: null });
    expect(signInReturn(new URLSearchParams("signin=whatever"))).toEqual({ kind: "notice", reason: "failed", until: null });
    expect(signInReturn(new URLSearchParams("bots"))).toBeNull();
  });

  it("leaves the address without it", () => {
    expect(withoutSignInReturn(new URL("https://carball.example/?signin=banned&until=2026-12-01"))).toBe("/");
    expect(withoutSignInReturn(new URL("https://carball.example/?bots&signup=#x"))).toBe("/?bots=#x");
  });
});
