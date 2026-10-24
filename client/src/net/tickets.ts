// The rejoin tickets (notes/accounts.md §3): a rejoin says who the player is with a ticket the game server checks
// offline (a claim's is its match ticket, the matchmaker's: notes/matchmaking.md). They come from the accounts service
// (POST /api/ticket?rejoin= on this page's origin: the signed-in session's cookie).
import { isTicketText } from "./protocol";

/** The page has no signed-in session, or it ended: sign in to play online */
export class SignedOutError extends Error {
  constructor() {
    super("sign in to play online");
    this.name = "SignedOutError";
  }
}

/** A rejoin's ticket refused by the matchmaker (409): the account searches, plays another match, or a search since gave
 *  that match up (RV-869, RV-882) */
export class RejoinGoneError extends Error {
  constructor() {
    super("that match can't be rejoined now");
    this.name = "RejoinGoneError";
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

/** A rejoin's ticket from the accounts service, for the match `rejoin` (which a queue ban from that match doesn't stop):
 *  the write's guards its own (Origin the page's, which the browser sends; the custom header), no body. (Its search
 *  purpose, a ticket with no match, is no page's since the central matchmaker: RV-888) */
export async function accountTicket(rejoin: bigint, post: typeof fetch = fetch): Promise<string> {
  const response = await post(`/api/ticket?rejoin=${matchHex(rejoin)}`, {
    method: "POST",
    headers: { "X-Carball": "1" },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) throw new SignedOutError();
  if (response.status === 403) {
    // (the ban's seconds left, its end on this page's clock, RV-1001)
    const body = (await response.json().catch(() => null)) as { error?: unknown; seconds?: unknown } | null;
    const seconds = typeof body?.seconds === "number" ? body.seconds : NaN;
    if (body?.error === "queue-banned" && Number.isFinite(seconds)) throw new QueueBannedError(Date.now() + seconds * 1000);
  }
  // (a rejoin the matchmaker refuses: the account searching, in another match, or a later search having given that
  // match up: its own answer, not tried again, RV-882)
  if (response.status === 409) throw new RejoinGoneError();
  if (!response.ok) throw new Error(ticketRefusalText(response.status));
  return ticketOf(await response.json());
}

/** Another refusal of a ticket in words (RX29C): its per-account limit (a few a minute, AC-26), the service down */
export function ticketRefusalText(status: number): string {
  if (status === 429) return "too many tries: wait a minute and try again";
  if (status >= 500) return "accounts aren't reachable right now: try again later";
  return `the accounts service refused the rejoin (HTTP ${String(status)})`;
}

/** A match's id as the tickets name it: 16 hex digits */
function matchHex(id: bigint): string {
  return id.toString(16).padStart(16, "0");
}

function ticketOf(body: unknown): string {
  const ticket = (body as { ticket?: unknown } | null)?.ticket;
  if (!isTicketText(ticket)) throw new Error("a malformed ticket");
  return ticket;
}
