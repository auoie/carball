// The local host (an offline match against bots): the server's own match, built to WebAssembly (server/src/bin/host.rs),
// behind typed calls. Its players' bytes go in as WebTransport would carry them (a control stream's framed messages, input
// datagrams) and come out per player (`drain`); a bot's controls go straight to its car, its view is the whole match's
// snapshot (`state`, as a welcome's). Used by the worker (local/hostWorker.ts) and the tests, in Node.
import type { HostModule } from "@host/carball_host.mjs";

/** What the host sends a player: a control message (framed), a datagram, or the end of its stream (the game let it go) */
export type HostMessage =
  | { readonly id: number; readonly kind: "control"; readonly bytes: Uint8Array }
  | { readonly id: number; readonly kind: "datagram"; readonly bytes: Uint8Array }
  | { readonly id: number; readonly kind: "end" };

/** A bot's controls (as the engine's: axes -1..1, throttle too; buttons held) */
/** A player's input buffer counters on the host (server/src/input_buffer.rs Stats) */
export interface InputStats {
  readonly consumed: number;
  readonly neverConsumed: number;
  readonly over: number;
  readonly under: number;
  readonly fillSkips: number;
  readonly duplicates: number;
  readonly late: number;
  readonly trimmed: number;
}

export interface BotControls {
  readonly throttle: number;
  readonly steer: number;
  readonly pitch: number;
  readonly yaw: number;
  readonly roll: number;
  readonly jump: boolean;
  readonly boost: boolean;
  readonly handbrake: boolean;
}

const KINDS = ["control", "datagram", "end"] as const;

export class LocalHost {
  readonly #m: HostModule;
  /** A buffer in the module for bytes going in, grown as needed */
  #scratch = 0;
  #scratchSize = 0;

  private constructor(module: HostModule) {
    this.#m = module;
  }

  /** The host's module set up with the arena's collision meshes (the client's, in name order) */
  static create(module: HostModule, meshes: readonly Uint8Array[]): LocalHost {
    module.FS.mkdir("/meshes");
    module.FS.mkdir("/meshes/arena");
    meshes.forEach((bytes, i) => {
      module.FS.writeFile(`/meshes/arena/${String(i).padStart(3, "0")}.cmf`, bytes);
    });
    const dir = module.stringToNewUTF8("/meshes");
    const ok = module._host_init(dir);
    module._free(dir);
    if (ok !== 1) throw new Error("the local host's engine didn't start (its arena meshes)");
    return new LocalHost(module);
  }

  /** A new open match (on Night, the one map): `teamSize` a side, the kickoff orders from `seed`; its
   *  clock from 0 s */
  open(teamSize: number, seed: number): void {
    this.#m._host_open(teamSize, seed);
  }

  connect(id: number): void {
    this.#m._host_connect(id);
  }

  /** Bytes on a player's control stream (its hello first) */
  control(id: number, bytes: Uint8Array, now: number): void {
    const at = this.#in(bytes);
    this.#m._host_control(id, at, bytes.byteLength, now);
  }

  datagram(id: number, bytes: Uint8Array, now: number): void {
    const at = this.#in(bytes);
    this.#m._host_datagram(id, at, bytes.byteLength, now);
  }

  leave(id: number): void {
    this.#m._host_leave(id);
  }

  /** The ticks due by `now` s */
  tick(now: number): void {
    this.#m._host_tick(now);
  }

  /** When the next tick is due (s), or null with no match running */
  nextTick(): number | null {
    const at = this.#m._host_next_tick();
    return at < 0 ? null : at;
  }

  /** Every player's messages since the last drain, in order */
  drain(): HostMessage[] {
    const length = this.#m._host_drain();
    if (length === 0) return [];
    const bytes = this.#m.HEAPU8.slice(this.#m._host_drained(), this.#m._host_drained() + length);
    const view = new DataView(bytes.buffer);
    const messages: HostMessage[] = [];
    for (let at = 0; at + 9 <= length;) {
      const id = view.getUint32(at, true);
      const kind = KINDS[view.getUint8(at + 4)];
      const size = view.getUint32(at + 5, true);
      const body = bytes.subarray(at + 9, at + 9 + size);
      at += 9 + size;
      if (kind === "end") messages.push({ id, kind });
      else if (kind !== undefined) messages.push({ id, kind, bytes: body });
    }
    return messages;
  }

  /** A bot's controls from the next tick on (its first makes the player a bot) */
  bot(id: number, c: BotControls): void {
    this.#m._host_bot(id, c.throttle, c.steer, c.pitch, c.yaw, c.roll, c.jump ? 1 : 0, c.boost ? 1 : 0, c.handbrake ? 1 : 0);
  }

  /** The car a player drives, or null */
  car(id: number): number | null {
    const car = this.#m._host_car(id);
    return car < 0 ? null : car;
  }

  /** The phase of a player's match (protocol's Phase as its number: 0 the countdown, 1 play, 4 pre-podium, 7 podium, 8
   *  finished), or null */
  phase(id: number): number | null {
    const phase = this.#m._host_phase(id);
    return phase < 0 ? null : phase;
  }

  /** The goals of each team (blue, orange) in a player's match, or null */
  score(id: number): readonly [number, number] | null {
    const blue = this.#m._host_score(id, 0);
    const orange = this.#m._host_score(id, 1);
    return blue < 0 || orange < 0 ? null : [blue, orange];
  }

  /** A player's input buffer counters on the host (the network tests'), or null for no such player */
  inputStats(id: number): InputStats | null {
    const read = (which: number): number => this.#m._host_input_stat(id, which);
    if (read(0) < 0) return null;
    const [consumed, neverConsumed, over, under, fillSkips, duplicates, late, trimmed] = [0, 1, 2, 3, 4, 5, 6, 7].map(read);
    return {
      consumed: consumed ?? 0,
      neverConsumed: neverConsumed ?? 0,
      over: over ?? 0,
      under: under ?? 0,
      fillSkips: fillSkips ?? 0,
      duplicates: duplicates ?? 0,
      late: late ?? 0,
      trimmed: trimmed ?? 0,
    };
  }

  /** The whole match's state as a welcome's snapshot (World.loadState); empty for no such player */
  state(id: number): Uint8Array {
    const length = this.#m._host_state(id);
    const at = this.#m._host_state_bytes();
    return this.#m.HEAPU8.slice(at, at + length);
  }

  #in(bytes: Uint8Array): number {
    if (bytes.byteLength > this.#scratchSize) {
      if (this.#scratch !== 0) this.#m._free(this.#scratch);
      this.#scratchSize = Math.max(1024, bytes.byteLength * 2);
      this.#scratch = this.#m._malloc(this.#scratchSize);
    }
    this.#m.HEAPU8.set(bytes, this.#scratch);
    return this.#scratch;
  }
}
