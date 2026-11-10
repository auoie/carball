// The touch controls (phones and tablets: the user's request of 2026-11-10, notes/mobile.md), shown in play: a floating
// stick on the left half, centred where the thumb lands (steer, pitch and yaw, and a flip's direction: a pad's left
// stick, through its own path, InputDevices putting it on a virtual pad's axes 0 and 1); big buttons on the right (Jump,
// Boost, Powerslide and air roll, Ball cam); a pause button and the mode's own (free play's reset, training's retry and
// shots, online's scoreboard). The buttons press actions, not pad buttons (the default pad binds Reverse and Air roll
// both to LT). The throttle is the stick's too: forward at its tilt, reverse in its bottom quarter, so steering at full
// lock still drives. Every finger its own pointer, captured where it lands (the stick and the buttons at once).
import type { Action } from "./bindings";
import type { TouchSnapshot } from "./mapping";

/** The stick's travel (px from its centre to full tilt) */
export const STICK_RADIUS = 56;

/** The stick at a finger `dx`, `dy` px from its centre: within the unit disc */
export function stickVector(dx: number, dy: number, radius: number = STICK_RADIUS): { x: number; y: number } {
  const length = Math.hypot(dx, dy);
  const scale = length > radius ? 1 / length : 1 / radius;
  return { x: dx * scale, y: dy * scale };
}

/** The buttons and the actions each holds (Jump skips a replay too, as the pad's A: the game's ReadyUp) */
export type TouchButton = "jump" | "boost" | "slide" | "ballCam" | "reset" | "previous" | "next" | "scoreboard";
export const TOUCH_ACTIONS: Readonly<Record<TouchButton, readonly Action[]>> = {
  jump: ["jump", "readyUp"],
  boost: ["boost"],
  slide: ["handbrake", "airRoll"],
  ballCam: ["ballCam"],
  reset: ["reset"],
  previous: ["trainingPrevious"],
  next: ["trainingNext"],
  scoreboard: ["scoreboard"],
};

export const TOUCH_TEXT = {
  jump: "Jump",
  boost: "Boost",
  slide: "Slide",
  ballCam: "Ball Cam",
  reset: "Reset",
  previous: "Prev",
  next: "Next",
  scoreboard: "Scores",
  pause: "Pause",
  rotate: "Turn your phone sideways to play",
} as const;

/** The match the controls are for: its own buttons (free play's reset; training's retry, previous and next; online's
 *  scoreboard) */
export type TouchMode = "freeplay" | "training" | "online";

const MODE_BUTTONS: Readonly<Record<TouchMode, readonly TouchButton[]>> = {
  freeplay: ["reset"],
  training: ["previous", "reset", "next"],
  online: ["scoreboard"],
};

