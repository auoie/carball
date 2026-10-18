// The pages' handoffs (the queue: notes/matchmaking.md v1 checklist): the menu page searches and hands the match page its
// claim (the slot's one-time token); the match page hands the menu page back a notice when it ends (a modal to show, a
// search to start: Play Again, a cancelled match). Kept in sessionStorage, this tab's alone and out of the URL's history.
import { type ServerAddress, devServerAddress, serverHost } from "./connection";
import { accountTicket, devTicket } from "./tickets";

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
  /** The error modal: kicked for being idle, the connection lost, a rejoin too late (the match over), the sign-in gone */
  readonly modal?: "idle" | "lost" | "concluded" | "signedOut";
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
      JSON.stringify({ token: claim.token.toString(), playlist: claim.playlist, searchedAt: claim.searchedAt, map: claim.map, rejoin: claim.rejoin }),
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
    const value = JSON.parse(text) as { token?: unknown; playlist?: unknown; searchedAt?: unknown; map?: unknown; rejoin?: unknown };
    if (typeof value.token !== "string" || !TOKEN.test(value.token) || typeof value.playlist !== "number") return null;
    const searchedAt = typeof value.searchedAt === "number" && Number.isFinite(value.searchedAt) ? value.searchedAt : Date.now();
    const map = typeof value.map === "number" && Number.isInteger(value.map) && value.map >= 0 && value.map < 256 ? { map: value.map } : {};
    return { token: BigInt(value.token), playlist: value.playlist, searchedAt, ...map, ...(value.rejoin === true ? { rejoin: true as const } : {}) };
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
    const value = JSON.parse(text) as { modal?: unknown; search?: unknown; warning?: unknown; back?: { token?: unknown; searchedAt?: unknown } };
    const back = value.back;
    return {
      ...(value.modal === "idle" || value.modal === "lost" || value.modal === "concluded" || value.modal === "signedOut" ? { modal: value.modal } : {}),
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

/** The deployment's `config.json` (APP-CONTRACT.md: the web image writes it from its environment): the game server's
 *  WebTransport URL, e.g. https://game.carball.zolt.top:4433/play; null without one (a development page) */
export async function deployedGameServer(
  fetchConfig: () => Promise<Response> = async () => fetch("/config.json", { cache: "no-store" }),
): Promise<string | null> {
  try {
    const response = await fetchConfig();
    if (!response.ok) return null;
    const config = (await response.json()) as { gameServer?: unknown };
    return typeof config.gameServer === "string" && /^https:\/\/[^/\s]+\/\S*$/.test(config.gameServer) ? config.gameServer : null;
  } catch {
    return null;
  }
}

/** Where the queue is: `?queue=host:infoPort` (a development server, its /info giving its port and certificate hash);
 *  else the deployment's game server (`config.json`: its real certificate, no hash); else this page's host, info port 4434.
 *  Its searches' and claims' tickets: the accounts service's for the deployment's, the development server's own else */
export async function queueAddress(params: URLSearchParams, host: string, deployed = deployedGameServer): Promise<ServerAddress> {
  const queue = params.get("queue");
  if (queue === null) {
    const url = await deployed();
    if (url !== null) return { url, certHash: null, ticket: () => accountTicket() };
  }
  const [name = host, port = "4434"] = queue === null || queue === "" ? [] : queue.split(":");
  return { ...(await devServerAddress(name, Number(port))), ticket: devTicket(serverHost(name), Number(port)) };
}

/** How long after its join a ranked match left by accident is offered back (LV1: 900 s, saved at the join's loading
 *  screen) */
export const REJOIN_SECONDS = 900;

/** A ranked 2v2 or 3v3 match this browser joined: its id, team size and when (ms, wall clock), for the rejoin offer */
export interface RankedSeat {
  readonly matchId: bigint;
  readonly teamSize: number;
  readonly joinedAt: number;
}

const SEAT_KEY = "carball.rankedSeat";

function local(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Kept as the match page joins (a ranked 2v2 or 3v3: no rejoin in 1v1), in local storage (a crash or a closed tab
 *  still offers it) */
export function storeRankedSeat(seat: RankedSeat, storage = local()): void {
  if (seat.teamSize < 2 || seat.matchId === 0n) return;
  try {
    storage?.setItem(SEAT_KEY, JSON.stringify({ matchId: seat.matchId.toString(), teamSize: seat.teamSize, joinedAt: seat.joinedAt }));
  } catch {
    // (not kept: no offer)
  }
}

/** The ranked match to offer back at `now` (ms): joined less than REJOIN_SECONDS ago; none otherwise */
export function rankedSeat(now = Date.now(), storage = local()): RankedSeat | null {
  try {
    const value = JSON.parse(storage?.getItem(SEAT_KEY) ?? "null") as { matchId?: unknown; teamSize?: unknown; joinedAt?: unknown } | null;
    if (!value || typeof value.matchId !== "string" || !TOKEN.test(value.matchId) || typeof value.teamSize !== "number") return null;
    if (typeof value.joinedAt !== "number" || !(now - value.joinedAt < REJOIN_SECONDS * 1000) || value.teamSize < 2) return null;
    return { matchId: BigInt(value.matchId), teamSize: value.teamSize, joinedAt: value.joinedAt };
  } catch {
    return null;
  }
}

/** No offer: the match left on purpose (Exit to Main Menu), over, declined or taken back */
export function clearRankedSeat(storage = local()): void {
  try {
    storage?.removeItem(SEAT_KEY);
  } catch {
    // (nothing kept)
  }
}
