// A WebTransport stand-in for unit tests (no server): the session is ready at once, its first bidirectional stream reads
// the given control messages then ends (or, asked to, stays open till the client closes its side, as a search's server
// does), and what the client writes is kept, its datagrams too.
import { type ControlMessage, encodeControl } from "../net/protocol";

export interface FakeTransportRecord {
  /** Each session's URL, the bytes the client wrote on its control stream, its datagrams, whether it closed its side
   *  of that stream, and whether it closed the session */
  readonly sessions: { url: string; written: Uint8Array[]; datagrams: Uint8Array[]; finished?: boolean; closed?: boolean }[];
}

/** A WebTransport class whose sessions answer with `replies` (each message framed as the server's); `closed`: each
 *  session closed by the server at once (else never); `onFinish`: the stream kept open after the replies till the client
 *  closes its side, then these written (what a server sent before it saw the close) and the stream ended */
export function fakeTransport(
  replies: readonly ControlMessage[],
  record: FakeTransportRecord = { sessions: [] },
  closed = false,
  onFinish?: readonly ControlMessage[],
): typeof WebTransport {
  class Fake {
    readonly ready = Promise.resolve();
    readonly closed = closed ? Promise.resolve() : new Promise<void>(() => undefined);
    readonly datagrams: { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> };
    readonly #session: FakeTransportRecord["sessions"][number];
    constructor(url: string) {
      const session: FakeTransportRecord["sessions"][number] = { url, written: [], datagrams: [] };
      this.#session = session;
      this.datagrams = {
        writable: new WritableStream<Uint8Array>({
          write(chunk) {
            session.datagrams.push(chunk);
          },
        }),
        readable: new ReadableStream<Uint8Array>(),
      };
      record.sessions.push(session);
    }
    createBidirectionalStream(): Promise<{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }> {
      const session = this.#session;
      let reading: ReadableStreamDefaultController<Uint8Array> | null = null;
      return Promise.resolve({
        readable: new ReadableStream<Uint8Array>({
          start(controller) {
            for (const m of replies) controller.enqueue(encodeControl(m));
            if (onFinish) reading = controller;
            else controller.close();
          },
        }),
        writable: new WritableStream<Uint8Array>({
          write(chunk) {
            session.written.push(chunk);
          },
          close() {
            session.finished = true;
            if (!reading || !onFinish) return;
            for (const m of onFinish) reading.enqueue(encodeControl(m));
            reading.close();
          },
        }),
      });
    }
    close(): void {
      this.#session.closed = true;
    }
  }
  return Fake as unknown as typeof WebTransport;
}
