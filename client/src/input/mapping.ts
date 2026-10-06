// Turns a snapshot of held keys/buttons/axes into car controls. Pure, so it is unit-tested.
import type { CarControls } from "../engine/world";
import type { Action, Bindings, GamepadInput, KeyboardInput } from "./bindings";

export interface GamepadSnapshot {
  readonly axes: readonly number[];
  readonly buttons: readonly number[]; // 0..1 (analog triggers) or 0/1
}

export interface InputSnapshot {
  readonly keys: ReadonlySet<string>;
  readonly mouseButtons: ReadonlySet<number>;
  readonly gamepad: GamepadSnapshot | null;
}

export const EMPTY_INPUT: InputSnapshot = { keys: new Set(), mouseButtons: new Set(), gamepad: null };

/** Controller settings (the game's Controls menu). */
export interface ControllerSettings {
  readonly stickDeadzone: number; // circular, per stick
  readonly triggerDeadzone: number; // analog buttons (triggers)
  readonly steeringSensitivity: number; // shapes steer
  readonly aerialSensitivity: number; // shapes pitch, yaw, roll
}

/** Held state of the non-driving actions; the caller detects presses. */
export interface HeldActions {
  readonly ballCam: boolean;
  readonly reset: boolean;
  readonly ballInFront: boolean;
  readonly ballOnCar: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** One axis: zero inside the deadzone, rescaled to 0..1 outside it. */
export function axisDeadzone(v: number, deadzone: number): number {
  const mag = Math.abs(v);
  if (mag <= deadzone) return 0;
  return (Math.sign(v) * (mag - deadzone)) / (1 - deadzone);
}

/** A stick: zero inside a circular deadzone, magnitude rescaled outside it. */
export function radialDeadzone(x: number, y: number, deadzone: number): readonly [number, number] {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone) return [0, 0];
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  return [(x / mag) * scaled, (y / mag) * scaled];
}

/** The game's input shaping (FUN_140396ca0): clamp(input * sensitivity), or digital at the maximum (10). */
export function shapeInput(v: number, sensitivity: number): number {
  if (sensitivity >= 10) return Math.sign(v);
  return clamp(v * sensitivity, -1, 1);
}

/** Stick axes after the circular deadzone (sticks are axis pairs 0/1, 2/3). */
function stickAxes(pad: GamepadSnapshot, deadzone: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < pad.axes.length; i += 2) {
    const [x, y] = radialDeadzone(pad.axes[i] ?? 0, pad.axes[i + 1] ?? 0, deadzone);
    out.push(x, y);
  }
  return out;
}

function keyboardValue(input: InputSnapshot, binding: KeyboardInput | null): number {
  if (binding === null) return 0;
  return (binding.kind === "key" ? input.keys.has(binding.code) : input.mouseButtons.has(binding.button)) ? 1 : 0;
}

function gamepadValue(sticks: readonly number[], pad: GamepadSnapshot | null, binding: GamepadInput | null, s: ControllerSettings): number {
  if (binding === null || pad === null) return 0;
  if (binding.kind === "padButton") return axisDeadzone(pad.buttons[binding.button] ?? 0, s.triggerDeadzone);
  return Math.max(0, (sticks[binding.axis] ?? 0) * binding.sign);
}

/** How strongly each action is held, 0..1. */
export function actionValues(input: InputSnapshot, bindings: Bindings, s: ControllerSettings): Record<Action, number> {
  const sticks = input.gamepad ? stickAxes(input.gamepad, s.stickDeadzone) : [];
  const values = {} as Record<Action, number>;
  for (const action of Object.keys(bindings) as Action[]) {
    const b = bindings[action];
    values[action] = Math.max(keyboardValue(input, b.keyboard), gamepadValue(sticks, input.gamepad, b.gamepad, s));
  }
  return values;
}

export function readControls(input: InputSnapshot, bindings: Bindings, s: ControllerSettings): CarControls {
  const v = actionValues(input, bindings, s);
  const yaw = v.yawRight - v.yawLeft;
  const airRoll = v.airRoll > 0.5;
  return {
    throttle: clamp(v.throttleForward - v.throttleReverse, -1, 1),
    steer: shapeInput(v.steerRight - v.steerLeft, s.steeringSensitivity),
    pitch: shapeInput(v.pitchUp - v.pitchDown, s.aerialSensitivity),
    // Holding air roll turns yaw input into roll
    yaw: airRoll ? 0 : shapeInput(yaw, s.aerialSensitivity),
    roll: shapeInput(v.rollRight - v.rollLeft + (airRoll ? yaw : 0), s.aerialSensitivity),
    jump: v.jump > 0.5,
    boost: v.boost > 0.5,
    handbrake: v.handbrake > 0.5,
  };
}

export function readHeldActions(input: InputSnapshot, bindings: Bindings, s: ControllerSettings): HeldActions {
  const v = actionValues(input, bindings, s);
  return { ballCam: v.ballCam > 0.5, reset: v.reset > 0.5, ballInFront: v.ballInFront > 0.5, ballOnCar: v.ballOnCar > 0.5 };
}
