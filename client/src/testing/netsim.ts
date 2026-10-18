// A simulated network path for the network tests (notes/netcode-live.md §13.0), the twin of server/src/netsim.rs: each
// packet sent arrives after a delay (a base, jitter: normal or AR(1), path stalls that hold back what is sent during
// them), is lost (i.i.d. or Gilbert–Elliott), or arrives twice; reordering comes from the delays. Seeded and
// deterministic: the same seed and profile give the same deliveries as the Rust one (netsim.vectors.json, written by
// its tests, checks it).

const MASK64 = (1n << 64n) - 1n;

/** PCG32 (XSH RR, 64-bit state) */
export class Pcg32 {
  #state = 0n;
  readonly #inc: bigint;

  constructor(seed: bigint, stream: bigint) {
    this.#inc = ((stream << 1n) | 1n) & MASK64;
    this.nextU32();
    this.#state = (this.#state + seed) & MASK64;
    this.nextU32();
  }

  nextU32(): number {
    const old = this.#state;
    this.#state = (old * 6364136223846793005n + this.#inc) & MASK64;
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0;
  }

  /** Uniform in [0, 1) */
  uniform(): number {
    return this.nextU32() / 4294967296;
  }

  /** Standard normal (Box–Muller, one of the pair) */
  normal(): number {
    const u1 = 1 - this.uniform();
    const u2 = this.uniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

export type Jitter =
  { readonly kind: "none" } | { readonly kind: "normal"; readonly sigmaMs: number } | { readonly kind: "ar1"; readonly sigmaMs: number; readonly rho: number };
export type Loss =
  | { readonly kind: "none" }
  | { readonly kind: "iid"; readonly p: number }
  | { readonly kind: "gilbertElliott"; readonly pGb: number; readonly pBg: number; readonly lossGood: number; readonly lossBad: number };

/** The path stalls from `atS` for `ms`, then every `everyS` (0: once) */
export interface Stall {
  readonly atS: number;
  readonly ms: number;
  readonly everyS: number;
}

export interface Profile {
  readonly baseMs: number;
  readonly jitter: Jitter;
  readonly loss: Loss;
  readonly duplicate: number;
  readonly stalls: readonly Stall[];
  /** Everything sent in these spans lost (an outage; TypeScript only: after the draws, so the Rust twin's vectors hold) */
  readonly outages?: readonly { readonly atS: number; readonly ms: number }[];
}

/** A constant delay */
export function constantProfile(baseMs: number): Profile {
  return { baseMs, jitter: { kind: "none" }, loss: { kind: "none" }, duplicate: 0, stalls: [] };
}

export class NetSim {
  readonly #rng: Pcg32;
  #ar = 0;
  #bad = false;

  constructor(
    readonly profile: Profile,
    seed: number,
  ) {
    this.#rng = new Pcg32(BigInt(seed), 54n);
  }

  #stalledUntil(t: number): number | null {
    for (const s of this.profile.stalls) {
      let start = s.atS;
      for (;;) {
        const end = start + s.ms / 1000;
        if (t >= start && t < end) return end;
        if (s.everyS <= 0 || start > t) break;
        start += s.everyS;
      }
    }
    return null;
  }

  /** A packet sent at `t` (s): when its copies arrive (none: lost; two: duplicated). The draws in the Rust one's order */
  send(t: number): number[] {
    const lossDraw = this.#rng.uniform();
    const jitterDraw = this.#rng.normal();
    const dupDraw = this.#rng.uniform();
    const dupJitter = this.#rng.normal();
    const loss = this.profile.loss;
    let lost = false;
    if (loss.kind === "iid") lost = lossDraw < loss.p;
    else if (loss.kind === "gilbertElliott") {
      const scaled = lossDraw * 1024;
      const moveDraw = scaled - Math.trunc(scaled);
      if (this.#bad) {
        if (moveDraw < loss.pBg) this.#bad = false;
      } else if (moveDraw < loss.pGb) this.#bad = true;
      lost = lossDraw < (this.#bad ? loss.lossBad : loss.lossGood);
    }
    const jitter = this.profile.jitter;
    let jitterMs = 0;
    if (jitter.kind === "normal") jitterMs = jitter.sigmaMs * jitterDraw;
    else if (jitter.kind === "ar1") {
      this.#ar = jitter.rho * this.#ar + Math.sqrt(1 - jitter.rho * jitter.rho) * jitter.sigmaMs * jitterDraw;
      jitterMs = this.#ar;
    }
    if (lost || (this.profile.outages ?? []).some((o) => t >= o.atS && t < o.atS + o.ms / 1000)) return [];
    const depart = this.#stalledUntil(t) ?? t;
    const arrive = (j: number): number => depart + Math.max(0, this.profile.baseMs + j) / 1000;
    const out = [arrive(jitterMs)];
    if (dupDraw < this.profile.duplicate) {
      const extra = jitter.kind === "none" ? 0 : jitter.sigmaMs * dupJitter;
      out.push(arrive(jitterMs + Math.abs(extra)));
    }
    return out;
  }
}
