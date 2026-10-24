// Actions and bindings, modelled on Rocket League's control settings (TAGame/Config/DefaultInput.ini). The keyboard
// defaults are the live game's "Modern" preset (its default since the 2026-10-06 update, ControlPreset_X
// DefaultPresetName); the gamepad's are unchanged. Every action has one keyboard/mouse input and one gamepad input
// (as the game's menu); a second jump key is its own action, as the game's JumpAlternative.
// Keys are KeyboardEvent.code values, mouse buttons MouseEvent.button, gamepad inputs use the browser's
// "standard" mapping (buttons 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, ...; axes 0/1 left stick, 2/3 right).

export type KeyboardInput = { readonly kind: "key"; readonly code: string } | { readonly kind: "mouse"; readonly button: number };

export type GamepadInput =
  | { readonly kind: "padButton"; readonly button: number } // analog for the triggers
  | { readonly kind: "padAxis"; readonly axis: number; readonly sign: 1 | -1 }; // one direction of a stick axis

export interface Binding {
  readonly keyboard: KeyboardInput | null;
  readonly gamepad: GamepadInput | null;
}

export const ACTIONS = [
  { id: "throttleForward", label: "Throttle", group: "Driving" },
  { id: "throttleReverse", label: "Reverse", group: "Driving" },
  { id: "steerRight", label: "Steer right", group: "Driving" },
  { id: "steerLeft", label: "Steer left", group: "Driving" },
  { id: "jump", label: "Jump", group: "Driving" },
  { id: "jumpAlternative", label: "Jump (alternative)", group: "Driving" },
  { id: "boost", label: "Boost", group: "Driving" },
  { id: "handbrake", label: "Powerslide", group: "Driving" },
  { id: "pitchUp", label: "Pitch up (nose up)", group: "Aerial" },
  { id: "pitchDown", label: "Pitch down (nose down)", group: "Aerial" },
  { id: "yawRight", label: "Yaw right", group: "Aerial" },
  { id: "yawLeft", label: "Yaw left", group: "Aerial" },
  { id: "airRoll", label: "Air roll (hold: yaw rolls)", group: "Aerial" },
  { id: "rollRight", label: "Air roll right", group: "Aerial" },
  { id: "rollLeft", label: "Air roll left", group: "Aerial" },
  { id: "ballCam", label: "Ball cam", group: "Camera" },
  { id: "rearCamera", label: "Rear camera", group: "Camera" },
  { id: "swivelUp", label: "Swivel up", group: "Camera" },
  { id: "swivelDown", label: "Swivel down", group: "Camera" },
  { id: "swivelLeft", label: "Swivel left", group: "Camera" },
  { id: "swivelRight", label: "Swivel right", group: "Camera" },
  { id: "reset", label: "Reset to kickoff", group: "Freeplay" },
  // (FreeplayCommand_X, the game's labels and order: FP3)
  { id: "ballInFront", label: "Take Possession", group: "Freeplay" },
  { id: "ballOnCar", label: "Start Dribble", group: "Freeplay" },
  { id: "passBall", label: "Pass Ball", group: "Freeplay" },
  { id: "launchBall", label: "Launch Ball", group: "Freeplay" },
  { id: "defendShot", label: "Defend Shot", group: "Freeplay" },
  // (Controls.int [ChatPreset1-4] Label, verbatim: online only, so the same keys as freeplay's, as the game binds them)
  { id: "chatPreset1", label: "Quick Chat - Information/Post Game", group: "Quick Chat" },
  { id: "chatPreset2", label: "Quick Chat - Compliments", group: "Quick Chat" },
  { id: "chatPreset3", label: "Quick Chat - Reactions", group: "Quick Chat" },
  { id: "chatPreset4", label: "Quick Chat - Apologies", group: "Quick Chat" },
  // (custom training's playtest commands, DefaultInput.ini: the arrows and the D-pad; notes/custom-training.md §2.9)
  { id: "trainingPrevious", label: "Previous shot", group: "Training" },
  { id: "trainingNext", label: "Next shot", group: "Training" },
  { id: "trainingShuffle", label: "Shuffle shots", group: "Training" },
  { id: "trainingMirror", label: "Mirror shot", group: "Training" },
  { id: "trainingSelect", label: "Select shot", group: "Training" },
  // (ToggleScoreboard: held, online only)
  { id: "scoreboard", label: "Scoreboard (hold)", group: "Match" },
  // (Controls.int [ReadyUp] Label, verbatim: the goal replay's skip, when no car drives, so it shares its keys)
  { id: "readyUp", label: "Skip Replay", group: "Replay" },
] as const;

/** Action groups never active together (freeplay's offline, quick chat's online, custom training's in its own mode):
 *  their bindings may share inputs */
