// Turns a snapshot of held keys/buttons/axes into car controls, following the game's input code:
// PlayerInput_X's axis handling (native), PlayerInput_TA.PlayerInput and PlayerController_TA.PlayerMove.
// Pure, so it is unit-tested.
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

/** PlayerInput_TA GamepadDeadzones: the triggers' own deadzone (fixed; not a player setting). */
export const TRIGGER_DEADZONE = 0.1;

/** Held state of the non-driving actions; the caller detects presses. */
export interface HeldActions {
  readonly ballCam: boolean;
  readonly rearCamera: boolean;
  readonly reset: boolean;
  readonly ballInFront: boolean;
  readonly ballOnCar: boolean;
}

/** Camera swivel input, -1..1 each (PlayerController_TA.ReplicateCameraRotation, before inversion). */
export interface LookInput {
  readonly up: number; // positive looks up
  readonly right: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The game's gamepad deadzone (PlayerInput_X InputAxis override): applied to each axis on its own,
 * zero inside it and rescaled to 0..1 outside it.
 */
export function axisDeadzone(v: number, deadzone: number): number {
  if (deadzone <= 0 || deadzone >= 1) return v;
  return (Math.sign(v) * Math.max(0, Math.abs(v) - deadzone)) / (1 - deadzone);
}

function keyboardValue(input: InputSnapshot, binding: KeyboardInput | null): number {
  if (binding === null) return 0;
  return (binding.kind === "key" ? input.keys.has(binding.code) : input.mouseButtons.has(binding.button)) ? 1 : 0;
}

function gamepadValue(pad: GamepadSnapshot | null, binding: GamepadInput | null, stickDeadzone: number): number {
  if (binding === null || pad === null) return 0;
  if (binding.kind === "padButton") return axisDeadzone(pad.buttons[binding.button] ?? 0, TRIGGER_DEADZONE);
  // A stick direction: only its side of the axis counts (AxisSign), after the deadzone
  return Math.max(0, axisDeadzone(pad.axes[binding.axis] ?? 0, stickDeadzone) * binding.sign);
}

/** How strongly each action is held, 0..1. `stickDeadzone`: the player's controller deadzone. */
export function actionValues(input: InputSnapshot, bindings: Bindings, stickDeadzone: number): Record<Action, number> {
  const values = {} as Record<Action, number>;
  for (const action of Object.keys(bindings) as Action[]) {
    const b = bindings[action];
    values[action] = Math.max(keyboardValue(input, b.keyboard), gamepadValue(input.gamepad, b.gamepad, stickDeadzone));
  }
  return values;
}

/**
 * Car controls before the per-player shaping, which the physics applies (sensitivities, dodge deadzone).
 * Holding air roll turns yaw into roll and replaces directional roll (PlayerInput_TA.PlayerInput:
 * aPositiveRoll = aPositiveYaw, ...; yaw = 0).
 */
export function readControls(input: InputSnapshot, bindings: Bindings, stickDeadzone: number): CarControls {
  const v = actionValues(input, bindings, stickDeadzone);
  const yaw = v.yawRight - v.yawLeft;
  const airRoll = v.airRoll > 0.5;
  return {
    throttle: clamp(v.throttleForward - v.throttleReverse, -1, 1),
    steer: clamp(v.steerRight - v.steerLeft, -1, 1),
    pitch: clamp(v.pitchUp - v.pitchDown, -1, 1),
    yaw: airRoll ? 0 : clamp(yaw, -1, 1),
    roll: clamp(airRoll ? yaw : v.rollRight - v.rollLeft, -1, 1),
    jump: v.jump > 0.5 || v.jumpAlternative > 0.5,
    boost: v.boost > 0.5,
    handbrake: v.handbrake > 0.5,
    airPitchSafety: false,
  };
}

export function readHeldActions(input: InputSnapshot, bindings: Bindings, stickDeadzone: number): HeldActions {
  const v = actionValues(input, bindings, stickDeadzone);
  return {
    ballCam: v.ballCam > 0.5,
    rearCamera: v.rearCamera > 0.5,
    reset: v.reset > 0.5,
    ballInFront: v.ballInFront > 0.5,
    ballOnCar: v.ballOnCar > 0.5,
  };
}

export function readLook(input: InputSnapshot, bindings: Bindings, stickDeadzone: number): LookInput {
  const v = actionValues(input, bindings, stickDeadzone);
  return { up: v.swivelUp - v.swivelDown, right: v.swivelRight - v.swivelLeft };
}

/**
 * PlayerController_TA.ApplyAirPitchSafety (keyboard and mouse only, profile option on by default): leaving the
 * ground with nose-down pitch held doesn't pitch the car until the player lets go of it or rolls. Dodges still
 * use the held pitch, so a front flip works.
 */
export class AirPitchSafety {
  #hasPitchedOrRolled = false;

  /** Per frame; returns whether air control should ignore pitch. */
  update(enabled: boolean, usingGamepad: boolean, onGround: boolean, controls: CarControls): boolean {
    if (onGround) this.#hasPitchedOrRolled = false;
    if (!enabled || this.#hasPitchedOrRolled || usingGamepad) return false;
    if (controls.pitch >= 0 || Math.abs(controls.roll) > 0) {
      this.#hasPitchedOrRolled = true;
      return false;
    }
    return true;
  }
}
