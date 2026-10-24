import { describe, expect, it } from "vitest";
import { NO_CONTROLS } from "../engine/world";
import { type Bindings, DEFAULT_BINDINGS, inputName, keyName } from "./bindings";
import {
  AirPitchSafety,
  ButtonLatch,
  type InputEvent,
  type InputSnapshot,
  JumpLatch,
  axisDeadzone,
  readControls,
  readHeldActions,
  readLook,
  chatPresses,
} from "./mapping";

const DZ = 0.2; // the game's default controller deadzone
const keys = (...codes: string[]): InputSnapshot => ({ keys: new Set(codes), mouseButtons: new Set(), gamepad: null });
const mouse = (...buttons: number[]): InputSnapshot => ({ keys: new Set(), mouseButtons: new Set(buttons), gamepad: null });
const both = (codes: string[], buttons: number[]): InputSnapshot => ({ keys: new Set(codes), mouseButtons: new Set(buttons), gamepad: null });

function pad(axes: number[], pressed: Record<number, number> = {}): InputSnapshot {
  const buttons = Array.from({ length: 17 }, (_, i) => pressed[i] ?? 0);
  return { keys: new Set(), mouseButtons: new Set(), gamepad: { axes, buttons } };
}

const controls = (input: InputSnapshot, bindings: Bindings = DEFAULT_BINDINGS, deadzone = DZ) => readControls(input, bindings, deadzone);

