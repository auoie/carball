// Collects keyboard, mouse and gamepad state from the browser into snapshots.
import { padStyleOf, setPadStyle, takesBrowserKey } from "./bindings";
import type { GamepadSnapshot, InputEvent, InputSnapshot } from "./mapping";

/** The keys a browser sends only a keyup for (Windows keeps PrintScreen's keydown): taps when they come (RV-1100) */
export const KEYUP_ONLY: readonly string[] = ["PrintScreen"];

/** The thumb buttons, Mouse 4 and 5: bindable (air roll, often), never the browser's back and forward, which on a match's
 *  page would leave the match (a loss and a ban): anywhere on the page, a menu's too, from the page's start (its seat
 *  claimed while it loads, RV-1103), in the capture phase (RV-1105). Chromium's; Firefox gives a page no thumb buttons at
 *  all (its Back the match page's guard's, LeaveGuard: RV-1104) */
export function cancelThumbButtons(target: Pick<Window, "addEventListener"> = window): void {
  for (const kind of ["mousedown", "mouseup", "auxclick"] as const) {
    target.addEventListener(
      kind,
      (e) => {
        if (e.button === 3 || e.button === 4) e.preventDefault();
      },
      { capture: true },
    );
  }
}

/** A text field (or editable text) a key typed goes to */
function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !["button", "checkbox", "color", "file", "radio", "range", "reset", "submit"].includes(target.type);
}

export class InputDevices {
  readonly #keys = new Set<string>();
  readonly #mouseButtons = new Set<number>();
  // Since the last snapshot: the press and release events (a tap shorter than a frame is in both)
  readonly #pressedKeys = new Set<string>();
  readonly #pressedButtons = new Set<number>();
  readonly #releasedKeys = new Set<string>();
  readonly #releasedButtons = new Set<number>();
  readonly #events: InputEvent[] = []; // (in the order they came)
  readonly #abort = new AbortController();
  #usingGamepad = false;
  /** bDeviceOwnerIsGamepad: the device of the last key or button event (sticks and the mouse's motion don't count) */
  #ownerIsGamepad = false;
  #padButtons: readonly boolean[] = [];
  /** Mouse motion since the last snapshot while the pointer is captured (counts) */
  #mouseX = 0;
  #mouseY = 0;
  /** Capture the pointer on a click (keyboard-and-mouse free look on): its motion turns the view */
  capturePointer = false;
  /** Whether a menu is up (Tab then moves the focus, not the scoreboard's) */
  menuOpen: () => boolean = () => false;
  /** Whether a key (KeyboardEvent.code) is bound to an action: in play its browser action never taken (RV-1092) */
  bound: (code: string) => boolean = () => false;

