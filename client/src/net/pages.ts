// The pages' handoffs (the queue: notes/matchmaking.md v1 checklist): the menu page searches and hands the match page its
// claim (the seat's match ticket, the matchmaker's); the match page hands the menu page back a notice when it ends (a
// modal to show, a search to start: Play Again, a cancelled match). Kept in sessionStorage, this tab's alone and out of the URL's history.
import { RefusedError, type ServerAddress, devServerAddress, serverHost } from "./connection";
import {
  REFUSED_CONCLUDED,
  REFUSED_IN_MATCH,
  REFUSED_REJOIN_GONE,
  REFUSED_TICKET,
  REFUSED_TOKEN,
  REFUSED_UNCONFIRMED,
  REFUSED_VERSION,
  isTicketText,
} from "./protocol";
import { REQUEST_TIMEOUT_MS } from "../account/api";
import { QueueBannedError, RejoinGoneError, SignedOutError, accountTicket, devTicket } from "./tickets";

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

/** A match found: its id, the playlist that matched, and when its search began (ms, wall clock: a cancelled match's
 *  search goes on from there, RV-367) */
export interface Claim {
  readonly token: bigint;
  readonly playlist: number;
  readonly searchedAt: number;
  /** Its seat's match ticket (the matchmaker's: notes/matchmaking.md, the central matchmaker) */
  readonly ticket?: string;
  /** The playlists searched (Play Again searches them again); none: `playlist` alone */
  readonly playlists?: readonly number[];
  /** The match's map, from its MatchFound (its arena loads while the claim connects); the welcome's decides */
  readonly map?: number;
  /** A rejoin of the ranked match left by accident (LV1): `playlist` its team size */
  readonly rejoin?: true;
  /** The signed-in account that claims it (its saved seat its own: RX30C); none on a development page */
  readonly account?: string;
  /** The region whose server hosts the match (`Region`'s id); none: the first (a claim from before the regions) */
  readonly server?: string;
  /** That server's WebTransport URL (a deployment's region, as the menu had it): the claim opens with it at once, no
   *  config.json read again inside the roster's 10 s (the flow audit's 1) */
  readonly url?: string;
  /** A rejoin's saved seat's join (ms, `RankedSeat.joinedAt`): the seat kept again when the matchmaker can't be asked, its
   *  offer within its own 900 s (RV-1008) */
  readonly seatJoinedAt?: number;
}

/** A search back from a match cancelled for someone else: when its first search began (ms, wall clock; the matchmaker
 *  keeps its place itself) */
export interface Back {
  readonly searchedAt: number;
}

const TOKEN = /^[1-9][0-9]{0,19}$/;
/** A region's id as kept: config.json's (lower-case letters, digits, hyphens) or a development server's host:port */
const SERVER_ID = /^[A-Za-z0-9.:[\]-]{1,64}$/;
/** A kept record's region, if it's one */
const keptServer = (value: unknown): { server: string } | Record<string, never> =>
  typeof value === "string" && SERVER_ID.test(value) ? { server: value } : {};

/** What the menu page does as it opens after a match page */
export interface MenuNotice {
  /** The error modal: kicked for being idle, the connection lost, a rejoin too late (the match over), the sign-in gone, a
   *  rejoin's ticket refused for a ban from another match (until `until`) */
  readonly modal?: "idle" | "lost" | "concluded" | "signedOut" | "elsewhere" | "banned" | "reload" | "rejoinGone" | "rejoinUnconfirmed";
  /** The ban's end ("banned": ms, wall clock) */
  readonly until?: number;
  /** A search of these playlists to start */
  readonly search?: readonly number[];
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
        ticket: claim.ticket,
        playlists: claim.playlists,
        map: claim.map,
        rejoin: claim.rejoin,
        account: claim.account,
        server: claim.server,
        url: claim.url,
        seatJoinedAt: claim.seatJoinedAt,
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
    const value = JSON.parse(text) as {
      token?: unknown;
      playlist?: unknown;
      searchedAt?: unknown;
      ticket?: unknown;
      playlists?: unknown;
      map?: unknown;
      rejoin?: unknown;
      account?: unknown;
      server?: unknown;
      url?: unknown;
      seatJoinedAt?: unknown;
    };
    if (typeof value.token !== "string" || !TOKEN.test(value.token) || typeof value.playlist !== "number") return null;
    const searchedAt = typeof value.searchedAt === "number" && Number.isFinite(value.searchedAt) ? value.searchedAt : Date.now();
    const map = typeof value.map === "number" && Number.isInteger(value.map) && value.map >= 0 && value.map < 256 ? { map: value.map } : {};
    const ticket = isTicketText(value.ticket) ? { ticket: value.ticket } : {};
    const playlists = playlistsOf(value.playlists);
    return {
      token: BigInt(value.token),
      playlist: value.playlist,
      searchedAt,
      ...ticket,
      ...(playlists ? { playlists } : {}),
      ...map,
      ...(value.rejoin === true ? { rejoin: true as const } : {}),
      ...(typeof value.account === "string" ? { account: value.account } : {}),
      ...keptServer(value.server),
      ...(typeof value.url === "string" && SERVER_URL.test(value.url) ? { url: value.url } : {}),
      ...(typeof value.seatJoinedAt === "number" && Number.isFinite(value.seatJoinedAt) ? { seatJoinedAt: value.seatJoinedAt } : {}),
    };
  } catch {
    return null;
  }
}

