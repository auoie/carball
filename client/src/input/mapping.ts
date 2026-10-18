// Turns a snapshot of held keys/buttons/axes into car controls, following the game's input code:
// PlayerInput_X's axis handling (native), PlayerInput_TA.PlayerInput and PlayerController_TA.PlayerMove.
// Pure, so it is unit-tested.
import type { CarControls } from "../engine/world";
import type { Action, Bindings, GamepadInput, KeyboardInput } from "./bindings";
import { type FreeLookAxes, freeLookStick } from "../camera/freeLook";

export interface GamepadSnapshot {
  readonly axes: readonly number[];
  readonly buttons: readonly number[]; // 0..1 (analog triggers) or 0/1
}

export interface InputSnapshot {
  /** Held now */
  readonly keys: ReadonlySet<string>;
  readonly mouseButtons: ReadonlySet<number>;
  /** Pressed since the previous snapshot, also those let go again (a tap): the game's press events */
  readonly pressedKeys?: ReadonlySet<string>;
  readonly pressedMouseButtons?: ReadonlySet<number>;
  /** Let go since the previous snapshot: still full value this frame for axis actions (LT-6) */
  readonly releasedKeys?: ReadonlySet<string>;
  readonly releasedMouseButtons?: ReadonlySet<number>;
  /** The key and mouse button presses and releases since the previous snapshot, in the order they came (the game acts
   *  on each when it comes: with two inputs on one command, the last event wins; RV-3) */
  readonly events?: readonly InputEvent[];
  /** The captured mouse's motion since the previous snapshot (counts; y down) */
  readonly mouse?: { readonly x: number; readonly y: number };
  readonly gamepad: GamepadSnapshot | null;
}

export type InputEvent =
  { readonly kind: "key"; readonly code: string; readonly down: boolean } | { readonly kind: "mouse"; readonly button: number; readonly down: boolean };

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
  /** The scoreboard's binding held (OpenScoreboard | OnRelease CloseScoreboard) */
  readonly scoreboard: boolean;
  /** The goal replay's skip (ReadyUp) */
  readonly readyUp: boolean;
  /** Custom training's commands: the previous and next shot, shuffle, mirror */
  readonly trainingPrevious: boolean;
  readonly trainingNext: boolean;
  readonly trainingShuffle: boolean;
  readonly trainingMirror: boolean;
  readonly trainingSelect: boolean;
  /** The quick-chat keys (ChatPreset1-4): a key's press since the last frame (each tap, in back-to-back frames too: a
   *  press is a command, not a state), and the pad button held now (its press is its edge) */
  readonly chat: readonly ChatKey[];
}

export interface ChatKey {
  readonly keyPressed: boolean;
  readonly padDown: boolean;
}

const NO_CHAT_KEY: ChatKey = { keyPressed: false, padDown: false };

/** The quick-chat keys pressed this frame (their indices): a key's press, or a pad button down that wasn't last frame */
export function chatPresses(keys: readonly ChatKey[], previous: readonly ChatKey[]): number[] {
  return keys.flatMap((k, i) => (k.keyPressed || (k.padDown && !(previous[i]?.padDown ?? false)) ? [i] : []));
}
export const NO_HELD_ACTIONS: HeldActions = {
  ballCam: false,
  rearCamera: false,
  reset: false,
  ballInFront: false,
  ballOnCar: false,
  scoreboard: false,
  readyUp: false,
  trainingPrevious: false,
  trainingNext: false,
  trainingShuffle: false,
  trainingMirror: false,
  trainingSelect: false,
  chat: [NO_CHAT_KEY, NO_CHAT_KEY, NO_CHAT_KEY, NO_CHAT_KEY],
};

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

/** A keyboard or mouse input as an axis: full while held, and in the frame it was let go (UInput::Tick sends a key
 *  released since the last frame as down for that frame, then up: notes/client-loop-timing.md LT-6) */
function keyboardValue(input: InputSnapshot, binding: KeyboardInput | null): number {
  if (binding === null) return 0;
  const down =
    binding.kind === "key"
      ? input.keys.has(binding.code) || (input.releasedKeys?.has(binding.code) ?? false)
      : input.mouseButtons.has(binding.button) || (input.releasedMouseButtons?.has(binding.button) ?? false);
  return down ? 1 : 0;
}