  /** `surface`: the element that receives mouse buttons (the game canvas). */
  constructor(surface: HTMLElement) {
    const signal = this.#abort.signal;
    window.addEventListener(
      "keydown",
      (e) => {
        // (typing in a text field, the settings' name: its keys the field's, not the game's: RV-482)
        if (editable(e.target)) return;
        // (no page scroll or back; but Space ticks a focused box in a menu, the regions' on Play's page: RV-858)
        const box = e.target instanceof Element && e.target.getAttribute("role") === "checkbox" && this.menuOpen();
        if ((e.code === "Space" && !box) || e.code === "Backspace") e.preventDefault();
        // (Tab the scoreboard's, not focus, in play; with a menu up it moves the focus, the menus' keyboard path: RV-482)
        if (e.code === "Tab" && !this.menuOpen() && (e.target === document.body || e.target === surface)) e.preventDefault();
        // (in play, a bound key or a chord with a bound modifier the game's alone: F5's reload, Ctrl+D's bookmark, Alt+D's
        // address bar never taken; Ctrl+W, T and N reach the page only in full screen, DisplayMode: RV-1091, RV-1092)
        // (a focused button's Enter its own: the end screen's, an editor panel's, RV-1110)
        const button = e.target instanceof HTMLButtonElement && (e.code === "Enter" || e.code === "NumpadEnter");
        if (!this.menuOpen() && !button && takesBrowserKey(e, this.bound)) e.preventDefault();
        this.#usingGamepad = false;
        this.#ownerIsGamepad = false;
        this.#keys.add(e.code);
        if (!e.repeat) {
          // (the OS's key repeat is no new press)
          this.#pressedKeys.add(e.code);
          this.#events.push({ kind: "key", code: e.code, down: true });
        }
      },
      { signal },
    );
    window.addEventListener(
      "keyup",
      (e) => {
        // (a bound Alt's release not the browser's menu bar either)
        if (!editable(e.target) && !this.menuOpen() && this.bound(e.code)) e.preventDefault();
        if (this.#keys.delete(e.code)) {
          this.#releasedKeys.add(e.code);
          this.#events.push({ kind: "key", code: e.code, down: false });
        } else if (KEYUP_ONLY.includes(e.code) && !editable(e.target)) {
          // (a key whose press comes as its release alone, Windows' PrintScreen: a tap, RV-1100)
          this.#tap(e.code);
        }
      },
      { signal },
    );
    // (the wheel's turns as the game's MouseScrollUp and MouseScrollDown: a key tapped in a frame, bindable, RV-1096)
    surface.addEventListener(
      "wheel",
      (e) => {
        if (e.deltaY === 0) return;
        this.#usingGamepad = false;
        this.#ownerIsGamepad = false;
        this.#tap(e.deltaY < 0 ? "WheelUp" : "WheelDown");
      },
      { signal, passive: true },
    );
    surface.addEventListener(
      "mousedown",
      (e) => {
        if (e.button === 1) e.preventDefault(); // middle button = rear camera, not autoscroll
        this.#usingGamepad = false;
        this.#ownerIsGamepad = false;
        if (this.capturePointer && document.pointerLockElement !== surface) {
          // (raw counts where the browser has them; a refusal, as headless or an iframe, just leaves the mouse free)
          // (older browsers return nothing; some refuse unadjustedMovement: then plain capture)
          const lock = (options?: PointerLockOptions): Promise<void> | undefined => surface.requestPointerLock(options);
          lock({ unadjustedMovement: true })?.catch(() => lock()?.catch(() => undefined));
        }
        this.#mouseButtons.add(e.button);
        this.#pressedButtons.add(e.button);
        this.#events.push({ kind: "mouse", button: e.button, down: true });
      },
      { signal },
    );
    window.addEventListener(
      "mouseup",
      (e) => {
        if (this.#mouseButtons.delete(e.button)) {
          this.#releasedButtons.add(e.button);
          this.#events.push({ kind: "mouse", button: e.button, down: false });
        }
      },
      { signal },
    );
    surface.addEventListener(
      "contextmenu",
      (e) => {
        e.preventDefault();
      },
      { signal },
    ); // right button = jump
    window.addEventListener(
      "mousemove",
      (e) => {
        if (document.pointerLockElement !== surface) return;
        this.#mouseX += e.movementX;
        this.#mouseY += e.movementY;
      },
      { signal },
    );
    window.addEventListener(
      "blur",
      () => {
        for (const k of this.#keys) {
          this.#releasedKeys.add(k);
          this.#events.push({ kind: "key", code: k, down: false });
        }
        for (const b of this.#mouseButtons) {
          this.#releasedButtons.add(b);
          this.#events.push({ kind: "mouse", button: b, down: false });
        }
        this.#keys.clear();
        this.#mouseButtons.clear();
      },
      { signal },
    );
  }

  /** PlayerInput.bUsingGamepad: the gamepad was used more recently than the keyboard or mouse. */
  get usingGamepad(): boolean {
    return this.#usingGamepad;
  }

  /** The free look's device and the camera settings in use (bDeviceOwnerIsGamepad: the last key or button event's
   *  device; notes/camera-respawn-goal.md CAM-16, CAM-17) */
  get ownerIsGamepad(): boolean {
    return this.#ownerIsGamepad;
  }

  dispose(): void {
    this.#abort.abort();
  }

  /** What the game sees of the pad (the menus' presses taken out: ui/padNav.ts) */
  padFilter: (pad: GamepadSnapshot | null) => GamepadSnapshot | null = (pad) => pad;