/** Playlists as kept: one to three team sizes, each once; else none */
export function playlistsOf(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) return null;
  const sizes = value.filter((v): v is number => v === 1 || v === 2 || v === 3);
  return sizes.length === value.length && new Set(sizes).size === sizes.length ? sizes : null;
}

export function storeNotice(notice: MenuNotice, storage = session()): void {
  try {
    storage?.setItem(NOTICE_KEY, JSON.stringify(notice));
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
      back?: { searchedAt?: unknown };
    };
    const back = value.back;
    const search = playlistsOf(value.search);
    return {
      ...(value.modal === "idle" ||
      value.modal === "lost" ||
      value.modal === "concluded" ||
      value.modal === "signedOut" ||
      value.modal === "elsewhere" ||
      value.modal === "reload" ||
      value.modal === "rejoinGone" ||
      value.modal === "rejoinUnconfirmed"
        ? { modal: value.modal }
        : {}),
      ...(value.modal === "banned" && typeof value.until === "number" && Number.isFinite(value.until) ? { modal: "banned" as const, until: value.until } : {}),
      ...(search ? { search } : {}),
      ...(typeof value.warning === "string" ? { warning: value.warning } : {}),
      ...(typeof back?.searchedAt === "number" && Number.isFinite(back.searchedAt) ? { back: { searchedAt: back.searchedAt } } : {}),
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

/** One game server, a region's (config.json's `gameServers`: notes/matchmaking.md, Regions): its id, its name as the region
 *  picker shows it (empty: one server, no picker), its WebTransport URL */
export interface GameServerEntry {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

/** Where online play is: the deployment's game servers (`url` the first's), a development page's own, or a deployment's
 *  that can't be read */
export type GameServerConfig =
  | { readonly kind: "deployed"; readonly url: string; readonly servers: readonly GameServerEntry[] }
  | { readonly kind: "development" }
  | { readonly kind: "unreachable" };

const SERVER_URL = /^https:\/\/[^/\s]+\/\S*$/;

/** config.json's servers: `gameServers`' good entries (an id each once, a name of 40 printable characters at most, an
 *  https URL), else its `gameServer` alone (a deployment from before the regions); none, none */
export function configServers(config: { readonly gameServer?: unknown; readonly gameServers?: unknown }): GameServerEntry[] {
  const servers: GameServerEntry[] = [];
  if (Array.isArray(config.gameServers)) {
    for (const entry of config.gameServers as unknown[]) {
      if (typeof entry !== "object" || entry === null) continue;
      const { id, name, url } = entry as { id?: unknown; name?: unknown; url?: unknown };
      if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(id) || servers.some((s) => s.id === id)) continue;
      if (typeof name !== "string" || name.length > 40 || !/^[\x20-\x7e]*$/.test(name)) continue;
      if (typeof url !== "string" || !SERVER_URL.test(url)) continue;
      servers.push({ id, name, url });
    }
  }
  if (servers.length === 0 && typeof config.gameServer === "string" && SERVER_URL.test(config.gameServer)) {
    servers.push({ id: "default", name: "", url: config.gameServer });
  }
  return servers;
}

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
    const servers = configServers((await response.json()) as { gameServer?: unknown; gameServers?: unknown });
    const first = servers[0];
    if (first) return { kind: "deployed", url: first.url, servers };
  } catch {
    // (not JSON: unreachable, below)
  }
  return unreachable;
}

