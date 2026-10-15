// A search session (protocol/README.md "The queue"): a hello that searches a playlist's queue, then the server's answer:
// a match found (its slot's one-time token) or a refusal. The session ends with the answer; closing it cancels the search.
import { type ServerAddress, readControlMessages, refusalText } from "./connection";
import { PROTOCOL_VERSION, encodeControl } from "./protocol";

export interface SearchHandlers {
  /** The hello went out: the search is in the queue */
  readonly searching: () => void;
  /** A match was found: the token claims the slot in a new session */
  readonly found: (token: bigint) => void;
  /** The search ended without a match: refused, or the connection to the server lost */
  readonly failed: (reason: string) => void;
}

export class Search {
  #transport: WebTransport | null = null;
  #over = false;

  private constructor(readonly handlers: SearchHandlers) {}

  /** Searches the playlist with this team size (1, 2, 3) */
  static start(address: ServerAddress, playlist: number, handlers: SearchHandlers): Search {
    const search = new Search(handlers);
    void search.#run(address, playlist);
    return search;
  }

  async #run(address: ServerAddress, playlist: number): Promise<void> {
    try {
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
          body: 0,
          dodgeDeadzone: 0,
          steeringSensitivity: 0,
          airControlSensitivity: 0,
          autoSkipReplay: false,
          key: 0n,
          name: "",
          quickChat: "everyone",
          blockNonTactical: false,
          intent: "search",
          playlist,
          token: 0n,
        }),
      );
      if (this.#cancelled()) return;
      this.handlers.searching();
      await readControlMessages(stream.readable as ReadableStream<Uint8Array>, (m) => {
        if (m.type === "matchFound") this.#end(() => { this.handlers.found(m.token); });
        else if (m.type === "refused") this.#end(() => { this.handlers.failed(refusalText(m.reason)); });
      });
      this.#end(() => { this.handlers.failed("the connection to the server was lost"); });
    } catch (e) {
      this.#end(() => { this.handlers.failed(e instanceof Error ? e.message : String(e)); });
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
