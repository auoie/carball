// The search (notes/matchmaking.md, the central matchmaker): one search of the ticked playlists with the accounts
// service's matchmaker, by long polling. `POST /api/search` starts it with the ticked regions and the pings measured just
// before; `GET /api/search/{id}?after=N` is answered at its next change (or after 25 s), each poll sent as the last one
// returns (a hidden tab's timers are throttled: MX1R-16); `DELETE` is Cancel Search. A found match carries the
// player's match ticket for their seat at its server. A development page searches a development matchmaker
// (`?matchmaker=host:port`: `carball-api matchmaker --dev`), naming its player by its key and name.
import { type FoundMatch, type SearchHandlers } from "../game/matchmaking";
import { REFUSED_IN_MATCH, REFUSED_QUEUE_BANNED } from "./protocol";
import { REQUEST_TIMEOUT_MS } from "../account/api";
import { queueBanText } from "./tickets";

/** Where the matchmaker is: this page's origin (the deployment's), or a development matchmaker with the player it names */
export interface MatchmakerEndpoint {
  readonly base: string;
  readonly dev?: { readonly name: string; readonly key: string };
}

/** A search's request: its ticked playlists (team sizes), every listed region's server that answered the ping just
 *  before (its address, host:port, and ms), and the ticked regions' servers */
export interface SearchRequest {
  readonly playlists: readonly number[];
  readonly pings: Readonly<Record<string, number>>;
  readonly regions: readonly string[];
}

/** What else a search's answers tell the page: the sign-in gone, a leaver's ban (until when, ms) */
export interface SearchNotes {
  readonly signedOut?: () => void;
  readonly banned?: (until: number) => void;
}

/** A search the page can end: Cancel Search, or the page going (a match found meanwhile still answered) */
export interface MatchmakerSearch {
  cancel(): void;
  finish(): Promise<void>;
}

/** The search's words for what the matchmaker says (ours) */
export const MATCHMAKER_TEXT = {
  noServer: "no ticked region answered: check your connection, or tick another region",
  busy: "too many searches: wait a minute and try again",
  lost: "the connection to the matchmaker was lost",
  unreachable: "the matchmaker isn't reachable right now: try again in a moment",
  /** Refused while the account plays a match (connected to it: one left isn't counted), so in another tab or window or
   *  on another device; the next step said (RV-886: the game has no words for it, ours) */
  inMatch: "you're playing a match in another tab or window: finish it there, then search again",
  restarted: "the matchmaker restarted: search again",
  noMatchmaker: "no matchmaker to search with (a development page: ?matchmaker=host:port)",
} as const;

/** How many times a poll that fails (no answer, a 502/503/504: the service restarting) is tried again, and the longest
 *  pause between (ms): 1 s, doubling */
const POLL_RETRIES = 5;
const POLL_PAUSE_MAX_MS = 8000;

interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
}

/** A match found's fields as the page keeps them; null if they're not a match's */
export function foundMatch(value: unknown): FoundMatch | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, server, ticket, playlist, map } = value as Record<string, unknown>;
  if (typeof id !== "string" || !/^[0-9a-f]{16}$/.test(id) || id === "0".repeat(16)) return null;
  if (typeof server !== "string" || !/^[A-Za-z0-9.-]{1,58}:[0-9]{1,5}$/.test(server)) return null;
  if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(ticket)) return null;
  if (typeof playlist !== "number" || ![1, 2, 3].includes(playlist)) return null;
  return { id: BigInt(`0x${id}`), server, ticket, playlist, map: typeof map === "number" && Number.isInteger(map) ? map : 0 };
}

export class MatchmakerSearchSession implements MatchmakerSearch {
  #over = false;
  #id: string | null = null;
  #version = 0;
  #abort = new AbortController();
  #done: Promise<void> = Promise.resolve();

  private constructor(
    private readonly endpoint: MatchmakerEndpoint,
    private readonly request: SearchRequest | (() => Promise<SearchRequest>),
    private readonly handlers: SearchHandlers,
    private readonly notes: SearchNotes,
    private readonly http: typeof fetch,
    private readonly pause: (ms: number) => Promise<void>,
  ) {}

  /** Starts the search; its answers to `handlers` */
  static start(
    endpoint: MatchmakerEndpoint,
    request: SearchRequest | (() => Promise<SearchRequest>),
    handlers: SearchHandlers,
    notes: SearchNotes = {},
    // (the window's own fetch, called as itself: as a method of this object it throws "Illegal invocation")
    http: typeof fetch = async (input, init) => fetch(input, init),
    pause: (ms: number) => Promise<void> = async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ): MatchmakerSearchSession {
    const search = new MatchmakerSearchSession(endpoint, request, handlers, notes, http, pause);
    search.#done = search.#run();
    return search;
  }

