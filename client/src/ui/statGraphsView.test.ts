// The stat graphs drawn (HUD-21, SG2): the scale, the tiles, the columns, the colours and the graph's worse side, read
// from a recording 2D context (RV-529's CM9-CM13b)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SampleHistory, type StatRowView } from "../game/statGraphs";
import { STAT_COLOURS, StatGraphsView, statScale } from "./statGraphsView";

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly textAlign: string;
}

/** A 2D context that records each call with the styles it was made under */
class RecordingContext {
  readonly calls: Call[] = [];
  fillStyle = "";
  strokeStyle = "";
  textAlign = "start";
  textBaseline = "alphabetic";
  font = "";
  lineWidth = 1;
  #record(op: string, args: readonly unknown[]): void {
    this.calls.push({ op, args, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, textAlign: this.textAlign });
  }
  setTransform(...args: number[]): void {
    this.#record("setTransform", args);
  }
  clearRect(...args: number[]): void {
    this.#record("clearRect", args);
  }
  fillRect(...args: number[]): void {
    this.#record("fillRect", args);
  }
  fillText(...args: unknown[]): void {
    this.#record("fillText", args);
  }
  beginPath(): void {
    this.#record("beginPath", []);
  }
  moveTo(...args: number[]): void {
    this.#record("moveTo", args);
  }
  lineTo(...args: number[]): void {
    this.#record("lineTo", args);
  }
  stroke(): void {
    this.#record("stroke", []);
  }
}

let ctx: RecordingContext;

beforeEach(() => {
  ctx = new RecordingContext();
  const canvas = {
    className: "",
    hidden: true,
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    setAttribute: () => undefined,
    getContext: () => ctx,
  };
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const parent = { append: () => undefined } as unknown as HTMLElement;

const row = (o: Partial<StatRowView>): StatRowView => ({
  title: "FPS",
  summaries: [
    { type: "avg", value: 60, standing: "good" },
    { type: "min", value: 30, standing: "bad" },
  ],
  graph: null,
  range: [0, 100],
  good: 40,
  bad: 20,
  base: 0,
  higherBetter: true,
  ...o,
});

describe("the stat graphs' scale (SG2's YScale)", () => {
  it("H 16/9 / 1600 x the Interface Scale, 1 at least, 1.8 at most", () => {
    expect(statScale(720, 1)).toBe(1);
    expect(statScale(1440, 1)).toBeCloseTo(1.6, 9);
    expect(statScale(2160, 1)).toBe(1.8);
    expect(statScale(1080, 0.5)).toBe(1);
  });
});

describe("the stat graphs drawn", () => {
  it("a Summary level at 1280 x 720: the black third tile, the values column 6 W in, the title white, each value in its standing's colour", () => {
    const view = new StatGraphsView(parent);
    view.draw([row({})], 0, 1, 1, 1);
    // (W 13 at scale 1: the values column 78 px, the tile 15 W wide, from the first row's 16 px down, two lines tall)
    const tile = ctx.calls.find((c) => c.op === "fillRect");
    expect(tile?.fillStyle).toBe("rgba(0, 0, 0, 0.333)");
    expect(tile?.args).toEqual([1280 - 15 * 13, 16, 15 * 13, 32]);
    const texts = ctx.calls.filter((c) => c.op === "fillText").map((c) => [c.args[0], c.args[1], c.textAlign, c.fillStyle]);
    expect(texts).toEqual([
      ["FPS", 1280 - 6 * 13, "right", STAT_COLOURS.title],
      [" 60.00", 1280 - 6 * 13, "left", "rgb(64, 255, 64)"],
      ["Min", 1280 - 6 * 13, "right", STAT_COLOURS.label],
      [" 30.00", 1280 - 6 * 13, "left", "rgb(255, 64, 64)"],
    ]);
  });

  it("a graph level: the polyline the worse side of each slot (higher better: its low), coloured by that side's standing", () => {
    const history = new SampleHistory();
    // (a second of slots, each sampled mid-slot)
    for (let i = 0; i < 60; i++) history.add(10, 50, (60 + i + 0.5) / 60);
    const now = (119 + 0.5) / 60;
    const view = new StatGraphsView(parent);
    view.draw([row({ graph: history })], 5, now, 1, 1);
    const line = ctx.calls.filter((c) => (c.op === "lineTo" || c.op === "moveTo") && c.strokeStyle !== STAT_COLOURS.grid);
    // (its first point, then a line to each of the 60)
    expect(line.length).toBe(61);
    // (its rows' first at 16 px, two 16-px lines tall: 10 of 0..100 at 16 + 32 x 0.9; the high, 50, would be at 32)
    expect(new Set(line.map((c) => c.args[1]))).toEqual(new Set([16 + 32 * 0.9]));
    expect(new Set(line.map((c) => c.strokeStyle))).toEqual(new Set([STAT_COLOURS.bad]));
    // (lower better: its high)
    const lower = new RecordingContext();
    ctx = lower;
    new StatGraphsView(parent).draw([row({ graph: history, good: 20, bad: 40, higherBetter: false })], 5, now, 1, 1);
    const high = lower.calls.filter((c) => c.op === "lineTo" && c.strokeStyle !== STAT_COLOURS.grid);
    expect(new Set(high.map((c) => c.args[1]))).toEqual(new Set([16 + 32 * 0.5]));
  });
});
