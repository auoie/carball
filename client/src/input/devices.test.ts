// The pads as the game reads them (src/input/devices.ts): a browser without the Gamepad API (turned off, a privacy
// setting) has none, the game going on without them (the loading screen once stuck behind a first frame that threw)
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputDevices, WheelNotches, gamepads, padUnmapped, readGamepad } from "./devices";

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

describe("a pad the browser doesn't map (RV-1124)", () => {
  const button = (value: number) => ({ value, pressed: value > 0.5, touched: value > 0 });

  it("never read, said so; a standard one read when both are there", () => {
    const raw = { id: "test-pad-2", connected: true, mapping: "", axes: [-0.5, 0], buttons: [button(1)] };
    const standard = { id: "standard-pad", connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: [button(0)] };
    vi.stubGlobal("navigator", { getGamepads: () => [raw] });
    expect(readGamepad()).toBeNull();
    expect(padUnmapped()).toBe(true);
    vi.stubGlobal("navigator", { getGamepads: () => [raw, standard] });
    expect(readGamepad()?.axes).toHaveLength(4);
    expect(padUnmapped()).toBe(false);
    vi.stubGlobal("navigator", { getGamepads: () => [] });
    expect(padUnmapped(), "none at all").toBe(false);
  });
});

describe("the wheel's notches (RV-1126, RV-1129, RV-1130, RV-1131)", () => {
  /** A wheel event at `at` ms; `shift`: Shift held */
  const wheel = (at: number, deltaY: number, deltaX = 0, { deltaMode = 0, shift = false } = {}) => ({
    deltaX,
    deltaY,
    deltaMode,
    shiftKey: shift,
    timeStamp: at,
  });

  it("a mouse's notch one tap each, either way; Shift's, sent sideways, the same; sideways without Shift none", () => {
    const n = new WheelNotches();
    const turns = [
      n.turn(wheel(0, -100)),
      n.turn(wheel(200, 100)),
      n.turn(wheel(400, 53)),
      n.turn(wheel(600, 0, -120, { shift: true })),
      n.turn(wheel(800, 0, 120)),
      n.turn(wheel(1000, 0)),
    ];
    expect(turns).toEqual(["WheelUp", "WheelDown", "WheelDown", "WheelUp", null, null]);
    expect(n.turn(wheel(1200, 3, 0, { deltaMode: 1 })), "Firefox's lines").toBe("WheelDown");
  });

  it("a precision wheel's notch in pieces, a trackpad's swipe, a fast spin: one tap a burst; the next after a pause", () => {
    const n = new WheelNotches();
    const pieces = Array.from({ length: 8 }, (_, i) => n.turn(wheel(i * 8, -12.5))).filter((c) => c !== null);
    expect(pieces, "a notch in eight pieces").toEqual(["WheelUp"]);
    const swipe = Array.from({ length: 60 }, (_, i) => n.turn(wheel(500 + i * 16, -4))).filter((c) => c !== null);
    expect(swipe, "a swipe").toEqual(["WheelUp"]);
    expect([n.turn(wheel(2000, -30)), n.turn(wheel(2010, 30)), n.turn(wheel(2020, 30))], "a turn back starts again").toEqual([null, null, "WheelDown"]);
  });
});

describe("the keyboard's and the wheel's taps in play (RV-1096, RV-1100, RV-1127)", () => {
  /** The page's window and the game's canvas for InputDevices, as plain event targets (no DOM here) */
  const devices = (): { input: InputDevices; win: EventTarget; surface: EventTarget } => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    // (no element here: the events' target the window, never a field's or a button's)
    class NoElement {
      readonly element = false;
    }
    for (const name of ["Element", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLTextAreaElement"]) vi.stubGlobal(name, NoElement);
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", { pointerLockElement: null });
    const surface = new EventTarget();
    return { input: new InputDevices(surface as HTMLElement), win, surface };
  };
  const event = (kind: string, fields: object): Event => Object.assign(new Event(kind, { cancelable: true }), fields);

  it("PrintScreen's keyup alone a tap: pressed and let go that frame, never held; with its keydown, one press", () => {
    const { input, win } = devices();
    win.dispatchEvent(event("keyup", { code: "PrintScreen" }));
    const tapped = input.snapshot();
    expect([tapped.pressedKeys?.has("PrintScreen"), tapped.releasedKeys?.has("PrintScreen"), tapped.keys.has("PrintScreen")]).toEqual([true, true, false]);
    expect(input.snapshot().pressedKeys?.has("PrintScreen"), "the next frame").toBe(false);
    win.dispatchEvent(event("keydown", { code: "PrintScreen", repeat: false }));
    win.dispatchEvent(event("keyup", { code: "PrintScreen" }));
    expect(input.snapshot().events?.filter((e) => e.kind === "key" && e.down)).toHaveLength(1);
    input.dispose();
  });

  it("a wheel's notch a tap; in play with the wheel bound, the page's own (Ctrl's zoom) cancelled, in a menu or unbound not", () => {
    const { input, surface } = devices();
    const turn = (): boolean => {
      const e = event("wheel", { deltaY: -100, deltaX: 0, deltaMode: 0, ctrlKey: true });
      surface.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(turn(), "unbound").toBe(false);
    const tapped = input.snapshot();
    expect([tapped.pressedKeys?.has("WheelUp"), tapped.releasedKeys?.has("WheelUp"), tapped.keys.has("WheelUp")]).toEqual([true, true, false]);
    input.bound = (code) => code === "WheelUp";
    expect(turn(), "bound, in play").toBe(true);
    input.menuOpen = () => true;
    expect(turn(), "bound, a menu up").toBe(false);
    input.dispose();
  });
});
