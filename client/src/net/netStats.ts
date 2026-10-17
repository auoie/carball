// The stat graphs' network and input-buffer rows fed (notes/hud-menus.md HUD-21, SG2; protocol 24): raw counts per
// 1-second period (packets each way, lost packets each way, a count, not a share, bytes each way: the graph steps once a
// second), the latency (the raw round trip, not the ping's smoothed one), and the server's input-buffer window from each
// update (IBuf's fewest and most frames, its target, IBuf Miss's frames skipped less ticks without one). Offline the
// network and input-buffer rows read 0.
import type { StatGraphData, StatTitle } from "../game/statGraphs";
import type { Update } from "./protocol";

/** Packets a second each way as sent (the input send clock's 60 a second; the server's update every 2 of its 120
 *  ticks): the Pkt rows' bases */
export const EXPECTED_PACKETS = { out: 60, in: 60 } as const;
/** Server ticks per update (game.rs UPDATE_EVERY_TICKS) */
const UPDATE_EVERY_TICKS = 2;
/** A gap longer than this (server ticks: 1.5 s) is a pause, not loss: the server holding back from a client it hasn't
 *  heard (G8), a stalled tab (RV-516) */
const PAUSE_TICKS = 180;
/** An update datagram's bytes before its state (protocol 24: its type, the ticks and frames, the echo, the buffer's
 *  target, size and window, the part and parts: 28, RV-520) */
export const UPDATE_HEADER_BYTES = 28;

const NET_ROWS: readonly StatTitle[] = ["Out Pkt", "In Pkt", "Out Loss", "In Loss", "Out Bytes", "In Bytes", "Latency", "IBuf", "IBuf Target", "IBuf Miss", "Phys Rate"];

export class NetGraphFeed {
  #periodStart: number | null = null;
  #counts = { outPkt: 0, inPkt: 0, outBytes: 0, inBytes: 0, outLoss: 0, inLoss: 0 };
  /** The newest update read (its first part to arrive gives its window: a lost part 0 doesn't lose it, RV-522) */
  #lastTick: number | null = null;

  constructor(private readonly data: StatGraphData) {}

  /** Offline: the network and input-buffer rows read 0 */
  static offline(data: StatGraphData): void {
    for (const title of NET_ROWS) data.set(title, 0);
  }

  /** An input datagram sent, `bytes` long */
  sent(bytes: number): void {
    this.#counts.outPkt++;
    this.#counts.outBytes += bytes;
  }

  /** An update part arrived; `rtt`: its raw round trip (ms; null without an echo) */
  received(u: Update, rtt: number | null): void {
    this.#counts.inPkt++;
    this.#counts.inBytes += u.state.length + UPDATE_HEADER_BYTES;
    if (this.#lastTick !== null && u.serverTick <= this.#lastTick) return;
    // (the updates the server sent between this one and the last, not here: In Loss; a longer gap a pause)
    const gap = this.#lastTick === null ? 0 : u.serverTick - this.#lastTick;
    if (gap <= PAUSE_TICKS) this.#counts.inLoss += Math.max(0, Math.round(gap / UPDATE_EVERY_TICKS) - 1);
    this.#lastTick = u.serverTick;
    this.#counts.outLoss += u.inputLoss;
    const d = this.data;
    if (rtt !== null) d.set("Latency", rtt);
    d.set("IBuf", [u.bufferLow, u.bufferHigh]);
    d.set("IBuf Target", u.bufferTarget);
    d.set("IBuf Miss", u.bufferOver - u.bufferUnder);
    // (the server's fixed 120: the game's physics rate)
    d.set("Phys Rate", 120);
  }

  /** Each frame at `now` (s): a second's period ended, its counts the rows' values till the next */
  frame(now: number): void {
    if (this.#periodStart === null || now - this.#periodStart >= 2) {
      // (the first frame, or after a stall: a new period from now)
      if (this.#periodStart !== null) this.#flush();
      this.#periodStart = now;
      return;
    }
    if (now - this.#periodStart < 1) return;
    this.#flush();
    this.#periodStart += 1;
  }

  #flush(): void {
    const c = this.#counts;
    const d = this.data;
    d.set("Out Pkt", c.outPkt);
    d.set("In Pkt", c.inPkt);
    d.set("Out Bytes", c.outBytes);
    d.set("In Bytes", c.inBytes);
    d.set("Out Loss", c.outLoss);
    d.set("In Loss", c.inLoss);
    this.#counts = { outPkt: 0, inPkt: 0, outBytes: 0, inBytes: 0, outLoss: 0, inLoss: 0 };
  }
}

/** An update's raw round trip at its arrival (ms: now less the echoed input's stamp and the server's hold), null
 *  without an echo or out of reason */
export function rawRoundTrip(u: Pick<Update, "echoTimestamp" | "echoDelay">, nowMs: number): number | null {
  if (u.echoTimestamp <= 0) return null;
  const rtt = ((Math.round(nowMs) - u.echoTimestamp) >>> 0) - u.echoDelay;
  return rtt >= 0 && rtt < 10_000 ? rtt : null;
}
