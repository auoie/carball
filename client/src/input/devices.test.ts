// The pads as the game reads them (src/input/devices.ts): a browser without the Gamepad API (turned off, a privacy
// setting) has none, the game going on without them (the loading screen once stuck behind a first frame that threw)
import { afterEach, describe, expect, it, vi } from "vitest";
import { gamepads, padUnmapped, readGamepad, unmappedSnapshot } from "./devices";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the pads", () => {
  it("none, and no throw, without the Gamepad API", () => {
    vi.stubGlobal("navigator", {});
    expect(gamepads()).toEqual([]);
    expect(readGamepad()).toBeNull();
  });

  it("none, and no throw, where a permissions policy refuses the API (RV-526)", () => {
    vi.stubGlobal("navigator", {
      getGamepads: () => {
        throw new DOMException("Gamepad is not allowed", "SecurityError");
      },
    });
    expect(gamepads()).toEqual([]);
    expect(readGamepad()).toBeNull();
  });

  it("the first connected standard pad", () => {
    const pad = { id: "Xbox pad", index: 0, connected: true, mapping: "standard", axes: [0.5, 0, 0, 0], buttons: [{ value: 1, pressed: true }] };
    vi.stubGlobal("navigator", { getGamepads: () => [null, pad] });
    expect(readGamepad()).toEqual({ axes: [0.5, 0, 0, 0], buttons: [1] });
  });
});

describe("a pad the browser doesn't map (RV-1095)", () => {
  const button = (value: number) => ({ value, pressed: value > 0.5, touched: value > 0 });
  const pad = (id: string, axes: number[], pressed: number[]) => ({ id, axes, buttons: [0, 1, 2].map((i) => button(pressed.includes(i) ? 1 : 0)) });
  const rounded = (axes: readonly number[]) => axes.map((v) => Math.round(v * 100) / 100);

  it("read by its own numbers, a trigger from where it rested when first seen (-1: 0 untouched)", () => {
    expect(rounded(unmappedSnapshot(pad("test-pad-1", [0, 0.01, -1], [])).axes)).toEqual([0, 0.01, 0]);
    const held = unmappedSnapshot(pad("test-pad-1", [-1, 0.01, 1], [2]));
    expect(rounded(held.axes)).toEqual([-1, 0.01, 1]);
    expect(held.buttons).toEqual([0, 0, 1]);
  });

  it("first seen at the press that showed it: a stick half way rests at 0, the button held counts once let go", () => {
    const first = unmappedSnapshot(pad("test-pad-3", [0.6, 0], [1]));
    expect(first.axes).toEqual([0.6, 0]);
    expect(first.buttons, "the showing press: not a press").toEqual([0, 0, 0]);
    expect(unmappedSnapshot(pad("test-pad-3", [0, 0], [])).axes, "the stick let go: centred").toEqual([0, 0]);
    expect(unmappedSnapshot(pad("test-pad-3", [0, 0], [1])).buttons, "pressed again: a press").toEqual([0, 1, 0]);
  });

  it("taken when no standard pad is there, said so; a standard one first when both are", () => {
    const raw = { id: "test-pad-2", connected: true, mapping: "", axes: [0, 0], buttons: [button(0)] };
    const standard = { id: "standard-pad", connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: [button(0)] };
    vi.stubGlobal("navigator", { getGamepads: () => [raw] });
    expect(readGamepad()?.buttons).toEqual([0]);
    raw.buttons = [button(1)];
    expect(readGamepad()?.buttons).toEqual([1]);
    expect(padUnmapped()).toBe(true);
    vi.stubGlobal("navigator", { getGamepads: () => [raw, standard] });
    expect(readGamepad()?.axes).toHaveLength(4);
    expect(padUnmapped()).toBe(false);
  });
});
