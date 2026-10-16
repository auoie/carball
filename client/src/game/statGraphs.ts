// The stat graphs' data (notes/hud-menus.md HUD-21, the static session's SG1 and SG2: StatGraphSystem_TA,
// SampleHistory_TA, GetSummaryValue): each row a ring of 60 samples a second, 10 s deep, each slot the low and high of what
// was sampled in its 1/60 s. Every row is sampled every rendered frame from its current value (the last that arrived, a
// slot repeating it when nothing new comes), visible or not. Its summaries: Latest the newest slot's midpoint, Avg the
// slots' highs over their count, Sum their highs, Min their lowest low, Max their highest high, each over its own age if
// within the window, else the window. The Interface setting's levels pick a group and a window (the Summary levels text
// only over the whole 10 s, short 5 s, long 10 s). Colours judge d = |v - base| against the row's good and bad values. The
// row titles are the game's English literals (the user cleared them for verbatim use, 2026-10-16).
import type { StatGraphs as StatGraphLevel } from "../settings/settings";

/** Samples a second, and seconds kept (600 slots) */
export const SAMPLE_RATE = 60;
export const HISTORY_SECONDS = 10;
const SLOTS = SAMPLE_RATE * HISTORY_SECONDS;

export type SummaryType = "latest" | "avg" | "min" | "max" | "sum";

/** A summary (AddSummary(Type, MaxSampleAge, bAbs)): over the last `age` s (0, or past the window: the window); `abs`
 *  of each value */
export interface Summary {
  readonly type: SummaryType;
  readonly age: number;
  readonly abs?: boolean;
}

/** A slot: its 1/60 s and the low and high of what was sampled in it */
export interface StatSlot {
  readonly tick: number;
  readonly low: number;
  readonly high: number;
}

/** A row's samples (SampleHistory_TA) */
export class SampleHistory {
  readonly #slots: { tick: number; low: number; high: number }[] = Array.from({ length: SLOTS }, () => ({ tick: -1, low: 0, high: 0 }));
  #newest = -1;

  /** A sample (one value, or an envelope) at `now` (s) */
  add(low: number, high: number, now: number): void {
    if (!Number.isFinite(low) || !Number.isFinite(high)) return;
    const tick = Math.floor(now * SAMPLE_RATE);
    const slot = this.#slots[((tick % SLOTS) + SLOTS) % SLOTS];
    if (!slot) return;
    if (slot.tick !== tick) Object.assign(slot, { tick, low, high });
    slot.low = Math.min(slot.low, low);
    slot.high = Math.max(slot.high, high);
    this.#newest = Math.max(this.#newest, tick);
  }

  /** The slots within the last `seconds` before `now`, oldest first */
  slots(now: number, seconds: number): readonly StatSlot[] {
    const tick = Math.floor(now * SAMPLE_RATE);
    const from = tick - Math.min(SLOTS, Math.round(seconds * SAMPLE_RATE)) + 1;
    return this.#slots.filter((s) => s.tick >= 0 && s.tick >= from && s.tick <= tick).sort((a, b) => a.tick - b.tick);
  }

  /** A summary's value at `now` for a level's `window` (s); null without samples */
  summary(s: Summary, now: number, window: number): number | null {
    const v = (x: number): number => (s.abs ? Math.abs(x) : x);
    if (s.type === "latest") {
      const slot = this.#slots[((this.#newest % SLOTS) + SLOTS) % SLOTS];
      return slot && this.#newest >= 0 && slot.tick === this.#newest ? v((slot.low + slot.high) / 2) : null;
    }
    const slots = this.slots(now, s.age > 0 && s.age <= window ? s.age : window);
    if (slots.length === 0) return null;
    switch (s.type) {
      case "avg":
        return slots.reduce((t, x) => t + v(x.high), 0) / slots.length;
      case "sum":
        return slots.reduce((t, x) => t + v(x.high), 0);
      case "min":
        return Math.min(...slots.map((x) => v(x.low)));
      case "max":
        return Math.max(...slots.map((x) => v(x.high)));
    }
  }
}

/** The displays' common refresh rates (Hz) */
const REFRESH_RATES = [30, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240, 360] as const;

/** The target frame rate (SG2: the Max FPS cap; ours has none, so the display's refresh as measured): the median of the
 *  recent frame intervals (ms) as the nearest common rate; 60 before any */