export function exclusiveGroups(a: Action, b: Action): boolean {
  const group = (id: Action): string => ACTIONS.find((x) => x.id === id)?.group ?? "";
  const pair = [group(a), group(b)].sort().join("|");
  // (the replay's skip: no car is driven in a goal replay, so it shares any key: Space with jump, the pad's A)
  // (free play has no scoreboard: Defend Shot's LB, the game's, beside the scoreboard's, FP3)
  return (
    pair === "Freeplay|Quick Chat" ||
    pair === "Freeplay|Training" ||
    pair === "Freeplay|Match" ||
    pair === "Quick Chat|Training" ||
    (pair.includes("Replay") && group(a) !== group(b))
  );
}

export type Action = (typeof ACTIONS)[number]["id"];
export type Bindings = Readonly<Record<Action, Binding>>;

const key = (code: string): KeyboardInput => ({ kind: "key", code });
const mouse = (button: number): KeyboardInput => ({ kind: "mouse", button });
const button = (b: number): GamepadInput => ({ kind: "padButton", button: b });
const axis = (a: number, sign: 1 | -1): GamepadInput => ({ kind: "padAxis", axis: a, sign });
const bind = (keyboard: KeyboardInput | null, gamepad: GamepadInput | null): Binding => ({ keyboard, gamepad });

/** The game's defaults: the live game's "Modern" layouts (keyboard and controller). On the controller the left
 *  trigger is both reverse and air roll, as the game binds it (one input, two actions: the reverse axis with the
 *  triggers' deadzone, air roll pressed past the digital threshold); "Legacy" had air roll on X with powerslide. */
export const DEFAULT_BINDINGS: Bindings = {
  throttleForward: bind(key("KeyW"), button(7)),
  throttleReverse: bind(key("KeyS"), button(6)),
  steerRight: bind(key("KeyD"), axis(0, 1)),
  steerLeft: bind(key("KeyA"), axis(0, -1)),
  jump: bind(key("Space"), button(0)),
  jumpAlternative: bind(mouse(0), null),
  boost: bind(key("ShiftLeft"), button(1)),
  handbrake: bind(mouse(2), button(2)),
  pitchUp: bind(key("KeyS"), axis(1, 1)), // stick pulled back
  pitchDown: bind(key("KeyW"), axis(1, -1)), // stick pushed forward
  yawRight: bind(key("KeyD"), axis(0, 1)),
  yawLeft: bind(key("KeyA"), axis(0, -1)),
  airRoll: bind(mouse(2), button(6)),
  rollRight: bind(key("KeyE"), null),
  rollLeft: bind(key("KeyQ"), null),
  ballCam: bind(mouse(1), button(3)),
  rearCamera: bind(key("ControlLeft"), button(11)),
  // Camera swivel: right stick (the game binds no keyboard keys). As the game's: SwivelUp is the stick pulled down
  // (RightY positive, as the browser's axis 3), and the default inverted swivel pitch (bInvertSwivelPitch) turns that
  // into looking down, so pushing the stick up looks up
  swivelUp: bind(null, axis(3, 1)),
  swivelDown: bind(null, axis(3, -1)),
  swivelLeft: bind(null, axis(2, -1)),
  swivelRight: bind(null, axis(2, 1)),
  reset: bind(key("Backspace"), button(5)),
  // (the game's defaults in every preset: 1-5, the D-pad's down, up, left, right, LB: FP3)
  ballInFront: bind(key("Digit1"), button(13)),
  ballOnCar: bind(key("Digit2"), button(12)),
  passBall: bind(key("Digit3"), button(14)),
  launchBall: bind(key("Digit4"), button(15)),
  defendShot: bind(key("Digit5"), button(4)),
  // (ControlPreset_X: keys 1-4, the D-pad's up, left, right, down)
  chatPreset1: bind(key("Digit1"), button(12)),
  chatPreset2: bind(key("Digit2"), button(14)),
  chatPreset3: bind(key("Digit3"), button(15)),
  chatPreset4: bind(key("Digit4"), button(13)),
  // (TrainingNavigationCommand Previous/Next, ToggleShuffle, MirrorShot: the arrows, the D-pad)
  trainingPrevious: bind(key("ArrowLeft"), button(14)),
  trainingNext: bind(key("ArrowRight"), button(15)),
  trainingShuffle: bind(key("ArrowUp"), button(12)),
  trainingMirror: bind(key("ArrowDown"), button(13)),
  // (OpenShotSelectionMenu: Enter, the pad's Back/View)
  trainingSelect: bind(key("Enter"), button(8)),
  // (DefaultInput.ini, ControlPreset_X: Tab and the left bumper, SB-10)
  scoreboard: bind(key("Tab"), button(4)),
  // (ReadyUp: Modern's SpaceBar, the pad's A: notes/hud-menus.md HT-3)
  readyUp: bind(key("Space"), button(0)),
};

