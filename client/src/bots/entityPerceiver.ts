// The observation builder "entity-perceiver-v1" (ours, from the packages' nexto/SPEC.md §2 and necto/SPEC.md §2; checked
// against their vectors): a query (the bot's own row and its previous action, 32 floats) and a row of 24 per entity (every
// car, the ball, the 34 pads in the bot's pad order), built in float64 and handed over as float32. Orange sees the field
// mirrored. Its tracker steps on every call: a car's ticks off the ground (on_ground holds for the first 6 of them);
// has_flip is no second jump or dodge since landing (rlgym-compat 1.0.2, no timer). The variants: Nexto's rows relative
// to the bot and turned to its heading, its column 21 demolished / pad up; Necto's ball first, rows relative in position
// and velocity alone, its column 21 the shipped sawtooth timers (advanced once a decision, from the bot's start).
import type { BotView } from "../local/bots";
import type { BotManifest, Controls8 } from "./manifest";
import type { ObservationBuilder } from "./observations";

/** The constants a package gives this builder (bot.json observation) */
interface Constants {
  readonly variant: "nexto" | "necto";
  readonly norm: { readonly pos: number; readonly vel: number; readonly angVel: number };
  readonly boostScale: number;
  readonly padTable: readonly (readonly [number, number, number])[];
  readonly padBotFromOur: readonly number[];
  readonly padBoost: { readonly small: number; readonly big: number };
  readonly tracker: { readonly onGroundGraceTicks: number };
  readonly timers?: {
    readonly stepPerDecision: { readonly demo: number; readonly pad: number };
    readonly demoStart: number;
    readonly demoScale: number;
    readonly padStart: { readonly small: number; readonly big: number };
  };
}

const COLUMNS = 24;
/** The vectors' columns: position, velocity, forward, up, angular velocity (each x, y, z) */
const POS = 5;
const VEL = 8;
const FWD = 11;
const UP = 14;
const ANG = 17;
const VECTORS = [POS, VEL, FWD, UP, ANG] as const;

/** A big pad: the table's z over 72 */
const BIG_Z = 72;

function constants(manifest: BotManifest): Constants {
  const variant: unknown = manifest.observation["variant"];
  const o = manifest.observation as unknown as Constants;
  if ((variant !== "nexto" && variant !== "necto") || o.padTable.length !== 34 || o.padBotFromOur.length !== 34) throw new Error(`bot ${manifest.id}: its entity-perceiver constants`);
  if (o.variant === "necto" && !o.timers) throw new Error(`bot ${manifest.id}: Necto's timers`);
  return o;
}

/** The builder's per-car tracker and has_flip, as the vectors' `derived` show them */
export interface PerceiverDerived {
  readonly onGround: readonly boolean[];
  readonly hasFlip: readonly boolean[];
  readonly groundTicks: readonly number[];
}

