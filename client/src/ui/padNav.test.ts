import { describe, expect, it } from "vitest";
import { nearestTowards, padDirection } from "./padNav";

const pad = (down: number[], axes: number[] = [0, 0, 0, 0]): { buttons: number[]; axes: number[] } => ({
  buttons: Array.from({ length: 17 }, (_, i) => (down.includes(i) ? 1 : 0)),
  axes,
});

describe("the menus with a pad", () => {
  it("move by the D-pad, else the left stick past half way", () => {
    expect([padDirection(pad([12])), padDirection(pad([13])), padDirection(pad([14])), padDirection(pad([15]))]).toEqual(["up", "down", "left", "right"]);
    expect(padDirection(pad([], [0.3, -0.2]))).toBeNull();
    expect(padDirection(pad([], [0.1, 0.9]))).toBe("down");
    expect(padDirection(pad([], [-0.8, 0.6]))).toBe("left");
  });

  it("to the nearest control that way, the one in line before one off to the side", () => {
    const from = { left: 100, top: 100, width: 100, height: 40 };
    const below = { left: 100, top: 160, width: 100, height: 40 };
    const belowRight = { left: 300, top: 150, width: 100, height: 40 };
    const right = { left: 260, top: 100, width: 100, height: 40 };
    const above = { left: 100, top: 40, width: 100, height: 40 };
    const candidates = [below, belowRight, right, above];
    expect(nearestTowards(from, "down", candidates)).toBe(0);
    expect(nearestTowards(from, "right", candidates)).toBe(2);
    expect(nearestTowards(from, "up", candidates)).toBe(3);
    expect(nearestTowards(from, "left", candidates)).toBe(-1);
  });
});
