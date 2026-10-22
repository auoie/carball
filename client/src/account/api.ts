// The accounts service as the page sees it (notes/accounts.md; api/internal/server): who's signed in, sign-in at a
// provider (a page load to the API, which comes back to `/?signin=…` or `/?signup`), the sign-up's name and Turnstile
// check, the account's rename, sign-out and deletion. The deployment's page only: a development page plays on its game
// server's own tickets, with no accounts.

/** A signed-in account (GET /api/me): its ratings in the playlists (1v1, 2v2, 3v3), a leaver's queue ban's end (ms) */
export interface Account {
  readonly id: string;
  readonly name: string;
  readonly providers: readonly Provider[];
  readonly ratings: readonly ShownRating[];
  readonly queueBanUntil: number | null;
}

/** A playlist's rating as the page shows it ("?" while provisional: lichess's) */
export interface ShownRating {
  readonly playlist: number;
  readonly rating: number;
  readonly provisional: boolean;
  readonly games: number;
}

/** A rating as a line shows it: "1523", "1500?" */
export function ratingText(r: ShownRating): string {
  return `${String(r.rating)}${r.provisional ? "?" : ""}`;
}

export type Provider = "google" | "steam";

/** A sign-up waiting for its name (GET /api/signup): the provider signed in with, a name to start from, the Turnstile
 *  widget's site key (empty: no check, a development API) */
export interface Signup {
  readonly provider: Provider;
  readonly suggestion: string;
  readonly turnstileSiteKey: string;
  readonly nameMaxBytes: number;
}

/** The API's refusal codes the page words (api/internal/server: writeError) */
export type ApiError =
  "signed-out" | "no-signup" | "name-empty" | "name-too-long" | "turnstile" | "banned" | "blocked" | "taken" | "busy" | "unavailable" | "server";

/** How long the page waits for each accounts call, and for config.json (ms), before it says they can't be reached: one
 *  that hangs isn't a button that does nothing (RX31) */
export const REQUEST_TIMEOUT_MS = 10_000;

/** A call the API refused, or couldn't answer */
export class AccountError extends Error {
  constructor(readonly code: ApiError) {
    super(code);
    this.name = "AccountError";
  }
}

/** The custom header every write carries (the API's guard with the page's Origin: WriteHeader) */
const WRITE_HEADER = "X-Carball";

const PROVIDERS: readonly Provider[] = ["google", "steam"];
const CODES: readonly ApiError[] = ["signed-out", "no-signup", "name-empty", "name-too-long", "turnstile", "banned", "blocked", "taken", "busy", "unavailable"];

/** Where a sign-in starts: a page load (the API sets its flow's cookie and sends the browser to the provider) */
export function signInUrl(provider: Provider): string {
  return `/api/auth/${provider}/start`;
}

export class AccountsApi {
  constructor(
    private readonly call: typeof fetch = (input, init) => fetch(input, init),
    private readonly timeoutMs = REQUEST_TIMEOUT_MS,
  ) {}

