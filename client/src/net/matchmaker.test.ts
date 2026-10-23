// The search with the matchmaker (notes/matchmaking.md, the central matchmaker) against a stand-in service: its start,
// polls and answers, refusals, a restart's 404 searched once more, failed polls retried, Cancel Search and the page going
import { describe, expect, it, vi } from "vitest";
import { type FoundMatch, type SearchHandlers } from "../game/matchmaking";
import { MATCHMAKER_TEXT, MatchmakerSearchSession, type SearchRequest, devMatchmakerBase, foundMatch } from "./matchmaker";
import { REFUSED_IN_MATCH } from "./protocol";

interface Reply {
  readonly status: number;
  readonly body?: unknown;
  /** Answered once this settles (a slow call) */
  readonly after?: Promise<void>;
}

/** A stand-in matchmaker: each call's method, path and body kept; answered in turn from `replies` (by path's start), a
 *  slow answer rejected if the call is aborted first; a path with no replies left waits (a long poll's) till the call is
 *  aborted, one not listed fails (no answer) */
function service(replies: Record<string, Reply[]>): { http: typeof fetch; calls: { method: string; path: string; body: unknown; init?: RequestInit }[] } {
  const calls: { method: string; path: string; body: unknown; init?: RequestInit }[] = [];
  const http = ((input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, path: input, body, ...(init ? { init } : {}) });
    const key = Object.keys(replies).find((k) => `${method} ${input}`.startsWith(k));
    if (key === undefined) return Promise.reject(new TypeError("no answer"));
    const reply = replies[key]?.shift();
    if (!reply) {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    const response = (): Response => new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
    if (!reply.after) return Promise.resolve(response());
    // (a slow answer, as fetch's: an abort first rejects it, RV-895)
    const after = reply.after;
    return new Promise<Response>((resolve, reject) => {
      if (init?.signal?.aborted === true) reject(new DOMException("aborted", "AbortError"));
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
      void after.then(() => {
        resolve(response());
      });
    });
  }) as typeof fetch;
  return { http, calls };
}

function answers(): { handlers: SearchHandlers; got: string[]; done: Promise<void> } {
  const got: string[] = [];
  let finish = (): void => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const end = (line: string): void => {
    got.push(line);
    finish();
  };
  const handlers: SearchHandlers = {
    searching: () => got.push("searching"),
    found: (m: FoundMatch) => {
      end(`found ${m.id.toString(16)} at ${m.server} (${String(m.playlist)}v${String(m.playlist)}) ${m.ticket}`);
    },
    failed: (reason) => {
      end(`failed ${reason}`);
    },
    refused: (reason) => got.push(`refused ${String(reason)}`),
    cooldown: (seconds) => {
      end(`cooldown ${String(seconds)}`);
    },
    replaced: () => {
      end("replaced");
    },
  };
  return { handlers, got, done };
}

const request = { playlists: [1, 2], pings: { "game-eu.example:4433": 30, "game-us.example:4433": 90 }, regions: ["game-eu.example:4433"] };
const match = { id: "00000000000000ab", server: "game-eu.example:4433", ticket: "dGlja2V0", playlist: 2, map: 0 };
const started = { status: 200, body: { search: "a".repeat(32), version: 1, state: "searching" } };
const noWait = (): Promise<void> => Promise.resolve();

