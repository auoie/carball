import { describe, expect, it } from "vitest";
import { type Action, type Bindings, DEFAULT_BINDINGS, type KeyboardInput, inputName, keyBound, keyName, setKeyboardLayout, takesBrowserKey } from "./bindings";
import { readHeldActions } from "./mapping";

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

  it("zoom by its character on any layout (a German keyboard's + on BracketRight), and Firefox's tools' chords (RV-1120)", () => {
    expect(takesBrowserKey({ ...press("BracketRight", { ctrlKey: true }), key: "+" }, bound), "Ctrl + on a German keyboard").toBe(false);
    expect(takesBrowserKey({ ...press("BracketRight", { ctrlKey: true }), key: "]" }, bound), "Ctrl+] on a US one: the game's").toBe(true);
    // (Ctrl alone bound: the defaults bind E)
    const ctrl = (code: string): boolean => code === "ControlLeft";
    for (const code of ["KeyK", "KeyE", "KeyM"]) expect(takesBrowserKey({ ...press(code, { ctrlKey: true }), shiftKey: true }, ctrl), code).toBe(false);
  });

  it("nothing when nothing's bound", () => {
    expect(takesBrowserKey(press("KeyJ", { ctrlKey: true, altKey: true, metaKey: true }), () => false)).toBe(false);
  });
});

const withKey = (b: Bindings, action: Action, keyboard: KeyboardInput | null): Bindings => ({ ...b, [action]: { ...b[action], keyboard } });

describe("the keys' and buttons' names (RV-1096, RV-1099, RV-1101)", () => {
  it("a layout's letters and punctuation by its keycaps (AZERTY's Z on the W key), its digits as printed", () => {
    setKeyboardLayout(
      new Map([
        ["KeyW", "z"],
        ["KeyQ", "a"],
        ["Semicolon", "m"],
        ["Digit1", "&"],
        ["Minus", "ß"],
        ["Quote", " "],
      ]),
    );
    try {
      expect([keyName("KeyW"), keyName("KeyQ"), keyName("Semicolon"), keyName("Digit1"), keyName("KeyE")]).toEqual(["Z", "A", "M", "1", "E"]);
      // (German's ß its own, not "SS"; a blank the key's own name: RV-1128)
      expect([keyName("Minus"), keyName("Quote")]).toEqual(["ß", keyName("Quote")]);
      expect(keyName("Quote")).not.toBe(" ");
    } finally {
      setKeyboardLayout(null);
    }
    expect(keyName("KeyW"), "no layout: the US keycap").toBe("W");
  });

  it("the wheel's turns, and pad button 17 (Xbox's Share, PlayStation's touchpad)", () => {
    expect([keyName("WheelUp"), keyName("WheelDown")]).toEqual(["Wheel up", "Wheel down"]);
    expect(inputName({ kind: "padButton", button: 17 }, "xbox")).toBe("Share");
    expect(inputName({ kind: "padButton", button: 17 }, "playstation")).toBe("Touchpad");
  });

  it("a wheel turn bound: a press its frame, its action fired once (RV-1096)", () => {
    const bindings = withKey(DEFAULT_BINDINGS, "launchBall", { kind: "key", code: "WheelUp" });
    const turned = {
      keys: new Set<string>(),
      mouseButtons: new Set<number>(),
      pressedKeys: new Set(["WheelUp"]),
      releasedKeys: new Set(["WheelUp"]),
      gamepad: null,
    };
    expect(readHeldActions(turned, bindings, 0.2).launchBall).toBe(true);
    const after = { keys: new Set<string>(), mouseButtons: new Set<number>(), gamepad: null };
    expect(readHeldActions(after, bindings, 0.2).launchBall, "the next frame: not held").toBe(false);
  });
});
