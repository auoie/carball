import { describe, expect, it } from "vitest";
import { formatClock, matchMessage } from "./matchClock";

describe("match clock", () => {
  it("shows regulation time rounded up, overtime counting up", () => {
    expect(formatClock({ overtime: false, clockTicks: 36000 })).toBe("5:00");
    expect(formatClock({ overtime: false, clockTicks: 35999 })).toBe("5:00");
    expect(formatClock({ overtime: false, clockTicks: 35880 })).toBe("4:59");
    expect(formatClock({ overtime: false, clockTicks: 1 })).toBe("0:01");
    expect(formatClock({ overtime: false, clockTicks: 0 })).toBe("0:00");
    expect(formatClock({ overtime: true, clockTicks: 0 })).toBe("+0:00");
    expect(formatClock({ overtime: true, clockTicks: 119 })).toBe("+0:00");
    expect(formatClock({ overtime: true, clockTicks: 120 * 75 })).toBe("+1:15");
  });

  it("announces overtime and the winner", () => {
    expect(matchMessage({ phase: "countdown", overtime: true, clockTicks: 0, winner: null, forfeit: false })).toBe("OVERTIME");
    expect(matchMessage({ phase: "countdown", overtime: false, clockTicks: 36000, winner: null, forfeit: false })).toBeNull();
    expect(matchMessage({ phase: "ended", overtime: true, clockTicks: 300, winner: 1, forfeit: false })).toBe("ORANGE WINS!");
    expect(matchMessage({ phase: "ended", overtime: false, clockTicks: 0, winner: 0, forfeit: false })).toBe("BLUE WINS!");
    expect(matchMessage({ phase: "active", overtime: false, clockTicks: 100, winner: null, forfeit: false })).toBeNull();
    expect(matchMessage({ phase: "ended", overtime: false, clockTicks: 9000, winner: 0, forfeit: true })).toBe("BLUE WINS BY FORFEIT!");
  });
});
