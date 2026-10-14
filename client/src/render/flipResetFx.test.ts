import { describe, expect, it } from "vitest";
import { FLIP_RESET_FX, domeOpacity, partSize, ringProfile } from "./flipResetFx";

describe("the flip reset's effect (HUD-19)", () => {
  it("grows its parts from 10 % to full, linearly, then they end (no fade)", () => {
    expect(partSize(0, 0.2)).toBeCloseTo(0.1, 9);
    expect(partSize(0.1, 0.2)).toBeCloseTo(0.55, 9);
    expect(partSize(0.2, 0.2)).toBeNull();
    expect(partSize(-0.01, 0.2)).toBeNull();
  });

  it("draws the ring as a thin line at 37 uu, a sharp edge at 38, a soft glow in to 30, nothing in the middle", () => {
    expect(ringProfile(37)).toBe(1);
    expect(ringProfile(38.5)).toBe(0);
    expect(ringProfile(29)).toBe(0);
    expect(ringProfile(10)).toBe(0);
    expect(ringProfile(33)).toBeGreaterThan(0);
    expect(ringProfile(33)).toBeLessThan(ringProfile(35));
  });

  it("shows the dome as a band at its rim: (1 - V)^5, half gone 13 % in", () => {
    expect(domeOpacity(0)).toBe(1);
    expect(domeOpacity(0.13)).toBeCloseTo(0.5, 1);
    expect(domeOpacity(1)).toBe(0);
    // (its rim and top: 26.6 and 10.3 under the car's origin, 145 across)
    expect(FLIP_RESET_FX.domeRimBelow - FLIP_RESET_FX.domeTopBelow).toBeCloseTo(16.3, 6);
    expect(2 * FLIP_RESET_FX.domeRadius).toBeCloseTo(145.2, 6);
  });
});
