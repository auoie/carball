import { describe, expect, it } from "vitest";
import { clockCue, clockWarning, countdownStep, formatClock, overtimeLabel } from "./matchClock";

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

  it("shows OVERTIME in the clock's slot through overtime's kickoff, until its clock runs (HUD-3)", () => {
    expect(overtimeLabel({ phase: "countdown", overtime: true, clockTicks: 0 })).toBe(true);
    expect(overtimeLabel({ phase: "countdown", overtime: false, clockTicks: 36000 })).toBe(false);
    expect(overtimeLabel({ phase: "active", overtime: true, clockTicks: 100 })).toBe(false);
    expect(overtimeLabel({ phase: "prePodium", overtime: true, clockTicks: 300 })).toBe(false);
  });
});

describe("the clock's announcements (HUD-10)", () => {
  it("one minute and 30 seconds left, then each of the last ten, as the shown second steps down to them", () => {
    expect(clockWarning(61, 60)).toBe("One Minute Remaining!");
    expect(clockWarning(60, 60)).toBeNull();
    expect(clockWarning(31, 30)).toBe("30 Seconds Remaining!");
    expect(clockWarning(11, 10)).toBe("10");
    expect(clockWarning(2, 1)).toBe("1");
    expect(clockWarning(1, 0)).toBeNull();
    expect(clockWarning(12, 11)).toBeNull();
    expect(clockWarning(64, 59)).toBeNull(); // (a step past it: not at it)
  });

  it("each announcement its own sound (HT-7, RV-283): the last ten's tick, the minute's and 30 seconds' calls", () => {
    expect([clockCue(60), clockCue(30), clockCue(10), clockCue(1)]).toEqual(["oneMinute", "thirtySeconds", "endCounter", "endCounter"]);
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
    expect(said).toEqual([[120, "3"], [240, "2"], [360, "1"], [480, "Go!"]]);
    said.length = 0;
    run(480);
    expect(said[0]).toEqual([120, "3"]);
  });
});
