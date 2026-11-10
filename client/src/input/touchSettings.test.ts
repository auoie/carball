// The touch controls' settings (src/input/touchSettings.ts; notes/mobile.md): the settings read within their ranges, the
// stick's deadzone and sensitivity, the layout kept across updates (any version read, unknown buttons kept), and the
// throttle's models through the game's reading of controls
import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS, type Action } from "./bindings";
import { withTouchStick } from "./devices";
import { readControls } from "./mapping";
import { EMPTY_LAYOUT, TOUCH_DEFAULTS, loadLayout, readLayout, readTouch, saveLayout, shapeStick } from "./touchSettings";

describe("the touch settings", () => {
  it("read within their ranges; anything else its default", () => {
    expect(readTouch(undefined)).toEqual(TOUCH_DEFAULTS);
    expect(readTouch({ throttle: "split", fixedStick: true, stickSize: 9, sensitivity: 0.1, deadzone: 0.2 })).toEqual({
      throttle: "split",
      fixedStick: true,
      stickSize: 1.5,
      sensitivity: 0.5,
      deadzone: 0.2,
    });
    expect(readTouch({ throttle: "turbo", fixedStick: "yes", stickSize: Number.NaN })).toEqual(TOUCH_DEFAULTS);
  });

  it("shape the stick: nothing inside its deadzone, rescaled past it, full tilt sooner with more sensitivity; its direction kept", () => {
    expect(shapeStick({ x: 0.1, y: 0 }, { deadzone: 0.2, sensitivity: 1 })).toEqual({ x: 0, y: 0 });
    expect(shapeStick({ x: 0, y: -0.6 }, { deadzone: 0.2, sensitivity: 1 }).y).toBeCloseTo(-0.5, 12);
    expect(shapeStick({ x: 0.5, y: 0 }, { deadzone: 0, sensitivity: 2 })).toEqual({ x: 1, y: 0 });
    expect(shapeStick({ x: 0.3, y: 0.4 }, { deadzone: 0, sensitivity: 1.5 }).x).toBeCloseTo(0.45, 12);
    expect(shapeStick({ x: 0, y: 0 }, { deadzone: 0, sensitivity: 1 })).toEqual({ x: 0, y: 0 });
  });
});

describe("the buttons' layout", () => {
  const store = (): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  };

  it("is kept with its version and read back; the empty one removes the record", () => {
    const s = store();
    const layout = {
      buttons: { jump: { x: 0.9, y: 0.8, scale: 1.2, opacity: 0.7, hidden: false }, ballCam: { scale: 1, opacity: 1, hidden: true } },
      stick: { x: 0.25, y: 0.7 },
    };
    saveLayout(layout, s);
    expect(JSON.parse(s.data.get("carball.touchLayout") ?? "{}")).toMatchObject({ version: 1 });
    expect(loadLayout(s)).toEqual(layout);
    saveLayout(EMPTY_LAYOUT, s);
    expect(s.data.size).toBe(0);
    expect(loadLayout(s)).toEqual(EMPTY_LAYOUT);
  });

  it("read from any version: values checked and clamped, a later page's buttons kept, junk dropped", () => {
    expect(
      readLayout({
        version: 7,
        future: { anything: true },
        buttons: { jump: { x: 1.4, y: -1, scale: 5, opacity: 0, hidden: "no" }, hover: { scale: 1.1 }, "bad id!": {} },
        stick: { x: 0.5 },
      }),
    ).toEqual({ buttons: { jump: { x: 1, y: 0, scale: 1.6, opacity: 0.2, hidden: false }, hover: { scale: 1.1, opacity: 1, hidden: false } } });
    expect(readLayout("nonsense")).toEqual(EMPTY_LAYOUT);
    expect(loadLayout({ getItem: () => "{not json", setItem: () => undefined, removeItem: () => undefined })).toEqual(EMPTY_LAYOUT);
  });
});

describe("the throttle's models", () => {
  const frame = (stick: { x: number; y: number } | null, held: Action[], stickDrives: boolean) =>
    readControls(
      {
        keys: new Set(),
        mouseButtons: new Set(),
        events: [],
        gamepad: withTouchStick(null, stick),
        touch: { stick, held: new Set(held), pressed: new Set(), stickDrives },
      },
      DEFAULT_BINDINGS,
      0.2,
    );

  it("Stick: the stick's tilt drives (stickThrottle)", () => {
    expect(frame({ x: 0, y: -1 }, [], true).throttle).toBeCloseTo(1, 12);
  });

  it("Auto drive and Split: the stick steers alone; the buttons' held throttle drives, Brake or Reverse backs up", () => {
    const steering = frame({ x: 1, y: 0 }, [], false);
    expect(steering.throttle).toBe(0);
    expect(steering.steer).toBeCloseTo(1, 12);
    expect(frame({ x: 0, y: -1 }, ["throttleForward"], false).throttle).toBe(1);
    expect(frame(null, ["throttleReverse"], false).throttle).toBe(-1);
  });
});