export function measuredRefresh(intervalsMs: readonly number[]): number {
  if (intervalsMs.length === 0) return 60;
  const sorted = [...intervalsMs].sort((a, b) => a - b);
  const rate = 1000 / (sorted[Math.floor(sorted.length / 2)] ?? 1000 / 60);
  return REFRESH_RATES.reduce((best, r) => (Math.abs(r - rate) < Math.abs(best - rate) ? r : best), 60);
}

/** What the rows' values depend on: the target frame rate (the cap, else the display's measured refresh), the
 *  downstream's budget in bytes a second, the packet rates as sent, the speeds' units */
export interface StatContext {
  readonly targetFps: number;
  readonly maxBytesRate: number;
  readonly expectedOutPackets: number;
  readonly expectedInPackets: number;
  readonly metric: boolean;
}

/** A row (the game's script: title, summaries, good and bad values, its range, its base: d = |v - base| is judged);
 *  higher better when good > bad */
export interface StatRow {
  readonly title: string;
  readonly summaries: readonly Summary[];
  readonly good: (c: StatContext) => number;
  readonly bad: (c: StatContext) => number;
  readonly range: (c: StatContext) => readonly [number, number];
  readonly base?: (c: StatContext) => number;
}

const AVG_1S: Summary = { type: "avg", age: 1 };
const LATEST: Summary = { type: "latest", age: 0 };
const MAX: Summary = { type: "max", age: 0 };
const MIN: Summary = { type: "min", age: 0 };

/** A frame's time in ms at the target rate (a frame of slack: 1000 / (target - 1)) */
const goodMs = (c: StatContext): number => 1000 / (c.targetFps - 1);
/** km/h or mph per uu/s (the Metric setting) */
export const speedUnit = (metric: boolean): number => (metric ? 0.036 : 0.0223694);

const ms = (title: string): StatRow => ({
  title,
  summaries: [AVG_1S, MAX],
  good: goodMs,
  bad: (c) => 1.5 * goodMs(c),
  range: () => [0, 50],
});
const speed = (title: string, good: number, bad: number, top: number): StatRow => ({
  title,
  summaries: [LATEST],
  good: (c) => good * speedUnit(c.metric),
  bad: (c) => bad * speedUnit(c.metric),
  range: (c) => [0, top * speedUnit(c.metric)],
});

/** The groups' rows (HUD-21's table; the titles the game's) */
export const STAT_GROUPS = {
  perf: [
    { title: "FPS", summaries: [AVG_1S, { type: "min", age: 1 }], good: (c) => c.targetFps - 1, bad: (c) => 0.8 * c.targetFps, range: (c) => [0, c.targetFps] },
    ms("Frame"),
    ms("Game"),
    ms("Render"),
    ms("GPU"),
  ],
  net: [
    { title: "Out Pkt", summaries: [LATEST, MAX, MIN], good: () => 3, bad: () => 6, range: (c) => [c.expectedOutPackets - 5, c.expectedOutPackets + 5], base: (c) => c.expectedOutPackets },
    { title: "In Pkt", summaries: [LATEST, MAX, MIN], good: () => 3, bad: () => 6, range: (c) => [c.expectedInPackets - 5, c.expectedInPackets + 5], base: (c) => c.expectedInPackets },
    { title: "Out Loss", summaries: [LATEST, MAX], good: () => 1, bad: () => 3, range: () => [0, 5] },
    { title: "In Loss", summaries: [LATEST, MAX], good: () => 1, bad: () => 3, range: () => [0, 5] },
    { title: "Out Bytes", summaries: [LATEST, MAX], good: (c) => 0.75 * c.maxBytesRate, bad: (c) => 0.9 * c.maxBytesRate, range: (c) => [0, c.maxBytesRate] },
    { title: "In Bytes", summaries: [LATEST, MAX], good: (c) => 0.75 * c.maxBytesRate, bad: (c) => 0.9 * c.maxBytesRate, range: (c) => [0, c.maxBytesRate] },
    { title: "Latency", summaries: [AVG_1S, MAX, MIN], good: () => 75, bad: () => 120, range: () => [0, 200] },
  ],
  inputBuffer: [
    { title: "IBuf", summaries: [{ type: "min", age: 1 }, MAX, MIN], good: () => 2, bad: () => 0.01, range: () => [0, 20] },
    { title: "IBuf Target", summaries: [LATEST, MAX], good: () => 4, bad: () => 12, range: () => [0, 20] },
    { title: "IBuf Miss", summaries: [{ type: "sum", age: 0, abs: true }, MAX, MIN], good: () => 0, bad: () => 1, range: () => [-5, 5] },
    { title: "Phys Rate", summaries: [LATEST], good: () => 121.18, bad: () => 999, range: () => [120 * (1 - 0.009), 120 * (1 + 0.009)] },
  ],
  speed: [
    speed("Car Speed", 2200, 2290, 2300),
    speed("Car Speed (XY)", 2200, 2290, 2300),
    speed("Car Speed (Z)", 2200, 2290, 2300),
    speed("Ball Speed", 4000, 5500, 6000),
    speed("Ball Speed (XY)", 4000, 5500, 6000),
    speed("Ball Speed (Z)", 4000, 5500, 6000),
  ],
} as const satisfies Record<string, readonly StatRow[]>;

