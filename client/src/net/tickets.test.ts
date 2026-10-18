import { describe, expect, it, vi } from "vitest";
import { SignedOutError, accountTicket, devTicket } from "./tickets";

const answer = (body: unknown, status = 200) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe("search tickets", () => {
  it("asks the accounts service with its write's header, signed out on 401", async () => {
    const post = answer({ ticket: "AQIDBAUG-_" });
    expect(await accountTicket(post)).toBe("AQIDBAUG-_");
    expect(post).toHaveBeenCalledWith("/api/ticket", { method: "POST", headers: { "X-Carball": "1" }, credentials: "same-origin", cache: "no-store" });
    await expect(accountTicket(answer({ error: "signed out" }, 401))).rejects.toBeInstanceOf(SignedOutError);
    await expect(accountTicket(answer({ error: "busy" }, 503))).rejects.toThrow(/503/);
    // (a ticket is base64url, 256 characters at most: anything else isn't sent on)
    await expect(accountTicket(answer({ ticket: "has space" }))).rejects.toThrow(/malformed/);
    await expect(accountTicket(answer({ ticket: "A".repeat(257) }))).rejects.toThrow(/malformed/);
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
    await expect(devTicket("127.0.0.1", 4434, answer({}, 404))()).rejects.toThrow(/404/);
  });
});