  /** A key pressed and let go within the frame (the wheel's turns, PrintScreen): a press the game acts on, never held */
  #tap(code: string): void {
    this.#pressedKeys.add(code);
    this.#releasedKeys.add(code);
    this.#events.push({ kind: "key", code, down: true }, { kind: "key", code, down: false });
  }

  /** Held inputs, and the presses and releases since the previous snapshot. */
  snapshot(): InputSnapshot {
    const gamepad = this.padFilter(readGamepad());
    if (gamepad && (gamepad.buttons.some((v) => v > 0.5) || gamepad.axes.some((v) => Math.abs(v) > 0.5))) {
      this.#usingGamepad = true;
    }
    const padButtons = gamepad?.buttons.map((v) => v > 0.5) ?? [];
    if (padButtons.some((down, i) => down && !(this.#padButtons[i] ?? false))) this.#ownerIsGamepad = true;
    this.#padButtons = padButtons;
    const snapshot: InputSnapshot = {
      keys: new Set(this.#keys),
      mouseButtons: new Set(this.#mouseButtons),
      pressedKeys: new Set(this.#pressedKeys),
      pressedMouseButtons: new Set(this.#pressedButtons),
      releasedKeys: new Set(this.#releasedKeys),
      releasedMouseButtons: new Set(this.#releasedButtons),
      events: this.#events.splice(0),
      mouse: { x: this.#mouseX, y: this.#mouseY },
      gamepad,
    };
    this.#mouseX = 0;
    this.#mouseY = 0;
    this.#pressedKeys.clear();
    this.#pressedButtons.clear();
    this.#releasedKeys.clear();
    this.#releasedButtons.clear();
    return snapshot;
  }
}

/** The browser's pads: none where it has no Gamepad API (turned off, or a privacy setting's) or refuses it (a
 *  permissions policy's block: RV-526): the game plays on without pads, not stopped at its first frame */
export function gamepads(): readonly (Gamepad | null)[] {
  if (typeof navigator.getGamepads !== "function") return [];
  try {
    return navigator.getGamepads();
  } catch {
    return [];
  }
}

/** The first connected gamepad with the standard layout, else the first the browser doesn't map (unmappedSnapshot); its
 *  kind noted for the prompts' glyphs (setPadStyle) */
export function readGamepad(): GamepadSnapshot | null {
  let unmapped: Gamepad | null = null;
  for (const pad of gamepads()) {
    if (!pad?.connected) continue;
    if (pad.mapping === "standard") {
      setPadStyle(padStyleOf(pad.id));
      lastPadUnmapped = false;
      return { axes: [...pad.axes], buttons: pad.buttons.map((b) => b.value) };
    }
    unmapped ??= pad;
  }
  lastPadUnmapped = unmapped !== null;
  return unmapped ? unmappedSnapshot(unmapped) : null;
}

/** Each unmapped pad's rest (by its id): its axes' resting values, the buttons held when first seen (RV-1095) */
const rests = new Map<string, { readonly axes: readonly number[]; readonly held: Set<number> }>();
/** The pad last read is one the browser doesn't map (the Controls screen says so) */
let lastPadUnmapped = false;

/** Whether the pad in use is one the browser doesn't map (its buttons and sticks numbered as it reports them) */
export function padUnmapped(): boolean {
  return lastPadUnmapped;
}

/** A pad the browser doesn't map ("standard" mapping missing: an older or uncommon pad): its buttons and sticks by
 *  their own numbers, its binds set on the Controls screen (RV-1095). An axis at an end when first seen rests there (a
 *  trigger at -1 reads 0 untouched), any other at 0 (the browser shows a pad first at a stick moved half way: never its
 *  rest); a button held when first seen (the press that showed it) counts once let go */
export function unmappedSnapshot(pad: Pick<Gamepad, "id" | "axes" | "buttons">): GamepadSnapshot {
  let rest = rests.get(pad.id);
  if (!rest) {
    rest = {
      axes: pad.axes.map((v) => (Math.abs(v) > 0.99 ? Math.sign(v) : 0)),
      held: new Set(pad.buttons.flatMap((b, i) => (b.value > 0.5 ? [i] : []))),
    };
    rests.set(pad.id, rest);
  }
  setPadStyle(padStyleOf(pad.id));
  const { axes: restAxes, held } = rest;
  const axes = pad.axes.map((v, i) => Math.max(-1, Math.min(1, v - (restAxes[i] ?? 0))));
  const buttons = pad.buttons.map((b, i) => {
    if (held.has(i) && b.value > 0.5) return 0;
    held.delete(i);
    return b.value;
  });
  return { axes, buttons };
}
