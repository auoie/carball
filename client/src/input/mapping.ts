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

/** PlayerInput_TA GamepadDeadzones: the triggers' own deadzone (fixed; not a player setting; live: 0.1). */
export const TRIGGER_DEADZONE = 0.1;
/** A gamepad button or trigger bound to a button action counts as pressed past this much of its travel (the game's
 *  digital threshold: raw 30 of 255; controls audit C-5) */
export const BUTTON_PRESS_THRESHOLD = 30 / 255;

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

/** How strongly each action is held: its keyboard and gamepad inputs summed (the game sums every binding's axis
 *  input, then clamps the control: controls audit C-4). `stickDeadzone`: the player's controller deadzone. */
export function actionValues(input: InputSnapshot, bindings: Bindings, stickDeadzone: number): Record<Action, number> {
  const values = {} as Record<Action, number>;
  for (const action of Object.keys(bindings) as Action[]) {
    const b = bindings[action];
    values[action] = keyboardValue(input, b.keyboard) + gamepadValue(input.gamepad, b.gamepad, stickDeadzone);
  }
  return values;
}

/** Whether a gamepad input bound to a button action is down: a button or trigger past the game's digital threshold
 *  (raw, before any deadzone), a stick direction past half its travel */
function gamepadPressed(pad: GamepadSnapshot | null, binding: GamepadInput | null, stickDeadzone: number): boolean {
  if (binding === null || pad === null) return false;
  if (binding.kind === "padButton") return (pad.buttons[binding.button] ?? 0) > BUTTON_PRESS_THRESHOLD;
  return gamepadValue(pad, binding, stickDeadzone) > 0.5;
}

/** Each input bound to an action, pressed or not (keyboard, then gamepad) */
function buttonInputs(input: InputSnapshot, bindings: Bindings, stickDeadzone: number, ...actions: Action[]): boolean[] {
  return actions.flatMap((a) => [
    keyboardValue(input, bindings[a].keyboard) > 0.5,
    gamepadPressed(input.gamepad, bindings[a].gamepad, stickDeadzone),
  ]);
}

/**
 * The game's buttons are commands sent on each press and each release (ToggleJump true, OnRelease ToggleJump false),
 * so with two inputs bound to one command (a key and a pad button, or jump and the alternative jump) the last event
 * wins: releasing either releases it (controls audit C-4). Keeps each input's previous state to find the events.
 */
export class ButtonLatch {
  readonly #inputs = new Map<string, boolean>();
  readonly #commands = new Map<string, boolean>();

  /** The command's state after this frame's inputs (a press and a release in one frame: pressed) */
  update(command: string, inputs: readonly boolean[]): boolean {
    let pressed = false;
    let released = false;
    for (const [i, down] of inputs.entries()) {
      const key = `${command}:${String(i)}`;
      const was = this.#inputs.get(key) ?? false;
      if (down && !was) pressed = true;
      if (!down && was) released = true;
      this.#inputs.set(key, down);
    }
    const state = pressed ? true : released ? false : (this.#commands.get(command) ?? false);
    this.#commands.set(command, state);
    return state;
  }
}

/**
 * Car controls before the per-player shaping, which the physics applies (sensitivities, dodge deadzone).
 * Holding air roll turns yaw into roll and replaces directional roll (PlayerInput_TA.PlayerInput:
 * aPositiveRoll = aPositiveYaw, ...; yaw = 0).
 */
export function readControls(input: InputSnapshot, bindings: Bindings, stickDeadzone: number, latch?: ButtonLatch): CarControls {
  const v = actionValues(input, bindings, stickDeadzone);
  // Buttons: with a latch, as the game's press and release commands; without, held while any input is
  const button = (command: string, ...actions: Action[]): boolean => {
    const inputs = buttonInputs(input, bindings, stickDeadzone, ...actions);
    return latch ? latch.update(command, inputs) : inputs.some((down) => down);
  };
  const yaw = v.yawRight - v.yawLeft;
  const airRoll = button("airRoll", "airRoll");
  return {
    throttle: clamp(v.throttleForward - v.throttleReverse, -1, 1),
    steer: clamp(v.steerRight - v.steerLeft, -1, 1),
    pitch: clamp(v.pitchUp - v.pitchDown, -1, 1),
    yaw: airRoll ? 0 : clamp(yaw, -1, 1),
    roll: clamp(airRoll ? yaw : v.rollRight - v.rollLeft, -1, 1),
    jump: button("jump", "jump", "jumpAlternative"),
    boost: button("boost", "boost"),
    handbrake: button("handbrake", "handbrake"),
    airPitchSafety: false,
  };
}

export function readHeldActions(input: InputSnapshot, bindings: Bindings, stickDeadzone: number): HeldActions {
  const held = (action: Action): boolean => buttonInputs(input, bindings, stickDeadzone, action).some((down) => down);
  return {
    ballCam: held("ballCam"),
    rearCamera: held("rearCamera"),
    reset: held("reset"),
    ballInFront: held("ballInFront"),
    ballOnCar: held("ballOnCar"),
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
