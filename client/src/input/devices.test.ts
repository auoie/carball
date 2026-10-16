// The pads as the game reads them (src/input/devices.ts): a browser without the Gamepad API (turned off, a privacy
// setting) has none, the game going on without them (the loading screen once stuck behind a first frame that threw)
import { afterEach, describe, expect, it, vi } from "vitest";
import { gamepads, readGamepad } from "./devices";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the pads", () => {
  it("none, and no throw, without the Gamepad API", () => {
    vi.stubGlobal("navigator", {});
    expect(gamepads()).toEqual([]);
    expect(readGamepad()).toBeNull();
  });

  it("the first connected standard pad", () => {
    const pad = { id: "Xbox pad", index: 0, connected: true, mapping: "standard", axes: [0.5, 0, 0, 0], buttons: [{ value: 1, pressed: true }] };
    vi.stubGlobal("navigator", { getGamepads: () => [null, pad] });
    expect(readGamepad()).toEqual({ axes: [0.5, 0, 0, 0], buttons: [1] });
  });
});
