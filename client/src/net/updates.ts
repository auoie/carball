// The server splits a large world update into parts (one datagram each). Each part is a complete network state for
// some of the bodies, so a part that never arrives costs only its bodies that update: the parts that did come still
// apply (flush, at the end of the client's frame: an update's parts are sent together, so one that misses the frame is
// as good as lost). As the game, where actors replicate independently (notes/netcode-audit.md N-3): an older update's
// parts and a late part still apply (their bodies may hold nothing newer; the predictor keeps every applied state in
// its history, so an older one can't undo a newer one: NR-6).
import type { Update } from "./protocol";

export interface CompleteUpdate {
  readonly update: Update; // the first part's header (the same in every part)
  readonly states: readonly Uint8Array[];
}

/** Server ticks remembered for dropping duplicate parts */
const SEEN_TICKS = 256;

/** Collects update parts; yields each update once all its parts are in, and on flush() the parts in of incomplete ones.
 *  A part of an update already yielded (late) is yielded on its own; a part already yielded is dropped. */
export class UpdateAssembler {
  readonly #pending = new Map<number, { update: Update; states: (Uint8Array | undefined)[]; received: number }>();
  readonly #yielded = new Map<number, Set<number>>(); // server tick -> parts yielded
  #lastTick = -1;

  /** The updates this part completes: older incomplete ones with the parts they have, oldest first, then its own */
  add(u: Update): CompleteUpdate[] {
    if (u.part >= u.parts || this.#yielded.get(u.serverTick)?.has(u.part)) return [];
    if (u.serverTick <= this.#lastTick && !this.#pending.has(u.serverTick)) {
      this.#markYielded(u.serverTick, [u.part]);
      return [{ update: u, states: [u.state] }]; // (late: its update was yielded without it)
    }
    let pending = this.#pending.get(u.serverTick);
    if (!pending) {
      pending = { update: u, states: new Array<Uint8Array | undefined>(u.parts).fill(undefined), received: 0 };
      this.#pending.set(u.serverTick, pending);
    }
    if (pending.states.length !== u.parts || pending.states[u.part]) return [];
    pending.states[u.part] = u.state;
    pending.received++;
    if (pending.received < u.parts) return [];

    const ready = [...this.#pending.entries()].filter(([tick]) => tick <= u.serverTick).sort(([a], [b]) => a - b);
    this.#lastTick = Math.max(this.#lastTick, u.serverTick);
    return ready.map(([tick]) => this.#take(tick));
  }

  /** The updates still missing a part, oldest first, with the parts that came (and forgets them). */
  flush(): CompleteUpdate[] {
    const ticks = [...this.#pending.keys()].sort((a, b) => a - b);
    const last = ticks.at(-1);
    if (last !== undefined) this.#lastTick = Math.max(this.#lastTick, last);
    return ticks.map((tick) => this.#take(tick));
  }

  #take(tick: number): CompleteUpdate {
    const p = this.#pending.get(tick);
    this.#pending.delete(tick);
    if (!p) throw new Error("updates: no pending update");
    const parts = p.states.flatMap((s, i) => (s ? [i] : []));
    this.#markYielded(tick, parts);
    return { update: p.update, states: p.states.filter((s) => s !== undefined) };
  }

  #markYielded(tick: number, parts: readonly number[]): void {
    const seen = this.#yielded.get(tick) ?? new Set<number>();
    for (const part of parts) seen.add(part);
    this.#yielded.set(tick, seen);
    for (const old of this.#yielded.keys()) if (old < this.#lastTick - SEEN_TICKS) this.#yielded.delete(old);
  }
}
