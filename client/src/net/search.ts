// A search session (protocol/README.md "The queue"): a hello that searches a playlist's queue, then the server's answer:
// a match found (its slot's one-time token) or a refusal. The session ends with the answer; closing it cancels the search.
import { type SearchHandlers } from "../game/matchmaking";
import { type ServerAddress, readControlMessages, refusalText } from "./connection";
import { KICK_REPLACED, PROTOCOL_VERSION, encodeControl } from "./protocol";

const BROWSER_KEY = "carball.browserKey";
/** This page's key when the browser keeps none (storage blocked) */
let pageKey = 0n;

function randomKey(): bigint {
  const words = crypto.getRandomValues(new Uint32Array(2));
  const key = (BigInt(words[0] ?? 0) << 32n) | BigInt(words[1] ?? 0);
  return key === 0n ? 1n : key;
}

/** The browser's own key, sent with its searches (RV-367: a no-show's cooldown counts it; its address only after a
 *  second key's, RV-385): random, kept
 *  in local storage across tabs and visits; this page's alone if the browser keeps nothing */
export function browserKey(storage: Pick<Storage, "getItem" | "setItem"> | null = local()): bigint {
  try {
    const stored = storage?.getItem(BROWSER_KEY) ?? "";
    if (/^[1-9][0-9]{0,19}$/.test(stored) && BigInt(stored) < 1n << 64n) return BigInt(stored);
    const key = randomKey();
    storage?.setItem(BROWSER_KEY, key.toString());
    if (storage) return key;
  } catch {
    // (not kept: this page's key)
  }
  if (pageKey === 0n) pageKey = randomKey();
  return pageKey;
}

function local(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** How long a search that's finishing waits for the server's end (ms): the server writes out what it sent and ends
 *  within 2 s (RV-443) */
const FINISH_WAIT_MS = 3000;

/** A region's ping waits this long at most (ms): its connection and the answer (notes/matchmaking.md, Regions) */
const PING_TIMEOUT_MS = 4000;

/** A hello for a session that isn't a player's: a region's ping, or a decline */
function plainHello(intent: "ping" | "decline", token: bigint, ticket: string, key: bigint): Uint8Array {
  return encodeControl({
    type: "hello",
    version: PROTOCOL_VERSION,
    team: 255,
    model: 0,
    dodgeDeadzone: 0,
    steeringSensitivity: 0,
    airControlSensitivity: 0,
    autoSkipReplay: false,
    key,
    name: "",
    quickChat: "everyone",
    blockNonTactical: false,
    intent,
    playlist: 0,
    token,
    ticket,
  });
}

function transportTo(address: ServerAddress): WebTransport {
  return new WebTransport(address.url, address.certHash ? { serverCertificateHashes: [{ algorithm: "sha-256", value: address.certHash }] } : undefined);
}

/** A region's ping (notes/matchmaking.md, Regions): the round trip in ms on an open session, from a hello with intent
 *  "ping" to the server's first answer (its Pong; a server from before the intent refuses it, as quickly), the better of
 *  `tries`; null if it can't be reached in time */
export async function pingServer(address: ServerAddress, tries = 2): Promise<number | null> {
  let best: number | null = null;
  for (let i = 0; i < tries; i++) {
    const ms = await pingOnce(address).catch(() => null);
    if (ms !== null && (best === null || ms < best)) best = ms;
  }
  return best === null ? null : Math.round(best);
}

async function pingOnce(address: ServerAddress): Promise<number> {
  const transport = transportTo(address);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("no answer in time"));
      }, PING_TIMEOUT_MS);
    });
    const timed = async (): Promise<number> => {
      await transport.ready;
      const stream = await transport.createBidirectionalStream();
      const writer = stream.writable.getWriter();
      const reader = (stream.readable as ReadableStream<Uint8Array>).getReader();
      const start = performance.now();
      await writer.write(plainHello("ping", 0n, "", 0n));
      const { done } = await reader.read();
      if (done) throw new Error("no answer");
      return performance.now() - start;
    };
    return await Promise.race([timeout, timed()]);
  } finally {
    clearTimeout(timer);
    try {
      transport.close();
    } catch {
      // (already closed)
    }
  }
}

/** Gives up a slot a region's server found when another region's match came first (the race: notes/matchmaking.md,
 *  Regions): a hello with intent "decline" and its token, ticketed as a claim; the server cancels that match. Its end
 *  awaited a few seconds at most; a failure dropped (the reservation runs out on its own, then a stall) */
export async function declineSlot(address: ServerAddress, token: bigint): Promise<void> {
  let transport: WebTransport | null = null;
  try {
    const ticket = address.ticket ? await address.ticket() : "";
    transport = transportTo(address);
    await transport.ready;
    const stream = await transport.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    await writer.write(plainHello("decline", token, ticket, ticket === "" ? browserKey() : 0n));
    // (the server takes it and ends the session: its end awaited, a few seconds at most)
    await Promise.race([
      readControlMessages(stream.readable as ReadableStream<Uint8Array>, () => undefined),
      new Promise((resolve) => setTimeout(resolve, FINISH_WAIT_MS)),
    ]);
  } catch {
    // (given up: the reservation runs out)
  } finally {
    try {
      transport?.close();
    } catch {
      // (already closed)
    }
  }
}

