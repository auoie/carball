// The pages' handoffs (the queue: notes/matchmaking.md v1 checklist): the menu page searches and hands the match page its
// claim (the slot's one-time token); the match page hands the menu page back a notice when it ends (a modal to show, a
// search to start: Play Again, a cancelled match). Kept in sessionStorage, this tab's alone and out of the URL's history.
import { RefusedError, type ServerAddress, devServerAddress, serverHost } from "./connection";
import { REFUSED_CONCLUDED, REFUSED_IN_MATCH, REFUSED_MODE, REFUSED_TICKET, REFUSED_TOKEN } from "./protocol";
import { REQUEST_TIMEOUT_MS } from "../account/api";
import { QueueBannedError, SignedOutError, accountTicket, devTicket } from "./tickets";

const CLAIM_KEY = "carball.claim";
const NOTICE_KEY = "carball.menuNotice";

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function session(): SessionStore | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** A match found: the token that claims the slot, the playlist searched (Play Again searches it again), and when its
 *  search began (ms, wall clock: a cancelled match's search goes on from there, RV-367) */
export interface Claim {
  readonly token: bigint;
  readonly playlist: number;
  readonly searchedAt: number;
  /** The match's map, from its MatchFound (its arena loads while the claim connects); the welcome's decides */
  readonly map?: number;
  /** A rejoin of the ranked match left by accident (LV1): `token` its match id, `playlist` its team size */
  readonly rejoin?: true;
  /** The signed-in account that claims it (its saved seat its own: RX30C); none on a development page */
  readonly account?: string;
}

/** A search back from a match cancelled for someone else: the token claimed (the queue's front again) and when its first
 *  search began (ms, wall clock) */
export interface Back {
  readonly token: bigint;
  readonly searchedAt: number;
}

const TOKEN = /^[1-9][0-9]{0,19}$/;

/** What the menu page does as it opens after a match page */
export interface MenuNotice {
  /** The error modal: kicked for being idle, the connection lost, a rejoin too late (the match over), the sign-in gone, a
   *  rejoin's ticket refused for a ban from another match (until `until`) */
  readonly modal?: "idle" | "lost" | "concluded" | "signedOut" | "elsewhere" | "banned";
  /** The ban's end ("banned": ms, wall clock) */
  readonly until?: number;
  /** A search of this playlist to start */
  readonly search?: number;
  /** A warning line to start its log with */
  readonly warning?: string;
  /** The search is back from a match cancelled for someone else (RV-367) */
  readonly back?: Back;
}

export function storeClaim(claim: Claim, storage = session()): void {
  try {
    storage?.setItem(
      CLAIM_KEY,
      JSON.stringify({
        token: claim.token.toString(),
        playlist: claim.playlist,
        searchedAt: claim.searchedAt,
        map: claim.map,
        rejoin: claim.rejoin,
        account: claim.account,
      }),
    );
  } catch {
    // (not kept: the match page goes back to the menu)
  }
}

/** The claim, once (taken out) */
export function takeClaim(storage = session()): Claim | null {
  try {
    const text = storage?.getItem(CLAIM_KEY) ?? null;
    storage?.removeItem(CLAIM_KEY);
    if (text === null) return null;
    const value = JSON.parse(text) as { token?: unknown; playlist?: unknown; searchedAt?: unknown; map?: unknown; rejoin?: unknown; account?: unknown };
    if (typeof value.token !== "string" || !TOKEN.test(value.token) || typeof value.playlist !== "number") return null;
    const searchedAt = typeof value.searchedAt === "number" && Number.isFinite(value.searchedAt) ? value.searchedAt : Date.now();
    const map = typeof value.map === "number" && Number.isInteger(value.map) && value.map >= 0 && value.map < 256 ? { map: value.map } : {};
    return {
      token: BigInt(value.token),
      playlist: value.playlist,
      searchedAt,
      ...map,
      ...(value.rejoin === true ? { rejoin: true as const } : {}),
      ...(typeof value.account === "string" ? { account: value.account } : {}),
    };
  } catch {
    return null;
  }
}

export function storeNotice(notice: MenuNotice, storage = session()): void {
  try {
    const { back, ...rest } = notice;
    storage?.setItem(NOTICE_KEY, JSON.stringify(back ? { ...rest, back: { token: back.token.toString(), searchedAt: back.searchedAt } } : rest));
  } catch {
    // (not kept)
  }
}

/** The notice, once (taken out) */
export function takeNotice(storage = session()): MenuNotice | null {
  try {
    const text = storage?.getItem(NOTICE_KEY) ?? null;
    storage?.removeItem(NOTICE_KEY);
    if (text === null) return null;
    const value = JSON.parse(text) as {
      modal?: unknown;
      until?: unknown;
      search?: unknown;
      warning?: unknown;
      back?: { token?: unknown; searchedAt?: unknown };
    };
    const back = value.back;
    return {
      ...(value.modal === "idle" || value.modal === "lost" || value.modal === "concluded" || value.modal === "signedOut" || value.modal === "elsewhere"
        ? { modal: value.modal }
        : {}),
      ...(value.modal === "banned" && typeof value.until === "number" && Number.isFinite(value.until) ? { modal: "banned" as const, until: value.until } : {}),
      ...(typeof value.search === "number" ? { search: value.search } : {}),
      ...(typeof value.warning === "string" ? { warning: value.warning } : {}),
      ...(typeof back?.token === "string" && TOKEN.test(back.token) && typeof back.searchedAt === "number" && Number.isFinite(back.searchedAt)
        ? { back: { token: BigInt(back.token), searchedAt: back.searchedAt } }
        : {}),
    };
  } catch {
    return null;
  }
}

/** The menu page's or the match page's URL: this page's query without the pages' own parameters (a development server's
 *  `server`, the match page's `match`), with `match` for the match page */
export function pageUrl(page: "menu" | "match" | "bots", at: { readonly pathname: string; readonly search: string }): string {
  const query = new URLSearchParams(at.search);
  query.delete("server");
  query.delete("match");
  query.delete("bots");
  if (page !== "menu") query.set(page, "");
  const text = query.toString().replace(/(^|&)(match|bots)=(?=&|$)/, "$1$2");
  return `${at.pathname}${text === "" ? "" : `?${text}`}`;
}

/** Where online play is: the deployment's game server, a development page's own, or a deployment's that can't be read */
export type GameServerConfig = { readonly kind: "deployed"; readonly url: string } | { readonly kind: "development" } | { readonly kind: "unreachable" };

/** A deployment's page whose config.json can't be read: no search (no development server's in its place, RX29C) */
export const SERVERS_UNREACHABLE = "the game's servers can't be reached right now: try again later";

/** A page a development server may serve: a development build, or one on this machine (localhost, a loopback address) */
export function localPage(dev: boolean = import.meta.env.DEV, host: string = typeof location === "undefined" ? "" : location.hostname): boolean {
  return dev || host === "localhost" || host === "[::1]" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/** The deployment's `config.json` (APP-CONTRACT.md: the web image writes it from its environment, so a deployment always
 *  has one): the game server's WebTransport URL, e.g. https://game.carball.zolt.top:4433/play. None on a local page
 *  (404, or a development server's page in its place): a development page. Anything else, and none on any other page (a
 *  deployment's config missing answers 404, or its site's page): unreachable, which fails closed (RX29C) */
export async function deployedGameServer(
  fetchConfig: (signal: AbortSignal) => Promise<Response> = async (signal) => fetch("/config.json", { cache: "no-store", signal }),
  onLocalPage: boolean = localPage(),
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<GameServerConfig> {
  const unreachable = { kind: "unreachable" } as const;
  let response: Response;
  try {
    // (one that hangs given up: unreachable, not a Find Match that does nothing, RX31)
    response = await fetchConfig(AbortSignal.timeout(timeoutMs));
  } catch {
    return unreachable;
  }
  const none = response.status === 404 || (response.ok && (response.headers.get("content-type") ?? "").startsWith("text/html"));
  if (none) return onLocalPage ? { kind: "development" } : unreachable;
  if (!response.ok) return unreachable;
  try {
    const config = (await response.json()) as { gameServer?: unknown };
    if (typeof config.gameServer === "string" && /^https:\/\/[^/\s]+\/\S*$/.test(config.gameServer)) return { kind: "deployed", url: config.gameServer };
  } catch {
    // (not JSON: unreachable, below)
  }
  return unreachable;
}

/** Where the queue is: `?queue=host:infoPort` (a development server, its /info giving its port and certificate hash);
 *  else the deployment's game server (`config.json`: its real certificate, no hash); else, a development page, this page's
 *  host, info port 4434; a deployment's config that can't be read, an error. Its searches' and claims' tickets: the
 *  accounts service's for the deployment's, the development server's own else */
export async function queueAddress(params: URLSearchParams, host: string, deployed = deployedGameServer): Promise<ServerAddress> {
  const queue = params.get("queue");
  if (queue === null) {
    const config = await deployed();
    if (config.kind === "deployed") return { url: config.url, certHash: null, ticket: (rejoin) => accountTicket(fetch, rejoin) };
    if (config.kind === "unreachable") throw new Error(SERVERS_UNREACHABLE);
  }
  const [name = host, port = "4434"] = queue === null || queue === "" ? [] : queue.split(":");
  return { ...(await devServerAddress(name, Number(port))), ticket: devTicket(serverHost(name), Number(port)) };
}

/** How often a claim's page tries its config.json and its ticket, and the pause between (ms): a passing fault (a
 *  restart, a dropped request) inside the claim's 12 s isn't a no-show (RX31) */
export const CLAIM_TRIES = 3;
export const CLAIM_RETRY_MS = 1000;

/** A claim's address: `queueAddress`, its config.json and its ticket each tried up to `CLAIM_TRIES` times; the sign-in
 *  gone and a ban are answers, not tried again */
export async function claimAddress(
  params: URLSearchParams,
  host: string,
  deployed = deployedGameServer,
  pause: (ms: number) => Promise<void> = async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<ServerAddress> {
  const tried = async <T>(attempt: () => Promise<T>, again: (e: unknown) => boolean): Promise<T> => {
    for (let i = 1; ; i++) {
      try {
        return await attempt();
      } catch (e) {
        if (i >= CLAIM_TRIES || !again(e)) throw e;
        await pause(CLAIM_RETRY_MS);
      }
    }
  };
  const address = await tried(
    async () => queueAddress(params, host, deployed),
    () => true,
  );
  const ticket = address.ticket;
  if (!ticket) return address;
  const answer = (e: unknown): boolean => e instanceof SignedOutError || e instanceof QueueBannedError;
  return {
    ...address,
    ticket: async (rejoin) =>
      tried(
        async () => ticket(rejoin),
        (e) => !answer(e),
      ),
  };
}

/** A claim's session opened, tried once more with a fresh ticket if the server refuses its ticket (a server restarted, a
 *  key rotated, the clocks apart): the claim's token isn't spent by it (RX30C) */
export async function openClaim<T>(open: () => Promise<T>): Promise<T> {
  try {
    return await open();
  } catch (e) {
    if (e instanceof RefusedError && e.reason === REFUSED_TICKET) return open();
    throw e;
  }
}

/** What the menu does after a claim that failed (`matchGone`: the search's warning line, MM-18): refused while still in
 *  its time, a match cancelled for someone else, so back to the queue's front (RV-367); a rejoin's seat live in another
 *  tab: said so, the seat kept (RX30C); a match over: its offer gone; a rejoin's ticket refused for a ban from another
 *  match: the ban (RX31); the sign-in gone: the menu's sign-in (RX29C); anything else (the server not reached, a ticket
 *  refused twice): the connection lost (a claim's seat a no-show; a rejoin not offered again, its record cleared as it
 *  was offered: RJ1, RX32) */
export function claimNotice(e: unknown, claim: Claim, matchGone: string): MenuNotice {
  const refused = e instanceof RefusedError ? e.reason : null;
  if (refused === REFUSED_TOKEN && !claim.rejoin) {
    return { search: claim.playlist, warning: matchGone, back: { token: claim.token, searchedAt: claim.searchedAt } };
  }
  if (refused === REFUSED_IN_MATCH && claim.rejoin) return { modal: "elsewhere" };
  if (refused === REFUSED_CONCLUDED) return { modal: "concluded" };
  if (e instanceof QueueBannedError && claim.rejoin) return { modal: "banned", until: e.until };
  if (e instanceof SignedOutError) return { modal: "signedOut" };
  return { modal: "lost" };
}

/** The Web Lock a match page holds while it plays its match (`navigator.locks`): another tab of this browser offers no
 *  rejoin of a match one of its tabs plays (RX30C) */
export function matchLock(matchId: bigint): string {
  return `carball.match.${matchId.toString()}`;
}

/** This browser's Web Locks, where there are (a secure page's) */
function webLocks(): LockManager | undefined {
  return typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : undefined;
}

/** The match's lock held for as long as this page lives (its match page's) */
export function holdMatchLock(matchId: bigint, locks: LockManager | undefined = webLocks()): void {
  void locks?.request(matchLock(matchId), () => new Promise<void>(() => undefined));
}

/** Whether another tab of this browser plays the match (holds its lock); false where Web Locks aren't */
export async function matchPlayedElsewhere(matchId: bigint, locks: LockManager | undefined = webLocks()): Promise<boolean> {
  if (!locks) return false;
  try {
    const state = await locks.query();
    return (state.held ?? []).some((l) => l.name === matchLock(matchId));
  } catch {
    return false;
  }
}

/** How long after its join a ranked match left by accident is offered back (LV1: 900 s, saved at the join's loading
 *  screen) */
export const REJOIN_SECONDS = 900;

/** A ranked 2v2 or 3v3 match this browser joined: its id, team size and when (ms, wall clock), for the rejoin offer */
export interface RankedSeat {
  readonly matchId: bigint;
  readonly teamSize: number;
  /** When its match page joined (ms): the latest join, a rejoin's too (RJ1: the game saves the record at every join) */
  readonly joinedAt: number;
  /** The account that played it (offered to that account alone: RX30C); null on a development page */
  readonly account: string | null;
}

const SEAT_KEY = "carball.rankedSeat";

function local(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Kept as the match page joins, at every join (a rejoin's too, RJ1), in local storage (a crash or a closed tab still
 *  offers it); a join with no rejoin (a 1v1) clears it (the game's record: saved for a ranked 2v2 or 3v3, cleared else) */
export function storeRankedSeat(seat: RankedSeat, storage = local()): void {
  if (seat.teamSize < 2 || seat.matchId === 0n) {
    clearRankedSeat(storage);
    return;
  }
  try {
    storage?.setItem(SEAT_KEY, JSON.stringify({ matchId: seat.matchId.toString(), teamSize: seat.teamSize, joinedAt: seat.joinedAt, account: seat.account }));
  } catch {
    // (not kept: no offer)
  }
}

/** The ranked match to offer back at `now` (ms): joined less than REJOIN_SECONDS ago; none otherwise */
export function rankedSeat(now = Date.now(), storage = local()): RankedSeat | null {
  try {
    const value = JSON.parse(storage?.getItem(SEAT_KEY) ?? "null") as {
      matchId?: unknown;
      teamSize?: unknown;
      joinedAt?: unknown;
      account?: unknown;
    } | null;
    if (!value || typeof value.matchId !== "string" || !TOKEN.test(value.matchId) || typeof value.teamSize !== "number") return null;
    if (typeof value.joinedAt !== "number" || !(now - value.joinedAt < REJOIN_SECONDS * 1000) || value.teamSize < 2) return null;
    const account = typeof value.account === "string" ? value.account : null;
    return { matchId: BigInt(value.matchId), teamSize: value.teamSize, joinedAt: value.joinedAt, account };
  } catch {
    return null;
  }
}

/** No offer: the match left on purpose (Exit to Main Menu), over, or offered once already (one prompt per record, RJ1) */
/** A search reached the server (its hello sent: a refusal before it, a ticket refused or a ban, never got there): the
 *  ranked seat the server holds for this account's rejoin is given up by it (RX30C), so its saved record goes too. Not
 *  another account's (another sign-in in this browser), nor one another tab plays (its lock held: the server refuses
 *  that search, the seat live, RX32) */
export async function searchGaveUpSeat(account: string | null, storage = local(), locks: LockManager | undefined = webLocks()): Promise<RankedSeat | null> {
  const seat = rankedSeat(Date.now(), storage);
  if (seat?.account !== account) return null; // (none, or another account's)
  if (await matchPlayedElsewhere(seat.matchId, locks)) return null;
  clearRankedSeat(storage);
  return seat;
}

/** A search's hold on the saved seat: given up as its hello is sent (searchGaveUpSeat), back if the server refused the
 *  search before taking it, for any reason but REFUSED_MODE (which comes after it gave the seat up): a reported quitter's
 *  Refused 7 leaves the seat to rejoin (RX32) */
export function seatSearch(
  account: string | null,
  storage = local(),
  locks: LockManager | undefined = webLocks(),
): { sent(): void; refused(reason: number): void } {
  let given: Promise<RankedSeat | null> = Promise.resolve(null);
  return {
    sent: () => {
      given = searchGaveUpSeat(account, storage, locks);
    },
    refused: (reason) => {
      void given.then((seat) => {
        if (seat && reason !== REFUSED_MODE && rankedSeat(Date.now(), storage) === null) storeRankedSeat(seat, storage);
      });
    },
  };
}

export function clearRankedSeat(storage = local()): void {
  try {
    storage?.removeItem(SEAT_KEY);
  } catch {
    // (nothing kept)
  }
}
