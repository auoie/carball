// The server splits a large world update into parts (one datagram each); a correction needs all of them.
import type { Update } from "./protocol";

export interface CompleteUpdate {
  readonly update: Update; // the first part's header (the same in every part)
  readonly states: readonly Uint8Array[];
}

/** Collects update parts; yields each update once all its parts are in. Updates older than one already yielded are dropped. */
export class UpdateAssembler {
  readonly #pending = new Map<number, { update: Update; states: (Uint8Array | undefined)[]; received: number }>();
  #lastTick = -1;

  add(u: Update): CompleteUpdate | null {
    if (u.serverTick <= this.#lastTick || u.part >= u.parts) return null;
    let pending = this.#pending.get(u.serverTick);
    if (!pending) {
      pending = { update: u, states: new Array<Uint8Array | undefined>(u.parts).fill(undefined), received: 0 };
      this.#pending.set(u.serverTick, pending);
    }
    if (pending.states.length !== u.parts || pending.states[u.part]) return null;
    pending.states[u.part] = u.state;
    pending.received++;
    if (pending.received < u.parts) return null;

    this.#lastTick = u.serverTick;
    for (const tick of this.#pending.keys()) if (tick <= u.serverTick) this.#pending.delete(tick); // incl. lost-part leftovers
    return { update: pending.update, states: pending.states.filter((s) => s !== undefined) };
  }
}