describe("the search with the matchmaker", () => {
  it("starts with the ticked playlists, the pings and the regions; polls from its version; a match found passed on", async () => {
    const { http, calls } = service({
      "POST /api/search": [started],
      "GET /api/search/": [
        { status: 200, body: { version: 1, state: "searching" } },
        { status: 200, body: { version: 2, state: "found", match } },
      ],
    });
    const { handlers, got, done } = answers();
    MatchmakerSearchSession.start({ base: "" }, request, handlers, {}, http, noWait);
    await done;
    expect(got).toEqual(["searching", "found ab at game-eu.example:4433 (2v2) dGlja2V0"]);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/search", body: request });
    expect(calls.slice(1).map((c) => c.path)).toEqual([`/api/search/${"a".repeat(32)}?after=1`, `/api/search/${"a".repeat(32)}?after=1`]);
  });

  it("a development matchmaker's: its base, the player named in the body", async () => {
    const { http, calls } = service({ "POST http://127.0.0.1:8090/api/search": [{ status: 503, body: { error: "no-server" } }] });
    const { handlers, got, done } = answers();
    MatchmakerSearchSession.start({ base: "http://127.0.0.1:8090", dev: { name: "Dev", key: "0123456789abcdef" } }, request, handlers, {}, http, noWait);
    await done;
    expect(calls[0]?.body).toEqual({ ...request, name: "Dev", key: "0123456789abcdef" });
    expect(got).toEqual([`failed ${MATCHMAKER_TEXT.noServer}`]);
  });

  it("says each refusal: signed out, banned (until when), in a match, a no-show's cooldown, the limit", async () => {
    const cases: [Reply, string[], string[]][] = [
      [{ status: 401, body: { error: "signed-out" } }, ["failed sign in to play online"], ["signedOut"]],
      [{ status: 403, body: { error: "queue-banned", until: new Date(Date.now() + 90_000).toISOString() } }, ["refused 7"], ["banned"]],
      [{ status: 403, body: { error: "in-match" } }, [`refused ${String(REFUSED_IN_MATCH)}`, `failed ${MATCHMAKER_TEXT.inMatch}`], []],
      [{ status: 429, body: { error: "cooldown", seconds: 77 } }, ["cooldown 77"], []],
      [{ status: 429, body: { error: "busy" } }, [`failed ${MATCHMAKER_TEXT.busy}`], []],
    ];
    for (const [reply, want, noted] of cases) {
      const { http } = service({ "POST /api/search": [reply] });
      const { handlers, got, done } = answers();
      const notes: string[] = [];
      MatchmakerSearchSession.start(
        { base: "" },
        request,
        handlers,
        { signedOut: () => notes.push("signedOut"), banned: () => notes.push("banned") },
        http,
        noWait,
      );
      await done;
      expect(got.slice(0, want.length)).toEqual(want);
      expect(notes).toEqual(noted);
    }
  });

  it("an end the service says: replaced, a quitter's ban, a no-show's cooldown", async () => {
    for (const [body, want] of [
      [{ version: 2, state: "ended", reason: "replaced" }, "replaced"],
      [{ version: 2, state: "ended", reason: "cooldown", seconds: 120 }, "cooldown 120"],
    ] as const) {
      const { http } = service({ "POST /api/search": [started], "GET /api/search/": [{ status: 200, body }] });
      const { handlers, got, done } = answers();
      MatchmakerSearchSession.start({ base: "" }, request, handlers, {}, http, noWait);
      await done;
      expect(got).toEqual(["searching", want]);
    }
  });

  it("a restart's 404: searched again once by itself (Searching said once); a second, failed", async () => {
    const { http, calls } = service({
      "POST /api/search": [started, started, started],
      "GET /api/search/": [{ status: 404 }, { status: 200, body: { version: 2, state: "found", match } }],
    });
    const { handlers, got, done } = answers();
    MatchmakerSearchSession.start({ base: "" }, request, handlers, {}, http, noWait);
    await done;
    expect(got).toEqual(["searching", "found ab at game-eu.example:4433 (2v2) dGlja2V0"]);
    expect(calls.filter((c) => c.method === "POST").length).toBe(2);
    const twice = service({ "POST /api/search": [started, started], "GET /api/search/": [{ status: 404 }, { status: 404 }] });
    const second = answers();
    MatchmakerSearchSession.start({ base: "" }, request, second.handlers, {}, twice.http, noWait);
    await second.done;
    expect(second.got).toEqual(["searching", `failed ${MATCHMAKER_TEXT.restarted}`]);
  });

  it("failed polls (no answer, 502/503) tried again with a pause; too many, the connection lost", async () => {
    const pauses: number[] = [];
    const pause = (ms: number): Promise<void> => {
      pauses.push(ms);
      return Promise.resolve();
    };
    const { http } = service({
      "POST /api/search": [started],
      "GET /api/search/": [{ status: 502 }, { status: 503 }, { status: 200, body: { version: 2, state: "found", match } }],
    });
    const { handlers, got, done } = answers();
    MatchmakerSearchSession.start({ base: "" }, request, handlers, {}, http, pause);
    await done;
    expect(got.at(-1)?.startsWith("found")).toBe(true);
    expect(pauses).toEqual([1000, 2000]);
    const down = service({ "POST /api/search": [started] });
    const lost = answers();
    MatchmakerSearchSession.start({ base: "" }, request, lost.handlers, {}, down.http, noWait);
    await lost.done;
    expect(lost.got).toEqual(["searching", `failed ${MATCHMAKER_TEXT.lost}`]);
  });

  it("Cancel Search: the search deleted at the service, nothing said after; the page going: deleted, then a match found before still said", async () => {
    const { http, calls } = service({ "POST /api/search": [started], "GET /api/search/": [], "DELETE /api/search/": [{ status: 204 }] });
    const { handlers, got } = answers();
    const search = MatchmakerSearchSession.start({ base: "" }, request, handlers, {}, http, noWait);
    await vi.waitFor(() => {
      expect(got).toEqual(["searching"]);
    });
    search.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.some((c) => c.method === "DELETE" && c.path === `/api/search/${"a".repeat(32)}`)).toBe(true);
    expect(got).toEqual(["searching"]);
    // (the page's first poll waits; the last look after the delete finds the match found before it)
    const replies: Record<string, Reply[]> = { "POST /api/search": [started], "DELETE /api/search/": [{ status: 204 }], "GET /api/search/": [] };
    const going = service(replies);
    const last = answers();
    const page = MatchmakerSearchSession.start({ base: "" }, request, last.handlers, {}, going.http, noWait);
    await vi.waitFor(() => {
      expect(last.got).toEqual(["searching"]);
    });
    replies["GET /api/search/"]?.push({ status: 200, body: { version: 2, state: "found", match } });
    await page.finish();
    expect(last.got.at(-1)?.startsWith("found ab")).toBe(true);
    // (the last look finding no match: nothing said; the delete before it, kept alive past the page: RV-887's M18-M20)
    const quietPolls: Reply[] = [];
    const quiet = service({ "POST /api/search": [started], "DELETE /api/search/": [{ status: 204 }], "GET /api/search/": quietPolls });
    const nothing = answers();
    const going2 = MatchmakerSearchSession.start({ base: "" }, request, nothing.handlers, {}, quiet.http, noWait);
    await vi.waitFor(() => {
      expect(nothing.got).toEqual(["searching"]);
    });
    quietPolls.push({ status: 200, body: { version: 2, state: "ended", reason: "cancelled" } });
    await going2.finish();
    expect(nothing.got).toEqual(["searching"]);
    expect(quiet.calls.map((c) => c.method).slice(-2)).toEqual(["DELETE", "GET"]);
    expect(quiet.calls.find((c) => c.method === "DELETE")?.init?.keepalive).toBe(true);
    // (finished before the start answered: the start's search deleted as it comes, as a cancel's)
    let answerStart = (): void => undefined;
    const slow = service({
      "POST /api/search": [{ ...started, after: new Promise<void>((resolve) => (answerStart = resolve)) }],
      "DELETE /api/search/": [{ status: 204 }],
    });
    const early = answers();
    const going3 = MatchmakerSearchSession.start({ base: "" }, request, early.handlers, {}, slow.http, noWait);
    await vi.waitFor(() => {
      expect(slow.calls.length).toBe(1);
    });
    const finished = going3.finish();
    answerStart();
    await finished;
    await vi.waitFor(() => {
      expect(slow.calls.map((c) => c.method)).toEqual(["POST", "DELETE"]);
    });
    expect(slow.calls[1]?.init?.keepalive).toBe(true);
    expect(early.got).toEqual([]);
  });

  it("a poll answered 504 or not at all tried again with pauses (1 s, doubling); a 200 between, counted afresh (RV-887's M07)", async () => {
    const pauses: number[] = [];
    const pause = (ms: number): Promise<void> => {
      pauses.push(ms);
      return Promise.resolve();
    };
    const { http } = service({
      "POST /api/search": [started],
      "GET /api/search/": [
        { status: 504 },
        { status: 502 },
        { status: 200, body: { version: 1, state: "searching" } },
        { status: 503 },
        { status: 200, body: { version: 2, state: "found", match } },
      ],
    });
    const { handlers, got, done } = answers();
    MatchmakerSearchSession.start({ base: "" }, request, handlers, {}, http, pause);
    await done;
    expect(got.at(-1)?.startsWith("found")).toBe(true);
    expect(pauses).toEqual([1000, 2000, 1000]);
  });

  it("Cancel Search while the start is under way: the start finishes and the search it returned is deleted (RV-867)", async () => {
    let answer = (): void => undefined;
    const slow = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const { http, calls } = service({ "POST /api/search": [{ ...started, after: slow }], "DELETE /api/search/": [{ status: 204 }] });
    const { handlers, got } = answers();
    const search = MatchmakerSearchSession.start({ base: "" }, request, handlers, {}, http, noWait);
    await vi.waitFor(() => {
      expect(calls.length).toBe(1);
    });
    search.cancel();
    answer();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE" && c.path === `/api/search/${"a".repeat(32)}`)).toBe(true);
    });
    expect(got).toEqual([]);
  });

  it("a poll answered 401 (the session ended: signed out, banned, deleted): the search over, the sign-in said (RV-872)", async () => {
    const { http } = service({ "POST /api/search": [started], "GET /api/search/": [{ status: 401, body: { error: "signed-out" } }] });
    const { handlers, got, done } = answers();
    const notes: string[] = [];
    MatchmakerSearchSession.start({ base: "" }, request, handlers, { signedOut: () => notes.push("signedOut") }, http, noWait);
    await done;
    expect(got).toEqual(["searching", "failed sign in to play online"]);
    expect(notes).toEqual(["signedOut"]);
  });

  it("each start's request built for it: a restart's measured again (RV-880)", async () => {
    const { http, calls } = service({
      "POST /api/search": [started, started],
      "GET /api/search/": [{ status: 404 }, { status: 200, body: { version: 2, state: "found", match } }],
    });
    const { handlers, done } = answers();
    let built = 0;
    const build = (): Promise<SearchRequest> => {
      built++;
      return Promise.resolve({ ...request, pings: { "game-eu.example:4433": 30 + built } });
    };
    MatchmakerSearchSession.start({ base: "" }, build, handlers, {}, http, noWait);
    await done;
    expect(built).toBe(2);
    const posts = calls.filter((c) => c.method === "POST").map((c) => (c.body as { pings: Record<string, number> }).pings);
    expect(posts).toEqual([{ "game-eu.example:4433": 31 }, { "game-eu.example:4433": 32 }]);
  });

  it("a start answered 503 (the service restarting) or not at all tried again with pauses; too many, not reachable (RV-881)", async () => {
    const pauses: number[] = [];
    const pause = (ms: number): Promise<void> => {
      pauses.push(ms);
      return Promise.resolve();
    };
    const { http } = service({
      "POST /api/search": [{ status: 503 }, { status: 502 }, started],
      "GET /api/search/": [{ status: 200, body: { version: 2, state: "found", match } }],
    });
    const { handlers, got, done } = answers();
    MatchmakerSearchSession.start({ base: "" }, request, handlers, {}, http, pause);
    await done;
    expect(got.at(-1)?.startsWith("found")).toBe(true);
    expect(pauses).toEqual([1000, 2000]);
    // (a 503 that's the service's own answer, no server answered: said at once)
    const none = service({ "POST /api/search": [{ status: 503, body: { error: "no-server" } }] });
    const noServer = answers();
    MatchmakerSearchSession.start({ base: "" }, request, noServer.handlers, {}, none.http, pause);
    await noServer.done;
    expect(noServer.got).toEqual([`failed ${MATCHMAKER_TEXT.noServer}`]);
    const down = service({});
    const unreachable = answers();
    MatchmakerSearchSession.start({ base: "" }, request, unreachable.handlers, {}, down.http, noWait);
    await unreachable.done;
    expect(unreachable.got).toEqual([`failed ${MATCHMAKER_TEXT.unreachable}`]);
  });

  it("the calls' guards: the page's credentials and write header; Cancel Search's delete kept alive past the page (RV-887's M12-M15)", async () => {
    const { http, calls } = service({ "POST /api/search": [started], "GET /api/search/": [], "DELETE /api/search/": [{ status: 204 }] });
    const { handlers, got } = answers();
    const search = MatchmakerSearchSession.start({ base: "" }, request, handlers, {}, http, noWait);
    await vi.waitFor(() => {
      expect(got).toEqual(["searching"]);
    });
    search.cancel();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    });
    const [post, , del] = [calls.find((c) => c.method === "POST"), null, calls.find((c) => c.method === "DELETE")];
    expect(post?.init?.credentials).toBe("same-origin");
    expect((post?.init?.headers as Record<string, string>)["X-Carball"]).toBe("1");
    expect(del?.init?.keepalive).toBe(true);
    expect(del?.init?.signal ?? null).toBeNull(); // (never aborted with the page: RV-913's M12)
    expect((del?.init?.headers as Record<string, string>)["X-Carball"]).toBe("1");
    // (a development matchmaker's: no credentials)
    const dev = service({ "POST http://127.0.0.1:8090/api/search": [{ status: 503, body: { error: "no-server" } }] });
    const devAnswers = answers();
    MatchmakerSearchSession.start(
      { base: "http://127.0.0.1:8090", dev: { name: "D", key: "0123456789abcdef" } },
      request,
      devAnswers.handlers,
      {},
      dev.http,
      noWait,
    );
    await devAnswers.done;
    expect(dev.calls[0]?.init?.credentials).toBe("omit");
  });

  it("polls lost, 504 or no answer, tried 1 + 5 times, the pauses doubling to 8 s; then the connection said lost (RV-913's M11, X04)", async () => {
    const pauses: number[] = [];
    const pause = (ms: number): Promise<void> => {
      pauses.push(ms);
      return Promise.resolve();
    };
    const { http, calls } = service({ "POST /api/search": [started], "GET /api/search/": Array.from({ length: 10 }, () => ({ status: 504 })) });
    const { handlers, got, done } = answers();
    MatchmakerSearchSession.start({ base: "" }, request, handlers, {}, http, pause);
    await done;
    expect(got.at(-1)).toBe(`failed ${MATCHMAKER_TEXT.lost}`);
    expect(pauses).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(6);
  });

  it("Cancel Search during a start's retry pause: no start after it (RV-903); during the request's making, none at all (RV-913's X06)", async () => {
    const { http, calls } = service({ "POST /api/search": [{ status: 503 }, started] });
    const { handlers } = answers();
    let search: { cancel(): void } | null = null;
    const pause = (): Promise<void> => {
      search?.cancel();
      return Promise.resolve();
    };
    search = MatchmakerSearchSession.start({ base: "" }, request, handlers, {}, http, pause);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    // (the request still being made, its pings measured, when Cancel Search comes)
    let made = (): void => undefined;
    const slow = service({ "POST /api/search": [started] });
    const building = MatchmakerSearchSession.start(
      { base: "" },
      () =>
        new Promise<SearchRequest>((resolve) => {
          made = () => {
            resolve(request);
          };
        }),
      answers().handlers,
      {},
      slow.http,
      noWait,
    );
    building.cancel();
    made();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(slow.calls).toEqual([]);
  });

  it("a development page's matchmaker: the preview's same-origin path, or this machine's host:port; nothing else (RV-911, RV-913's Q01)", () => {
    expect(devMatchmakerBase("/dev-matchmaker/14451")).toBe("/dev-matchmaker/14451");
    expect(devMatchmakerBase("127.0.0.1:14451")).toBe("http://127.0.0.1:14451");
    expect(devMatchmakerBase("[::1]:8090")).toBe("http://[::1]:8090");
    expect(devMatchmakerBase("h".repeat(64))).toBe(`http://${"h".repeat(64)}`);
    for (const bad of [null, "", "h".repeat(65), "/dev-matchmaker/x", "/elsewhere/1", "evil.example/path", "a b:1", "x@y:1"]) {
      expect(devMatchmakerBase(bad), String(bad)).toBeNull();
    }
  });

  it("reads a found match's fields, nothing else", () => {
    expect(foundMatch(match)).toEqual({ id: 0xabn, server: "game-eu.example:4433", ticket: "dGlja2V0", playlist: 2, map: 0 });
    for (const bad of [
      { ...match, id: "zz" },
      { ...match, id: "0".repeat(16) },
      { ...match, server: "no port" },
      { ...match, playlist: 4 },
      { ...match, ticket: "" },
      null,
    ]) {
      expect(foundMatch(bad)).toBeNull();
    }
  });
});
