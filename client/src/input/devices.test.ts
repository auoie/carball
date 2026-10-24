// The pads as the game reads them (src/input/devices.ts): a browser without the Gamepad API (turned off, a privacy
// setting) has none, the game going on without them (the loading screen once stuck behind a first frame that threw)
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputDevices, gamepads, padUnmapped, readGamepad, wheelTaps } from "./devices";

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

describe("the wheel's taps, as the game's messages (WHEEL1, RV-1137; Shift RV-1126, RV-1131)", () => {
  const wheel = (deltaY: number, deltaX = 0, { deltaMode = 0, shift = false } = {}) => ({ deltaX, deltaY, deltaMode, shiftKey: shift });
  const counts = (...events: ReturnType<typeof wheel>[]) => events.map((e) => wheelTaps(e)?.count ?? 0);

  it("each event its own taps in its direction, however close together (no window, nothing carried)", () => {
    expect([wheelTaps(wheel(-100)), wheelTaps(wheel(100)), wheelTaps(wheel(-53))]).toEqual([
      { code: "WheelUp", count: 1 },
      { code: "WheelDown", count: 1 },
      { code: "WheelUp", count: 1 },
    ]);
  });

  it("every ordinary notch one tap: Chromium's 100 and 53 px, Firefox's 48, a 1-line notch's 33, 1 to 3 lines, a page", () => {
    expect(
      counts(wheel(100), wheel(53), wheel(48), wheel(33.3), wheel(3, 0, { deltaMode: 1 }), wheel(1, 0, { deltaMode: 1 }), wheel(1, 0, { deltaMode: 2 })),
    ).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it("a merged event: its notches against Chromium's 100 px (3 lines), the first event too (RV-1148); a piece before never skews a notch after (RV-1145)", () => {
    expect(counts(wheel(200), wheel(300), wheel(6, 0, { deltaMode: 1 }), wheel(2, 0, { deltaMode: 2 }))).toEqual([2, 3, 2, 2]);
    expect(counts(wheel(50), wheel(35), wheel(100), wheel(100)), "pieces, then the mouse's notches").toEqual([1, 1, 1, 1]);
  });

  it("smaller than a notch (a precision wheel's or a trackpad's pieces): one tap each in its own direction, the user's choice over the game's every-piece-up bug", () => {
    expect([wheelTaps(wheel(12.5)), wheelTaps(wheel(-12.5)), wheelTaps(wheel(4))]).toEqual([
      { code: "WheelDown", count: 1 },
      { code: "WheelUp", count: 1 },
      { code: "WheelDown", count: 1 },
    ]);
  });

  it("Shift's turn, which Chromium sends sideways, the same turn; sideways without Shift none; nothing, none", () => {
    expect([wheelTaps(wheel(0, -100, { shift: true })), wheelTaps(wheel(0, 100)), wheelTaps(wheel(0))]).toEqual([{ code: "WheelUp", count: 1 }, null, null]);
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
    input.snapshot();
    // (a merged event of three notches: three taps, each a press and release in order: RV-1150)
    surface.dispatchEvent(event("wheel", { deltaY: -300, deltaX: 0, deltaMode: 0 }));
    expect(input.snapshot().events?.map((e) => (e.kind === "key" ? `${e.code}:${String(e.down)}` : ""))).toEqual([
      "WheelUp:true",
      "WheelUp:false",
      "WheelUp:true",
      "WheelUp:false",
      "WheelUp:true",
      "WheelUp:false",
    ]);
    input.menuOpen = () => true;
    expect(turn(), "bound, a menu up").toBe(false);
    input.dispose();
  });
});