  /** A call to the matchmaker: its status and JSON body (none if it isn't JSON) */
  async #call(method: "POST" | "GET" | "DELETE", path: string, body?: unknown, keepalive = false): Promise<Answer> {
    const headers: Record<string, string> = method === "GET" ? {} : { "X-Carball": "1" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await this.http(`${this.endpoint.base}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: this.endpoint.dev ? "omit" : "same-origin",
      cache: "no-store",
      keepalive,
      // (a poll's own wait is the service's 25 s: a hung one given up past that, as a failed poll; a cancel stops the polls,
      // never the start, whose search is then deleted: RV-867)
      signal: keepalive
        ? null
        : method === "POST"
          ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          : AbortSignal.any([this.#abort.signal, AbortSignal.timeout(method === "GET" ? 40_000 : REQUEST_TIMEOUT_MS)]),
    });
    const json = (await response.json().catch(() => null)) as unknown;
    return { status: response.status, body: typeof json === "object" && json !== null ? (json as Record<string, unknown>) : null };
  }

  async #run(): Promise<void> {
    try {
      let restarted = false;
      for (;;) {
        if (!(await this.#start())) return;
        const outcome = await this.#poll();
        // (an unknown search: the service restarted; searched again once, by itself)
        if (outcome !== "unknown" || restarted) {
          if (outcome === "unknown")
            this.#end(() => {
              this.handlers.failed(MATCHMAKER_TEXT.restarted);
            });
          return;
        }
        restarted = true;
      }
    } catch (e) {
      this.#end(() => {
        this.handlers.failed(e instanceof Error ? e.message : String(e));
      });
    }
  }

  /** The search started (its id kept, Searching said the first time); false if refused (said) or cancelled. Its
   *  request built for this start (a restart's measured again: RV-880); no answer or a 502/503/504 (the service
   *  restarting) tried again with the polls' pauses, then said (RV-881) */
  async #start(): Promise<boolean> {
    if (this.#over) return false;
    const request = typeof this.request === "function" ? await this.request() : this.request;
    if (this.#isOver()) return false;
    const body = { playlists: request.playlists, pings: request.pings, regions: request.regions, ...this.endpoint.dev };
    let answer: Answer = { status: 0, body: null };
    for (let failures = 0; ; failures++) {
      try {
        answer = await this.#call("POST", "/api/search", body);
      } catch {
        answer = { status: 0, body: null };
      }
      if (this.#isOver()) {
        this.#forget(answer);
        return false;
      }
      if (![0, 502, 503, 504].includes(answer.status) || answer.body?.["error"] === "no-server") break;
      if (failures >= POLL_RETRIES) {
        this.#end(() => {
          this.handlers.failed(MATCHMAKER_TEXT.unreachable);
        });
        return false;
      }
      await this.pause(Math.min(1000 * 2 ** failures, POLL_PAUSE_MAX_MS));
    }
    const error = answer.body?.["error"];
    if (answer.status === 200 && typeof answer.body?.["search"] === "string") {
      const first = this.#id === null;
      this.#id = answer.body["search"];
      this.#version = typeof answer.body["version"] === "number" ? answer.body["version"] : 1;
      if (first) this.handlers.searching();
      return true;
    }
    if (answer.status === 401) {
      this.#end(() => {
        this.notes.signedOut?.();
        this.handlers.failed("sign in to play online");
      });
    } else if (error === "queue-banned") {
      const until = typeof answer.body?.["until"] === "string" ? Date.parse(answer.body["until"]) : NaN;
      this.#banned(Number.isFinite(until) ? until : Date.now());
    } else if (error === "in-match") {
      this.#end(() => {
        this.handlers.refused?.(REFUSED_IN_MATCH);
        this.handlers.failed(MATCHMAKER_TEXT.inMatch);
      });
    } else if (error === "cooldown") {
      const seconds = typeof answer.body?.["seconds"] === "number" ? answer.body["seconds"] : 120;
      this.#end(() => {
        this.handlers.cooldown(seconds);
      });
    } else if (error === "no-server") {
      this.#end(() => {
        this.handlers.failed(MATCHMAKER_TEXT.noServer);
      });
    } else if (answer.status === 429) {
      this.#end(() => {
        this.handlers.failed(MATCHMAKER_TEXT.busy);
      });
    } else {
      this.#end(() => {
        this.handlers.failed(`the matchmaker refused the search (HTTP ${String(answer.status)})`);
      });
    }
    return false;
  }

  /** A search started as the page cancelled: cancelled at the service too */
  #forget(answer: Answer): void {
    const id = answer.body?.["search"];
    if (answer.status === 200 && typeof id === "string") void this.#call("DELETE", `/api/search/${id}`, undefined, true).catch(() => undefined);
  }

  #banned(until: number): void {
    this.#end(() => {
      this.notes.banned?.(until);
      this.handlers.refused?.(REFUSED_QUEUE_BANNED);
      this.handlers.failed(queueBanText(until, Date.now()));
    });
  }

  /** Polls till the search is over: its end said; "unknown" if the service doesn't know it (a restart) */
  async #poll(): Promise<"over" | "unknown"> {
    let failures = 0;
    while (!this.#over && this.#id !== null) {
      let answer: Answer;
      try {
        answer = await this.#call("GET", `/api/search/${this.#id}?after=${String(this.#version)}`);
      } catch {
        if (this.#isOver()) return "over";
        answer = { status: 0, body: null };
      }
      if (this.#isOver()) return "over";
      if (answer.status === 404) return "unknown";
      // (the session ended meanwhile: signed out, the account banned or deleted, RV-872)
      if (answer.status === 401) {
        this.#end(() => {
          this.notes.signedOut?.();
          this.handlers.failed("sign in to play online");
        });
        return "over";
      }
      if (answer.status === 0 || answer.status === 502 || answer.status === 503 || answer.status === 504) {
        if (++failures > POLL_RETRIES) {
          this.#end(() => {
            this.handlers.failed(MATCHMAKER_TEXT.lost);
          });
          return "over";
        }
        await this.pause(Math.min(1000 * 2 ** (failures - 1), POLL_PAUSE_MAX_MS));
        continue;
      }
      failures = 0;
      if (answer.status !== 200 || !answer.body) {
        this.#end(() => {
          this.handlers.failed(`the matchmaker refused the search (HTTP ${String(answer.status)})`);
        });
        return "over";
      }
      if (this.#answered(answer.body)) return "over";
    }
    return "over";
  }

  /** A poll's answer taken: whether the search is over */
  #answered(body: Record<string, unknown>): boolean {
    if (typeof body["version"] === "number") this.#version = body["version"];
    const state = body["state"];
    if (state === "found") {
      const match = foundMatch(body["match"]);
      this.#end(() => {
        if (match) this.handlers.found(match);
        else this.handlers.failed("the matchmaker's match couldn't be read");
      });
      return true;
    }
    if (state !== "ended") return false;
    const reason = body["reason"];
    if (reason === "replaced")
      this.#end(() => {
        this.handlers.replaced();
      });
    else if (reason === "queue-banned") {
      const until = typeof body["until"] === "string" ? Date.parse(body["until"]) : NaN;
      this.#banned(Number.isFinite(until) ? until : Date.now());
    } else if (reason === "cooldown") {
      const seconds = typeof body["seconds"] === "number" ? body["seconds"] : 120;
      this.#end(() => {
        this.handlers.cooldown(seconds);
      });
    } else
      this.#end(() => {
        this.handlers.failed("the matchmaker ended the search");
      });
    return true;
  }

  /** Over meanwhile (read after each wait: a cancel comes while one runs) */
  #isOver(): boolean {
    return this.#over;
  }

  /** The search's answer, once */
  #end(answer: () => void): void {
    if (this.#over) return;
    this.#over = true;
    answer();
  }

  /** Cancel Search: cancelled at the service (a match it found meanwhile stands: not claimed, a no-show), no answer */
  cancel(): void {
    if (this.#over) return;
    this.#over = true;
    this.#abort.abort();
    const id = this.#id;
    if (id !== null) void this.#call("DELETE", `/api/search/${id}`, undefined, true).catch(() => undefined);
  }

  /** The page going elsewhere with the search running: cancelled at the service, then one last look (no wait: the cancel
   *  is its change), so a match found before the cancel is still answered (RV-443) */
  async finish(): Promise<void> {
    if (this.#over) return;
    const id = this.#id;
    if (id === null) {
      this.cancel();
      return;
    }
    this.#over = true;
    this.#abort.abort();
    try {
      await this.#call("DELETE", `/api/search/${id}`, undefined, true);
      this.#abort = new AbortController();
      const answer = await this.#call("GET", `/api/search/${id}?after=${String(this.#version)}`);
      const match = answer.body?.["state"] === "found" ? foundMatch(answer.body["match"]) : null;
      if (match) this.handlers.found(match);
    } catch {
      // (gone: nothing found)
    }
    await this.#done.catch(() => undefined);
  }
}
