// The connection to the game server over WebTransport (protocol/README.md): a control stream for reliable messages,
// datagrams for inputs and world updates.
import {
  type ChatFilter,
  type ControlMessage,
  type DatagramMessage,
  DecodeError,
  type InputFrame,
  PROTOCOL_VERSION,
  REFUSED_CONCLUDED,
  REFUSED_IN_MATCH,
  REFUSED_QUEUE_BANNED,
  REFUSED_MODE,
  REFUSED_TICKET,
  REFUSED_TOKEN,
  REFUSED_VERSION,
  type Update,
  decodeControl,
  decodeDatagram,
  encodeControl,
  encodeDatagram,
  welcomeVersion,
} from "./protocol";

export interface ServerAddress {
  readonly url: string; // https://host:port/play
  readonly certHash: Uint8Array<ArrayBuffer> | null; // development servers: SHA-256 of their self-signed certificate
  /** The offline match against bots: its session, a stand-in for WebTransport talking to the local host
   *  (local/localTransport.ts), instead of the network */
  readonly open?: () => WebTransport;
  /** A search's and a claim's ticket, who the player is (src/net/tickets.ts: the accounts service's, a development
   *  server's own), or a rejoin's of the match `rejoin`; none for the local host and a development server's open match */
  readonly ticket?: (rejoin?: bigint) => Promise<string>;
}

/** A development server publishes its port and certificate hash at http://host:infoPort/info. */
/** The host to reach a server at: "localhost" as 127.0.0.1. Windows resolves localhost to ::1 first, and UDP to ::1
 *  doesn't reach a server in WSL, while WebTransport doesn't fall back to IPv4: the opening handshake fails */
export function serverHost(host: string): string {
  return host === "" || host.toLowerCase() === "localhost" ? "127.0.0.1" : host;
}

export async function devServerAddress(requestedHost: string, infoPort: number): Promise<ServerAddress> {
  const host = serverHost(requestedHost);
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
  /** The garage's car (src/game/cars.ts) */
  readonly model: number;
  readonly dodgeDeadzone: number;
  readonly steeringSensitivity: number;
  readonly airControlSensitivity: number;
  readonly autoSkipReplay: boolean;
  /** Empty: the server names the player */
  readonly name: string;
  /** The chat filters from the start (RV-259: not a frame late) */
  readonly quickChat: ChatFilter;
  readonly blockNonTactical: boolean;
}

type Welcome = Extract<ControlMessage, { type: "welcome" }>;

const KEY_STORAGE = "carball.playerKey";

