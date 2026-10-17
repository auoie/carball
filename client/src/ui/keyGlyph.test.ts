import { describe, expect, it } from "vitest";
import { inputName, padStyleOf } from "../input/bindings";
import { keyGlyph } from "./keyGlyph";

describe("the prompts' {key} token (HT-3, RV-282)", () => {
  it("draws mouse and pad buttons as icons, keys as words", () => {
    expect(keyGlyph({ kind: "mouse", button: 1 })).toEqual({ kind: "mouse", button: 1 });
    expect(keyGlyph({ kind: "padButton", button: 3 }, "xbox")).toEqual({ kind: "pad", button: 3, text: "Y", style: "xbox" });
    expect(keyGlyph({ kind: "padButton", button: 0 }, "xbox")).toEqual({ kind: "pad", button: 0, text: "A", style: "xbox" });
    expect(keyGlyph({ kind: "padButton", button: 4 }, "xbox")).toEqual({ kind: "pad", button: 4, text: "LB", style: "xbox" });
    expect(keyGlyph({ kind: "key", code: "Space" })).toEqual({ kind: "word", text: "Space" });
    expect(keyGlyph(null)).toEqual({ kind: "word", text: "—" });
  });

  it("draws a PlayStation pad's own symbols (the game's glyph set per pad type), told by the pad's id", () => {
    expect([0, 1, 2, 3, 4, 7, 10].map((b) => keyGlyph({ kind: "padButton", button: b }, "playstation").kind === "pad" && (keyGlyph({ kind: "padButton", button: b }, "playstation") as { text: string }).text)).toEqual(["✕", "○", "□", "△", "L1", "R2", "L3"]);
    expect(padStyleOf("Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)")).toBe("playstation");
    expect(padStyleOf("DualSense Wireless Controller")).toBe("playstation");
    expect(padStyleOf("Xbox 360 Controller (XInput STANDARD GAMEPAD)")).toBe("xbox");
    expect(inputName({ kind: "padButton", button: 0 }, "playstation")).toBe("Cross");
  });
});

describe("a stick's direction as a badge (RV-512: the axis's long name made the respawn prompts collide)", () => {
  it("the standard layout's sticks: L or R with the direction, its name kept for the title", () => {
    expect(keyGlyph({ kind: "padAxis", axis: 0, sign: -1 })).toEqual({ kind: "stick", stick: "L", direction: "left", text: inputName({ kind: "padAxis", axis: 0, sign: -1 }) });
    expect(keyGlyph({ kind: "padAxis", axis: 0, sign: 1 })).toMatchObject({ stick: "L", direction: "right" });
    expect(keyGlyph({ kind: "padAxis", axis: 1, sign: 1 })).toMatchObject({ stick: "L", direction: "down" });
    expect(keyGlyph({ kind: "padAxis", axis: 3, sign: -1 })).toMatchObject({ stick: "R", direction: "up" });
    // (another axis: its name)
    expect(keyGlyph({ kind: "padAxis", axis: 5, sign: 1 }).kind).toBe("word");
  });
});

