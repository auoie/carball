// The regions' pings (notes/matchmaking.md, Regions: a hello with intent "ping" timed to the server's Pong) and this
// browser's key (a development page's player: its account the key twice). The search itself is the accounts service's
// matchmaker's (net/matchmaker.ts).
import { type ServerAddress } from "./connection";
import { PROTOCOL_VERSION, decodeControl, encodeControl } from "./protocol";

const BROWSER_KEY = "carball.browserKey";
/** This page's key when the browser keeps none (storage blocked) */
let pageKey = 0n;

function randomKey(): bigint {
  const words = crypto.getRandomValues(new Uint32Array(2));
  const key = (BigInt(words[0] ?? 0) << 32n) | BigInt(words[1] ?? 0);
  return key === 0n ? 1n : key;
}

/** The browser's own key (a development page's player, its account the key twice): random, kept in local storage across
 *  tabs and visits; this page's alone if the browser keeps nothing */
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

/** A region's ping waits this long at most (ms): its connection and the answer (notes/matchmaking.md, Regions) */
const PING_TIMEOUT_MS = 4000;

/** A ping's hello: no player's */
function pingHello(): Uint8Array {
  return encodeControl({
    type: "hello",
    version: PROTOCOL_VERSION,
    team: 255,
    model: 0,
    dodgeDeadzone: 0,
    steeringSensitivity: 0,
    airControlSensitivity: 0,
    autoSkipReplay: false,
    key: 0n,
    name: "",
    quickChat: "everyone",
    blockNonTactical: false,
    intent: "ping",
    playlist: 0,
    token: 0n,
    ticket: "",
  });
}

function transportTo(address: ServerAddress): WebTransport {
  return new WebTransport(address.url, address.certHash ? { serverCertificateHashes: [{ algorithm: "sha-256", value: address.certHash }] } : undefined);
}

/** A region's ping (notes/matchmaking.md, Regions): the round trip in ms on an open session, from a hello with intent
 *  "ping" to the server's Pong, the better of `tries`, and the server's name as its Pong says it (the matchmaker's for
 *  it: RV-863; empty from a server from before the name); null if it can't be reached in time, or answers with anything
 *  but a Pong (a server of another protocol version refuses it: not one to match at, RV-864) */
export async function pingServer(address: ServerAddress, tries = 2): Promise<{ readonly ms: number; readonly server: string } | null> {
  let best: { ms: number; server: string } | null = null;
  for (let i = 0; i < tries; i++) {
    const answer = await pingOnce(address).catch(() => null);
    // (unreached: not tried again, its dash shown in one try's time, not two: RV-842)
    if (answer === null) break;
    if (best === null || answer.ms < best.ms) best = answer;
  }
  return best === null ? null : { ms: Math.round(best.ms), server: best.server };
}

async function pingOnce(address: ServerAddress): Promise<{ ms: number; server: string }> {
  const transport = transportTo(address);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("no answer in time"));
      }, PING_TIMEOUT_MS);
    });
    const timed = async (): Promise<{ ms: number; server: string }> => {
      await transport.ready;
      const stream = await transport.createBidirectionalStream();
      const writer = stream.writable.getWriter();
      const reader = (stream.readable as ReadableStream<Uint8Array>).getReader();
      const start = performance.now();
      await writer.write(pingHello());
      // (the first whole message, decoded: a Pong alone answers)
      let buffer = new Uint8Array(0);
      for (;;) {
        if (buffer.byteLength >= 2) {
          const n = (buffer[0] ?? 0) | ((buffer[1] ?? 0) << 8);
          if (buffer.byteLength >= 2 + n) {
            const ms = performance.now() - start;
            const answer = decodeControl(buffer.subarray(2, 2 + n));
            if (answer.type !== "pong") throw new Error(`answered with ${answer.type}, not a pong`);
            return { ms, server: answer.server };
          }
        }
        const { done, value } = await reader.read();
        if (done) throw new Error("no answer");
        const joined = new Uint8Array(buffer.byteLength + value.byteLength);
        joined.set(buffer);
        joined.set(value, buffer.byteLength);
        buffer = joined;
      }
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
