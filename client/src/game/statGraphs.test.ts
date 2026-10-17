// The stat graphs' data (HUD-21, SG1, SG2): the 60-a-second envelope history, its summaries, the rows and the levels
import { describe, expect, it } from "vitest";
import { HISTORY_SECONDS, SAMPLE_RATE, SampleHistory, STAT_GROUPS, type StatContext, StatGraphData, levelView, speedUnit, standing } from "./statGraphs";

const CONTEXT: StatContext = { targetFps: 60, maxBytesRate: 15000, expectedOutPackets: 60, expectedInPackets: 60, metric: true };

describe("a row's history (SampleHistory_TA)", () => {
  it("each 1/60 s slot the low and high of what was sampled in it; 10 s kept, older slots gone", () => {
    const h = new SampleHistory();
    h.add(3, 3, 0.001);
    h.add(7, 7, 0.005); // (the same slot)
    h.add(4, 6, 1 / 60 + 0.001); // (an envelope)
    expect(h.slots(1 / 60 + 0.002, 1).map((s) => [s.low, s.high])).toEqual([
      [3, 7],
      [4, 6],
    ]);
    // (10 s on: the first slot out of the window, its place taken)
    h.add(1, 1, HISTORY_SECONDS + 0.001);
    expect(h.slots(HISTORY_SECONDS + 0.002, HISTORY_SECONDS).map((s) => s.low)).toEqual([4, 1]);
    expect(SAMPLE_RATE * HISTORY_SECONDS).toBe(600);
  });

  it("read in order straight from the ring, across its seam, as a plain record of every slot would give (RV-517)", () => {
    const h = new SampleHistory();
    const reference = new Map<number, [number, number]>();
    // (25 s of uneven frames, the ring wrapped twice; a deterministic stream of values)
    let seed = 7;
    const next = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let t = 0;
    while (t < 25) {
      t += 0.004 + next() * 0.03;
      const [a, b] = [next() * 100 - 20, next() * 100 - 20];
      const [low, high] = [Math.min(a, b), Math.max(a, b)];
      h.add(low, high, t);
      const tick = Math.floor(t * SAMPLE_RATE);
      const was = reference.get(tick);
      reference.set(tick, was ? [Math.min(was[0], low), Math.max(was[1], high)] : [low, high]);
    }
    const tick = Math.floor(t * SAMPLE_RATE);
    for (const seconds of [1, 5, 10]) {
      const kept = [...reference].filter(([k]) => k > tick - seconds * SAMPLE_RATE && k <= tick).sort(([x], [y]) => x - y);
      expect(h.slots(t, seconds).map((x) => [x.tick, x.low, x.high])).toEqual(kept.map(([k, [l, hi]]) => [k, l, hi]));
      const highs = kept.map(([, [, hi]]) => hi);
      expect(h.summary({ type: "sum", age: 0 }, t, seconds)).toBe(highs.reduce((x, y) => x + y, 0));
      expect(h.summary({ type: "max", age: 0 }, t, seconds)).toBe(Math.max(...highs));
      expect(h.summary({ type: "min", age: 0, abs: true }, t, seconds)).toBe(Math.min(...kept.map(([, [l]]) => Math.abs(l))));
    }
  });

  it("its summaries (GetSummaryValue): Latest the newest slot's midpoint, Avg the highs over their count, Sum the highs, Min the lowest low, Max the highest high; each over its age within the window", () => {
    const h = new SampleHistory();
    for (let i = 0; i < 120; i++) h.add(i < 60 ? 10 : 18, i < 60 ? 10 : 22, i / 60);
    const now = 119 / 60;
    expect(h.summary({ type: "latest", age: 0 }, now, 10)).toBe(20);
    expect(h.summary({ type: "avg", age: 1 }, now, 10)).toBeCloseTo(22, 9);
    expect(h.summary({ type: "avg", age: 0 }, now, 10)).toBeCloseTo(16, 9);
    expect(h.summary({ type: "min", age: 0 }, now, 10)).toBe(10);
    expect(h.summary({ type: "max", age: 0 }, now, 10)).toBe(22);
    // (an age past the window: the window's)
    expect(h.summary({ type: "avg", age: 30 }, now, 1)).toBeCloseTo(22, 9);
    // (IBuf Miss: each update's skipped less missing frames, their sizes summed)
    const miss = new SampleHistory();
    miss.add(1, 1, 0);
    miss.add(-2, -2, 1 / 60);
    miss.add(0, 0, 2 / 60);
    expect(miss.summary({ type: "sum", age: 0, abs: true }, 2 / 60, 5)).toBe(3);
    expect(miss.summary({ type: "sum", age: 0 }, 2 / 60, 5)).toBe(-1);
    expect(new SampleHistory().summary({ type: "max", age: 0 }, 0, 5)).toBeNull();
    expect(new SampleHistory().summary({ type: "latest", age: 0 }, 0, 5)).toBeNull();
  });
});

