// The connection to the game server over WebTransport (protocol/README.md): a control stream for reliable messages,
// datagrams for inputs and world updates.
import {
  type ControlMessage,
  type DatagramMessage,
  DecodeError,
  type InputFrame,
  PROTOCOL_VERSION,
  type Update,
  decodeControl,
  decodeDatagram,
  encodeControl,
  encodeDatagram,
} from "./protocol";

export interface ServerAddress {
  readonly url: string; // https://host:port/play
  readonly certHash: Uint8Array<ArrayBuffer> | null; // development servers: SHA-256 of their self-signed certificate
}

/** A development server publishes its port and certificate hash at http://host:infoPort/info. */
export async function devServerAddress(host: string, infoPort: number): Promise<ServerAddress> {
  const response = await fetch(`http://${host}:${String(infoPort)}/info`, { cache: "no-store" });
  if (!response.ok) throw new Error(`server info: HTTP ${String(response.status)}`);
  const info = (await response.json()) as { port?: unknown; certHash?: unknown };
  if (typeof info.port !== "number" || typeof info.certHash !== "string" || !/^[0-9a-f]{64}$/.test(info.certHash)) {
    throw new Error("server info: malformed");
  }
  const hash = Uint8Array.from(info.certHash.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
  return { url: `https://${host}:${String(info.port)}/play`, certHash: hash };
}

export interface JoinPreferences {
  readonly team: number; // 0, 1, 255 = any
  readonly body: number;
  readonly dodgeDeadzone: number;
  readonly steeringSensitivity: number;
  readonly airControlSensitivity: number;
  readonly autoSkipReplay: boolean;
}

type Welcome = Extract<ControlMessage, { type: "welcome" }>;

const KEY_STORAGE = "rl-clone.playerKey";

/** This tab's random key, kept across its reconnects and reloads (sessionStorage: each tab its own player), so the
 *  server knows who started a forfeit vote; a fresh one each time when storage is unavailable */
export function playerKey(): number {
  try {
    const stored = Number(sessionStorage.getItem(KEY_STORAGE));
    if (Number.isInteger(stored) && stored > 0 && stored <= 0xffffffff) return stored;
  } catch {
    // (no storage: a new key)
  }
  const key = Math.max(1, crypto.getRandomValues(new Uint32Array(1))[0] ?? 1);
  try {
    sessionStorage.setItem(KEY_STORAGE, String(key));
  } catch {
    // (not kept)
  }
  return key;
}

export class Connection {
  readonly #transport: WebTransport;
  readonly #datagrams: WritableStreamDefaultWriter<Uint8Array>;
  #control: WritableStreamDefaultWriter<Uint8Array> | null = null; // the control stream (after the hello)
  #closed = false;
  #onControl: ((m: ControlMessage) => void) | null = null;
  /** Reliable messages that came before anyone listened (the match state and the vote sent right after the welcome) */
  readonly #early: ControlMessage[] = [];
  onUpdate: (u: Update) => void = () => undefined;
  onClose: (reason: string) => void = () => undefined;

  private constructor(transport: WebTransport) {
    this.#transport = transport;
    // (the DOM typings leave WebTransport's streams untyped: they carry bytes)
    this.#datagrams = (transport.datagrams.writable as WritableStream<Uint8Array>).getWriter();
  }

  /** Connects, says hello and waits for the welcome. */
  static async open(address: ServerAddress, preferences: JoinPreferences): Promise<{ connection: Connection; welcome: Welcome }> {
    const transport = new WebTransport(
      address.url,
      address.certHash ? { serverCertificateHashes: [{ algorithm: "sha-256", value: address.certHash }] } : undefined,
    );
    await transport.ready;
    const connection = new Connection(transport);
    const stream = await transport.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    await writer.write(encodeControl({ type: "hello", version: PROTOCOL_VERSION, ...preferences, key: playerKey() }));
    connection.#control = writer;

    const welcome = await new Promise<Welcome>((resolve, reject) => {
      let first = true;
      connection.#readControl(stream.readable as ReadableStream<Uint8Array>, (m) => {
        if (first) {
          first = false;
          if (m.type === "welcome") resolve(m);
          else reject(new Error(`expected welcome, got ${m.type}`));
          return;
        }
        if (connection.#onControl) connection.#onControl(m);
        else connection.#early.push(m);
      }).catch(reject);
    });
    if (welcome.version !== PROTOCOL_VERSION) throw new Error(`server protocol ${String(welcome.version)}`);
    void connection.#readDatagrams();
    transport.closed
      .then(() => { connection.#close("closed by the server"); })
      .catch((e: unknown) => { connection.#close(e instanceof Error ? e.message : String(e)); });
    return { connection, welcome };
  }

  /** Reliable messages after the welcome (world reloads, events), from the first one on */
  listen(handle: (m: ControlMessage) => void): void {
    this.#onControl = handle;
    for (const m of this.#early.splice(0)) handle(m);
  }

  get closed(): boolean {
    return this.#closed;
  }

  #close(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.onClose(reason);
  }

  /** Length-prefixed messages on the control stream */
  async #readControl(readable: ReadableStream<Uint8Array>, handle: (m: ControlMessage) => void): Promise<void> {
    const reader = readable.getReader();
    let buffer = new Uint8Array(0);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      const joined = new Uint8Array(buffer.byteLength + value.byteLength);
      joined.set(buffer);
      joined.set(value, buffer.byteLength);
      buffer = joined;
      while (buffer.byteLength >= 2) {
        const length = (buffer[0] ?? 0) | ((buffer[1] ?? 0) << 8);
        if (buffer.byteLength < 2 + length) break;
        handle(decodeControl(buffer.subarray(2, 2 + length)));
        buffer = buffer.slice(2 + length);
      }
    }
  }

  async #readDatagrams(): Promise<void> {
    const reader = (this.#transport.datagrams.readable as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        let message: DatagramMessage;
        try {
          message = decodeDatagram(value);
        } catch (e) {
          if (e instanceof DecodeError) continue; // a malformed datagram is dropped like a lost one
          throw e;
        }
        if (message.type === "update") this.onUpdate(message);
      }
    } catch (e) {
      this.#close(e instanceof Error ? e.message : String(e));
    }
  }

  /** Input frames from `firstFrame` on (at most 10), stamped with the client's clock (ms) */
  sendInputs(timestamp: number, firstFrame: number, frames: readonly InputFrame[]): void {
    if (this.#closed) return;
    const bytes = encodeDatagram({ type: "inputs", timestamp: timestamp >>> 0, firstFrame, frames });
    // Unreliable: if the browser drops it (congestion), the frames go again in the next packets
    this.#datagrams.write(bytes).catch(() => undefined);
  }

  /** After a hitch: the server starts its estimate of this client's packet timing over (reliable) */
  resetInputBuffer(): void {
    this.#sendControl({ type: "resetInputBuffer" });
  }

  /** Skip the goal replay (ReadyUp) */
  readyUp(): void {
    this.#sendControl({ type: "readyUp" });
  }

  /** The auto-skip setting changed */
  setAutoSkipReplay(on: boolean): void {
    this.#sendControl({ type: "autoSkipReplay", on });
  }

  /** Vote to forfeit: starts the team's vote, or joins it */
  voteForfeit(): void {
    this.#sendControl({ type: "voteForfeit" });
  }

  #sendControl(m: ControlMessage): void {
    if (this.#closed || !this.#control) return;
    this.#control.write(encodeControl(m)).catch(() => undefined);
  }

  close(): void {
    this.#transport.close();
    this.#close("closed");
  }
}
