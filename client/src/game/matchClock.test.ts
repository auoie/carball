import { describe, expect, it } from "vitest";
import { countdownStep, formatClock, matchMessage } from "./matchClock";

describe("match clock", () => {
  it("shows int(t) + 1 seconds, as the game's (5:00 until the clock runs; at a whole second, still the one before)", () => {
    expect(formatClock({ overtime: false, clockTicks: 36000 })).toBe("5:00");
    expect(formatClock({ overtime: false, clockTicks: 35999 })).toBe("5:00");
    expect(formatClock({ overtime: false, clockTicks: 35880 })).toBe("5:00"); // (t = 299.0: int + 1 = 300)
    expect(formatClock({ overtime: false, clockTicks: 35879 })).toBe("4:59");
    expect(formatClock({ overtime: false, clockTicks: 1 })).toBe("0:01");
    expect(formatClock({ overtime: false, clockTicks: 0 })).toBe("0:00");
  });

  it("in overtime +0:00 until the clock runs, then +0:01 at once", () => {
    expect(formatClock({ overtime: true, clockTicks: 0 })).toBe("+0:00");
    expect(formatClock({ overtime: true, clockTicks: 1 })).toBe("+0:01");
    expect(formatClock({ overtime: true, clockTicks: 119 })).toBe("+0:01");
    expect(formatClock({ overtime: true, clockTicks: 120 * 75 })).toBe("+1:16");
  });

  it("announces overtime (the winner has its banner instead: MIO-18)", () => {
    expect(matchMessage({ phase: "countdown", overtime: true, clockTicks: 0 })).toBe("OVERTIME");
    expect(matchMessage({ phase: "countdown", overtime: false, clockTicks: 36000 })).toBeNull();
    expect(matchMessage({ phase: "active", overtime: false, clockTicks: 100 })).toBeNull();
    expect(matchMessage({ phase: "prePodium", overtime: true, clockTicks: 300 })).toBeNull();
  });
});

describe("the kickoff countdown's announcements (VT-24, RV-36)", () => {
  it("3 after a second of the 4, then 2, 1 and GO! as the cars can drive; a restart says nothing until 3", () => {
    let left = 0;
    const said: [number, string][] = [];
    const run = (from: number): void => {
      for (let ticks = from; ticks >= 0; ticks--) {
        const step = countdownStep(left, ticks);
        left = step.left;
        if (step.say !== null) said.push([from - ticks, step.say]);
      }
    };
    run(480);
    expect(said).toEqual([[120, "3"], [240, "2"], [360, "1"], [480, "GO!"]]);
    said.length = 0;
    run(480);
    expect(said[0]).toEqual([120, "3"]);
  });
});
