// The search tickets (notes/accounts.md §3): a search and a claim say who the player is with a ticket the game server
// checks offline. The deployment's come from the accounts service (POST /api/ticket on this page's origin: the signed-in
// session's cookie); a development server's from its own info server (`/dev-ticket`: signed with a key it made at its
// start, the browser's key standing for an account, the settings' name its name).
import { loadSettings } from "../settings/settings";
import { browserKey } from "./search";

/** The page has no signed-in session, or it ended: sign in to play online */
export class SignedOutError extends Error {
  constructor() {
    super("sign in to play online");
    this.name = "SignedOutError";
  }
}

/** A leaver's queue ban in force (LV1): no search until `until` (ms, wall clock) */
export class QueueBannedError extends Error {
  constructor(readonly until: number) {
    super(queueBanText(until, Date.now()));
    this.name = "QueueBannedError";
  }
}

/** A ban's minutes left as the search says them (LV1: max(⌈s/60⌉, 1); our words, the game's by key until cleared) */
export function queueBanText(until: number, now: number): string {
  const minutes = Math.max(Math.ceil((until - now) / 60_000), 1);
  return `you left a ranked match: you can search again in ${String(minutes)} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** A ticket from the accounts service: the write's guards its own (Origin the page's, which the browser sends; the custom
 *  header), no body */
export async function accountTicket(post: typeof fetch = fetch): Promise<string> {
  const response = await post("/api/ticket", { method: "POST", headers: { "X-Carball": "1" }, credentials: "same-origin", cache: "no-store" });
  if (response.status === 401) throw new SignedOutError();
  if (response.status === 403) {
    const body = (await response.json().catch(() => null)) as { error?: unknown; until?: unknown } | null;
    const until = typeof body?.until === "string" ? Date.parse(body.until) : NaN;
    if (body?.error === "queue-banned" && Number.isFinite(until)) throw new QueueBannedError(until);
  }
  if (!response.ok) throw new Error(`the accounts service: HTTP ${String(response.status)}`);
  return ticketOf(await response.json());
}

/** A development server's ticket source: its info server's, for this browser's account (its key twice: 16 bytes) and
 *  the settings' name */
export function devTicket(host: string, infoPort: number, get: typeof fetch = fetch): () => Promise<string> {
  return async () => {
    const key = browserKey().toString(16).padStart(16, "0");
    const name = encodeURIComponent(loadSettings().chat.name);
    const response = await get(`http://${host}:${String(infoPort)}/dev-ticket?name=${name}&id=${key}${key}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`the development server's ticket: HTTP ${String(response.status)}`);
    return ticketOf(await response.json());
  };
}

function ticketOf(body: unknown): string {
  const ticket = (body as { ticket?: unknown } | null)?.ticket;
  if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(ticket)) throw new Error("a malformed ticket");
  return ticket;
}