export type StatGroup = keyof typeof STAT_GROUPS;
export type StatTitle = (typeof STAT_GROUPS)[StatGroup][number]["title"];

/** The summaries' labels (line 0 shows the row's title in the first one's place) */
export const SUMMARY_LABELS: Readonly<Record<SummaryType, string>> = { latest: "Latest", avg: "Avg", min: "Min", max: "Max", sum: "Sum" };

/** A level's groups and window (SetGraphLevel: the Summary levels text only, short 5 s, long 10 s) */
export function levelView(level: StatGraphLevel): { readonly groups: readonly StatGroup[]; readonly window: number; readonly graphs: boolean } | null {
  if (level === "none") return null;
  const groups: readonly StatGroup[] = level.startsWith("performance") ? ["perf"] : level.startsWith("network") ? ["net", "inputBuffer"] : ["speed"];
  const window = level.endsWith("Short") ? 5 : level.endsWith("Long") ? 10 : 0;
  return { groups, window, graphs: window > 0 };
}

/** A value's standing (the graph's and the text's colour): d = |v - base| against good and bad, higher better when
 *  good > bad (lower better: good at d <= good, mid below bad; higher better: good at d >= good, mid above bad) */
export function standing(value: number, good: number, bad: number, base = 0): "good" | "mid" | "bad" {
  const d = Math.abs(value - base);
  if (good > bad) return d >= good ? "good" : d > bad ? "mid" : "bad";
  return d <= good ? "good" : d < bad ? "mid" : "bad";
}

/** A row as a level shows it */
export interface StatRowView {
  readonly title: string;
  readonly summaries: readonly { readonly type: SummaryType; readonly value: number | null; readonly standing: "good" | "mid" | "bad" | null }[];
  /** Its graph's slots (the window's; none at the Summary levels) */
  readonly slots: readonly StatSlot[];
  readonly range: readonly [number, number];
  readonly good: number;
  readonly bad: number;
  readonly base: number;
  readonly higherBetter: boolean;
}

/** Every row's samples and current values; what a level shows from them */
export class StatGraphData {
  readonly #rows = new Map<string, { readonly history: SampleHistory; current: readonly [number, number] | null }>();

  /** A row's current value (one value or an envelope): sampled every frame till another comes */
  set(title: StatTitle, value: number | readonly [number, number]): void {
    const current: readonly [number, number] = typeof value === "number" ? [value, value] : value;
    const row = this.#rows.get(title);
    if (row) row.current = current;
    else this.#rows.set(title, { history: new SampleHistory(), current });
  }

  /** Every row with a value sampled at `now` (s: each rendered frame) */
  sample(now: number): void {
    for (const row of this.#rows.values()) if (row.current) row.history.add(row.current[0], row.current[1], now);
  }

  /** The level's rows at `now` */
  view(level: StatGraphLevel, now: number, c: StatContext): StatRowView[] {
    const v = levelView(level);
    if (!v) return [];
    // (the Summary levels' summaries over the history's whole 10 s)
    const window = v.window > 0 ? v.window : HISTORY_SECONDS;
    return v.groups.flatMap((g) =>
      STAT_GROUPS[g].map((row: StatRow): StatRowView => {
        const history = this.#rows.get(row.title)?.history;
        const [good, bad, base] = [row.good(c), row.bad(c), row.base?.(c) ?? 0];
        return {
          title: row.title,
          summaries: row.summaries.map((s) => {
            const value = history?.summary(s, now, window) ?? null;
            return { type: s.type, value, standing: value === null ? null : standing(value, good, bad, base) };
          }),
          slots: v.graphs && history ? history.slots(now, v.window) : [],
          range: row.range(c),
          good,
          bad,
          base,
          higherBetter: good > bad,
        };
      }),
    );
  }
}
