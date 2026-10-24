import { describe, expect, it } from "vitest";
import { type Action, type Bindings, DEFAULT_BINDINGS, type KeyboardInput, browserHeldBinds, keyBound, takesBrowserKey } from "./bindings";

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

  it("the OS key's chords the game's when it's bound (RV-1116)", () => {
    expect(takesBrowserKey(press("KeyD", { metaKey: true }), (code) => code === "MetaLeft")).toBe(true);
  });

  it("never page zoom nor the developer tools for a held modifier, unless that very key is bound (RV-1110)", () => {
    for (const code of ["Equal", "Minus", "Digit0", "NumpadAdd"]) expect(takesBrowserKey(press(code, { ctrlKey: true }), bound), code).toBe(false);
    expect(takesBrowserKey({ ...press("KeyI", { ctrlKey: true }), shiftKey: true }, bound), "Ctrl+Shift+I").toBe(false);
    expect(takesBrowserKey(press("KeyI", { ctrlKey: true }), bound), "Ctrl+I, no Shift: the game's").toBe(true);
    expect(
      takesBrowserKey(press("Minus", { ctrlKey: true }), (code) => code === "ControlLeft" || code === "Minus"),
      "Minus bound",
    ).toBe(true);
  });

  it("nothing when nothing's bound", () => {
    expect(takesBrowserKey(press("KeyJ", { ctrlKey: true, altKey: true, metaKey: true }), () => false)).toBe(false);
  });
});

const withKey = (b: Bindings, action: Action, keyboard: KeyboardInput | null): Bindings => ({ ...b, [action]: { ...b[action], keyboard } });

describe("the binds a normal tab can lose to the browser (the Controls screen's Fullscreen notice)", () => {
  it("Ctrl, Alt, the OS key and Escape, each once; none else", () => {
    expect(browserHeldBinds(DEFAULT_BINDINGS)).toEqual([{ kind: "key", code: "ControlLeft" }]);
    const alt = withKey(withKey(DEFAULT_BINDINGS, "rollLeft", { kind: "key", code: "AltLeft" }), "rearCamera", null);
    expect(browserHeldBinds(alt)).toEqual([{ kind: "key", code: "AltLeft" }]);
    expect(browserHeldBinds(withKey(DEFAULT_BINDINGS, "rearCamera", { kind: "key", code: "KeyR" }))).toEqual([]);
  });
});
