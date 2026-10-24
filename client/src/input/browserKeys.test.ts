import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS, keyBound, takesBrowserKey } from "./bindings";

const bound = (code: string): boolean => keyBound(DEFAULT_BINDINGS, code);
const press = (code: string, mods: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("the keys a press in play takes from the browser (RV-1092)", () => {
  it("a bound key, never an unbound one", () => {
    expect(bound("KeyW")).toBe(true);
    expect(takesBrowserKey(press("KeyW"), bound)).toBe(true);
    expect(bound("F5")).toBe(false);
    expect(takesBrowserKey(press("F5"), bound)).toBe(false);
    // (F5 bound: its reload never taken)
    expect(takesBrowserKey(press("F5"), (code) => code === "F5")).toBe(true);
  });

  it("any key with a bound modifier held: the defaults' Left Ctrl (rear camera) makes Ctrl+J and Ctrl+W the game's (RV-1091)", () => {
    expect(bound("ControlLeft")).toBe(true);
    for (const code of ["KeyJ", "KeyW", "KeyD"]) expect(takesBrowserKey(press(code, { ctrlKey: true }), bound), code).toBe(true);
    // (Alt and the OS key not bound by default: their chords the browser's, as a player expects)
    expect(takesBrowserKey(press("KeyJ", { altKey: true }), bound)).toBe(false);
    expect(takesBrowserKey(press("KeyJ", { metaKey: true }), bound)).toBe(false);
    // (Right Alt bound: Alt's chords the game's, whichever side)
    expect(takesBrowserKey(press("KeyD", { altKey: true }), (code) => code === "AltRight")).toBe(true);
  });

  it("nothing when nothing's bound", () => {
    expect(takesBrowserKey(press("KeyJ", { ctrlKey: true, altKey: true, metaKey: true }), () => false)).toBe(false);
  });
});