const PAD_BUTTON_NAMES = [
  "A",
  "B",
  "X",
  "Y",
  "LB",
  "RB",
  "LT",
  "RT",
  "View",
  "Menu",
  "Left stick click",
  "Right stick click",
  "D-pad up",
  "D-pad down",
  "D-pad left",
  "D-pad right",
  "Home",
  // (button 17, past the standard layout: Chromium's Xbox Series Share button, RV-1099)
  "Share",
];
/** A PlayStation pad's names for the same buttons (the standard layout: Cross is button 0) */
const PS_BUTTON_NAMES = [
  "Cross",
  "Circle",
  "Square",
  "Triangle",
  "L1",
  "R1",
  "L2",
  "R2",
  "Share",
  "Options",
  "L3",
  "R3",
  "D-pad up",
  "D-pad down",
  "D-pad left",
  "D-pad right",
  "PS",
  // (button 17: the DualShock 4's and DualSense's touchpad press, RV-1099)
  "Touchpad",
];

/** The pad's kind, for its buttons' names and glyphs (the game's glyph set per pad type: HT-3) */
export type PadStyle = "xbox" | "playstation";

/** A pad's kind from its id: Sony's (vendor 054c), a DualShock or DualSense, "Wireless Controller" (the DS4's own
 *  name), else Xbox's layout */
export function padStyleOf(id: string): PadStyle {
  return /054c|dualshock|dualsense|wireless controller|playstation/i.test(id) ? "playstation" : "xbox";
}

let padStyle: PadStyle = "xbox";

const padStyleListeners = new Set<(style: PadStyle) => void>();

/** The connected pad's kind (the devices note it as they read the pad); who listens told when it changes */
export function setPadStyle(style: PadStyle): void {
  if (style === padStyle) return;
  padStyle = style;
  for (const listener of padStyleListeners) listener(style);
}

/** Told when the connected pad's kind changes (a page that drew its names redraws them); the unsubscribe */
export function onPadStyle(listener: (style: PadStyle) => void): () => void {
  padStyleListeners.add(listener);
  return () => {
    padStyleListeners.delete(listener);
  };
}

export function currentPadStyle(): PadStyle {
  return padStyle;
}
const MOUSE_NAMES = ["Left mouse", "Middle mouse", "Right mouse", "Mouse 4", "Mouse 5"];
const AXIS_NAMES: Record<number, readonly [string, string]> = {
  0: ["Left stick left", "Left stick right"],
  1: ["Left stick up", "Left stick down"],
  2: ["Right stick left", "Right stick right"],
  3: ["Right stick up", "Right stick down"],
};

/** Whether any action is bound to the key `code` (KeyboardEvent.code) */
export function keyBound(bindings: Bindings, code: string): boolean {
  return Object.values(bindings).some((b: Binding) => b.keyboard?.kind === "key" && b.keyboard.code === code);
}

/** The browser's own chords a held modifier bind never takes: page zoom (an accessibility setting) and the developer
 *  tools, theirs unless that very key is bound (RV-1110). Zoom by the character too, a layout's + elsewhere (a German
 *  keyboard's on BracketRight); the tools Chromium's (I, J, C) and Firefox's (K, E, M: RV-1120) */
const ZOOM_KEYS = ["Equal", "Minus", "Digit0", "NumpadAdd", "NumpadSubtract", "Numpad0"];
const ZOOM_CHARACTERS = ["+", "-", "=", "0"];
const TOOLS_KEYS = ["KeyI", "KeyJ", "KeyC", "KeyK", "KeyE", "KeyM"];

/** Whether a key press in play is the game's alone, its browser action never taken (RV-1092): a bound key (F5's reload,
 *  `/`'s quick find), or any key with a bound modifier held (Ctrl held as a bind: Ctrl+D, Ctrl+S; Alt: Alt+D, Alt+E),
 *  but the zoom and developer tools' chords. Ctrl+W, T and N reach the page only in full screen with the keyboard locked
 *  (RV-1091) */
export function takesBrowserKey(
  e: {
    readonly code: string;
    readonly key?: string;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
    readonly shiftKey?: boolean;
  },
  bound: (code: string) => boolean,
): boolean {
  if (bound(e.code)) return true;
  const zoom = ZOOM_KEYS.includes(e.code) || ZOOM_CHARACTERS.includes(e.key ?? "");
  if ((e.ctrlKey || e.metaKey) && (zoom || (e.shiftKey === true && TOOLS_KEYS.includes(e.code)))) return false;
  const held = (side: string): boolean => bound(`${side}Left`) || bound(`${side}Right`);
  return (e.ctrlKey && held("Control")) || (e.altKey && held("Alt")) || (e.metaKey && held("Meta"));
}

