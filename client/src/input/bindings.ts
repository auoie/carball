// Default bindings: Rocket League's TAGame/Config/DefaultInput.ini ("Standard" preset).
// Keys are KeyboardEvent.code values; mouse buttons are MouseEvent.button; gamepad buttons use the
// browser's "standard" mapping (0 A, 1 B, 2 X, 3 Y, 5 RB, 12 D-pad up, 13 D-pad down).

export type ButtonInput =
  | { readonly kind: "key"; readonly code: string }
  | { readonly kind: "mouse"; readonly button: number }
  | { readonly kind: "pad"; readonly button: number };

const key = (code: string): ButtonInput => ({ kind: "key", code });
const mouse = (button: number): ButtonInput => ({ kind: "mouse", button });
const pad = (button: number): ButtonInput => ({ kind: "pad", button });

export interface Bindings {
  // Digital driving inputs (keyboard). Gamepad sticks and triggers are read as axes.
  readonly throttleForward: readonly ButtonInput[]; // also pitch down in the air
  readonly throttleReverse: readonly ButtonInput[]; // also pitch up in the air
  readonly steerRight: readonly ButtonInput[]; // also yaw right
  readonly steerLeft: readonly ButtonInput[];
  readonly rollRight: readonly ButtonInput[];
  readonly rollLeft: readonly ButtonInput[];
  readonly jump: readonly ButtonInput[];
  readonly boost: readonly ButtonInput[];
  readonly handbrake: readonly ButtonInput[]; // powerslide
  readonly airRoll: readonly ButtonInput[]; // "ToggleRoll": steer/yaw input rolls instead
  // Camera and freeplay
  readonly ballCam: readonly ButtonInput[]; // "SecondaryCamera"
  readonly reset: readonly ButtonInput[]; // "ResetTraining"
  readonly ballInFront: readonly ButtonInput[]; // "FreeplayBallInFront"
  readonly ballOnCar: readonly ButtonInput[]; // "FreeplayBallOnCar"
}

export const DEFAULT_BINDINGS: Bindings = {
  throttleForward: [key("KeyW")],
  throttleReverse: [key("KeyS")],
  steerRight: [key("KeyD")],
  steerLeft: [key("KeyA")],
  rollRight: [key("KeyE")],
  rollLeft: [key("KeyQ")],
  jump: [mouse(2), pad(0)],
  boost: [mouse(0), pad(1)],
  // The ini binds gamepad air roll to the left trigger in the base preset and to X in "Legacy";
  // X (with powerslide) is what players know as the default, so X is used here.
  handbrake: [key("ShiftLeft"), pad(2)],
  airRoll: [key("ShiftLeft"), pad(2)],
  ballCam: [key("Space"), pad(3)],
  reset: [key("Backspace"), pad(5)],
  ballInFront: [key("Digit1"), pad(13)],
  ballOnCar: [key("Digit2"), pad(12)],
};

/** PlayerInput_TA defaults (DefaultInput.ini). Provisional until the input code is decompiled (roadmap §4). */
export const GAMEPAD_STICK_DEADZONE = 0.3;
export const GAMEPAD_TRIGGER_DEADZONE = 0.1;

/** Standard-mapping gamepad axes and analog buttons. */
export const PAD_AXIS_LEFT_X = 0;
export const PAD_AXIS_LEFT_Y = 1; // -1 when pushed up
export const PAD_BUTTON_LEFT_TRIGGER = 6;
export const PAD_BUTTON_RIGHT_TRIGGER = 7;
