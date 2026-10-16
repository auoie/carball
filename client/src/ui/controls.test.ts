// Our own controls' value rules (src/ui/controls.ts; the controls themselves: the browser tests')
import { describe, expect, it } from "vitest";
import { onGrid } from "./controls";

describe("a slider's value", () => {
  it("on its step's grid from its minimum, clamped, with no float's tail", () => {
    expect(onGrid(0.1 + 0.2, 0, 1, 0.1)).toBe(0.3);
    expect(onGrid(0.26, 0, 1, 0.05)).toBe(0.25);
    expect(onGrid(107.4, 60, 110, 1)).toBe(107);
    expect(onGrid(-3, 0, 1, 0.1)).toBe(0);
    expect(onGrid(9, 0, 5, 0.5)).toBe(5);
    // (the grid counted from the minimum, not from 0)
    expect(onGrid(1.32, 0.25, 2, 0.5)).toBe(1.25);
    expect(onGrid(0.008, 0, 1, 0.01)).toBe(0.01);
  });
});