/** A keyboard or mouse input as a button: held now, and whether it was pressed since the last frame */
function keyboardButton(input: InputSnapshot, binding: KeyboardInput | null): ButtonInput {
  if (binding === null) return { down: false, pressed: false };
  return binding.kind === "key"
    ? { down: input.keys.has(binding.code), pressed: input.pressedKeys?.has(binding.code) ?? false, keyboard: true }
    : { down: input.mouseButtons.has(binding.button), pressed: input.pressedMouseButtons?.has(binding.button) ?? false, keyboard: true };
}

/** One input bound to a button action: down now; `pressed`: a press event since the last frame (a keyboard tap
 *  shows as pressed without being down; the gamepad, polled once a frame, has no events: its presses are edges);
 *  `keyboard`: a key or mouse button (its events come in the snapshot's ordered list, when it has one) */
interface ButtonInput {
  readonly down: boolean;
  readonly pressed: boolean;
  readonly keyboard?: boolean;
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

/** The ordered key and mouse events of the inputs bound to `actions` (down or up), or null: the snapshot has no list */
function orderedKeyEvents(input: InputSnapshot, bindings: Bindings, actions: readonly Action[]): boolean[] | null {
  if (!input.events) return null;
  const bound = actions.map((a) => bindings[a].keyboard).filter((b): b is KeyboardInput => b !== null);
  return input.events
    .filter((e) => bound.some((b) => (b.kind === "key" ? e.kind === "key" && e.code === b.code : e.kind === "mouse" && e.button === b.button)))
    .map((e) => e.down);
}

/** Each input bound to an action (keyboard, then gamepad) */
function buttonInputs(input: InputSnapshot, bindings: Bindings, stickDeadzone: number, ...actions: Action[]): ButtonInput[] {
  return actions.flatMap((a) => [
    keyboardButton(input, bindings[a].keyboard),
    { down: gamepadPressed(input.gamepad, bindings[a].gamepad, stickDeadzone), pressed: false },
  ]);
}

/**
 * The game's buttons are commands sent on each press and each release (ToggleJump true, OnRelease ToggleJump false),
 * acted on when they happen, before the frame's ticks: with two inputs bound to one command (a key and a pad button,
 * or jump and the alternative jump) the last event wins, so releasing either releases it (controls audit C-4), and a
 * press and release within one frame leaves it released: the tap is lost (LT-5; the jump's own latch keeps it: LT-4).
 * Keeps each input's previous state to find the gamepad's events.
 */
export class ButtonLatch {
  readonly #inputs = new Map<string, boolean>();
  readonly #commands = new Map<string, boolean>();
  readonly #pressed = new Set<string>();

  /** The command's state after this frame's events: `keyEvents`, the keys' and mouse buttons' presses (true) and
   *  releases in the order they came, then the gamepad's (its poll's edges); without an ordered list, each input's
   *  edges in turn */
  update(command: string, inputs: readonly ButtonInput[], keyEvents: readonly boolean[] | null = null): boolean {
    const events: boolean[] = keyEvents ? [...keyEvents] : [];
    for (const [i, input] of inputs.entries()) {
      const key = `${command}:${String(i)}`;
      const was = this.#inputs.get(key) ?? false;
      this.#inputs.set(key, input.down);
      if (keyEvents && input.keyboard) continue; // (in the ordered list)
      if (input.pressed && !input.down)
        events.push(true, false); // (a tap)
      else if (input.down && (!was || input.pressed)) events.push(true);
      else if (!input.down && was) events.push(false);
    }
    const state = events.at(-1) ?? this.#commands.get(command) ?? false;
    this.#commands.set(command, state);
    if (events.includes(true)) this.#pressed.add(command);
    else this.#pressed.delete(command);
    return state;
  }

  /** Whether the command was pressed in the last update (even if released again: the jump's latch) */
  pressed(command: string): boolean {
    return this.#pressed.has(command);
  }
}

/**
 * The jump's latch (PlayerController_TA.bJumped; notes/client-loop-timing.md LT-4): a press sets it, and the first
 * tick after takes the jump as held even if it was let go already, then clears it. So a tap is exactly one tick of
 * jump, never lost however short, and a frame with no tick keeps it for the next.
 */
export class JumpLatch {
  #latched = false;

