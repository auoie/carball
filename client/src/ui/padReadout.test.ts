import { describe, expect, it } from "vitest";
import { padLine } from "./padReadout";

describe("the ?pad readout", () => {
  it("says the pad's id, mapping, held buttons and axes", () => {
    expect(padLine({ index: 0, id: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)", mapping: "standard", pressed: [0, 13], axes: [0, -1, 0.5, 0] })).toBe(
      '#0 Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc) | mapping "standard" | held [0, 13] | axes 0.00 -1.00 0.50 0.00',
    );
  });
});
