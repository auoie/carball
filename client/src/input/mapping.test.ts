import { describe, expect, it } from "vitest";
import { NO_CONTROLS } from "../engine/world";
import { type Bindings, DEFAULT_BINDINGS, inputName, keyName } from "./bindings";
import { AirPitchSafety, type InputSnapshot, axisDeadzone, readControls, readHeldActions, readLook } from "./mapping";

const DZ = 0.2; // the game's default controller deadzone
const keys = (...codes: string[]): InputSnapshot => ({ keys: new Set(codes), mouseButtons: new Set(), gamepad: null });
const mouse = (...buttons: number[]): InputSnapshot => ({ keys: new Set(), mouseButtons: new Set(buttons), gamepad: null });

function pad(axes: number[], pressed: Record<number, number> = {}): InputSnapshot {
  const buttons = Array.from({ length: 17 }, (_, i) => pressed[i] ?? 0);
  return { keys: new Set(), mouseButtons: new Set(), gamepad: { axes, buttons } };
}

const controls = (input: InputSnapshot, bindings: Bindings = DEFAULT_BINDINGS, deadzone = DZ) =>
  readControls(input, bindings, deadzone);

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

  it("free air roll replaces directional roll (PlayerInput_TA.PlayerInput)", () => {
    expect(controls(keys("KeyE", "ShiftLeft")).roll).toBe(0);
    expect(controls(keys("KeyE", "KeyA", "ShiftLeft")).roll).toBe(-1);
  });

  it("Q/E roll directly", () => {
    expect(controls(keys("KeyE")).roll).toBe(1);
    expect(controls(keys("KeyQ")).roll).toBe(-1);
  });

  it("left mouse boosts, right mouse jumps", () => {
    expect(controls(mouse(0)).boost).toBe(true);
    expect(controls(mouse(2)).jump).toBe(true);
  });

  it("actions: space is ball cam, middle mouse rear camera, backspace resets", () => {
    expect(readHeldActions(keys("Space"), DEFAULT_BINDINGS, DZ).ballCam).toBe(true);
    expect(readHeldActions(mouse(1), DEFAULT_BINDINGS, DZ).rearCamera).toBe(true);
    expect(readHeldActions(keys("Backspace"), DEFAULT_BINDINGS, DZ).reset).toBe(true);
  });

  it("controls carry no shaping: the engine applies the sensitivities", () => {
    expect(controls(pad([0.6, 0])).steer).toBeCloseTo(0.5);
  });
});

describe("default gamepad (standard mapping)", () => {
  it("triggers are throttle and reverse with their own 0.1 deadzone", () => {
    expect(controls(pad([0, 0], { 7: 1 })).throttle).toBe(1);
    expect(controls(pad([0, 0], { 6: 1 })).throttle).toBe(-1);
    expect(controls(pad([0, 0], { 7: 0.05 })).throttle).toBe(0);
    expect(controls(pad([0, 0], { 7: 0.55 })).throttle).toBeCloseTo(0.5);
  });

  it("stick up pitches the nose down", () => {
    expect(controls(pad([0, -1])).pitch).toBeCloseTo(-1);
  });

  it("the deadzone applies to each axis on its own (not a circle)", () => {
    // Diagonal down-right (0.3, 0.3): each axis is past 0.2, so both count; a circular deadzone would scale them together
    const c = controls(pad([0.3, 0.3]));
    expect(c.steer).toBeCloseTo(0.125);
    expect(c.pitch).toBeCloseTo(0.125); // stick down = nose up
    // Straight right with a little vertical drift: the drift is ignored
    const d = controls(pad([1, 0.15]));
    expect(d.steer).toBe(1);
    expect(d.pitch).toBe(0);
  });

  it("A jumps, B boosts, X powerslides and air rolls", () => {
    expect(controls(pad([0, 0], { 0: 1 })).jump).toBe(true);
    expect(controls(pad([0, 0], { 1: 1 })).boost).toBe(true);
    const c = controls(pad([1, 0], { 2: 1 }));
    expect(c.handbrake).toBe(true);
    expect(c.roll).toBeCloseTo(1);
    expect(c.yaw).toBe(0);
  });

  it("the right stick swivels the camera", () => {
    expect(readLook(pad([0, 0, 0, -1]), DEFAULT_BINDINGS, DZ)).toEqual({ up: 1, right: 0 });
    expect(readLook(pad([0, 0, 1, 0]), DEFAULT_BINDINGS, DZ)).toEqual({ up: 0, right: 1 });
    expect(readLook(pad([0, 0, 0.1, 0.1]), DEFAULT_BINDINGS, DZ)).toEqual({ up: 0, right: 0 });
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

describe("deadzone", () => {
  it("rescales outside the deadzone", () => {
    expect(axisDeadzone(0.6, 0.2)).toBeCloseTo(0.5);
    expect(axisDeadzone(-1, 0.2)).toBe(-1);
    expect(axisDeadzone(0.15, 0.2)).toBe(0);
    expect(axisDeadzone(0.4, 0)).toBe(0.4);
  });

  it("a larger deadzone ignores more", () => {
    expect(controls(pad([0.4, 0]), DEFAULT_BINDINGS, 0.5).steer).toBe(0);
  });
});

describe("air pitch safety (PlayerController_TA.ApplyAirPitchSafety)", () => {
  const W = { ...NO_CONTROLS, pitch: -1 };

  it("holding nose-down off the ground does nothing until released", () => {
    const s = new AirPitchSafety();
    expect(s.update(true, false, true, W)).toBe(true); // on the ground holding W
    expect(s.update(true, false, false, W)).toBe(true); // jumped, still holding W: no pitch
    expect(s.update(true, false, false, NO_CONTROLS)).toBe(false); // released
    expect(s.update(true, false, false, W)).toBe(false); // pressed again in the air: pitches
  });

  it("rolling also ends it", () => {
    const s = new AirPitchSafety();
    s.update(true, false, true, W);
    expect(s.update(true, false, false, { ...W, roll: 1 })).toBe(false);
    expect(s.update(true, false, false, W)).toBe(false);
  });

  it("off for gamepads and when disabled", () => {
    expect(new AirPitchSafety().update(true, true, false, W)).toBe(false);
    expect(new AirPitchSafety().update(false, false, false, W)).toBe(false);
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
