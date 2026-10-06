// Turns a snapshot of held keys/buttons/axes into car controls. Pure, so it is unit-tested.
import type { CarControls } from "../engine/world";
import {
  type Bindings,
  type ButtonInput,
  GAMEPAD_STICK_DEADZONE,
  GAMEPAD_TRIGGER_DEADZONE,
  PAD_AXIS_LEFT_X,
  PAD_AXIS_LEFT_Y,
  PAD_BUTTON_LEFT_TRIGGER,
  PAD_BUTTON_RIGHT_TRIGGER,
} from "./bindings";

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

function isHeld(input: InputSnapshot, binding: ButtonInput): boolean {
  switch (binding.kind) {
    case "key":
      return input.keys.has(binding.code);
    case "mouse":
      return input.mouseButtons.has(binding.button);
    case "pad":
      return (input.gamepad?.buttons[binding.button] ?? 0) > 0.5;
  }
}

const anyHeld = (input: InputSnapshot, bindings: readonly ButtonInput[]): boolean =>
  bindings.some((b) => isHeld(input, b));
const digital = (input: InputSnapshot, bindings: readonly ButtonInput[]): number => (anyHeld(input, bindings) ? 1 : 0);

export function readControls(input: InputSnapshot, b: Bindings): CarControls {
  const pad = input.gamepad;
  const [stickX, stickY] = pad
    ? radialDeadzone(pad.axes[PAD_AXIS_LEFT_X] ?? 0, pad.axes[PAD_AXIS_LEFT_Y] ?? 0, GAMEPAD_STICK_DEADZONE)
    : [0, 0];
  const rightTrigger = axisDeadzone(pad?.buttons[PAD_BUTTON_RIGHT_TRIGGER] ?? 0, GAMEPAD_TRIGGER_DEADZONE);
  const leftTrigger = axisDeadzone(pad?.buttons[PAD_BUTTON_LEFT_TRIGGER] ?? 0, GAMEPAD_TRIGGER_DEADZONE);

  const forward = digital(input, b.throttleForward);
  const reverse = digital(input, b.throttleReverse);
  const throttle = clamp(forward - reverse + rightTrigger - leftTrigger, -1, 1);

  // Steering and yaw share one axis; pitch shares the throttle keys (forward = nose down).
  const steer = clamp(digital(input, b.steerRight) - digital(input, b.steerLeft) + stickX, -1, 1);
  const pitch = clamp(reverse - forward + stickY, -1, 1);
  const directionalRoll = digital(input, b.rollRight) - digital(input, b.rollLeft);

  const airRoll = anyHeld(input, b.airRoll);
  return {
    throttle,
    steer,
    pitch,
    yaw: airRoll ? 0 : steer,
    roll: clamp(directionalRoll + (airRoll ? steer : 0), -1, 1),
    jump: anyHeld(input, b.jump),
    boost: anyHeld(input, b.boost),
    handbrake: anyHeld(input, b.handbrake),
  };
}

export function readHeldActions(input: InputSnapshot, b: Bindings): HeldActions {
  return {
    ballCam: anyHeld(input, b.ballCam),
    reset: anyHeld(input, b.reset),
    ballInFront: anyHeld(input, b.ballInFront),
    ballOnCar: anyHeld(input, b.ballOnCar),
  };
}
