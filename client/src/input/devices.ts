// Collects keyboard, mouse and gamepad state from the browser into snapshots.
import { padStyleOf, setPadStyle } from "./bindings";
import type { GamepadSnapshot, InputEvent, InputSnapshot } from "./mapping";

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

  /** `surface`: the element that receives mouse buttons (the game canvas). */
  constructor(surface: HTMLElement) {
    const signal = this.#abort.signal;
    window.addEventListener(
      "keydown",
      (e) => {
        // (typing in a text field, the settings' name: its keys the field's, not the game's: RV-482)
        if (editable(e.target)) return;
        if (e.code === "Space" || e.code === "Backspace") e.preventDefault(); // no page scroll/back
        // (Tab the scoreboard's, not focus, in play; with a menu up it moves the focus, the menus' keyboard path: RV-482)
        if (e.code === "Tab" && !this.menuOpen() && (e.target === document.body || e.target === surface)) e.preventDefault();
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
        if (this.#keys.delete(e.code)) {
          this.#releasedKeys.add(e.code);
          this.#events.push({ kind: "key", code: e.code, down: false });
        }
      },
      { signal },
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
    surface.addEventListener("contextmenu", (e) => { e.preventDefault(); }, { signal }); // right button = jump
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

/** The first connected gamepad with the standard layout (its kind noted for the prompts' glyphs: setPadStyle) */
export function readGamepad(): GamepadSnapshot | null {
  for (const pad of gamepads()) {
    if (pad?.connected && pad.mapping === "standard") {
      setPadStyle(padStyleOf(pad.id));
      return { axes: [...pad.axes], buttons: pad.buttons.map((b) => b.value) };
    }
  }
  return null;
}
