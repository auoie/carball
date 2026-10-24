// Collects keyboard, mouse and gamepad state from the browser into snapshots.
import { padStyleOf, setPadStyle, takesBrowserKey } from "./bindings";
import type { GamepadSnapshot, InputEvent, InputSnapshot } from "./mapping";

/** The keys a browser sends only a keyup for (Windows keeps PrintScreen's keydown): taps when they come (RV-1100) */
export const KEYUP_ONLY: readonly string[] = ["PrintScreen"];

/** The least a wheel event is to be a notch in pixels (a 1-line Windows notch is 33.3 px, Chromium's 100 on Windows and
 *  53 on Linux, Firefox's about 48; a precision wheel's or a trackpad's pieces 12.5-25); in lines or pages any is one */
const WHEEL_NOTCH_PX = 32;
/** A notch as a merged event's notches are counted, in pixels, lines and pages: Chromium's Windows notch (100 px, 3
 *  lines), so every ordinary notch (100, 53, about 48 px; 1 to 3 lines) is one tap; a merged pair of 53 or 48 px notches
 *  counts one, a rare undercount; a wheel set to scroll 5 or more lines a notch (166 px) two (RV-1145, RV-1148) */
const WHEEL_NOTCH = [100, 3, 1] as const;

/**
 * A wheel event's taps, as the game takes the wheel (WHEEL1, RV-1137, notes/input.md): each wheel message one press and
 * release of MouseScrollUp or MouseScrollDown, in its order in the frame, nothing summed, carried or timed (no remainder,
 * no window, no rate limit). Here one browser event is one message; a turn down (a positive delta) MouseScrollDown, up
 * MouseScrollUp; Shift's, which Chromium sends sideways, the same turn (the game reads the vertical delta Shift doesn't
 * change), a sideways one without Shift none (the game reads no horizontal wheel). An event of several notches gives that
 * many taps: a stand-in for the game's separate messages where the browser merged them into one event (Chromium can under
 * load), counted against a fixed notch (WHEEL_NOTCH), never the game summing deltas. Smaller than a notch (a precision
 * wheel's or a trackpad's pieces): one tap in its own direction, a deliberate difference from the game (the user's
 * choice, 2026-10-24): the game's sign test on the truncated delta / 120 makes every such piece MouseScrollUp, whichever
 * way it turned.
 */
export function wheelTaps(
  e: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "shiftKey">,
): { readonly code: "WheelUp" | "WheelDown"; readonly count: number } | null {
  const delta = e.deltaY !== 0 ? e.deltaY : e.shiftKey ? e.deltaX : 0;
  if (delta === 0) return null;
  const code = delta < 0 ? "WheelUp" : "WheelDown";
  const size = Math.abs(delta);
  const mode = e.deltaMode === 1 || e.deltaMode === 2 ? e.deltaMode : 0;
  if (mode === 0 && size < WHEEL_NOTCH_PX) return { code, count: 1 };
  return { code, count: Math.max(1, Math.round(size / WHEEL_NOTCH[mode])) };
}

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
    // (the wheel's turns as the game's MouseScrollUp and MouseScrollDown: a key tapped each message, bindable, RV-1096,
    // RV-1137; in play, bound, the page's own never with it: Ctrl's zoom, RV-1127)
    surface.addEventListener(
      "wheel",
      (e) => {
        if (!this.menuOpen() && (this.bound("WheelUp") || this.bound("WheelDown"))) e.preventDefault();
        const taps = wheelTaps(e);
        if (taps === null) return;
        this.#usingGamepad = false;
        this.#ownerIsGamepad = false;
        for (let i = 0; i < taps.count; i++) this.#tap(taps.code);
      },
      { signal, passive: false },
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

/** The first connected gamepad with the standard layout (its kind noted for the prompts' glyphs: setPadStyle); a pad
 *  the browser doesn't map is never read (its numbers its own: a flight stick's, a wheel's pedals, RV-1124) */
export function readGamepad(): GamepadSnapshot | null {
  for (const pad of gamepads()) {
    if (pad?.connected && pad.mapping === "standard") {
      setPadStyle(padStyleOf(pad.id));
      return { axes: [...pad.axes], buttons: pad.buttons.map((b) => b.value) };
    }
  }
  return null;
}

/** Whether a pad the browser doesn't map is connected and no standard one is (the Controls screen says it can't be
 *  used) */
export function padUnmapped(): boolean {
  const connected = gamepads().filter((pad) => pad?.connected === true);
  return connected.length > 0 && connected.every((pad) => pad?.mapping !== "standard");
}
