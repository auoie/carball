import { describe, expect, it, vi } from "vitest";
import { QueueBannedError, SignedOutError, accountTicket, devTicket, queueBanText } from "./tickets";

const answer = (body: unknown, status = 200) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe("search tickets", () => {
  it("asks the accounts service with its write's header, signed out on 401", async () => {
    const post = answer({ ticket: "AQIDBAUG-_" });
    expect(await accountTicket(post)).toBe("AQIDBAUG-_");
    expect(post).toHaveBeenCalledWith("/api/ticket", { method: "POST", headers: { "X-Carball": "1" }, credentials: "same-origin", cache: "no-store" });
    await expect(accountTicket(answer({ error: "signed out" }, 401))).rejects.toBeInstanceOf(SignedOutError);
    // (its other refusals in words: the per-account limit, the service down, anything else with its code)
    await expect(accountTicket(answer({ error: "busy" }, 429))).rejects.toThrow("too many searches: wait a minute and try again");
    await expect(accountTicket(answer({ error: "unavailable" }, 503))).rejects.toThrow("accounts aren't reachable right now: try again later");
    await expect(accountTicket(answer({ error: "server" }, 500))).rejects.toThrow(/^accounts aren't reachable/);
    await expect(accountTicket(answer({ error: "nope" }, 400))).rejects.toThrow("the accounts service refused the search (HTTP 400)");
    await expect(accountTicket(answer({ error: "nope" }, 403))).rejects.toThrow(/\(HTTP 403\)$/);
    // (a leaver's queue ban: its end, the minutes left said (LV1: at least 1))
    const banned = accountTicket(answer({ error: "queue-banned", until: new Date(Date.now() + 14.5 * 60_000).toISOString() }, 403));
    await expect(banned).rejects.toBeInstanceOf(QueueBannedError);
    await expect(banned).rejects.toThrow(/search again in 15 minutes/);
    expect(queueBanText(1000, 990)).toMatch(/in 1 minute$/);
    // (a rejoin's: for its match, 16 hex digits)
    const rejoin = answer({ ticket: "UmVqb2lu" });
    expect(await accountTicket(rejoin, 0xa1n)).toBe("UmVqb2lu");
    expect(String((rejoin.mock.calls[0] as unknown[])[0])).toBe("/api/ticket?rejoin=00000000000000a1");
    // (a ticket is base64url, 320 characters at most: anything else isn't sent on)
    await expect(accountTicket(answer({ ticket: "has space" }))).rejects.toThrow(/malformed/);
    expect(await accountTicket(answer({ ticket: "A".repeat(320) }))).toHaveLength(320);
    await expect(accountTicket(answer({ ticket: "A".repeat(321) }))).rejects.toThrow(/malformed/);
    await expect(accountTicket(answer({}))).rejects.toThrow(/malformed/);
  });

  it("asks a development server's info server for one on this browser's key", async () => {
    const get = answer({ ticket: "Zm9v" });
    const source = devTicket("127.0.0.1", 4434, get);
    expect(await source()).toBe("Zm9v");
    const url = String((get.mock.calls[0] as unknown[])[0]);
    const id = /&id=([0-9a-f]{32})$/.exec(url)?.[1] ?? "";
    expect(url.startsWith("http://127.0.0.1:4434/dev-ticket?name=")).toBe(true);
    expect(id.slice(0, 16)).toBe(id.slice(16)); // (the browser's key, twice: one account per browser)
    await source();
    expect(String((get.mock.calls[1] as unknown[])[0])).toBe(url);
    await source(0xfedcba9876543210n);
    expect(String((get.mock.calls[2] as unknown[])[0])).toBe(`${url}&rejoin=fedcba9876543210`);
    await expect(devTicket("127.0.0.1", 4434, answer({}, 404))()).rejects.toThrow(/404/);
  });
});
