// The touch controls' settings (src/input/touchSettings.ts; notes/mobile.md): the settings read within their ranges, the
// stick's deadzone and sensitivity, the layout kept across updates (any version read, unknown buttons kept), and the
// throttle's models through the game's reading of controls
import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS, type Action } from "./bindings";
import { withTouchStick } from "./devices";
import { readControls } from "./mapping";
import { EMPTY_LAYOUT, FramePacer, STICK_X_MAX, TOUCH_DEFAULTS, loadLayout, readLayout, readTouch, saveLayout, shapeStick } from "./touchSettings";

describe("the touch settings", () => {
  it("read within their ranges; anything else its default", () => {
    expect(readTouch(undefined)).toEqual(TOUCH_DEFAULTS);
    expect(readTouch({ throttle: "split", fixedStick: true, stickSize: 9, sensitivity: 0.1, deadzone: 0.2 })).toEqual({
      throttle: "split",
      fixedStick: true,
      stickSize: 1.5,
      sensitivity: 0.5,
      deadzone: 0.2,
      frameRate: 60,
    });
    expect(readTouch({ throttle: "turbo", fixedStick: "yes", stickSize: Number.NaN, frameRate: 45 })).toEqual(TOUCH_DEFAULTS);
    expect(readTouch({ frameRate: 0 }).frameRate).toBe(0);
    expect(TOUCH_DEFAULTS.frameRate).toBe(60);
  });

  it("the Frame Rate, phase-locked to the screen (RV-1245): a minute of frames, jittered, every gap the cap's", () => {
    /** The gaps (in the screen's refreshes) between the frames drawn over a minute at `screenHz`, each frame's time
     *  jittered by up to ±`jitter` ms (a seeded sequence), the first second left out (the refresh measured) */
    const gaps = (screenHz: number, cap: number, jitter: number): Set<number> => {
      const pacer = new FramePacer();
      let seed = 7;
      const noise = (): number => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return (seed / 4294967296 - 0.5) * 2 * jitter;
      };
      const drawn: number[] = [];
      for (let i = 0; i < screenHz * 60; i++) if (pacer.due((i * 1000) / screenHz + noise(), cap) && i > screenHz) drawn.push(i);
      return new Set(drawn.slice(1).map((v, k) => v - (drawn[k] ?? v)));
    };
    expect(gaps(120, 60, 0.3)).toEqual(new Set([2]));
    expect(gaps(119.88, 60, 0.3)).toEqual(new Set([2]));
    expect(gaps(120.12, 60, 0.3)).toEqual(new Set([2]));
    expect(gaps(120, 30, 0.3)).toEqual(new Set([4]));
    expect(gaps(240, 60, 0.3)).toEqual(new Set([4]));
    expect(gaps(60, 60, 0.3)).toEqual(new Set([1]));
    expect(gaps(60.06, 60, 0.3)).toEqual(new Set([1]));
    expect(gaps(120, 0, 0.3)).toEqual(new Set([1]));
    // (a 90 Hz screen at 60: two frames in three, a refresh or two apart)
    expect(gaps(90, 60, 0.3)).toEqual(new Set([1, 2]));
  });

  it("the Frame Rate after a vsync missed: the cadence from the late frame, so the next keeps the interval (RV-1254)", () => {
    /** The gaps (refreshes) between frames drawn over a minute at `screenHz` and `cap`, `missed` of the vsyncs skipped */
    const gaps = (screenHz: number, cap: number, missed: number): Set<number> => {
      const pacer = new FramePacer();
      let seed = 3;
      const r = (): number => ((seed = (seed * 1664525 + 1013904223) % 4294967296), seed / 4294967296);
      const drawn: number[] = [];
      for (let i = 0; i < screenHz * 60; i++) {
        if (i > 10 && r() < missed) continue;
        if (pacer.due((i * 1000) / screenHz + (r() - 0.5) * 0.4, cap) && i > screenHz) drawn.push(i);
      }
      return new Set(drawn.slice(1).map((v, k) => v - (drawn[k] ?? v)));
    };
    expect([...gaps(120, 60, 0.02)].every((g) => g >= 2)).toBe(true);
    expect([...gaps(120, 30, 0.02)].every((g) => g >= 4)).toBe(true);
    // (a ratio's own half-refresh lateness doesn't count: 90 Hz at 60 still two frames in three)
    expect(gaps(90, 60, 0)).toEqual(new Set([1, 2]));
  });

  it("the Frame Rate: a long stall draws at once, the cadence from there", () => {
    const pacer = new FramePacer();
    expect(pacer.due(0, 60)).toBe(true);
    expect(pacer.due(8.3, 60)).toBe(false);
    expect(pacer.due(5000, 60)).toBe(true);
    expect(pacer.due(5008.3, 60)).toBe(false);
    expect(pacer.due(5016.7, 60)).toBe(true);
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
    ).toEqual({
      buttons: { jump: { x: 1, y: 0, scale: 1.6, opacity: 0.2, hidden: false }, hover: { scale: 1.1, opacity: 1, hidden: false } },
      others: { future: { anything: true }, version: 7 },
    });
    expect(readLayout("nonsense")).toEqual(EMPTY_LAYOUT);
    expect(readLayout({ buttons: { jump: [1, 2] } }).buttons["jump"]).toEqual({ scale: 1, opacity: 1, hidden: false });
    expect(loadLayout({ getItem: () => "{not json", setItem: () => undefined, removeItem: () => undefined })).toEqual(EMPTY_LAYOUT);
  });

  it("keeps a later page's fields of a button when this page saves it (an older tab, a rollback: RV-1236)", () => {
    const s = store();
    s.data.set("carball.touchLayout", JSON.stringify({ version: 2, buttons: { jump: { x: 0.8, y: 0.7, scale: 1, opacity: 1, hidden: false, tint: 3 } } }));
    const layout = loadLayout(s);
    saveLayout({ buttons: { jump: { ...(layout.buttons["jump"] ?? { scale: 1, opacity: 1, hidden: false }), scale: 1.2 } } }, s);
    expect(JSON.parse(s.data.get("carball.touchLayout") ?? "{}")).toMatchObject({ buttons: { jump: { scale: 1.2, tint: 3 } } });
  });

  it("keeps a later version's record whole when this page saves it: its fields, its stick's, its version (RV-1250)", () => {
    const s = store();
    s.data.set("carball.touchLayout", JSON.stringify({ version: 2, preset: "claw", buttons: {}, stick: { x: 0.2, y: 0.6, size: 1.3 } }));
    const layout = loadLayout(s);
    saveLayout({ ...layout, buttons: { jump: { scale: 1.2, opacity: 1, hidden: false } } }, s);
    expect(JSON.parse(s.data.get("carball.touchLayout") ?? "{}")).toEqual({
      version: 2,
      preset: "claw",
      buttons: { jump: { scale: 1.2, opacity: 1, hidden: false } },
      stick: { x: 0.2, y: 0.6, size: 1.3 },
    });
    // (an older record's version this page's)
    saveLayout({ buttons: { jump: { scale: 1, opacity: 1, hidden: true } } }, s);
    expect(JSON.parse(s.data.get("carball.touchLayout") ?? "{}")).toMatchObject({ version: 1 });
  });

  it("keeps the fixed stick in the left half, where a thumb takes it (RV-1233)", () => {
    expect(readLayout({ buttons: {}, stick: { x: 0.8, y: 0.6 } }).stick).toEqual({ x: STICK_X_MAX, y: 0.6 });
    expect(readLayout({ buttons: {}, stick: { x: 0.2, y: 0.6 } }).stick).toEqual({ x: 0.2, y: 0.6 });
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
