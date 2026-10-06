import { describe, expect, it } from "vitest";
import { DEFAULT_CONTROLLER_SETTINGS } from "../settings/settings";
import { type Bindings, DEFAULT_BINDINGS, inputName, keyName } from "./bindings";
import {
  type ControllerSettings,
  type InputSnapshot,
  axisDeadzone,
  radialDeadzone,
  readControls,
  readHeldActions,
  shapeInput,
} from "./mapping";

const S = DEFAULT_CONTROLLER_SETTINGS;
const keys = (...codes: string[]): InputSnapshot => ({ keys: new Set(codes), mouseButtons: new Set(), gamepad: null });
const mouse = (...buttons: number[]): InputSnapshot => ({ keys: new Set(), mouseButtons: new Set(buttons), gamepad: null });

function pad(axes: number[], pressed: Record<number, number> = {}): InputSnapshot {
  const buttons = Array.from({ length: 17 }, (_, i) => pressed[i] ?? 0);
  return { keys: new Set(), mouseButtons: new Set(), gamepad: { axes, buttons } };
}

const controls = (input: InputSnapshot, bindings: Bindings = DEFAULT_BINDINGS, s: ControllerSettings = S) =>
  readControls(input, bindings, s);

describe("default keyboard and mouse (DefaultInput.ini Standard preset)", () => {
  it("W drives forward and pitches the nose down", () => {
    const c = controls(keys("KeyW"));
    expect(c.throttle).toBe(1);
    expect(c.pitch).toBe(-1);
  });

  it("S reverses and pitches the nose up", () => {
    const c = controls(keys("KeyS"));
    expect(c.throttle).toBe(-1);
    expect(c.pitch).toBe(1);
  });

  it("A/D steer and yaw together", () => {
    const c = controls(keys("KeyD"));
    expect(c.steer).toBe(1);
    expect(c.yaw).toBe(1);
    expect(c.roll).toBe(0);
  });

  it("holding air roll turns yaw input into roll", () => {
    const c = controls(keys("KeyA", "ShiftLeft"));
    expect(c.yaw).toBe(0);
    expect(c.roll).toBe(-1);
    expect(c.handbrake).toBe(true); // same key powerslides on the ground
  });

  it("Q/E roll directly", () => {
    expect(controls(keys("KeyE")).roll).toBe(1);
    expect(controls(keys("KeyQ")).roll).toBe(-1);
  });

  it("left mouse boosts, right mouse jumps", () => {
    expect(controls(mouse(0)).boost).toBe(true);
    expect(controls(mouse(2)).jump).toBe(true);
  });

  it("actions: space is ball cam, backspace resets", () => {
    expect(readHeldActions(keys("Space"), DEFAULT_BINDINGS, S).ballCam).toBe(true);
    expect(readHeldActions(keys("Backspace"), DEFAULT_BINDINGS, S).reset).toBe(true);
  });
});

describe("default gamepad (standard mapping)", () => {
  it("triggers are throttle and reverse with a 0.1 deadzone", () => {
    expect(controls(pad([0, 0], { 7: 1 })).throttle).toBe(1);
    expect(controls(pad([0, 0], { 6: 1 })).throttle).toBe(-1);
    expect(controls(pad([0, 0], { 7: 0.05 })).throttle).toBe(0);
  });

  it("stick up pitches the nose down", () => {
    expect(controls(pad([0, -1])).pitch).toBeCloseTo(-1);
  });

  it("small stick movements stay inside the deadzone", () => {
    const c = controls(pad([0.2, 0.2]));
    expect(c.steer).toBe(0);
    expect(c.pitch).toBe(0);
  });

  it("A jumps, B boosts, X powerslides and air rolls", () => {
    expect(controls(pad([0, 0], { 0: 1 })).jump).toBe(true);
    expect(controls(pad([0, 0], { 1: 1 })).boost).toBe(true);
    const c = controls(pad([1, 0], { 2: 1 }));
    expect(c.handbrake).toBe(true);
    expect(c.roll).toBeCloseTo(1);
    expect(c.yaw).toBe(0);
  });
});

describe("custom bindings", () => {
  it("rebinding moves an action to another input", () => {
    const custom: Bindings = {
      ...DEFAULT_BINDINGS,
      jump: { keyboard: { kind: "key", code: "Space" }, gamepad: { kind: "padButton", button: 4 } },
      boost: { keyboard: { kind: "key", code: "ShiftLeft" }, gamepad: null },
    };
    expect(controls(keys("Space"), custom).jump).toBe(true);
    expect(controls(mouse(2), custom).jump).toBe(false);
    expect(controls(pad([0, 0], { 4: 1 }), custom).jump).toBe(true);
    expect(controls(keys("ShiftLeft"), custom).boost).toBe(true);
  });

  it("a stick direction can drive a button action", () => {
    const custom: Bindings = { ...DEFAULT_BINDINGS, boost: { keyboard: null, gamepad: { kind: "padAxis", axis: 3, sign: -1 } } };
    expect(controls(pad([0, 0, 0, -1]), custom).boost).toBe(true);
    expect(controls(pad([0, 0, 0, 1]), custom).boost).toBe(false);
  });

  it("an unbound action does nothing", () => {
    const custom: Bindings = { ...DEFAULT_BINDINGS, throttleForward: { keyboard: null, gamepad: null } };
    expect(controls(keys("KeyW"), custom).throttle).toBe(0);
  });
});

describe("controller settings", () => {
  it("sensitivity scales then clamps; 10 is digital", () => {
    expect(shapeInput(0.4, 2)).toBeCloseTo(0.8);
    expect(shapeInput(0.8, 2)).toBe(1);
    expect(shapeInput(0.1, 10)).toBe(1);
    expect(shapeInput(-0.1, 10)).toBe(-1);
  });

  it("steering and aerial sensitivity apply to the stick", () => {
    const s = { ...S, steeringSensitivity: 2, aerialSensitivity: 1.5 };
    const c = controls(pad([0.65, 0]), DEFAULT_BINDINGS, s); // 0.5 after the 0.3 deadzone
    expect(c.steer).toBeCloseTo(1);
    expect(c.yaw).toBeCloseTo(0.75);
  });

  it("a larger deadzone ignores more", () => {
    expect(controls(pad([0.4, 0]), DEFAULT_BINDINGS, { ...S, stickDeadzone: 0.5 }).steer).toBe(0);
  });

  it("deadzones rescale outside the deadzone", () => {
    expect(axisDeadzone(0.55, 0.1)).toBeCloseTo(0.5);
    expect(axisDeadzone(-1, 0.1)).toBe(-1);
    expect(radialDeadzone(1, 0, 0.3)[0]).toBeCloseTo(1);
    expect(radialDeadzone(0.65, 0, 0.3)[0]).toBeCloseTo(0.5);
  });
});

describe("input names", () => {
  it("are readable", () => {
    expect(keyName("KeyW")).toBe("W");
    expect(keyName("ShiftLeft")).toBe("Left Shift");
    expect(keyName("ControlRight")).toBe("Right Ctrl");
    expect(keyName("Digit1")).toBe("1");
    expect(inputName({ kind: "mouse", button: 2 })).toBe("Right mouse");
    expect(inputName({ kind: "padButton", button: 7 })).toBe("RT");
    expect(inputName({ kind: "padAxis", axis: 1, sign: -1 })).toBe("Left stick up");
    expect(inputName(null)).toBe("—");
  });
});