export function entityPerceiver(manifest: BotManifest): ObservationBuilder & { derived(view: BotView): PerceiverDerived; order(view: BotView): number[] } {
  const c = constants(manifest);
  const groundTicks: number[] = [];
  /** Necto's timers: per car index, per bot pad; started at the first decision */
  const demoTimers: number[] = [];
  const padTimers: number[] = new Array<number>(34).fill(0);

  const onGround = (view: BotView, i: number): boolean => (view.state.cars[i]?.onGround ?? false) || (groundTicks[i] ?? 0) <= c.tracker.onGroundGraceTicks;
  const hasFlip = (view: BotView, i: number): boolean => {
    const car = view.state.cars[i];
    return !(car?.doubleJumped === true || car?.hasFlipped === true);
  };

  /** The cars in the bot's order: itself, its mates, its opponents (each in index order) */
  const carOrder = (view: BotView): number[] => {
    const me = view.state.cars[view.self];
    const others = view.state.cars.map((_, i) => i).filter((i) => i !== view.self);
    const mates = others.filter((i) => view.state.cars[i]?.team === me?.team);
    const opponents = others.filter((i) => view.state.cars[i]?.team !== me?.team);
    return [view.self, ...mates, ...opponents];
  };

  return {
    track(view) {
      view.state.cars.forEach((car, i) => {
        groundTicks[i] = car.onGround ? 0 : (groundTicks[i] ?? 0) + 1;
      });
    },

    derived(view) {
      const cars = view.state.cars.map((_, i) => i);
      return { onGround: cars.map((i) => onGround(view, i)), hasFlip: cars.map((i) => hasFlip(view, i)), groundTicks: cars.map((i) => groundTicks[i] ?? 0) };
    },

    order: carOrder,

    build(view, previous: Controls8) {
      const { state } = view;
      const me = state.cars[view.self];
      if (!me) throw new Error("a bot without its car");
      // (Necto's timers, advanced once a decision for every car and pad)
      const demoColumn: number[] = [];
      const padColumn: number[] = [];
      if (c.timers) {
        const t = c.timers;
        state.cars.forEach((_, i) => {
          const timer = demoTimers[i] ?? 0;
          demoTimers[i] = timer <= 0 ? t.demoStart : Math.max(timer - t.stepPerDecision.demo, 0);
          demoColumn[i] = (demoTimers[i] ?? 0) * t.demoScale;
        });
        for (let k = 0; k < 34; k++) {
          const active = state.pads[c.padBotFromOur[k] ?? -1]?.active === true ? 1 : 0;
          const big = (c.padTable[k]?.[2] ?? 0) > BIG_Z;
          let timer = padTimers[k] ?? 0;
          if (active === 1 && timer === 0) timer = big ? t.padStart.big : t.padStart.small;
          timer *= active;
          padColumn[k] = timer;
          timer -= t.stepPerDecision.pad;
          padTimers[k] = timer < 0 ? 0 : timer;
        }
      }
      const carRow = (i: number): number[] => {
        const car = state.cars[i];
        const row = new Array<number>(COLUMNS).fill(0);
        if (!car) return row;
        row[0] = i === view.self ? 1 : 0;
        row[1] = car.team === 0 ? 1 : 0;
        row[2] = car.team === 1 ? 1 : 0;
        const put = (at: number, v: { x: number; y: number; z: number }): void => {
          row[at] = v.x;
          row[at + 1] = v.y;
          row[at + 2] = v.z;
        };
        put(POS, car.pos);
        put(VEL, car.vel);
        put(FWD, car.rot.forward);
        put(UP, car.rot.up);
        put(ANG, car.angVel);
        row[20] = car.boost * c.boostScale;
        row[21] = c.variant === "necto" ? (demoColumn[i] ?? 0) : car.demoed ? 1 : 0;
        row[22] = onGround(view, i) ? 1 : 0;
        row[23] = hasFlip(view, i) ? 1 : 0;
        return row;
      };
      const ballRow = (): number[] => {
        const row = new Array<number>(COLUMNS).fill(0);
        row[3] = 1;
        [state.ball.pos.x, state.ball.pos.y, state.ball.pos.z].forEach((v, j) => (row[POS + j] = v));
        [state.ball.vel.x, state.ball.vel.y, state.ball.vel.z].forEach((v, j) => (row[VEL + j] = v));
        [state.ball.angVel.x, state.ball.angVel.y, state.ball.angVel.z].forEach((v, j) => (row[ANG + j] = v));
        return row;
      };
      const padRow = (k: number): number[] => {
        const row = new Array<number>(COLUMNS).fill(0);
        const [x, y, z] = c.padTable[k] ?? [0, 0, 0];
        row[4] = 1;
        row[POS] = x;
        row[POS + 1] = y;
        row[POS + 2] = z;
        row[20] = z > BIG_Z ? c.padBoost.big : c.padBoost.small;
        row[21] = c.variant === "necto" ? (padColumn[k] ?? 0) : state.pads[c.padBotFromOur[k] ?? -1]?.active === true ? 1 : 0;
        return row;
      };
      const cars = carOrder(view).map(carRow);
      const pads = Array.from({ length: 34 }, (_, k) => padRow(k));
      const rows = c.variant === "nexto" ? [...cars, ballRow(), ...pads] : [ballRow(), ...cars, ...pads];
      // Mirrored for orange: x and y of every vector negated, mate and opponent swapped; then normalised
      for (const row of rows) {
        if (me.team === 1) {
          for (const at of VECTORS) {
            row[at] = -(row[at] ?? 0);
            row[at + 1] = -(row[at + 1] ?? 0);
          }
          [row[1], row[2]] = [row[2] ?? 0, row[1] ?? 0];
        }
        for (let j = 0; j < 3; j++) {
          row[POS + j] = (row[POS + j] ?? 0) / c.norm.pos;
          row[VEL + j] = (row[VEL + j] ?? 0) / c.norm.vel;
          row[ANG + j] = (row[ANG + j] ?? 0) / c.norm.angVel;
        }
      }
      const self = rows[c.variant === "nexto" ? 0 : 1] ?? [];
      const q = [...self, ...previous];
      // The keys relative to the bot: Nexto's position, then every vector turned to its heading; Necto's position and
      // velocity, not turned
      const kv = rows.map((row) => {
        const out = [...row];
        const relative = c.variant === "nexto" ? [POS] : [POS, VEL];
        for (const at of relative) for (let j = 0; j < 3; j++) out[at + j] = (out[at + j] ?? 0) - (q[at + j] ?? 0);
        if (c.variant === "nexto") {
          const theta = Math.atan2(q[FWD] ?? 0, q[FWD + 1] ?? 0);
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          for (const at of VECTORS) {
            const x = out[at] ?? 0;
            const y = out[at + 1] ?? 0;
            out[at] = cos * x - sin * y;
            out[at + 1] = sin * x + cos * y;
          }
        }
        return out;
      });
      return [
        { data: Float32Array.from(q), shape: [1, 1, q.length] },
        { data: Float32Array.from(kv.flat()), shape: [1, kv.length, COLUMNS] },
      ];
    },
  };
}
