import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS } from "./bindings";
import { type InputSnapshot, axisDeadzone, radialDeadzone, readControls, readHeldActions } from "./mapping";

const keys = (...codes: string[]): InputSnapshot => ({ keys: new Set(codes), mouseButtons: new Set(), gamepad: null });
const mouse = (...buttons: number[]): InputSnapshot => ({ keys: new Set(), mouseButtons: new Set(buttons), gamepad: null });

function pad(axes: number[], pressed: Record<number, number> = {}): InputSnapshot {
  const buttons = Array.from({ length: 17 }, (_, i) => pressed[i] ?? 0);
  return { keys: new Set(), mouseButtons: new Set(), gamepad: { axes, buttons } };
}

describe("keyboard and mouse (DefaultInput.ini Standard preset)", () => {
  it("W drives forward and pitches the nose down", () => {
    const c = readControls(keys("KeyW"), DEFAULT_BINDINGS);
    expect(c.throttle).toBe(1);
    expect(c.pitch).toBe(-1);
  });

  it("S reverses and pitches the nose up", () => {
    const c = readControls(keys("KeyS"), DEFAULT_BINDINGS);
    expect(c.throttle).toBe(-1);
    expect(c.pitch).toBe(1);
  });

  it("A/D steer and yaw together", () => {
    const c = readControls(keys("KeyD"), DEFAULT_BINDINGS);
    expect(c.steer).toBe(1);
    expect(c.yaw).toBe(1);
    expect(c.roll).toBe(0);
  });

  it("holding air roll turns yaw input into roll", () => {
    const c = readControls(keys("KeyA", "ShiftLeft"), DEFAULT_BINDINGS);
    expect(c.yaw).toBe(0);
    expect(c.roll).toBe(-1);
    expect(c.handbrake).toBe(true); // same key powerslides on the ground
  });

  it("Q/E roll directly", () => {
    expect(readControls(keys("KeyE"), DEFAULT_BINDINGS).roll).toBe(1);
    expect(readControls(keys("KeyQ"), DEFAULT_BINDINGS).roll).toBe(-1);
  });

  it("left mouse boosts, right mouse jumps", () => {
    expect(readControls(mouse(0), DEFAULT_BINDINGS).boost).toBe(true);
    expect(readControls(mouse(2), DEFAULT_BINDINGS).jump).toBe(true);
  });

  it("actions: space is ball cam, backspace resets", () => {
    expect(readHeldActions(keys("Space"), DEFAULT_BINDINGS).ballCam).toBe(true);
    expect(readHeldActions(keys("Backspace"), DEFAULT_BINDINGS).reset).toBe(true);
  });
});

describe("gamepad (standard mapping)", () => {
  it("triggers are throttle and reverse with a 0.1 deadzone", () => {
    expect(readControls(pad([0, 0], { 7: 1 }), DEFAULT_BINDINGS).throttle).toBe(1);
    expect(readControls(pad([0, 0], { 6: 1 }), DEFAULT_BINDINGS).throttle).toBe(-1);
    expect(readControls(pad([0, 0], { 7: 0.05 }), DEFAULT_BINDINGS).throttle).toBe(0);
  });

  it("stick up pitches the nose down", () => {
    expect(readControls(pad([0, -1]), DEFAULT_BINDINGS).pitch).toBeCloseTo(-1);
  });

  it("small stick movements stay inside the deadzone", () => {
    const c = readControls(pad([0.2, 0.2]), DEFAULT_BINDINGS);
    expect(c.steer).toBe(0);
    expect(c.pitch).toBe(0);
  });

  it("A jumps, B boosts, X powerslides and air rolls", () => {
    expect(readControls(pad([0, 0], { 0: 1 }), DEFAULT_BINDINGS).jump).toBe(true);
    expect(readControls(pad([0, 0], { 1: 1 }), DEFAULT_BINDINGS).boost).toBe(true);
    const c = readControls(pad([1, 0], { 2: 1 }), DEFAULT_BINDINGS);
    expect(c.handbrake).toBe(true);
    expect(c.roll).toBeCloseTo(1);
    expect(c.yaw).toBe(0);
  });
});

describe("deadzones", () => {
  it("rescale outside the deadzone", () => {
    expect(axisDeadzone(0.55, 0.1)).toBeCloseTo(0.5);
    expect(axisDeadzone(-1, 0.1)).toBe(-1);
    const [x, y] = radialDeadzone(1, 0, 0.3);
    expect(x).toBeCloseTo(1);
    expect(y).toBe(0);
    expect(radialDeadzone(0.65, 0, 0.3)[0]).toBeCloseTo(0.5);
  });
});
