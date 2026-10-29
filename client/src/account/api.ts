// The accounts service as the page sees it (notes/accounts.md; api/internal/server): who's signed in, sign-in at a
// provider (a page load to the API, which comes back to `/?signin=…` or `/?signup`), the sign-up's name and Turnstile
// check, the account's rename, sign-out and deletion. The deployment's page only: a development page has no accounts
// (its online play the direct --dev server's open match).

/** A signed-in account (GET /api/me): its ratings in the playlists (1v1, 2v2, 3v3), a leaver's queue ban's end and a
 *  no-show's search cooldown's end (ms, this page's clock: the service sends its seconds left, RV-983) */
export interface Account {
  readonly id: string;
  readonly name: string;
  readonly providers: readonly Provider[];
  readonly ratings: readonly ShownRating[];
  readonly queueBanUntil: number | null;
  readonly searchCooldownUntil: number | null;
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

/** The live counts (GET /api/stats, kept by the API a few seconds): by playlist (its team size) its matches, the players
 *  in them and those searching it; by game server (its name, host:port: a region's) its matches and players; the players
 *  playing (in a match or searching) and the matches. Counts only */
export interface LiveStats {
  readonly playlists: readonly { readonly playlist: number; readonly matches: number; readonly players: number; readonly searching: number }[];
  readonly servers: ReadonlyMap<string, { readonly matches: number; readonly players: number }>;
  readonly playing: number;
  readonly matches: number;
}

/** A leaderboard's row (GET /api/leaderboard: the top 100 by the rating as shown, the provisional left out) */
export interface BoardRow {
  readonly rank: number;
  readonly name: string;
  readonly rating: number;
  readonly games: number;
}

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
  | "signed-out"
  | "no-signup"
  | "name-empty"
  | "name-too-short"
  | "name-too-long"
  | "name-invalid"
  | "name-not-allowed"
  | "rename-locked"
  | "turnstile"
  | "banned"
  | "blocked"
  | "taken"
  | "busy"
  | "unavailable"
  | "server"
  | "pack-invalid"
  | "pack-name"
  | "pack-name-not-allowed"
  | "pack-description"
  | "pack-description-not-allowed"
  | "pack-uploads"
  | "pack-limit"
  | "pack-own"
  | "too-large"
  | "not-found";

/** How long the page waits for each accounts call, and for config.json (ms), before it says they can't be reached: one
 *  that hangs isn't a button that does nothing (RX31) */
export const REQUEST_TIMEOUT_MS = 10_000;

/** A shared training pack as listed (browse, the account's own, one read by its code): its code, name, description,
 *  creator (its owner's display name), type, difficulty, shots, downloads, when shared; on its owner's list whether an
 *  admin hid it, and why */
export interface SharedPack {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly creator: string;
  readonly type: string;
  readonly difficulty: string;
  readonly shots: number;
  readonly downloads: number;
  readonly createdAt: string;
  readonly hidden: boolean;
  readonly hiddenReason: string;
}

/** A browse's page: its packs, and the next page's cursor (null: the last) */
export interface PackPage {
  readonly packs: readonly SharedPack[];
  readonly next: string | null;
}

/** A call the API refused, or couldn't answer */
export class AccountError extends Error {
  /** `seconds`: a refusal's time left (rename-locked's, the admin's lock; pack-uploads' day), when it says one; `detail`:
   *  what in a shared pack it refused (pack-invalid's: "shot 3: its ball") */
  constructor(
    readonly code: ApiError,
    readonly seconds: number | null = null,
    readonly detail: string | null = null,
  ) {
    super(code);
    this.name = "AccountError";
  }
}

/** The custom header every write carries (the API's guard with the page's Origin: WriteHeader) */
const WRITE_HEADER = "X-Carball";

const PROVIDERS: readonly Provider[] = ["google", "steam"];
const CODES: readonly ApiError[] = [
  "signed-out",
  "no-signup",
  "name-empty",
  "name-too-short",
  "name-too-long",
  "name-invalid",
  "name-not-allowed",
  "rename-locked",
  "turnstile",
  "banned",
  "blocked",
  "taken",
  "busy",
  "unavailable",
  "pack-invalid",
  "pack-name",
  "pack-name-not-allowed",
  "pack-description",
  "pack-description-not-allowed",
  "pack-uploads",
  "pack-limit",
  "pack-own",
  "too-large",
  "not-found",
];

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

