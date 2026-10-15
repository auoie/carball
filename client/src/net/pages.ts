// The pages' handoffs (the queue: notes/matchmaking.md v1 checklist): the menu page searches and hands the match page its
// claim (the slot's one-time token); the match page hands the menu page back a notice when it ends (a modal to show, a
// search to start: Play Again, a cancelled match). Kept in sessionStorage, this tab's alone and out of the URL's history.
import { type ServerAddress, devServerAddress } from "./connection";

const CLAIM_KEY = "rl-clone.claim";
const NOTICE_KEY = "rl-clone.menuNotice";

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
  /** The error modal: kicked for being idle, or the connection lost */
  readonly modal?: "idle" | "lost";
  /** A search of this playlist to start */
  readonly search?: number;
  /** A warning line to start its log with */
  readonly warning?: string;
  /** The search is back from a match cancelled for someone else (RV-367) */
  readonly back?: Back;
}

export function storeClaim(claim: Claim, storage = session()): void {
  try {
    storage?.setItem(CLAIM_KEY, JSON.stringify({ token: claim.token.toString(), playlist: claim.playlist, searchedAt: claim.searchedAt }));
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
    const value = JSON.parse(text) as { token?: unknown; playlist?: unknown; searchedAt?: unknown };
    if (typeof value.token !== "string" || !TOKEN.test(value.token) || typeof value.playlist !== "number") return null;
    const searchedAt = typeof value.searchedAt === "number" && Number.isFinite(value.searchedAt) ? value.searchedAt : Date.now();
    return { token: BigInt(value.token), playlist: value.playlist, searchedAt };
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
      ...(value.modal === "idle" || value.modal === "lost" ? { modal: value.modal } : {}),
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
export function pageUrl(page: "menu" | "match", at: { readonly pathname: string; readonly search: string }): string {
  const query = new URLSearchParams(at.search);
  query.delete("server");
  query.delete("match");
  if (page === "match") query.set("match", "");
  const text = query.toString().replace(/(^|&)match=(?=&|$)/, "$1match");
  return `${at.pathname}${text === "" ? "" : `?${text}`}`;
}

/** The deployment's `config.json` (APP-CONTRACT.md: the web image writes it from its environment): the game server's
 *  WebTransport URL, e.g. https://game.carball.zolt.top:4433/play; null without one (a development page) */
export async function deployedGameServer(fetchConfig: () => Promise<Response> = async () => fetch("/config.json", { cache: "no-store" })): Promise<string | null> {
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
 *  else the deployment's game server (`config.json`: its real certificate, no hash); else this page's host, info port 4434 */
export async function queueAddress(params: URLSearchParams, host: string, deployed = deployedGameServer): Promise<ServerAddress> {
  const queue = params.get("queue");
  if (queue === null) {
    const url = await deployed();
    if (url !== null) return { url, certHash: null };
  }
  const [name = host, port = "4434"] = queue === null || queue === "" ? [] : queue.split(":");
  return devServerAddress(name, Number(port));
}