/** Whether this device's main pointer is a finger (a phone's, a tablet's) */
export function touchDevice(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/** The page's touch settings: no pinch zoom in Safari (its gesture events; the stylesheet's touch-action stops the rest),
 *  and the screen turned to landscape once in full screen where the browser allows it (Android's) */
export function installTouchPage(doc: Document = document): void {
  // (the menus' targets a finger's size on a touch device: the stylesheet's .touch-device rules)
  doc.documentElement.classList.toggle("touch-device", touchDevice());
  // (Safari's pinch stopped on a touch screen alone: a Mac's trackpad pinch zooms as ever, RV-1216)
  if (navigator.maxTouchPoints > 0) {
    doc.addEventListener("gesturestart", (e) => {
      e.preventDefault();
    });
  }
  doc.addEventListener("fullscreenchange", () => {
    if (doc.fullscreenElement === null || !touchDevice()) return;
    // (Safari has no lock, an older iOS no screen.orientation at all: typed as the browser may have them)
    const orientation = (screen as { readonly orientation?: { lock?: (o: "landscape") => Promise<void> } }).orientation;
    void orientation?.lock?.("landscape").catch(() => undefined);
  });
  // (portrait: the prompt to turn the phone, over everything: the stylesheet shows it on a touch device held upright)
  const rotate = doc.createElement("div");
  rotate.id = "rotate";
  rotate.textContent = TOUCH_TEXT.rotate;
  doc.body.append(rotate);
}

/** The screen kept on while wanted (play on a touch device: a phone dims and locks itself otherwise; notes/mobile.md),
 *  taken again when the page comes back (the browser lets a wake lock go with the page hidden); nothing where the browser
 *  has none */
class ScreenWake {
  #wanted = false;
  #lock: WakeLockSentinel | null = null;

  constructor() {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.#wanted) this.#take();
    });
  }

  set wanted(wanted: boolean) {
    if (wanted === this.#wanted) return;
    this.#wanted = wanted;
    if (wanted) this.#take();
    else {
      void this.#lock?.release().catch(() => undefined);
      this.#lock = null;
    }
  }

  #take(): void {
    const wakeLock = (navigator as { readonly wakeLock?: WakeLock }).wakeLock;
    if (!wakeLock || (this.#lock !== null && !this.#lock.released)) return;
    wakeLock.request("screen").then(
      (lock) => {
        if (!this.#wanted) {
          void lock.release().catch(() => undefined);
          return;
        }
        this.#lock = lock;
      },
      () => undefined,
    );
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = className;
  parent.append(e);
  return e;
};

/**
 * The controls over the game (#touch). Shown while `update` says the game is in play on a touch device (its pointer a
 * finger, or a touch since), hidden while a pad is used (until the next touch). `snapshot` is read with the others' a
 * frame (InputDevices).
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  readonly #stickBase: HTMLDivElement;
  readonly #stickKnob: HTMLDivElement;
  readonly #buttons = new Map<TouchButton, HTMLButtonElement>();
  readonly #modeRow: HTMLDivElement;
  #stickPointer: number | null = null;
  #stickOrigin = { x: 0, y: 0 };
  #stick: { x: number; y: number } | null = null;
  /** Each held button's pointers */
  readonly #holding = new Map<TouchButton, Set<number>>();
  readonly #pressed = new Set<Action>();
  #touched = touchDevice();
  #padUsed = false;
  #shown = false;
  #mode: TouchMode | null = null;
  readonly #wake = new ScreenWake();

  /** `pause`: the pause button's (the pause menu opened) */
  constructor(parent: HTMLElement, pause: () => void) {
    this.root = el("div", "touch", parent);
    this.root.id = "touch";
    this.root.hidden = true;
    // (the left half: a finger landing there places the stick)
    const zone = el("div", "touch-stick-zone", this.root);
    this.#stickBase = el("div", "touch-stick-base", zone);
    this.#stickKnob = el("div", "touch-stick-knob", this.#stickBase);
    this.#stickBase.hidden = true;
    zone.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      // (a finger's or a pen's: a mouse never drives the stick, RV-1211)
      if (this.#stickPointer !== null || e.pointerType === "mouse") return;
      this.#stickPointer = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.#stickOrigin = { x: e.clientX, y: e.clientY };
      this.#moveStick(e.clientX, e.clientY);
    });
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.#stickPointer) this.#moveStick(e.clientX, e.clientY);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      zone.addEventListener(type, (e) => {
        if (e.pointerId !== this.#stickPointer) return;
        this.#stickPointer = null;
        this.#stick = null;
        this.#stickBase.hidden = true;
      });
    }
    // (the right side's big buttons, bottom up: Jump in the thumb's corner, Boost beside it, Slide over it, Ball cam)
    const pad = el("div", "touch-buttons", this.root);
    for (const b of ["jump", "boost", "slide", "ballCam"] as const) this.#button(b, pad);
    // (the top row: pause, then the mode's own)
    const top = el("div", "touch-top", this.root);
    const pauseButton = el("button", "touch-button touch-pause", top);
    pauseButton.type = "button";
    pauseButton.textContent = TOUCH_TEXT.pause;
    pauseButton.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pause();
    });
    this.#modeRow = el("div", "touch-mode", top);
    for (const b of ["previous", "reset", "next", "scoreboard"] as const) this.#button(b, this.#modeRow);
    // (a touch anywhere: the controls are for a finger again, a pad's use forgotten; the mouse or the keyboard used: they
    // go until the next touch, a touchscreen laptop's or a tablet's keyboard, RV-1211)
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType === "mouse") this.#touched = false;
        if (e.pointerType !== "touch") return;
        this.#touched = true;
        this.#padUsed = false;
      },
      { capture: true },
    );
    window.addEventListener(
      "keydown",
      () => {
        this.#touched = false;
      },
      { capture: true },
    );
    // (the controls swallow every touch that lands on them, a stray one between the buttons too: no tap through to the
    // game, whose compatibility mouse events would be a jump, RV-1210; iOS before Safari 27 needs the touchstart's)
    this.root.addEventListener("pointerdown", (e) => {
      e.preventDefault();
    });
    this.root.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
      },
      { passive: false },
    );
    // (every finger let go when the page loses them: blurred, hidden, left, or turned, RV-1213)
    for (const type of ["blur", "pagehide", "orientationchange"] as const) {
      window.addEventListener(type, () => {
        this.#release();
      });
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.#release();
    });
  }

  /** Each frame: whether the game is in play (no menu over it) and its mode; shown on a touch device in play, no pad in
   *  use. Hidden, nothing is held */
  update(inPlay: boolean, mode: TouchMode): void {
    // (the screen kept on in play on a touch device, a pad in its hands or not)
    this.#wake.wanted = inPlay && this.#touched;
    const shown = inPlay && this.#touched && !this.#padUsed;
    if (mode !== this.#mode) {
      this.#mode = mode;
      for (const b of ["previous", "reset", "next", "scoreboard"] as const) {
        const button = this.#buttons.get(b);
        if (button) button.hidden = !MODE_BUTTONS[mode].includes(b);
      }
    }
    if (shown === this.#shown) return;
    this.#shown = shown;
    this.root.hidden = !shown;
    document.body.classList.toggle("touch-play", shown);
    if (!shown) this.#release();
  }

  /** A pad's button or stick used: the controls hide until the next touch */
  padUsed(): void {
    if (!this.#shown) return;
    this.#padUsed = true;
  }

  get shown(): boolean {
    return this.#shown;
  }

  /** This frame's stick and buttons (null while hidden); the presses since the last read */
  snapshot(): TouchSnapshot | null {
    if (!this.#shown) return null;
    const held = new Set<Action>();
    for (const [b, pointers] of this.#holding) if (pointers.size > 0) for (const a of TOUCH_ACTIONS[b]) held.add(a);
    const pressed = new Set(this.#pressed);
    this.#pressed.clear();
    return { stick: this.#stick, held, pressed };
  }

  #button(b: TouchButton, parent: HTMLElement): void {
    const button = el("button", `touch-button touch-${b}`, parent);
    button.type = "button";
    button.textContent = TOUCH_TEXT[b];
    button.dataset["touch"] = b;
    const pointers = new Set<number>();
    this.#holding.set(b, pointers);
    button.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (e.pointerType === "mouse") return;
      button.setPointerCapture(e.pointerId);
      pointers.add(e.pointerId);
      for (const a of TOUCH_ACTIONS[b]) this.#pressed.add(a);
      button.classList.add("held");
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      button.addEventListener(type, (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size === 0) button.classList.remove("held");
      });
    }
    this.#buttons.set(b, button);
  }

  #moveStick(x: number, y: number): void {
    const v = stickVector(x - this.#stickOrigin.x, y - this.#stickOrigin.y);
    this.#stick = v;
    this.#stickBase.hidden = false;
    this.#stickBase.style.left = `${String(this.#stickOrigin.x)}px`;
    this.#stickBase.style.top = `${String(this.#stickOrigin.y)}px`;
    this.#stickKnob.style.transform = `translate(${String(v.x * STICK_RADIUS)}px, ${String(v.y * STICK_RADIUS)}px)`;
  }

  /** Everything let go (hidden: a menu over the game) */
  #release(): void {
    this.#stickPointer = null;
    this.#stick = null;
    this.#stickBase.hidden = true;
    for (const [b, pointers] of this.#holding) {
      pointers.clear();
      this.#buttons.get(b)?.classList.remove("held");
    }
    this.#pressed.clear();
  }
}