/** A search the server ended for a reason this page doesn't know (our words: neutral) */
export const SEARCH_ENDED = "the server ended the search";

export class Search {
  #transport: WebTransport | null = null;
  /** Its stream's writing side, once the hello is sent */
  #writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  #over = false;
  /** The session's run, to its end */
  #done: Promise<void> = Promise.resolve();

  private constructor(readonly handlers: SearchHandlers) {}

  /** Searches the playlist with this team size (1, 2, 3); `token`: the one it claimed in a match cancelled for someone
   *  else (back to the queue's front, RV-367), else 0 */
  static start(address: ServerAddress, playlist: number, token: bigint, handlers: SearchHandlers): Search {
    const search = new Search(handlers);
    search.#done = search.#run(address, playlist, token);
    return search;
  }

  async #run(address: ServerAddress, playlist: number, token: bigint): Promise<void> {
    try {
      // (who the player is: the account's ticket, before the session opens (a refused ticket opens none: RX30C),
      // notes/accounts.md §3)
      const ticket = address.ticket ? await address.ticket() : "";
      if (this.#cancelled()) return;
      const transport = new WebTransport(
        address.url,
        address.certHash ? { serverCertificateHashes: [{ algorithm: "sha-256", value: address.certHash }] } : undefined,
      );
      this.#transport = transport;
      if (this.#cancelled()) {
        transport.close();
        return;
      }
      await transport.ready;
      const stream = await transport.createBidirectionalStream();
      const writer = stream.writable.getWriter();
      await writer.write(
        encodeControl({
          type: "hello",
          version: PROTOCOL_VERSION,
          team: 255,
          model: 0,
          dodgeDeadzone: 0,
          steeringSensitivity: 0,
          airControlSensitivity: 0,
          autoSkipReplay: false,
          key: ticket === "" ? browserKey() : 0n, // (an account's search: the account its key, not this browser, RX29C)
          name: "",
          quickChat: "everyone",
          blockNonTactical: false,
          intent: "search",
          playlist,
          token,
          ticket,
        }),
      );
      if (this.#cancelled()) return;
      this.#writer = writer;
      this.handlers.searching();
      await readControlMessages(stream.readable as ReadableStream<Uint8Array>, (m) => {
        if (m.type === "matchFound")
          this.#end(() => {
            this.handlers.found(m.token, m.map);
          });
        else if (m.type === "refused")
          this.#end(() => {
            this.handlers.refused?.(m.reason);
            this.handlers.failed(refusalText(m.reason));
          });
        else if (m.type === "searchCooldown")
          this.#end(() => {
            this.handlers.cooldown(m.seconds, m.network);
          });
        // (another tab of this browser searching took this search's place: said so, not as a failure, RV-460)
        else if (m.type === "kicked" && m.reason === KICK_REPLACED)
          this.#end(() => {
            this.handlers.replaced();
          });
        // (another kick, one this page doesn't know: the server's doing, not a lost connection: RV-485)
        else if (m.type === "kicked")
          this.#end(() => {
            this.handlers.failed(SEARCH_ENDED);
          });
      });
      this.#end(() => {
        this.handlers.failed("the connection to the server was lost");
      });
    } catch (e) {
      this.#end(() => {
        this.handlers.failed(e instanceof Error ? e.message : String(e));
      });
    }
  }

  /** Cancelled or answered meanwhile (read after each wait) */
  #cancelled(): boolean {
    return this.#over;
  }

  /** The search's answer, once; the session closed */
  #end(answer: () => void): void {
    if (this.#over) return;
    this.#over = true;
    try {
      this.#transport?.close();
    } catch {
      // (already closed)
    }
    answer();
  }

  /** The page going elsewhere (another map) with the search running: its stream closed, so the server takes it out of
   *  the queue and then writes out what it sent before (a match found: its answer, as any) and ends; that end awaited, a
   *  few seconds at most (RV-443). Before the search is sent, a cancel */
  async finish(): Promise<void> {
    if (this.#over) return;
    const writer = this.#writer;
    if (!writer) {
      this.cancel();
      return;
    }
    try {
      await writer.close();
    } catch {
      // (already closed)
    }
    await Promise.race([this.#done, new Promise((resolve) => setTimeout(resolve, FINISH_WAIT_MS))]);
    this.cancel();
  }

  /** Cancel Search: the session closed, no answer */
  cancel(): void {
    this.#over = true;
    try {
      this.#transport?.close();
    } catch {
      // (already closed)
    }
  }
}