describe("the rows and levels (HUD-21)", () => {
  it("the game's titles, verbatim, in each group's order", () => {
    expect(STAT_GROUPS.perf.map((r) => r.title)).toEqual(["FPS", "Frame", "Game", "Render", "GPU"]);
    expect(STAT_GROUPS.net.map((r) => r.title)).toEqual(["Out Pkt", "In Pkt", "Out Loss", "In Loss", "Out Bytes", "In Bytes", "Latency"]);
    expect(STAT_GROUPS.inputBuffer.map((r) => r.title)).toEqual(["IBuf", "IBuf Target", "IBuf Miss", "Phys Rate"]);
    expect(STAT_GROUPS.speed.map((r) => r.title)).toEqual(["Car Speed", "Car Speed (XY)", "Car Speed (Z)", "Ball Speed", "Ball Speed (XY)", "Ball Speed (Z)"]);
  });

  it("the levels: None nothing; Summary text only; short 5 s and long 10 s graphs; Network the input buffer's rows too", () => {
    expect(levelView("none")).toBeNull();
    expect(levelView("performanceSummary")).toEqual({ groups: ["perf"], window: 0, graphs: false });
    expect(levelView("networkShort")).toEqual({ groups: ["net", "inputBuffer"], window: 5, graphs: true });
    expect(levelView("speedLong")).toEqual({ groups: ["speed"], window: 10, graphs: true });
  });

  it("the colours on d = |v - base| (SG2): the frame rate higher-better from the target, a frame's time lower-better, the packets about their rate", () => {
    const [fps, frame] = STAT_GROUPS.perf;
    expect([fps.good(CONTEXT), fps.bad(CONTEXT)]).toEqual([59, 48]);
    expect(frame.good(CONTEXT)).toBeCloseTo(16.95, 2);
    expect(frame.bad(CONTEXT)).toBeCloseTo(25.42, 2);
    expect([standing(60, 59, 48), standing(50, 59, 48), standing(48, 59, 48)]).toEqual(["good", "mid", "bad"]);
    expect([standing(16, 16.95, 25.42), standing(20, 16.95, 25.42), standing(26, 16.95, 25.42)]).toEqual(["good", "mid", "bad"]);
    // (Out Pkt about 60: 58 good, 64 mid, 52 bad)
    expect([standing(58, 3, 6, 60), standing(64, 3, 6, 60), standing(52, 3, 6, 60)]).toEqual(["good", "mid", "bad"]);
    // (IBuf higher-better: 2 good, 1 mid, 0 bad)
    expect([standing(2, 2, 0.01), standing(1, 2, 0.01), standing(0, 2, 0.01)]).toEqual(["good", "mid", "bad"]);
    // (on the thresholds themselves, either way: at good is good, at bad is bad, RV-518's CM3)
    expect([standing(16.95, 16.95, 25.42), standing(25.42, 16.95, 25.42), standing(59, 59, 48), standing(48, 59, 48)]).toEqual(["good", "bad", "good", "bad"]);
    expect([standing(63, 3, 6, 60), standing(54, 3, 6, 60)]).toEqual(["good", "bad"]);
    // (the speeds in km/h or mph, their range too)
    const car = STAT_GROUPS.speed[0];
    expect(car.range(CONTEXT)[1]).toBeCloseTo(2300 * 0.036, 9);
    expect(car.range({ ...CONTEXT, metric: false })[1]).toBeCloseTo(2300 * speedUnit(false), 9);
  });

  it("every row sampled each frame from its current value (repeated till another comes); a level's view: summaries, standing, the graph's slots only at the graph levels", () => {
    const data = new StatGraphData();
    data.set("FPS", 60);
    for (let i = 0; i < 60; i++) data.sample(i / 60);
    const summary = data.view("performanceSummary", 59 / 60, CONTEXT);
    expect(summary.map((r) => r.title)).toEqual(["FPS", "Frame", "Game", "Render", "GPU"]);
    expect(summary[0]?.summaries).toEqual([
      { type: "avg", value: 60, standing: "good" },
      { type: "min", value: 60, standing: "good" },
    ]);
    expect(summary[0]?.graph).toBeNull();
    expect(summary[0]?.higherBetter).toBe(true);
    // (no value ever: none, no standing)
    expect(summary[4]?.summaries[0]).toEqual({ type: "avg", value: null, standing: null });
    expect(data.view("performanceShort", 59 / 60, CONTEXT)[0]?.graph?.slots(59 / 60, 5)).toHaveLength(60);
    expect(data.view("none", 59 / 60, CONTEXT)).toEqual([]);
  });
});

describe("every row's summaries as SG1's table (RV-515)", () => {
  it("their types, ages (0: the window) and |x|", () => {
    const table = Object.fromEntries(
      Object.values(STAT_GROUPS)
        .flat()
        .map((r) => [r.title, r.summaries.map((s) => `${s.type}${s.age > 0 ? `@${String(s.age)}` : ""}${"abs" in s && s.abs ? "|abs" : ""}`).join(" ")]),
    );
    const ms = "avg@1 max";
    expect(table).toEqual({
      FPS: "avg@1 min",
      Frame: ms,
      Game: ms,
      Render: ms,
      GPU: ms,
      "Out Pkt": "latest max min",
      "In Pkt": "latest max min",
      "Out Loss": "latest max",
      "In Loss": "latest max",
      "Out Bytes": "latest max",
      "In Bytes": "latest max",
      Latency: "avg@1 max min",
      IBuf: "min@1 max min",
      "IBuf Target": "latest max",
      "IBuf Miss": "sum|abs max min",
      "Phys Rate": "latest",
      "Car Speed": "latest",
      "Car Speed (XY)": "latest",
      "Car Speed (Z)": "latest",
      "Ball Speed": "latest",
      "Ball Speed (XY)": "latest",
      "Ball Speed (Z)": "latest",
    });
  });
});