function session(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The key the server gave this tab (sessionStorage: kept across its reconnects and reloads, each tab its own), so it
 *  knows who started a forfeit vote; 0 for none (RV-239: the server's, so two players can't share one; 64 bits: SEC-9) */
export function storedKey(storage = session()): bigint {
  try {
    const stored = storage?.getItem(KEY_STORAGE) ?? "";
    if (!/^[1-9][0-9]{0,19}$/.test(stored)) return 0n;
    const key = BigInt(stored);
    return key < 1n << 64n ? key : 0n;
  } catch {
    return 0n;
  }
}

/** The key the server gave (its Welcome's), kept for the next connection */
export function storeKey(key: bigint, storage = session()): void {
  try {
    storage?.setItem(KEY_STORAGE, key.toString());
  } catch {
    // (not kept: the server gives a new one next time)
  }
}

/** What a match session is for: join a development server's open match, claim a queue's reserved slot, or rejoin a ranked
 *  match left by accident (its match id) */
export type MatchSession = { readonly intent: "join" } | { readonly intent: "claim" | "rejoin"; readonly token: bigint };

/** The server refused the hello (`Refused`'s reason: REFUSED_*) */
export class RefusedError extends Error {
  constructor(readonly reason: number) {
    super(refusalText(reason));
    this.name = "RefusedError";
  }
}

/** Why the server refused a hello, in our own words */
export function refusalText(reason: number): string {
  switch (reason) {
    case REFUSED_VERSION:
      // (the server updated since this page loaded: a reload gets its page, RV-456)
      return "the server speaks another protocol version: reload the page";
    case REFUSED_TOKEN:
      return "the match is no longer there";
    case REFUSED_MODE:
      return "the server doesn't host that kind of match";
    case REFUSED_TICKET:
      return "sign in again to play online";
    case REFUSED_IN_MATCH:
      return "you're in a match already";
    case REFUSED_CONCLUDED:
      return "that match has ended";
    case REFUSED_QUEUE_BANNED:
      return "you left a ranked match: you can search again in a few minutes";
    default:
      return "the server is full";
  }
}

/** Messages for a listener that may come later: those before it's set wait, in order (the match state and the vote sent
 *  right after the welcome) */
export class ControlQueue<T> {
  #handle: ((m: T) => void) | null = null;
  readonly #early: T[] = [];

  push(m: T): void {
    if (this.#handle) this.#handle(m);
    else this.#early.push(m);
  }

  listen(handle: (m: T) => void): void {
    this.#handle = handle;
    for (const m of this.#early.splice(0)) handle(m);
  }
}

/** Length-prefixed messages on the control stream; the welcome's version checked before the rest is read (another
 *  version's fields don't decode: RV-243) */
export async function readControlMessages(readable: ReadableStream<Uint8Array>, handle: (m: ControlMessage) => void): Promise<void> {
  const reader = readable.getReader();
  let buffer = new Uint8Array(0);
  let first = true;
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
      const body = buffer.subarray(2, 2 + length);
      const version = first ? welcomeVersion(body) : null;
      if (version !== null && version !== PROTOCOL_VERSION) throw new Error(`server protocol ${String(version)}, client ${String(PROTOCOL_VERSION)}`);
      first = false;
      handle(decodeControl(body));
      buffer = buffer.slice(2 + length);
    }
  }
}

export class Connection {
  readonly #transport: WebTransport;
  readonly #datagrams: WritableStreamDefaultWriter<Uint8Array>;
  #control: WritableStreamDefaultWriter<Uint8Array> | null = null; // the control stream (after the hello)
  #closed = false;
  /** Why it closed, kept for a handler set later */
  #closedWith: string | null = null;
  #onClose: (reason: string) => void = () => undefined;
  readonly #incoming = new ControlQueue<ControlMessage>();
  onUpdate: (u: Update) => void = () => undefined;
  /** An input datagram sent, its bytes (the Stat Graphs' Out Pkt and Out Bytes, HUD-21) */
  onSent: (bytes: number) => void = () => undefined;

  private constructor(transport: WebTransport) {
    this.#transport = transport;
    // (the DOM typings leave WebTransport's streams untyped: they carry bytes)
    this.#datagrams = (transport.datagrams.writable as WritableStream<Uint8Array>).getWriter();
  }

  /** Connects, says hello (a join, or a claim of a reserved slot) and waits for the welcome. */
  static async open(
    address: ServerAddress,
    preferences: JoinPreferences,
    match: MatchSession = { intent: "join" },
  ): Promise<{ connection: Connection; welcome: Welcome }> {
    const transport =
      address.open?.() ??
      new WebTransport(address.url, address.certHash ? { serverCertificateHashes: [{ algorithm: "sha-256", value: address.certHash }] } : undefined);
    await transport.ready;
    const connection = new Connection(transport);
    const stream = await transport.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    const token = match.intent === "join" ? 0n : match.token;
    // (a claim's and a rejoin's ticket: the seat's account, notes/accounts.md §3, and no key of this browser's beside it
    // (the server keys the seat by the account: RX29C); a join's none)
    const ticket = match.intent !== "join" && address.ticket ? await address.ticket(match.intent === "rejoin" ? match.token : undefined) : "";
    const key = ticket === "" ? storedKey() : 0n;
    await writer.write(encodeControl({ type: "hello", version: PROTOCOL_VERSION, ...preferences, key, intent: match.intent, playlist: 0, token, ticket }));
    connection.#control = writer;

    const welcome = await new Promise<Welcome>((resolve, reject) => {
      let first = true;
      readControlMessages(stream.readable as ReadableStream<Uint8Array>, (m) => {
        if (first) {
          first = false;
          if (m.type === "welcome") resolve(m);
          else if (m.type === "refused") reject(new RefusedError(m.reason));
          else reject(new Error(`expected welcome, got ${m.type}`));
          return;
        }
        connection.#incoming.push(m);
      }).catch(reject);
    });
    if (welcome.version !== PROTOCOL_VERSION) throw new Error(`server protocol ${String(welcome.version)}`);
    storeKey(welcome.key);
    void connection.#readDatagrams();
    transport.closed
      .then(() => {
        connection.#close("closed by the server");
      })
      .catch((e: unknown) => {
        connection.#close(e instanceof Error ? e.message : String(e));
      });
    return { connection, welcome };
  }

  /** Reliable messages after the welcome (world reloads, events), from the first one on */
  listen(handle: (m: ControlMessage) => void): void {
    this.#incoming.listen(handle);
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** The session's end, with why: a handler set after it ended is told at once (a cancel, a restart or a lost connection
   *  while the match page builds its arena, before the game listens: RV-444) */
  get onClose(): (reason: string) => void {
    return this.#onClose;
  }

  set onClose(handler: (reason: string) => void) {
    this.#onClose = handler;
    if (this.#closedWith !== null) handler(this.#closedWith);
  }

  #close(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closedWith = reason;
    this.#onClose(reason);
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

  /** The input datagrams sent: each one's sequence (protocol 24, wrapping: the server counts the gaps as lost) */
  #inputsSent = 0;

  /** Input frames from `firstFrame` on (at most 10), stamped with the client's clock (ms) */
  sendInputs(timestamp: number, firstFrame: number, frames: readonly InputFrame[]): void {
    if (this.#closed) return;
    const sequence = this.#inputsSent++ & 0xffff;
    const bytes = encodeDatagram({ type: "inputs", timestamp: timestamp >>> 0, sequence, firstFrame, frames });
    this.onSent(bytes.length);
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

  /** A quick-chat preset (its index in the 76), to the team or all */
  quickChat(preset: number, team: boolean): void {
    this.#sendControl({ type: "quickChat", preset, team });
  }

  /** The chat filters changed (or the session started) */
  setChatFilter(quickChat: ChatFilter, blockNonTactical: boolean): void {
    this.#sendControl({ type: "chatFilter", quickChat, blockNonTactical });
  }

  /** Mute or unmute a player's chat for this player (the server stops relaying their lines) */
  mute(car: number, on: boolean): void {
    this.#sendControl({ type: "mute", car, on });
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