  /** The live counts (no sign-in) */
  async stats(): Promise<LiveStats> {
    return liveStats(await this.#ok(await this.#send("GET", "/api/stats")));
  }

  /** A playlist's leaderboard (its team size; no sign-in) */
  async leaderboard(playlist: number): Promise<BoardRow[]> {
    const body = (await this.#ok(await this.#send("GET", `/api/leaderboard?playlist=${String(playlist)}v${String(playlist)}`))) as { players?: unknown } | null;
    if (!Array.isArray(body?.players)) throw new AccountError("server");
    const rows: BoardRow[] = [];
    for (const r of body.players as unknown[]) {
      const x = (r ?? {}) as Partial<Record<keyof BoardRow, unknown>>;
      if (count(x.rank) && typeof x.name === "string" && count(x.rating) && count(x.games))
        rows.push({ rank: x.rank, name: x.name, rating: x.rating, games: x.games });
    }
    return rows;
  }

  /** A training pack shared (its file, as the page keeps it: training/myPacks.ts packFile); its share code */
  async sharePack(file: unknown): Promise<string> {
    const body = (await this.#ok(await this.#send("POST", "/api/packs", file))) as { code?: unknown } | null;
    if (typeof body?.code !== "string") throw new AccountError("server");
    return body.code;
  }

  /** A shared pack by its code (no sign-in): its listing and its file (as given: the page checks it) */
  async pack(code: string): Promise<{ readonly pack: SharedPack; readonly file: unknown }> {
    const body = (await this.#ok(await this.#send("GET", `/api/packs/${encodeURIComponent(code)}`))) as { pack?: unknown } | null;
    const pack = sharedPack(body);
    if (!pack || body?.pack === undefined) throw new AccountError("server");
    return { pack, file: body.pack };
  }

  /** A page of the shared packs (no sign-in): `search` a part of their names, newest or the most downloaded first, after
   *  `cursor` (a page's next) */
  async browsePacks(search: string, sort: "new" | "downloads", cursor: string | null = null): Promise<PackPage> {
    const q = new URLSearchParams({ sort });
    if (search !== "") q.set("search", search);
    if (cursor !== null) q.set("cursor", cursor);
    return packPage(await this.#ok(await this.#send("GET", `/api/packs?${q.toString()}`)));
  }

  /** The signed-in account's own shared packs (hidden ones too), and the most it may have */
  async myPacks(): Promise<{ readonly packs: readonly SharedPack[]; readonly most: number }> {
    const body = await this.#ok(await this.#send("GET", "/api/me/packs"));
    const most = (body as { most?: unknown } | null)?.most;
    return { packs: packPage(body).packs, most: count(most) ? most : 0 };
  }

  async deletePack(code: string): Promise<void> {
    await this.#ok(await this.#send("DELETE", `/api/packs/${encodeURIComponent(code)}`));
  }

  async reportPack(code: string): Promise<void> {
    await this.#ok(await this.#send("POST", `/api/packs/${encodeURIComponent(code)}/report`));
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
    let seconds: number | null = null;
    let detail: string | null = null;
    if (response.status === 413) code = "too-large";
    try {
      const said = (await response.json()) as { error?: unknown; seconds?: unknown; detail?: unknown };
      code = CODES.find((c) => c === said.error) ?? code;
      if (typeof said.seconds === "number" && Number.isFinite(said.seconds) && said.seconds >= 0) seconds = said.seconds;
      if (typeof said.detail === "string") detail = said.detail.slice(0, 120);
    } catch {
      // (not the API's JSON: a proxy's page)
    }
    throw new AccountError(code, seconds, detail);
  }
}

/** A count the API sent: a whole number, 0 or more */
function count(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/** A shared pack the API listed, checked (null: not one) */
function sharedPack(v: unknown): SharedPack | null {
  const x = (v ?? {}) as Partial<Record<keyof SharedPack, unknown>>;
  const text = (t: unknown): t is string => typeof t === "string";
  if (!text(x.code) || !text(x.name) || !text(x.creator) || !text(x.type) || !text(x.difficulty) || !count(x.shots) || !count(x.downloads)) return null;
  return {
    code: x.code,
    name: x.name,
    description: text(x.description) ? x.description : "",
    creator: x.creator,
    type: x.type,
    difficulty: x.difficulty,
    shots: x.shots,
    downloads: x.downloads,
    createdAt: text(x.createdAt) ? x.createdAt : "",
    hidden: x.hidden === true,
    hiddenReason: text(x.hiddenReason) ? x.hiddenReason : "",
  };
}

function packPage(body: unknown): PackPage {
  const b = (body ?? {}) as { packs?: unknown; next?: unknown };
  if (!Array.isArray(b.packs)) throw new AccountError("server");
  const packs = (b.packs as unknown[]).map(sharedPack).filter((p): p is SharedPack => p !== null);
  return { packs, next: typeof b.next === "string" ? b.next : null };
}

function liveStats(body: unknown): LiveStats {
  const b = (body ?? {}) as { playlists?: unknown; servers?: unknown; playing?: unknown; matches?: unknown };
  if (!count(b.playing) || !count(b.matches) || !Array.isArray(b.playlists)) throw new AccountError("server");
  const playlists: LiveStats["playlists"][number][] = [];
  for (const p of b.playlists as unknown[]) {
    const x = (p ?? {}) as { playlist?: unknown; matches?: unknown; players?: unknown; searching?: unknown };
    if (count(x.playlist) && count(x.matches) && count(x.players) && count(x.searching)) {
      playlists.push({ playlist: x.playlist, matches: x.matches, players: x.players, searching: x.searching });
    }
  }
  const servers = new Map<string, { matches: number; players: number }>();
  if (typeof b.servers === "object" && b.servers !== null) {
    for (const [name, s] of Object.entries(b.servers as Record<string, unknown>)) {
      const x = (s ?? {}) as { matches?: unknown; players?: unknown };
      if (count(x.matches) && count(x.players)) servers.set(name, { matches: x.matches, players: x.players });
    }
  }
  return { playlists, servers, playing: b.playing, matches: b.matches };
}

function account(body: unknown): Account {
  const b = (body ?? {}) as {
    id?: unknown;
    name?: unknown;
    providers?: unknown;
    ratings?: unknown;
    queueBanSeconds?: unknown;
    searchCooldownSeconds?: unknown;
  };
  if (typeof b.id !== "string" || typeof b.name !== "string" || !Array.isArray(b.providers)) throw new AccountError("server");
  const ratings: ShownRating[] = [];
  for (const r of Array.isArray(b.ratings) ? (b.ratings as unknown[]) : []) {
    const x = (r ?? {}) as { playlist?: unknown; rating?: unknown; provisional?: unknown; games?: unknown };
    if (typeof x.playlist === "number" && typeof x.rating === "number") {
      ratings.push({ playlist: x.playlist, rating: x.rating, provisional: x.provisional === true, games: typeof x.games === "number" ? x.games : 0 });
    }
  }
  // (a ban's or a cooldown's seconds left, its end on this page's clock: the service's clock never compared with it,
  // RV-983, RV-1001)
  const end = (seconds: unknown): number | null =>
    typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : null;
  return {
    id: b.id,
    name: b.name,
    providers: PROVIDERS.filter((p) => (b.providers as unknown[]).includes(p)),
    ratings,
    queueBanUntil: end(b.queueBanSeconds),
    searchCooldownUntil: end(b.searchCooldownSeconds),
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