describe("default keyboard and mouse (the live game's Modern preset)", () => {
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
    const c = controls(both(["KeyA"], [2]));
    expect(c.yaw).toBe(0);
    expect(c.roll).toBe(-1);
    expect(c.handbrake).toBe(true); // same button (right mouse) powerslides on the ground
  });

  it("free air roll replaces directional roll (PlayerInput_TA.PlayerInput)", () => {
    expect(controls(both(["KeyE"], [2])).roll).toBe(0);
    expect(controls(both(["KeyE", "KeyA"], [2])).roll).toBe(-1);
  });

  it("Q/E roll directly", () => {
    expect(controls(keys("KeyE")).roll).toBe(1);
    expect(controls(keys("KeyQ")).roll).toBe(-1);
  });

  it("space and left mouse (the alternative jump) jump, left shift boosts", () => {
    expect(controls(keys("Space")).jump).toBe(true);
    expect(controls(mouse(0)).jump).toBe(true);
    expect(controls(mouse(0)).boost).toBe(false);
    expect(controls(keys("ShiftLeft")).boost).toBe(true);
  });

  it("actions: middle mouse is ball cam, left ctrl rear camera, backspace resets", () => {
    expect(readHeldActions(mouse(1), DEFAULT_BINDINGS, DZ).ballCam.keyDown).toBe(true);
    expect(readHeldActions(keys("ControlLeft"), DEFAULT_BINDINGS, DZ).rearCamera.keyDown).toBe(true);
    expect(readHeldActions(keys("Backspace"), DEFAULT_BINDINGS, DZ).reset.keyDown).toBe(true);
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

  it("A jumps, B boosts, X powerslides, the left trigger air rolls (and reverses)", () => {
    expect(controls(pad([0, 0], { 0: 1 })).jump).toBe(true);
    expect(controls(pad([0, 0], { 1: 1 })).boost).toBe(true);
    const x = controls(pad([1, 0], { 2: 1 }));
    expect(x.handbrake).toBe(true);
    expect(x.roll).toBe(0); // (X no longer air rolls: the Modern layout)
    const c = controls(pad([1, 0], { 6: 1 }));
    expect(c.roll).toBeCloseTo(1);
    expect(c.yaw).toBe(0);
    expect(c.throttle).toBe(-1);
  });

  it("the right stick swivels the camera", () => {
    // Pushed up: SwivelDown (the game's binding), which the default inverted swivel pitch turns into looking up
    expect(readLook(pad([0, 0, 0, -1]), DEFAULT_BINDINGS, DZ)).toEqual({ up: -1, right: 0 });
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

describe("several inputs on one action (controls audit C-4)", () => {
  const withPad = (codes: string[], buttons: Record<number, number>): InputSnapshot => ({
    keys: new Set(codes),
    mouseButtons: new Set(),
    gamepad: { axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => buttons[i] ?? 0) },
  });

  it("sums the axes of every input, then clamps the control", () => {
    // W (throttle 1) and RT at 0.6 (throttle, after the trigger deadzone) against LT at 0.8 (reverse); taking the
    // larger of W and RT instead would give 1 - LT
    const trigger = (v: number) => axisDeadzone(v, 0.1);
    expect(controls(withPad(["KeyW"], { 7: 0.6, 6: 0.8 })).throttle).toBeCloseTo(1 + trigger(0.6) - trigger(0.8), 6);
    expect(controls(withPad(["KeyW"], { 7: 1 })).throttle).toBe(1);
  });

  it("buttons follow the last press or release: releasing one of two inputs releases the command", () => {
    const latch = new ButtonLatch();
    const read = (codes: string[], buttons: Record<number, number>) => readControls(withPad(codes, buttons), DEFAULT_BINDINGS, DZ, latch);
    expect(read(["Space"], {}).jump).toBe(true);
    expect(read(["Space"], { 0: 1 }).jump).toBe(true); // A too
    expect(read(["Space"], {}).jump).toBe(false); // A let go: ToggleJump(false), Space still down
    expect(read(["Space"], {}).jump).toBe(false);
    expect(read([], {}).jump).toBe(false);
    expect(read(["Space"], {}).jump).toBe(true);
    // The alternative jump (left mouse) is the same command
    const latch2 = new ButtonLatch();
    const both2 = (codes: string[], buttons: number[]) =>
      readControls({ keys: new Set(codes), mouseButtons: new Set(buttons), gamepad: null }, DEFAULT_BINDINGS, DZ, latch2);
    expect(both2(["Space"], [0]).jump).toBe(true);
    expect(both2(["Space"], []).jump).toBe(false);
    // Without a latch: held while any input is
    expect(controls(withPad(["Space"], {})).jump).toBe(true);
  });
});

describe("gamepad buttons and triggers as buttons (controls audit C-5)", () => {
  const padWith = (buttons: Record<number, number>): InputSnapshot => ({
    keys: new Set(),
    mouseButtons: new Set(),
    gamepad: { axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => buttons[i] ?? 0) },
  });
  const boostButton = DEFAULT_BINDINGS.boost.gamepad;

  it("count as pressed past raw 30/255 of their travel, as the game's digital threshold", () => {
    if (boostButton?.kind !== "padButton") throw new Error("boost isn't on a pad button");
    expect(controls(padWith({ [boostButton.button]: 0.11 })).boost).toBe(false);
    expect(controls(padWith({ [boostButton.button]: 0.13 })).boost).toBe(true);
  });

  it("while a trigger driving an axis keeps its 0.1 deadzone (measured live)", () => {
    expect(controls(padWith({ 7: 0.13 })).throttle).toBeCloseTo(axisDeadzone(0.13, 0.1), 6);
  });
});

describe("the controller default: the left trigger is reverse and air roll (the game's Modern layout)", () => {
  const lt = (value: number, axes: number[] = [0, 0, 0, 0]): InputSnapshot => ({
    keys: new Set(),
    mouseButtons: new Set(),
    gamepad: { axes, buttons: Array.from({ length: 17 }, (_, i) => (i === 6 ? value : 0)) },
  });

  it("binds both actions to it", () => {
    expect(DEFAULT_BINDINGS.throttleReverse.gamepad).toEqual({ kind: "padButton", button: 6 });
    expect(DEFAULT_BINDINGS.airRoll.gamepad).toEqual({ kind: "padButton", button: 6 });
  });

  it("drives both: reverse with the trigger's 0.1 deadzone, air roll past 30/255 (the stick's yaw becomes roll)", () => {
    const half = controls(lt(0.5, [1, 0, 0, 0]));
    expect(half.throttle).toBeCloseTo(-axisDeadzone(0.5, 0.1), 6);
    expect(half.yaw).toBe(0);
    expect(half.roll).toBeCloseTo(axisDeadzone(1, DZ), 6);
    // Past the deadzone but under the digital threshold: a little reverse, no air roll
    const light = controls(lt(0.115, [1, 0, 0, 0]));
    expect(light.throttle).toBeCloseTo(-axisDeadzone(0.115, 0.1), 6);
    expect(light.roll).toBe(0);
    expect(light.yaw).toBeCloseTo(axisDeadzone(1, DZ), 6);
    expect(controls(lt(0.12, [1, 0, 0, 0])).roll).toBeCloseTo(axisDeadzone(1, DZ), 6);
  });
});

describe("inputs between frames (notes/client-loop-timing.md LT-4..6)", () => {
  /** A frame's snapshot: held keys, and keys pressed and let go since the last one */
  const frame = (held: string[], pressed: string[] = [], released: string[] = []): InputSnapshot => ({
    keys: new Set(held),
    mouseButtons: new Set(),
    pressedKeys: new Set(pressed),
    releasedKeys: new Set(released),
    gamepad: null,
  });
  const boostKey = DEFAULT_BINDINGS.boost.keyboard;
  const boostCode = boostKey?.kind === "key" ? boostKey.code : "ShiftLeft";

  it("a boost or powerslide tap within one frame is lost: the release comes before the frame's ticks (LT-5)", () => {
    const latch = new ButtonLatch();
    expect(readControls(frame([], [boostCode], [boostCode]), DEFAULT_BINDINGS, DZ, latch).boost).toBe(false);
    expect(readControls(frame([boostCode], [boostCode]), DEFAULT_BINDINGS, DZ, latch).boost).toBe(true);
    expect(readControls(frame([], [], [boostCode]), DEFAULT_BINDINGS, DZ, latch).boost).toBe(false);
  });

  it("a jump tap within one frame is exactly one tick of jump, at 30 fps too (LT-4)", () => {
    const latch = new ButtonLatch();
    const jump = new JumpLatch();
    const c = readControls(frame([], ["Space"], ["Space"]), DEFAULT_BINDINGS, DZ, latch);
    jump.frame(latch);
    expect(c.jump).toBe(false);
    // 30 fps: four ticks this frame
    expect([0, 1, 2, 3].map(() => jump.tick(c.jump))).toEqual([true, false, false, false]);
  });

  it("a jump tap in a frame with no tick jumps on the next tick (LT-4)", () => {
    const latch = new ButtonLatch();
    const jump = new JumpLatch();
    readControls(frame([], ["Space"], ["Space"]), DEFAULT_BINDINGS, DZ, latch);
    jump.frame(latch); // (no tick: 144 Hz)
    const next = readControls(frame([]), DEFAULT_BINDINGS, DZ, latch);
    jump.frame(latch);
    expect(jump.tick(next.jump)).toBe(true);
    expect(jump.tick(next.jump)).toBe(false);
  });

  it("a held jump is held every tick; the key's repeat is no new press", () => {
    const latch = new ButtonLatch();
    const jump = new JumpLatch();
    readControls(frame(["Space"], ["Space"]), DEFAULT_BINDINGS, DZ, latch);
    jump.frame(latch);
    const held = readControls(frame(["Space"]), DEFAULT_BINDINGS, DZ, latch);
    jump.frame(latch);
    expect(latch.pressed("jump")).toBe(false);
    expect([jump.tick(held.jump), jump.tick(held.jump)]).toEqual([true, true]);
  });

  it("a keyboard axis key let go since the last frame still counts in full this frame, then not (LT-6)", () => {
    expect(controls(frame([], [], ["KeyW"])).throttle).toBe(1);
    expect(controls(frame([], ["KeyD"], ["KeyD"])).steer).toBe(1); // (a tap too)
    expect(controls(frame([])).throttle).toBe(0);
    // Not buttons: a boost key let go is let go
    expect(readControls(frame([], [], [boostCode]), DEFAULT_BINDINGS, DZ, new ButtonLatch()).boost).toBe(false);
  });
});

describe("events in the order they came (RV-3)", () => {
  const frame = (held: string[], buttons: number[], events: readonly InputEvent[]): InputSnapshot => ({
    keys: new Set(held),
    mouseButtons: new Set(buttons),
    events,
    gamepad: null,
  });

  it("hold Space, then in one frame press the left mouse (the alternative jump) and let go of Space: jump released", () => {
    const latch = new ButtonLatch();
    expect(readControls(frame(["Space"], [], [{ kind: "key", code: "Space", down: true }]), DEFAULT_BINDINGS, DZ, latch).jump).toBe(true);
    const next = frame(
      [],
      [0],
      [
        { kind: "mouse", button: 0, down: true },
        { kind: "key", code: "Space", down: false },
      ],
    );
    expect(readControls(next, DEFAULT_BINDINGS, DZ, latch).jump).toBe(false);
    expect(readControls(frame([], [0], []), DEFAULT_BINDINGS, DZ, latch).jump).toBe(false);
  });

  it("the other way round (let go of Space, then press the left mouse): jump held", () => {
    const latch = new ButtonLatch();
    readControls(frame(["Space"], [], [{ kind: "key", code: "Space", down: true }]), DEFAULT_BINDINGS, DZ, latch);
    const next = frame(
      [],
      [0],
      [
        { kind: "key", code: "Space", down: false },
        { kind: "mouse", button: 0, down: true },
      ],
    );
    expect(readControls(next, DEFAULT_BINDINGS, DZ, latch).jump).toBe(true);
    expect(readControls(frame([], [0], []), DEFAULT_BINDINGS, DZ, latch).jump).toBe(true);
  });
});

describe("inputs between frames, from the ordered event list (LT-4/5 as the browser delivers them)", () => {
  const boostKey = DEFAULT_BINDINGS.boost.keyboard;
  const boostCode = boostKey?.kind === "key" ? boostKey.code : "ShiftLeft";
  const tap = (code: string): InputSnapshot => ({
    keys: new Set(),
    mouseButtons: new Set(),
    pressedKeys: new Set([code]),
    releasedKeys: new Set([code]),
    events: [
      { kind: "key", code, down: true },
      { kind: "key", code, down: false },
    ],
    gamepad: null,
  });
  const idle: InputSnapshot = { keys: new Set(), mouseButtons: new Set(), events: [], gamepad: null };

  it("a boost tap within one frame is lost (LT-5)", () => {
    expect(readControls(tap(boostCode), DEFAULT_BINDINGS, DZ, new ButtonLatch()).boost).toBe(false);
  });

  it("a jump tap within one frame is one tick of jump, also from a frame with no tick (LT-4)", () => {
    const latch = new ButtonLatch();
    const jump = new JumpLatch();
    const c = readControls(tap("Space"), DEFAULT_BINDINGS, DZ, latch);
    jump.frame(latch);
    expect(c.jump).toBe(false);
    const next = readControls(idle, DEFAULT_BINDINGS, DZ, latch);
    jump.frame(latch);
    expect([jump.tick(next.jump), jump.tick(next.jump)]).toEqual([true, false]);
  });
});

describe("more inputs from the ordered event list (review test gaps)", () => {
  const frame = (o: Partial<InputSnapshot>): InputSnapshot => ({ keys: new Set(), mouseButtons: new Set(), events: [], gamepad: null, ...o });

  it("a right-mouse tap within one frame is lost: neither powerslide nor air roll (LT-5)", () => {
    const tap = frame({
      pressedMouseButtons: new Set([2]),
      releasedMouseButtons: new Set([2]),
      events: [
        { kind: "mouse", button: 2, down: true },
        { kind: "mouse", button: 2, down: false },
      ],
    });
    const c = readControls(tap, DEFAULT_BINDINGS, DZ, new ButtonLatch());
    expect(c.handbrake).toBe(false);
    expect(c.roll).toBe(0);
  });

  it("the alternative jump pressed while Space is held: jump stays held and its press latches a tick (LT-4)", () => {
    const latch = new ButtonLatch();
    readControls(frame({ keys: new Set(["Space"]), events: [{ kind: "key", code: "Space", down: true }] }), DEFAULT_BINDINGS, DZ, latch);
    const second = readControls(
      frame({ keys: new Set(["Space"]), mouseButtons: new Set([0]), events: [{ kind: "mouse", button: 0, down: true }] }),
      DEFAULT_BINDINGS,
      DZ,
      latch,
    );
    expect(second.jump).toBe(true);
    expect(latch.pressed("jump")).toBe(true);
  });

  it("the pad's buttons, polled once a frame, press past raw 30/255 with an event list too (C-5)", () => {
    const bButton = (value: number) => ({ axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => (i === 1 ? value : 0)) });
    const latch = new ButtonLatch();
    expect(readControls(frame({ gamepad: bButton(0.1) }), DEFAULT_BINDINGS, DZ, latch).boost).toBe(false);
    expect(readControls(frame({ gamepad: bButton(0.2) }), DEFAULT_BINDINGS, DZ, latch).boost).toBe(true);
    expect(readControls(frame({ gamepad: bButton(0) }), DEFAULT_BINDINGS, DZ, latch).boost).toBe(false);
  });
});

describe("quick chat's presses (CHAT-7)", () => {
  const key = (keyPressed: boolean, padDown = false): { keyPressed: boolean; padDown: boolean } => ({ keyPressed, padDown });
  it("a key's every tap, in back-to-back frames too; a pad button's press once while held", () => {
    const idle = [key(false), key(false), key(false), key(false)];
    const tap = [key(true), key(false), key(false), key(false)];
    expect(chatPresses(tap, idle)).toEqual([0]);
    expect(chatPresses(tap, tap)).toEqual([0]); // (released and tapped again between frames: a second press)
    const padHeld = [key(false), key(false, true), key(false), key(false)];
    expect(chatPresses(padHeld, idle)).toEqual([1]);
    expect(chatPresses(padHeld, padHeld)).toEqual([]); // (held)
  });
});