  /** After reading the frame's controls */
  frame(latch: ButtonLatch): void {
    if (latch.pressed("jump")) this.#latched = true;
  }

  /** A tick's jump: held, or latched (which the tick consumes) */
  tick(held: boolean): boolean {
    const jump = held || this.#latched;
    this.#latched = false;
    return jump;
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
    return latch ? latch.update(command, inputs, orderedKeyEvents(input, bindings, actions)) : inputs.some((i) => i.down);
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
  // (held, or pressed since the last frame: a tap still toggles, as the game's press commands do)
  const held = (action: Action): boolean => buttonInputs(input, bindings, stickDeadzone, action).some((i) => i.down || i.pressed);
  return {
    ballCam: held("ballCam"),
    rearCamera: held("rearCamera"),
    reset: held("reset"),
    ballInFront: held("ballInFront"),
    ballOnCar: held("ballOnCar"),
    scoreboard: held("scoreboard"),
    readyUp: held("readyUp"),
    trainingPrevious: held("trainingPrevious"),
    trainingNext: held("trainingNext"),
    trainingShuffle: held("trainingShuffle"),
    trainingMirror: held("trainingMirror"),
    trainingSelect: held("trainingSelect"),
    chat: (["chatPreset1", "chatPreset2", "chatPreset3", "chatPreset4"] as const).map((a) => {
      const [key, pad] = buttonInputs(input, bindings, stickDeadzone, a);
      return { keyPressed: key?.pressed ?? false, padDown: pad?.down ?? false };
    }),
  };
}

export function readLook(input: InputSnapshot, bindings: Bindings, stickDeadzone: number): LookInput {
  const v = actionValues(input, bindings, stickDeadzone);
  return { up: v.swivelUp - v.swivelDown, right: v.swivelRight - v.swivelLeft };
}

export interface FreeLookOptions {
  /** The device that owns the free look (the other's input is dropped: CAM-16) */
  readonly gamepad: boolean;
  /** The last view's FOV (PlayerInput_TA scales the look input by FOV / 90) */
  readonly fov: number;
  readonly invertPitch: boolean;
  readonly mouseSensitivity: number;
  readonly freeLookDeadzone: number;
}

/** The free look's input this frame (PlayerInput_TA.PlayerInput, ReplicateCameraRotation; notes/camera-respawn-goal.md
 *  CAM-11): the stick bound to the look, past its free-look deadzone; or the mouse's counts times its sensitivity
 *  (forward looks up), else keys bound to the look; scaled by FOV / 90, the pitch by the input's inversion. */
export function readFreeLook(input: InputSnapshot, bindings: Bindings, stickDeadzone: number, o: FreeLookOptions): FreeLookAxes {
  const fovScale = o.fov / 90;
  const pitchDir = o.invertPitch ? -1 : 1;
  if (o.gamepad) {
    const pad = (a: Action): number => gamepadValue(input.gamepad, bindings[a].gamepad, stickDeadzone);
    const up = freeLookStick((pad("swivelUp") - pad("swivelDown")) * fovScale, o.freeLookDeadzone);
    const right = freeLookStick((pad("swivelRight") - pad("swivelLeft")) * fovScale, o.freeLookDeadzone);
    return { pitch: up * pitchDir, yaw: right, source: "stick" };
  }
  const mouse = input.mouse ?? { x: 0, y: 0 };
  if (mouse.x !== 0 || mouse.y !== 0) {
    const counts = o.mouseSensitivity * fovScale;
    return { pitch: -mouse.y * counts * pitchDir, yaw: mouse.x * counts, source: "mouse" };
  }
  const key = (a: Action): number => keyboardValue(input, bindings[a].keyboard);
  const up = (key("swivelUp") - key("swivelDown")) * fovScale;
  const right = (key("swivelRight") - key("swivelLeft")) * fovScale;
  return { pitch: up * pitchDir, yaw: right, source: up !== 0 || right !== 0 ? "keys" : "mouse" };
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