/** The wheel's turns, bound as keys (the game's MouseScrollUp and MouseScrollDown, RV-1096): no key's code */
export const WHEEL_CODES: readonly string[] = ["WheelUp", "WheelDown"];

/** The keys the browser's keyboard lock takes in full screen: the bound keys, Escape (the pause menu's, not full
 *  screen's end: a long press still ends it), W, T and N (Ctrl+W, T, N); never Tab nor the system key, so Alt+Tab and
 *  the Windows key stay the system's (RV-1112); never a code that isn't a key's (the wheel's, a key the browser couldn't
 *  name), one of which fails the whole lock (RV-1117) */
export function lockedKeys(bindings: Bindings): string[] {
  const codes = new Set(["Escape", "KeyW", "KeyT", "KeyN"]);
  for (const b of Object.values<Binding>(bindings)) if (b.keyboard?.kind === "key") codes.add(b.keyboard.code);
  for (const never of ["Tab", "MetaLeft", "MetaRight", "OSLeft", "OSRight", "", "Unidentified", ...WHEEL_CODES]) codes.delete(never);
  return [...codes];
}

/** The keyboard's layout, each key's character by its position (navigator.keyboard.getLayoutMap, where the browser has
 *  it): an AZERTY player's Z key named Z, not W, its binding the same position either way (RV-1101) */
let layout: ReadonlyMap<string, string> | null = null;

export function setKeyboardLayout(map: ReadonlyMap<string, string> | null): void {
  layout = map;
}

/** The punctuation keys a layout renames (its letters too; its digits as their keycaps print them) */
const LAYOUT_KEYS = /^(Key[A-Z]|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Backquote|Comma|Period|Slash|IntlBackslash)$/;

/** "KeyW" -> "W", "ShiftLeft" -> "Left Shift", "Digit1" -> "1", "ArrowUp" -> "Up arrow"; a layout's own letters and
 *  punctuation where the browser tells them (RV-1101). */
export function keyName(code: string): string {
  const typed = LAYOUT_KEYS.test(code) ? layout?.get(code) : undefined;
  if (typed !== undefined && typed !== "") return typed.toUpperCase();
  if (code === "WheelUp") return "Wheel up";
  if (code === "WheelDown") return "Wheel down";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const sided = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
  if (sided) return `${sided[2] ?? ""} ${sided[1] === "Control" ? "Ctrl" : (sided[1] ?? "")}`;
  if (code.startsWith("Arrow")) return `${code.slice(5)} arrow`;
  if (code.startsWith("Numpad")) return `Numpad ${code.slice(6)}`;
  return code;
}

/** The pad's buttons as short glyphs (the quick-chat panel's 30 x 28 key boxes: RV-255) */
const PAD_BUTTON_GLYPHS: Readonly<Record<number, string>> = {
  4: "LB",
  5: "RB",
  6: "LT",
  7: "RT",
  8: "⧉",
  9: "≡",
  10: "LS",
  11: "RS",
  12: "▲",
  13: "▼",
  14: "◀",
  15: "▶",
};
/** A PlayStation pad's: the face buttons' symbols (our own drawing), L1/R1/L2/R2, L3/R3 */
const PS_BUTTON_GLYPHS: Readonly<Record<number, string>> = {
  0: "✕",
  1: "○",
  2: "□",
  3: "△",
  4: "L1",
  5: "R1",
  6: "L2",
  7: "R2",
  8: "⧉",
  9: "≡",
  10: "L3",
  11: "R3",
  12: "▲",
  13: "▼",
  14: "◀",
  15: "▶",
};

/** An input's name short enough for a key box: the D-pad as arrows, the sticks' clicks LS / RS (L3 / R3) */
export function inputGlyph(input: KeyboardInput | GamepadInput | null, style: PadStyle = padStyle): string {
  if (input?.kind === "padButton") return (style === "playstation" ? PS_BUTTON_GLYPHS : PAD_BUTTON_GLYPHS)[input.button] ?? inputName(input, style);
  return inputName(input, style);
}

export function inputName(input: KeyboardInput | GamepadInput | null, style: PadStyle = padStyle): string {
  if (input === null) return "—";
  switch (input.kind) {
    case "key":
      return keyName(input.code);
    case "mouse":
      return MOUSE_NAMES[input.button] ?? `Mouse ${input.button + 1}`;
    case "padButton":
      return (style === "playstation" ? PS_BUTTON_NAMES : PAD_BUTTON_NAMES)[input.button] ?? `Button ${input.button}`;
    case "padAxis": {
      const names = AXIS_NAMES[input.axis];
      return names ? names[input.sign > 0 ? 1 : 0] : `Axis ${input.axis}${input.sign > 0 ? "+" : "-"}`;
    }
  }
}
