// The local host's worker: the server's own match (local/host.ts) on its own clock, the bots deciding before the ticks
// they're due, and the page's player (PAGE_PLAYER) as its one remote client, through messages (local/hostMessages.ts)
// instead of WebTransport. Ticks run at the match's own times (120 Hz, slower in a goal's slow motion), each exactly
// once; what the host sends the page goes out after each pass, a batch at a time.
import createEngine from "@engine/carball_engine_web.mjs";
import createHost from "@host/carball_host.mjs";
import { World, initEngine } from "../engine/world";
import { LocalHost } from "./host";
import { type BotBrain, LocalBots, chaser } from "./bots";
import { type FromHost, PAGE_PLAYER, type PageMessage, type ToHost } from "./hostMessages";
import { loadBrain } from "../bots/registry";

/** At most this many ticks a pass (a long stall catches up over a few passes, the page's updates going out between) */
const TICKS_PER_PASS = 12;

const post = (message: FromHost, transfer: Transferable[] = []): void => {
  (self as unknown as Worker).postMessage(message, transfer);
};

let host: LocalHost | null = null;
let bots: LocalBots | null = null;
const start = performance.now();
const now = (): number => (performance.now() - start) / 1000;

async function open(message: Extract<ToHost, { type: "open" }>): Promise<void> {
  // (the host's log lines, the server's stderr, as the page's debug messages: not errors)
  const [hostModule, engine] = await Promise.all([createHost({ printErr: (text) => { console.debug(`local host: ${text}`); } }), createEngine()]);
  initEngine(engine, message.meshes);
  const h = LocalHost.create(hostModule, message.meshes);
  h.open(message.setup.teamSize, message.setup.seed);
  const b = new LocalBots(World.create(engine), message.setup.teamSize * 2);
  // (each bot's brain: its package's policy, or the built-in chaser)
  const brains: BotBrain[] = await Promise.all(message.setup.bots.map(async (slot) => (slot.brain === "chaser" ? chaser() : loadBrain(message.botsBase, slot.brain, message.setup.teamSize, fetch, Math.random, undefined, slot.strength))));
  message.setup.bots.forEach((slot, i) => {
    const brain = brains[i];
    if (brain) b.join(h, PAGE_PLAYER + 1 + i, slot, brain, now());
  });
  host = h;
  bots = b;
  post({ type: "ready" });
  // (the host failing mid-match: the page told, its session closes)
  run().catch((e: unknown) => {
    post({ type: "failed", reason: e instanceof Error ? e.message : String(e) });
  });
}

/** The match's ticks as they come due, the bots' decisions before theirs; the page's messages after each pass */
async function run(): Promise<void> {
  for (;;) {
    const h = host;
    const b = bots;
    if (!h || !b) return;
    let next = h.nextTick();
    for (let n = 0; next !== null && next <= now() && n < TICKS_PER_PASS; n++) {
      await b.beforeTick(h);
      h.tick(next);
      next = h.nextTick();
    }
    flush(h);
    const wait = next === null ? 50 : Math.max(0, (next - now()) * 1000);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** What the host sent the page's player since the last pass (the bots' own messages read and dropped) */
function flush(h: LocalHost): void {
  const messages: PageMessage[] = [];
  const transfer: Transferable[] = [];
  for (const m of h.drain()) {
    if (m.id !== PAGE_PLAYER) continue;
    if (m.kind === "end") {
      messages.push({ kind: "end" });
    } else {
      // (each its own copy: the drained messages share one buffer, which can be handed over once)
      const bytes = m.bytes.slice();
      messages.push({ kind: m.kind, bytes });
      transfer.push(bytes.buffer);
    }
  }
  if (messages.length > 0) post({ type: "out", messages }, transfer);
}

self.onmessage = (event: MessageEvent<ToHost>) => {
  const message = event.data;
  if (message.type === "open") {
    open(message).catch((e: unknown) => {
      post({ type: "failed", reason: e instanceof Error ? e.message : String(e) });
    });
    return;
  }
  const h = host;
  if (!h) return;
  switch (message.type) {
    case "connect":
      h.connect(PAGE_PLAYER);
      break;
    case "control":
      h.control(PAGE_PLAYER, message.bytes, now());
      break;
    case "datagram":
      h.datagram(PAGE_PLAYER, message.bytes, now());
      break;
    case "leave":
      h.leave(PAGE_PLAYER);
      host = null;
      bots = null;
      break;
  }
};
