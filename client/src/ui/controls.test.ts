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
    // (a grid from 0 inside clamps off it (the training editor's positions, RV-601): 0 stays 0, a step is 10, the ends the
    // clamps themselves)
    expect(onGrid(0, -4093.25, 4093.25, 10, 0)).toBe(0);
    expect(onGrid(10.4, -4093.25, 4093.25, 10, 0)).toBe(10);
    expect(onGrid(4090, -4093.25, 4093.25, 10, 0)).toBe(4090);
    expect(onGrid(4096, -4093.25, 4093.25, 10, 0)).toBe(4093.25);
    expect(onGrid(-5000, -4093.25, 4093.25, 10, 0)).toBe(-4093.25);
  });
});
