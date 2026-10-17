// The offline match's stand-in for WebTransport: the page's connection (net/connection.ts) talks to the local host's
// worker (local/hostWorker.ts) instead of a server, with the same streams: its control stream's framed messages both
// ways, its datagrams both ways; the host letting the player go ends the stream and closes the session. Everything else
// on the page is the online match's, unchanged.
import type { ServerAddress } from "../net/connection";
import type { FromHost, LocalMatchSetup, ToHost } from "./hostMessages";

/** The local match's address: each open starts its own worker hosting `setup` (the arena's meshes, the client's) */
export function localServerAddress(setup: LocalMatchSetup, meshes: readonly Uint8Array[], botsBase: string): ServerAddress {
  return { url: "local:bots", certHash: null, open: () => new LocalTransport(setup, meshes, botsBase) as unknown as WebTransport };
}

class LocalTransport {
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;
  readonly datagrams: { readonly readable: ReadableStream<Uint8Array>; readonly writable: WritableStream<Uint8Array> };
  readonly #worker: Worker;
  #toPage: ReadableStreamDefaultController<Uint8Array> | null = null;
  #controlToPage: ReadableStreamDefaultController<Uint8Array> | null = null;
  #ended = false;
  #resolveClosed: () => void = () => undefined;
  #rejectClosed: (e: Error) => void = () => undefined;

  constructor(setup: LocalMatchSetup, meshes: readonly Uint8Array[], botsBase: string) {
    this.#worker = new Worker(new URL("./hostWorker.ts", import.meta.url), { type: "module", name: "local host" });
    this.closed = new Promise<void>((resolve, reject) => {
      this.#resolveClosed = resolve;
      this.#rejectClosed = reject;
    });
    this.ready = new Promise<void>((resolve, reject) => {
      this.#worker.onmessage = (event: MessageEvent<FromHost>) => {
        const m = event.data;
        if (m.type === "ready") resolve();
        else if (m.type === "failed") {
          const error = new Error(`the local match didn't start: ${m.reason}`);
          reject(error);
          this.#end(error);
        } else this.#receive(m.messages);
      };
      this.#worker.onerror = (event) => {
        const error = new Error(`the local host: ${event.message}`);
        reject(error);
        this.#end(error);
      };
    });
    this.datagrams = {
      readable: new ReadableStream<Uint8Array>({
        start: (controller) => {
          this.#toPage = controller;
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write: (bytes) => {
          this.#send({ type: "datagram", bytes });
        },
      }),
    };
    this.#send({ type: "open", setup, meshes, botsBase });
  }

  /** The control stream (the page opens one, after `ready`): its player connects as it opens */
  createBidirectionalStream(): Promise<{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }> {
    this.#send({ type: "connect" });
    return Promise.resolve({
      readable: new ReadableStream<Uint8Array>({
        start: (controller) => {
          this.#controlToPage = controller;
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write: (bytes) => {
          this.#send({ type: "control", bytes });
        },
        close: () => {
          this.close();
        },
      }),
    });
  }

  /** The page leaves: its player goes, the worker with it */
  close(): void {
    if (this.#ended) return;
    this.#send({ type: "leave" });
    this.#end(null);
  }

  #send(message: ToHost): void {
    if (!this.#ended) this.#worker.postMessage(message);
  }

  #receive(messages: Extract<FromHost, { type: "out" }>["messages"]): void {
    for (const m of messages) {
      if (m.kind === "control") this.#controlToPage?.enqueue(m.bytes);
      else if (m.kind === "datagram") this.#toPage?.enqueue(m.bytes);
      else this.#end(null);
    }
  }

  /** The session over: the streams end, `closed` settles (an error: rejected with it), the worker stops */
  #end(error: Error | null): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const controller of [this.#controlToPage, this.#toPage]) {
      try {
        controller?.close();
      } catch {
        // (already closed)
      }
    }
    if (error) this.#rejectClosed(error);
    else this.#resolveClosed();
    // (a moment for the leave to reach it)
    setTimeout(() => {
      this.#worker.terminate();
    }, 100);
  }
}