/** A region (notes/matchmaking.md, Regions): its id (kept with a claim and a saved seat), its name as the region picker
 *  shows it (empty: a lone server, no picker), its address, and its server's name as the matchmaker knows it (its
 *  address's host:port: the pings and a found match name it) */
export interface Region {
  readonly id: string;
  readonly name: string;
  readonly address: ServerAddress;
  readonly server: string;
}

/** A WebTransport URL's server as the matchmaker names it: host:port (443 when the URL names none) */
export function serverOfUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port === "" ? "443" : u.port}`;
  } catch {
    return "";
  }
}

/** The regions: `?queue=host:infoPort[,host:infoPort…]` (development servers, each its /info giving its port and
 *  certificate hash, named by itself when there are two or more); else the deployment's game servers (`config.json`: their
 *  real certificates, no hash); else, a development page, this page's host, info port 4434; a deployment's config that
 *  can't be read, an error. Their searches' and claims' tickets: the accounts service's for the deployment's, each
 *  development server's own else */
export async function queueRegions(params: URLSearchParams, host: string, deployed = deployedGameServer): Promise<readonly Region[]> {
  const queue = params.get("queue");
  if (queue === null) {
    const config = await deployed();
    if (config.kind === "deployed") {
      return config.servers.map((s) => ({
        id: s.id,
        name: s.name,
        address: { url: s.url, certHash: null, ticket: (rejoin) => accountTicket(rejoin) },
        server: serverOfUrl(s.url),
      }));
    }
    if (config.kind === "unreachable") throw new Error(SERVERS_UNREACHABLE);
  }
  const entries = (queue ?? "").split(",").filter((e) => e !== "");
  const named = entries.length > 1;
  return Promise.all(
    (entries.length === 0 ? [""] : entries).map(async (entry) => {
      const [name = host, port = "4434"] = entry === "" ? [] : entry.split(":");
      const address = { ...(await devServerAddress(name, Number(port))), ticket: devTicket(serverHost(name), Number(port)) };
      return { id: entry === "" ? "default" : entry, name: named ? entry : "", address, server: serverOfUrl(address.url) };
    }),
  );
}

/** A region's address: the one `server` names (a claim's, a saved seat's), else the first's (a record from before the
 *  regions, or of a region no longer listed: its claim then refused, the match gone) */
export async function queueAddress(params: URLSearchParams, host: string, deployed = deployedGameServer, server?: string): Promise<ServerAddress> {
  const regions = await queueRegions(params, host, deployed);
  const region = regions.find((r) => r.id === server) ?? regions[0];
  if (!region) throw new Error(SERVERS_UNREACHABLE);
  return region.address;
}

/** How often a claim's page tries its config.json and its ticket, and the pause between (ms): a passing fault (a
 *  restart, a dropped request) inside the claim's 12 s isn't a no-show (RX31) */
export const CLAIM_TRIES = 3;
export const CLAIM_RETRY_MS = 1000;

/** A claim's address: `queueAddress`, its config.json tried up to `CLAIM_TRIES` times; its ticket the claim's match
 *  ticket (`matchTicket`), else (a rejoin) the ticket fetched, tried as often; the sign-in gone and a ban are answers,
 *  not tried again. A deployment's claim whose server's URL the menu handed over (`url`) opens with it at once, no
 *  config.json read (the flow audit's 1) */
export async function claimAddress(
  params: URLSearchParams,
  host: string,
  deployed = deployedGameServer,
  pause: (ms: number) => Promise<void> = async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  server?: string,
  matchTicket?: string,
  url?: string,
): Promise<ServerAddress> {
  if (url !== undefined && matchTicket !== undefined && params.get("queue") === null && SERVER_URL.test(url)) {
    return { url, certHash: null, ticket: async () => Promise.resolve(matchTicket) };
  }
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
    async () => queueAddress(params, host, deployed, server),
    () => true,
  );
  if (matchTicket !== undefined) return { ...address, ticket: async () => Promise.resolve(matchTicket) };
  const ticket = address.ticket;
  if (!ticket) return address;
  const answer = (e: unknown): boolean => e instanceof SignedOutError || e instanceof QueueBannedError || e instanceof RejoinGoneError;
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
    return { search: claim.playlists ?? [claim.playlist], warning: matchGone, back: { searchedAt: claim.searchedAt } };
  }
  if (refused === REFUSED_IN_MATCH && claim.rejoin) return { modal: "elsewhere" };
  // (the server updated since this page loaded: reload, as a search refused so is told, RV-865)
  if (refused === REFUSED_VERSION) return { modal: "reload" };
  // (the matchmaker refused the rejoin's ticket: said as such, RV-882)
  if (e instanceof RejoinGoneError) return { modal: "rejoinGone" };
  // (the game server's word for the matchmaker, at the rejoin itself: the account searched or played since; or the
  // matchmaker couldn't be asked, the seat offered again: RV-1008)
  if (refused === REFUSED_REJOIN_GONE && claim.rejoin) return { modal: "rejoinGone" };
  if (refused === REFUSED_UNCONFIRMED && claim.rejoin) return { modal: "rejoinUnconfirmed" };
  if (refused === REFUSED_CONCLUDED) return { modal: "concluded" };
  if (e instanceof QueueBannedError && claim.rejoin) return { modal: "banned", until: e.until };
  if (e instanceof SignedOutError) return { modal: "signedOut" };
  return { modal: "lost" };
}

/** The seat a failed rejoin keeps again: one the matchmaker couldn't be asked about (its saved seat as it was, the offer
 *  within its own 900 s from its join, RV-1008); none for any other failure */
export function seatKeptAfter(notice: MenuNotice, claim: Claim): RankedSeat | null {
  if (notice.modal !== "rejoinUnconfirmed" || claim.seatJoinedAt === undefined) return null;
  return {
    matchId: claim.token,
    teamSize: claim.playlist,
    joinedAt: claim.seatJoinedAt,
    account: claim.account ?? null,
    ...(claim.server === undefined ? {} : { server: claim.server }),
  };
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
  /** Its region (its rejoin connects there); none: the first (a record from before the regions) */
  readonly server?: string;
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
    storage?.setItem(
      SEAT_KEY,
      JSON.stringify({ matchId: seat.matchId.toString(), teamSize: seat.teamSize, joinedAt: seat.joinedAt, account: seat.account, server: seat.server }),
    );
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
      server?: unknown;
    } | null;
    if (!value || typeof value.matchId !== "string" || !TOKEN.test(value.matchId) || typeof value.teamSize !== "number") return null;
    if (typeof value.joinedAt !== "number" || !(now - value.joinedAt < REJOIN_SECONDS * 1000) || value.teamSize < 2) return null;
    const account = typeof value.account === "string" ? value.account : null;
    return { matchId: BigInt(value.matchId), teamSize: value.teamSize, joinedAt: value.joinedAt, account, ...keptServer(value.server) };
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

/** A search's hold on the saved seat: given up once the matchmaker accepts the search (searchGaveUpSeat: the API then
 *  refuses that match's rejoin, RV-846); a refused search never held it */
export function seatSearch(account: string | null, storage = local(), locks: LockManager | undefined = webLocks()): { sent(): void } {
  return {
    sent: () => {
      void searchGaveUpSeat(account, storage, locks);
    },
  };
}

/** The saved seat forgotten if it's this match's (its end seen on its page: RJ1); another match's, kept (another tab's
 *  account's, this browser's storage being shared: RX33) */
export function clearRankedSeatOf(matchId: bigint, storage = local()): void {
  if (rankedSeat(Date.now(), storage)?.matchId === matchId) clearRankedSeat(storage);
}

/** Leaving a match's page: left on purpose or the match over, its own saved seat forgotten (no rejoin offer of it), never
 *  another match's (another tab's account's, RX34); kicked for idling or the connection lost (`reason`), kept, its rejoin
 *  offered (LV1) */
export function leaveMatchSeat(matchId: bigint, reason: MenuNotice["modal"], storage = local()): void {
  if (reason !== "idle" && reason !== "lost") clearRankedSeatOf(matchId, storage);
}

export function clearRankedSeat(storage = local()): void {
  try {
    storage?.removeItem(SEAT_KEY);
  } catch {
    // (nothing kept)
  }
}
