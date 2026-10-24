import { describe, expect, it } from "vitest";
import {
  type Action,
  type Bindings,
  DEFAULT_BINDINGS,
  type KeyboardInput,
  inputName,
  keyBound,
  keyName,
  onKeyboardLayout,
  setKeyboardLayout,
  takesBrowserKey,
} from "./bindings";
import { ButtonLatch, type InputSnapshot, JumpLatch, readControls, readHeldActions } from "./mapping";

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

  it("a layout read again: who listens told only when it changed (each focus reads it: RV-1132)", () => {
    let told = 0;
    const stop = onKeyboardLayout(() => {
      told += 1;
    });
    try {
      setKeyboardLayout(new Map([["KeyW", "z"]]));
      setKeyboardLayout(new Map([["KeyW", "z"]]));
      expect(told, "the same map again").toBe(1);
      setKeyboardLayout(new Map([["KeyW", "w"]]));
      expect(told).toBe(2);
      setKeyboardLayout(
        new Map([
          ["KeyW", "w"],
          ["KeyQ", "q"],
        ]),
      );
      expect(told, "a key more: changed (RV-1135)").toBe(3);
      setKeyboardLayout(new Map([["KeyW", "w"]]));
      expect(told, "a key fewer: changed").toBe(4);
    } finally {
      setKeyboardLayout(null);
      stop();
    }
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

describe("a wheel's taps as the game's actions take them (WHEEL1, RV-1137): each a press and release within the frame", () => {
  /** A frame with `n` taps of `code`, in order */
  const taps = (code: string, n: number): InputSnapshot => ({
    keys: new Set<string>(),
    mouseButtons: new Set<number>(),
    pressedKeys: new Set([code]),
    releasedKeys: new Set([code]),
    events: Array.from({ length: n }, () => [
      { kind: "key" as const, code, down: true },
      { kind: "key" as const, code, down: false },
    ]).flat(),
    gamepad: null,
  });
  const idle: InputSnapshot = { keys: new Set<string>(), mouseButtons: new Set<number>(), gamepad: null };
  const up = { kind: "key", code: "WheelUp" } as const;

  it("an axis action full for that frame alone", () => {
    const bindings = withKey(DEFAULT_BINDINGS, "throttleForward", up);
    expect([readControls(taps("WheelUp", 1), bindings, 0.2).throttle, readControls(idle, bindings, 0.2).throttle]).toEqual([1, 0]);
  });

  it("the jump one tick, however many notches the frame had", () => {
    const bindings = withKey(DEFAULT_BINDINGS, "jump", up);
    const latch = new ButtonLatch();
    const jump = new JumpLatch();
    const controls = readControls(taps("WheelUp", 3), bindings, 0.2, latch);
    jump.frame(latch);
    expect([jump.tick(controls.jump), jump.tick(false)]).toEqual([true, false]);
  });

  it("boost, powerslide and air roll: nothing from a tap (released by the frame's end)", () => {
    const bindings = withKey(withKey(withKey(withKey(DEFAULT_BINDINGS, "boost", up), "handbrake", up), "airRoll", up), "yawRight", {
      kind: "key",
      code: "KeyL",
    });
    const frame = taps("WheelUp", 2);
    const held = { ...frame, keys: new Set(["KeyL"]) };
    const controls = readControls(held, bindings, 0.2, new ButtonLatch());
    expect([controls.boost, controls.handbrake, controls.yaw, controls.roll], "yaw still yaw: no air roll").toEqual([false, false, 1, 0]);
  });

  it("the cameras: each tap counted, none held after", () => {
    const bindings = withKey(withKey(DEFAULT_BINDINGS, "ballCam", up), "rearCamera", { kind: "key", code: "WheelDown" });
    const frame = { ...taps("WheelUp", 3), events: [...(taps("WheelUp", 3).events ?? []), ...(taps("WheelDown", 1).events ?? [])] };
    const held = readHeldActions(frame, bindings, 0.2);
    expect([held.ballCam.keyPresses, held.ballCam.keyDown, held.rearCamera.keyPresses]).toEqual([3, false, 1]);
  });
});