  /** The signed-in account; null signed out */
  async me(): Promise<Account | null> {
    const response = await this.#send("GET", "/api/me");
    if (response.status === 401) return null;
    return account(await this.#ok(response));
  }

  /** The sign-up this browser started at a provider; null for none (expired, or never) */
  async signup(): Promise<Signup | null> {
    const response = await this.#send("GET", "/api/signup");
    if (response.status === 404) return null;
    const body = (await this.#ok(response)) as Partial<Record<keyof Signup, unknown>>;
    const provider = PROVIDERS.find((p) => p === body.provider);
    if (!provider || typeof body.suggestion !== "string" || typeof body.turnstileSiteKey !== "string" || typeof body.nameMaxBytes !== "number") {
      throw new AccountError("server");
    }
    return { provider, suggestion: body.suggestion, turnstileSiteKey: body.turnstileSiteKey, nameMaxBytes: body.nameMaxBytes };
  }

  /** The account made with this name (the Turnstile widget's token), signed in */
  async createAccount(name: string, turnstile: string): Promise<Account> {
    return account(await this.#ok(await this.#send("POST", "/api/signup", { name, turnstile })));
  }

  async rename(name: string): Promise<Account> {
    return account(await this.#ok(await this.#send("PUT", "/api/me/name", { name })));
  }

  async signOut(): Promise<void> {
    await this.#ok(await this.#send("POST", "/api/signout"));
  }

  async signOutEverywhere(): Promise<void> {
    await this.#ok(await this.#send("POST", "/api/signout-everywhere"));
  }

  /** The account gone, at once (asked for in so many words: the API wants `confirm`) */
  async deleteAccount(): Promise<void> {
    await this.#ok(await this.#send("DELETE", "/api/me", { confirm: true }));
  }

  async #send(method: string, path: string, body?: unknown): Promise<Response> {
    const write = method !== "GET";
    const headers: Record<string, string> = write ? { [WRITE_HEADER]: "1" } : {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    try {
      return await this.call(path, {
        method,
        headers,
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new AccountError("unavailable"); // (offline, the API not reached, or no answer in time: RX31)
    }
  }

  /** The body of a success (none for 204), else the API's code */
  async #ok(response: Response): Promise<unknown> {
    if (response.ok) return response.status === 204 ? null : ((await response.json()) as unknown);
    let code: ApiError = response.status === 503 || response.status === 502 || response.status === 504 ? "unavailable" : "server";
    try {
      const said = ((await response.json()) as { error?: unknown }).error;
      code = CODES.find((c) => c === said) ?? code;
    } catch {
      // (not the API's JSON: a proxy's page)
    }
    throw new AccountError(code);
  }
}

function account(body: unknown): Account {
  const b = (body ?? {}) as { id?: unknown; name?: unknown; providers?: unknown; ratings?: unknown; queueBanUntil?: unknown };
  if (typeof b.id !== "string" || typeof b.name !== "string" || !Array.isArray(b.providers)) throw new AccountError("server");
  const ratings: ShownRating[] = [];
  for (const r of Array.isArray(b.ratings) ? (b.ratings as unknown[]) : []) {
    const x = (r ?? {}) as { playlist?: unknown; rating?: unknown; provisional?: unknown; games?: unknown };
    if (typeof x.playlist === "number" && typeof x.rating === "number") {
      ratings.push({ playlist: x.playlist, rating: x.rating, provisional: x.provisional === true, games: typeof x.games === "number" ? x.games : 0 });
    }
  }
  const until = typeof b.queueBanUntil === "string" ? Date.parse(b.queueBanUntil) : NaN;
  return {
    id: b.id,
    name: b.name,
    providers: PROVIDERS.filter((p) => (b.providers as unknown[]).includes(p)),
    ratings,
    queueBanUntil: Number.isFinite(until) ? until : null,
  };
}

/** What a sign-in's return says (`/?signin=…&until=…`, `/?signup`): a notice to show, or the sign-up to finish */
export type SignInReturn =
  | { readonly kind: "signup" }
  | { readonly kind: "notice"; readonly reason: "failed" | "cancelled" | "busy" | "banned" | "blocked" | "unavailable"; readonly until: string | null }
  | null;

const REASONS = ["failed", "cancelled", "busy", "banned", "blocked", "unavailable"] as const;

export function signInReturn(params: URLSearchParams): SignInReturn {
  if (params.has("signup")) return { kind: "signup" };
  const said = params.get("signin");
  if (said === null) return null;
  const reason = REASONS.find((r) => r === said) ?? "failed";
  const until = params.get("until");
  return { kind: "notice", reason, until: until !== null && /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : null };
}

/** The address without the sign-in's return (kept out of the history and a reload) */
export function withoutSignInReturn(url: URL): string {
  const query = new URLSearchParams(url.search);
  for (const key of ["signin", "signup", "until"]) query.delete(key);
  const text = query.toString();
  return `${url.pathname}${text === "" ? "" : `?${text}`}${url.hash}`;
}
