// The action parsers a bot package can name (ours, from FORMAT.md): the policy's logits picked (bots/manifest.ts's beta)
// and read as controls [throttle, steer, pitch, yaw, roll, jump, boost, handbrake], buttons pressed past 0.
// lookup-v1: one pick over the rows of the package's table; multidiscrete-v1: one pick per head (the logits the heads
// concatenated), each control the product of its factors' values at their heads' picks.
import type { BotControls } from "../local/host";
import type { Controls8, MultiDiscreteAction } from "./manifest";

/** A pick of `logits[from, from + count)` at `beta` (1 argmax, ties to the lowest; -1 argmin; 0 uniform; else drawn from
 *  the softmax of logits · log₃((1 + β) / (1 − β))), `random` in [0, 1) */
export function pickIndex(logits: ArrayLike<number>, beta: number, random: number, from = 0, count = logits.length - from): number {
  const at = (i: number): number => logits[from + i] ?? -Infinity;
  if (beta >= 1 || beta <= -1) {
    const sign = beta >= 1 ? 1 : -1;
    let best = 0;
    for (let i = 1; i < count; i++) if (sign * at(i) > sign * at(best)) best = i;
    return best;
  }
  if (beta === 0) return Math.min(count - 1, Math.floor(random * count));
  const scale = Math.log((1 + beta) / (1 - beta)) / Math.log(3);
  let most = -Infinity;
  for (let i = 0; i < count; i++) most = Math.max(most, at(i) * scale);
  const weights = Array.from({ length: count }, (_, i) => Math.exp(at(i) * scale - most));
  let left = random * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < count; i++) {
    left -= weights[i] ?? 0;
    if (left < 0) return i;
  }
  return count - 1;
}

/** A row as controls (buttons pressed when over 0) */
export function rowControls(row: Controls8): BotControls {
  const [throttle, steer, pitch, yaw, roll, jump, boost, handbrake] = row;
  return { throttle, steer, pitch, yaw, roll, jump: jump > 0, boost: boost > 0, handbrake: handbrake > 0 };
}

/** What a parser makes of the logits: its pick (a row, or one per head) and the controls' row */
export interface Parsed {
  readonly pick: number | readonly number[];
  readonly row: Controls8;
}

/** `allowed`: a mask's rows (the others' logits pushed to DISABLED_LOGIT before the pick; none allowed: all) */
export type ActionParser = (logits: ArrayLike<number>, beta: number, random: () => number, allowed?: readonly boolean[]) => Parsed;

/** A masked-off row's logit (Wisp's model.py) */
export const DISABLED_LOGIT = Math.fround(-1e10);

/** The logits with the rows a mask doesn't allow pushed down (none allowed: all, as given) */
export function maskLogits(logits: ArrayLike<number>, allowed: readonly boolean[] | undefined): ArrayLike<number> {
  if (!allowed?.some((a) => a)) return logits;
  return Float32Array.from({ length: logits.length }, (_, i) => (allowed[i] ? (logits[i] ?? DISABLED_LOGIT) : DISABLED_LOGIT));
}

/** lookup-v1: a row of the table */
export function lookupParser(table: readonly Controls8[]): ActionParser {
  return (logits, beta, random, allowed) => {
    const pick = pickIndex(maskLogits(logits, allowed), beta, random(), 0, table.length);
    const row = table[pick];
    if (!row) throw new Error(`action ${String(pick)} outside its table of ${String(table.length)}`);
    return { pick, row };
  };
}

const COLUMNS = ["throttle", "steer", "pitch", "yaw", "roll", "jump", "boost", "handbrake"] as const;

/** multidiscrete-v1: a pick per head, each control its factors' product */
export function multiDiscreteParser(action: MultiDiscreteAction): ActionParser {
  return (logits, beta, random) => {
    const picks: number[] = [];
    let from = 0;
    for (const size of action.heads) {
      picks.push(pickIndex(logits, beta, random(), from, size));
      from += size;
    }
    const value = (column: string): number => {
      const factors = action.controls[column] ?? [];
      if (factors.length === 0) return 0;
      return factors.reduce((product, f) => product * (f.values[picks[f.head] ?? 0] ?? 0), 1);
    };
    const row = COLUMNS.map(value) as unknown as Controls8;
    return { pick: picks, row };
  };
}

export function parseTable(json: unknown): Controls8[] | string {
  if (!Array.isArray(json) || json.length === 0) return "an empty table";
  const rows = json as unknown[];
  if (!rows.every((r) => Array.isArray(r) && r.length === 8 && r.every((v) => typeof v === "number" && Number.isFinite(v)))) return "a row not 8 numbers";
  return rows as Controls8[];
}
