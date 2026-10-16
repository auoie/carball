// A WebTransport stand-in for unit tests (no server): the session is ready at once, its first bidirectional stream reads
// the given control messages then ends, and what the client writes is kept.
import { type ControlMessage, encodeControl } from "../net/protocol";

export interface FakeTransportRecord {
  /** Each session's URL and the bytes the client wrote on its control stream */
  readonly sessions: { url: string; written: Uint8Array[] }[];
}

/** A WebTransport class whose sessions answer with `replies` (each message framed as the server's); `closed`: each
 *  session closed by the server at once (else never) */
export function fakeTransport(replies: readonly ControlMessage[], record: FakeTransportRecord = { sessions: [] }, closed = false): typeof WebTransport {
  class Fake {
    readonly ready = Promise.resolve();
    readonly closed = closed ? Promise.resolve() : new Promise<void>(() => undefined);
    readonly datagrams = { writable: new WritableStream<Uint8Array>(), readable: new ReadableStream<Uint8Array>() };
    readonly #session: { url: string; written: Uint8Array[] };
    constructor(url: string) {
      this.#session = { url, written: [] };
      record.sessions.push(this.#session);
    }
    createBidirectionalStream(): Promise<{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }> {
      const written = this.#session.written;
      return Promise.resolve({
        readable: new ReadableStream<Uint8Array>({
          start(controller) {
            for (const m of replies) controller.enqueue(encodeControl(m));
            controller.close();
          },
        }),
        writable: new WritableStream<Uint8Array>({
          write(chunk) {
            written.push(chunk);
          },
        }),
      });
    }
    close(): void {
      // (nothing to close)
    }
  }
  return Fake as unknown as typeof WebTransport;
}
