// The touch controls (phones and tablets: the user's request of 2026-11-10, notes/mobile.md), shown in play: a floating
// stick on the left half, centred where the thumb lands (steer, pitch and yaw, and a flip's direction: a pad's left
// stick, through its own path, InputDevices putting it on a virtual pad's axes 0 and 1); big buttons on the right (Jump,
// Boost, Powerslide and air roll, Ball cam); a pause button and the mode's own (free play's reset, training's retry and
// shots, online's scoreboard). The buttons press actions, not pad buttons (the default pad binds Reverse and Air roll
// both to LT). The throttle is the stick's by default (forward at its tilt, reverse in its bottom quarter, so steering at
// full lock still drives), else the buttons' (Auto drive's Brake; Split's Gas and Reverse: input/touchSettings.ts). The
// stick floats or stays at a fixed spot, its size, sensitivity and deadzone the player's; every button can be moved,
// sized, faded or hidden in the layout editor. Every finger its own pointer, captured where it lands (the stick and the
// buttons at once).
import type { Action } from "./bindings";
import type { TouchSnapshot } from "./mapping";
import { safeInsets } from "../ui/stage";
import {
  type ButtonPlace,
  DEFAULT_PLACE,
  EMPTY_LAYOUT,
  PLACE_LIMITS,
  TOUCH_DEFAULTS,
  type TouchLayout,
  type TouchSettings,
  loadLayout,
  saveLayout,
  shapeStick,
} from "./touchSettings";

/** The stick's travel (px from its centre to full tilt) */
export const STICK_RADIUS = 56;

/** The stick at a finger `dx`, `dy` px from its centre: within the unit disc */
export function stickVector(dx: number, dy: number, radius: number = STICK_RADIUS): { x: number; y: number } {
  const length = Math.hypot(dx, dy);
  const scale = length > radius ? 1 / length : 1 / radius;
  return { x: dx * scale, y: dy * scale };
}

/** The buttons and the actions each holds (Jump skips a replay too, as the pad's A: the game's ReadyUp) */
export type TouchButton = "jump" | "boost" | "slide" | "ballCam" | "gas" | "reverse" | "brake" | "reset" | "previous" | "next" | "scoreboard";
export const TOUCH_ACTIONS: Readonly<Record<TouchButton, readonly Action[]>> = {
  jump: ["jump", "readyUp"],
  boost: ["boost"],
  slide: ["handbrake", "airRoll"],
  ballCam: ["ballCam"],
  // (the throttle's buttons: Split's Gas and Reverse, Auto drive's Brake (the forward drive itself while it's let go))
  gas: ["throttleForward"],
  reverse: ["throttleReverse"],
  brake: ["throttleReverse"],
  reset: ["reset"],
  previous: ["trainingPrevious"],
  next: ["trainingNext"],
  scoreboard: ["scoreboard"],
};

export const TOUCH_TEXT = {
  jump: "Jump",
  boost: "Boost",
  slide: "Slide",
  /** Slide's words in the air: air roll is what it does there */
  airRoll: "Air Roll",
  ballCam: "Ball Cam",
  reset: "Reset",
  previous: "Prev",
  next: "Next",
  scoreboard: "Scores",
  gas: "Gas",
  reverse: "Reverse",
  brake: "Brake",
  pause: "Pause",
  rotate: "Turn your phone sideways to play",
  /** The layout editor's */
  editing: "Drag a button to move it",
  stick: "Stick",
  smaller: "Smaller",
  bigger: "Bigger",
  fainter: "Fainter",
  stronger: "Stronger",
  hide: "Hide",
  show: "Show",
  resetAll: "Reset All",
  done: "Done",
} as const;

/** The throttle model's buttons shown (Stick's none) */
const THROTTLE_BUTTONS: Readonly<Record<TouchSettings["throttle"], readonly TouchButton[]>> = { stick: [], auto: ["brake"], split: ["gas", "reverse"] };

/** The fixed stick's spot by default (fractions of the screen) */
const FIXED_STICK = { x: 0.2, y: 0.68 } as const;
/** The stick's base half its size (px, style.css's .touch-stick-base at Stick Size 1) */
const STICK_BASE_HALF = 76;

/** The match the controls are for: its own buttons (free play's reset; training's retry, previous and next; online's
 *  scoreboard) */
export type TouchMode = "freeplay" | "training" | "online";

/** The buttons that start a training shot, as the stick does (CTR-5's throttle, jump, boost); training's commands put it
 *  back in its Countdown (RV-1232) */
const STARTS_SHOT: ReadonlySet<TouchButton> = new Set(["jump", "boost", "gas", "reverse", "brake"]);
const SHOT_COMMANDS: ReadonlySet<TouchButton> = new Set(["previous", "reset", "next"]);

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
  // (Safari's pinch stopped on a touch screen in play alone: a Mac's trackpad pinch zooms as ever, RV-1216, and so do a
  // phone's menus, RV-1227)
  if (navigator.maxTouchPoints > 0) {
    doc.addEventListener("gesturestart", (e) => {
      if (doc.body.classList.contains("touch-play")) e.preventDefault();
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
export class ScreenWake {
  #wanted = false;
  #lock: WakeLockSentinel | null = null;
  #pending = false;
  readonly #wakeLock: () => WakeLock | undefined;

  /** `wakeLock`: the browser's (navigator.wakeLock: the tests' a stand-in); `doc`, whose visibility it follows */
  constructor(
    wakeLock: () => WakeLock | undefined = () => (navigator as { readonly wakeLock?: WakeLock }).wakeLock,
    doc: Pick<Document, "addEventListener" | "hidden"> = document,
  ) {
    this.#wakeLock = wakeLock;
    doc.addEventListener("visibilitychange", () => {
      if (!doc.hidden && this.#wanted) this.#take();
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
    const wakeLock = this.#wakeLock();
    if (!wakeLock || this.#pending || (this.#lock !== null && !this.#lock.released)) return;
    // (one request at a time: a lock that comes when it's no longer wanted, or one is held, let go at once: RV-1224)
    this.#pending = true;
    wakeLock.request("screen").then(
      (lock) => {
        this.#pending = false;
        if (!this.#wanted || (this.#lock !== null && !this.#lock.released)) {
          void lock.release().catch(() => undefined);
          return;
        }
        this.#lock = lock;
      },
      () => {
        this.#pending = false;
      },
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
 * finger, or a touch since), hidden while a pad, the mouse or the keyboard is used (until the next touch). `snapshot` is
 * read with the others' a frame (InputDevices). `configure` takes the Touch settings, `editLayout` opens the layout
 * editor over everything.
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  readonly #stickBase: HTMLDivElement;
  readonly #stickKnob: HTMLDivElement;
  readonly #buttons = new Map<TouchButton, HTMLButtonElement>();
  readonly #modeRow: HTMLDivElement;
  readonly #toolbar: HTMLDivElement;
  readonly #toolbarLabel: HTMLDivElement;
  readonly #hideButton: HTMLButtonElement;
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
  #settings: TouchSettings = TOUCH_DEFAULTS;
  #layout: TouchLayout = loadLayout();
  /** A training shot waiting in its Countdown, and whether the stick or a driving button was touched since it began:
   *  Auto drive drives only then (a shot starts on any throttle, so it would start every shot by itself: RV-1232). A
   *  tap on Prev, Reset or Next holds it back at once, for the next two frames (`#commandHold`): its command puts the
   *  shot in its Countdown later in that frame, after the frame's input is read, and the Countdown's wait takes over the
   *  next; a command that brings none (the reset's question) lets it drive again. The wait is read as the input is
   *  (`waiting`, the page's): a shot can come to its Countdown inside the game's frame before it (training's Skip Goal
   *  Replay: RV-1246) */
  waiting: () => boolean = () => false;
  #waiting = false;
  #armed = true;
  #commandHold = 0;
  #airborne = false;
  /** The layout editor open: its selected piece (a button, or the fixed stick), what to do when it's done */
  #editing: { selected: TouchButton | "stick" | null; done: () => void } | null = null;

  /** `pause`: the pause button's (the pause menu opened) */
  constructor(parent: HTMLElement, pause: () => void) {
    this.root = el("div", "touch", parent);
    this.root.id = "touch";
    this.root.hidden = true;
    // (the left half: a finger landing there places the stick, or takes the fixed one near its spot)
    const zone = el("div", "touch-stick-zone", this.root);
    this.#stickBase = el("div", "touch-stick-base", zone);
    this.#stickKnob = el("div", "touch-stick-knob", this.#stickBase);
    this.#stickBase.hidden = true;
    zone.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      // (a finger's or a pen's: a mouse never drives the stick, RV-1211)
      if (this.#editing || this.#stickPointer !== null || e.pointerType === "mouse") return;
      if (this.#settings.fixedStick) {
        const centre = this.#fixedCentre();
        if (Math.hypot(e.clientX - centre.x, e.clientY - centre.y) > this.#radius() * 2) return;
        this.#stickOrigin = centre;
      } else this.#stickOrigin = { x: e.clientX, y: e.clientY };
      this.#stickPointer = e.pointerId;
      this.#armed = true;
      zone.setPointerCapture(e.pointerId);
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
        this.#restStick();
      });
    }
    // (in the layout editor the fixed stick is dragged to its spot)
    this.#draggable(this.#stickBase, "stick");
    // (the right side's big buttons, bottom up: Jump in the thumb's corner, Boost beside it, Slide over it, Ball cam; the
    // throttle model's own left of them)
    const pad = el("div", "touch-buttons", this.root);
    for (const b of ["jump", "boost", "slide", "ballCam", "gas", "reverse", "brake"] as const) this.#button(b, pad);
    // (the top row: pause, then the mode's own)
    const top = el("div", "touch-top", this.root);
    const pauseButton = el("button", "touch-button touch-pause", top);
    pauseButton.type = "button";
    pauseButton.textContent = TOUCH_TEXT.pause;
    pauseButton.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!this.#editing) pause();
    });
    this.#modeRow = el("div", "touch-mode", top);
    for (const b of ["previous", "reset", "next", "scoreboard"] as const) this.#button(b, this.#modeRow);
    // (the layout editor's bar: the selected piece's size, its opacity, hidden or not; every piece back to its default;
    // done)
    this.#toolbar = el("div", "touch-toolbar", this.root);
    this.#toolbarLabel = el("div", "touch-toolbar-label", this.#toolbar);
    const tool = (label: string, act: () => void): HTMLButtonElement => {
      const b = el("button", "touch-tool", this.#toolbar);
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", act);
      return b;
    };
    const T = TOUCH_TEXT;
    tool(T.smaller, () => {
      this.#adjust({ scale: -0.1 });
    });
    tool(T.bigger, () => {
      this.#adjust({ scale: 0.1 });
    });
    tool(T.fainter, () => {
      this.#adjust({ opacity: -0.1 });
    });
    tool(T.stronger, () => {
      this.#adjust({ opacity: 0.1 });
    });
    this.#hideButton = tool(T.hide, () => {
      const selected = this.#editing?.selected;
      if (!selected || selected === "stick") return;
      const place = this.#place(selected);
      this.#setPlace(selected, { ...place, hidden: !place.hidden });
    });
    tool(T.resetAll, () => {
      this.#layout = EMPTY_LAYOUT;
      this.#applyLayout();
      this.#select(null);
    });
    tool(T.done, () => {
      this.#finishEditing();
    });
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
      (e) => {
        // (typing into a text field, the on-screen keyboard's too, is no keyboard player: RV-1231)
        const target = e.target;
        if (target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        this.#touched = false;
      },
      { capture: true },
    );
    // (the controls swallow every touch that lands on them, a stray one between the buttons too: no tap through to the
    // game, whose compatibility mouse events would be a jump, RV-1210; iOS before Safari 27 needs the touchstart's)
    this.root.addEventListener("pointerdown", (e) => {
      if (!(e.target instanceof Element && e.target.closest(".touch-toolbar"))) e.preventDefault();
    });
    this.root.addEventListener(
      "touchstart",
      (e) => {
        if (!(e.target instanceof Element && e.target.closest(".touch-toolbar"))) e.preventDefault();
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
    this.#applyLayout();
  }

  /** The Touch settings (input/touchSettings.ts): the throttle model's buttons, the stick's kind, size and response */
  configure(settings: TouchSettings): void {
    this.#settings = settings;
    this.root.style.setProperty("--stick-scale", String(settings.stickSize));
    for (const b of ["gas", "reverse", "brake"] as const) {
      const button = this.#buttons.get(b);
      if (button) button.hidden = !THROTTLE_BUTTONS[settings.throttle].includes(b);
    }
    this.#release();
  }

  /** Each frame: whether the game is in play (no menu over it) and its mode; shown on a touch device in play, no pad, mouse
   *  or keyboard in use. Hidden, nothing is held. (Not while the layout editor is open: it's shown over everything) */
  update(inPlay: boolean, mode: TouchMode, { airborne = false }: { readonly airborne?: boolean } = {}): void {
    if (this.#editing) return;
    // (Slide is air roll too: it says so in the air, the user's phone, 2026-11-10)
    if (airborne !== this.#airborne) {
      this.#airborne = airborne;
      const slide = this.#buttons.get("slide");
      if (slide) slide.textContent = airborne ? TOUCH_TEXT.airRoll : TOUCH_TEXT.slide;
    }
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
    // (the buttons' places kept inside the safe area at their sizes, measured now they're laid out)
    if (shown) this.#applyLayout();
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

  /** This frame's stick and buttons (null while hidden, or while the layout editor is open); the presses since the last
   *  read. Auto drive drives forward while Brake is let go */
  snapshot(): TouchSnapshot | null {
    if (!this.#shown || this.#editing) return null;
    const held = new Set<Action>();
    for (const [b, pointers] of this.#holding) if (pointers.size > 0) for (const a of TOUCH_ACTIONS[b]) held.add(a);
    const waiting = this.waiting();
    if (waiting && !this.#waiting) this.#armed = false;
    this.#waiting = waiting;
    const holding = waiting || this.#commandHold > 0;
    this.#commandHold = waiting ? 0 : Math.max(0, this.#commandHold - 1);
    const autoDrives = this.#settings.throttle === "auto" && !held.has("throttleReverse") && (!holding || this.#armed);
    if (autoDrives) held.add("throttleForward");
    const pressed = new Set(this.#pressed);
    this.#pressed.clear();
    return { stick: this.#stick, held, pressed, stickDrives: this.#settings.throttle === "stick" };
  }

  /** The layout editor over everything (the settings' Edit Button Layout): every button shown, dragged to its place, the
   *  selected one sized, faded or hidden; kept when done, then `done` */
  editLayout(done: () => void): void {
    this.#release();
    this.#editing = { selected: null, done };
    this.root.hidden = false;
    this.root.classList.add("touch-editing");
    for (const b of ["previous", "reset", "next", "scoreboard"] as const) {
      const button = this.#buttons.get(b);
      if (button) button.hidden = false;
    }
    this.#restStick();
    this.#select(null);
  }

  get editing(): boolean {
    return this.#editing !== null;
  }

  /** The editor's Done from elsewhere (Escape, a pad's Start: RV-1249, RV-1255) */
  finishEditing(): void {
    this.#finishEditing();
  }

  /** Every button and the fixed stick back to their default places (the settings' Reset Button Layout) */
  resetLayout(): void {
    this.#layout = EMPTY_LAYOUT;
    saveLayout(this.#layout);
    this.#applyLayout();
  }

  #finishEditing(): void {
    const editing = this.#editing;
    if (!editing) return;
    saveLayout(this.#layout);
    this.#editing = null;
    this.root.classList.remove("touch-editing");
    // (shown again as the next frame says; its mode's buttons as its mode has them)
    this.#shown = false;
    this.#mode = null;
    this.root.hidden = true;
    this.#restStick();
    editing.done();
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
      if (this.#editing || e.pointerType === "mouse") return;
      button.setPointerCapture(e.pointerId);
      pointers.add(e.pointerId);
      if (STARTS_SHOT.has(b)) this.#armed = true;
      else if (SHOT_COMMANDS.has(b) && this.#mode === "training") [this.#commandHold, this.#armed] = [2, false];
      for (const a of TOUCH_ACTIONS[b]) this.#pressed.add(a);
      button.classList.add("held");
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      button.addEventListener(type, (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size === 0) button.classList.remove("held");
      });
    }
    if (b === "gas" || b === "reverse" || b === "brake") button.hidden = true;
    this.#draggable(button, b);
    this.#buttons.set(b, button);
  }

  /** In the layout editor: a piece selected by a touch, moved with the finger (its centre where the finger is) */
  #draggable(piece: HTMLElement, id: TouchButton | "stick"): void {
    let dragging: number | null = null;
    piece.addEventListener("pointerdown", (e) => {
      if (!this.#editing) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = e.pointerId;
      piece.setPointerCapture(e.pointerId);
      this.#select(id);
    });
    piece.addEventListener("pointermove", (e) => {
      if (!this.#editing || e.pointerId !== dragging) return;
      // (its centre kept so the whole of it is inside the safe area (RV-1235); the stick's in the left half too, where
      // a thumb takes it (RV-1233))
      const [w, h] = [window.innerWidth, window.innerHeight];
      const inset = safeInsets();
      const rect = piece.getBoundingClientRect();
      const [halfW, halfH] = [rect.width / 2, rect.height / 2];
      const right = id === "stick" ? w / 2 - halfW : w - inset.right - halfW;
      const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(lo, hi), Math.max(lo, v));
      const x = clamp(e.clientX, inset.left + halfW, right) / w;
      const y = clamp(e.clientY, inset.top + halfH, h - inset.bottom - halfH) / h;
      if (id === "stick") {
        this.#layout = { ...this.#layout, stick: { ...this.#layout.stick, x, y } };
        this.#restStick();
      } else this.#setPlace(id, { ...this.#place(id), x, y });
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      piece.addEventListener(type, (e) => {
        if (e.pointerId === dragging) dragging = null;
      });
    }
  }

  #select(id: TouchButton | "stick" | null): void {
    if (!this.#editing) return;
    this.#editing.selected = id;
    for (const [b, button] of this.#buttons) button.classList.toggle("selected", b === id);
    this.#stickBase.classList.toggle("selected", id === "stick");
    const place = id && id !== "stick" ? this.#place(id) : null;
    this.#toolbarLabel.textContent = id === null ? TOUCH_TEXT.editing : id === "stick" ? TOUCH_TEXT.stick : TOUCH_TEXT[id];
    this.#hideButton.textContent = place?.hidden ? TOUCH_TEXT.show : TOUCH_TEXT.hide;
    this.#hideButton.disabled = place === null;
  }

  /** The selected button's size or opacity stepped, within their limits */
  #adjust(by: { readonly scale?: number; readonly opacity?: number }): void {
    const selected = this.#editing?.selected;
    if (!selected || selected === "stick") return;
    const place = this.#place(selected);
    const clamp = (v: number, r: { readonly min: number; readonly max: number }): number => Math.round(Math.min(r.max, Math.max(r.min, v)) * 100) / 100;
    this.#setPlace(selected, {
      ...place,
      scale: clamp(place.scale + (by.scale ?? 0), PLACE_LIMITS.scale),
      opacity: clamp(place.opacity + (by.opacity ?? 0), PLACE_LIMITS.opacity),
    });
  }

  #place(b: TouchButton): ButtonPlace {
    return this.#layout.buttons[b] ?? DEFAULT_PLACE;
  }

  #setPlace(b: TouchButton, place: ButtonPlace): void {
    this.#layout = { ...this.#layout, buttons: { ...this.#layout.buttons, [b]: place } };
    this.#applyLayout();
    if (this.#editing?.selected === b) this.#select(b);
  }

  /** Each button at its place: moved (its centre at its fractions of the screen, kept whole inside the safe area at its
   *  size, whatever the screen or a size changed since: RV-1253), sized, faded, hidden (shown faded in the editor); the
   *  fixed stick at its spot */
  #applyLayout(): void {
    const within = (fraction: number, half: number, from: "left" | "top", to: "right" | "bottom"): string =>
      `clamp(calc(env(safe-area-inset-${from}, 0px) + ${String(half)}px), ${String(fraction * 100)}%, ` +
      `calc(100% - env(safe-area-inset-${to}, 0px) - ${String(half)}px))`;
    for (const [b, button] of this.#buttons) {
      const place = this.#place(b);
      const moved = place.x !== undefined && place.y !== undefined;
      // (its size unscaled, as laid out: 0 while the controls are hidden, so placed again as they're shown)
      const [halfW, halfH] = [(button.offsetWidth * place.scale) / 2, (button.offsetHeight * place.scale) / 2];
      button.style.position = moved ? "fixed" : "";
      button.style.left = moved ? within(place.x ?? 0, halfW, "left", "right") : "";
      button.style.top = moved ? within(place.y ?? 0, halfH, "top", "bottom") : "";
      button.style.right = moved ? "auto" : "";
      button.style.bottom = moved ? "auto" : "";
      button.style.translate = moved ? "-50% -50%" : "";
      button.style.scale = place.scale === 1 ? "" : String(place.scale);
      button.style.opacity = place.opacity === 1 ? "" : String(place.opacity);
      if (place.hidden) button.dataset["layoutHidden"] = "";
      else delete button.dataset["layoutHidden"];
    }
    this.#restStick();
  }

  /** The stick's travel (px): its size's */
  #radius(): number {
    return STICK_RADIUS * this.#settings.stickSize;
  }

  /** The fixed stick's centre (px): its spot in the layout, else its default */
  #fixedCentre(): { x: number; y: number } {
    const spot = this.#layout.stick ?? FIXED_STICK;
    // (kept whole in the left half and the safe area at its size now, a bigger Stick Size since too: RV-1253)
    const [w, h] = [window.innerWidth, window.innerHeight];
    const inset = safeInsets();
    const half = this.#stickBase.offsetWidth / 2 || STICK_BASE_HALF * this.#settings.stickSize;
    const within = (v: number, lo: number, hi: number): number => Math.min(Math.max(lo, hi), Math.max(lo, v));
    return { x: within(spot.x * w, inset.left + half, w / 2 - half), y: within(spot.y * h, inset.top + half, h - inset.bottom - half) };
  }

  /** The stick at rest: the fixed one shown at its spot, its knob centred (in the editor too); the floating one hidden */
  #restStick(): void {
    const fixed = this.#settings.fixedStick;
    this.#stickBase.hidden = !fixed;
    this.#stickKnob.style.transform = "";
    if (!fixed) return;
    const centre = this.#fixedCentre();
    this.#stickBase.style.left = `${String(centre.x)}px`;
    this.#stickBase.style.top = `${String(centre.y)}px`;
  }

  #moveStick(x: number, y: number): void {
    const radius = this.#radius();
    const v = shapeStick(stickVector(x - this.#stickOrigin.x, y - this.#stickOrigin.y, radius), this.#settings);
    this.#stick = v;
    this.#stickBase.hidden = false;
    this.#stickBase.style.left = `${String(this.#stickOrigin.x)}px`;
    this.#stickBase.style.top = `${String(this.#stickOrigin.y)}px`;
    this.#stickKnob.style.transform = `translate(${String(v.x * radius)}px, ${String(v.y * radius)}px)`;
  }

  /** Everything let go (hidden: a menu over the game) */
  #release(): void {
    this.#stickPointer = null;
    this.#stick = null;
    this.#restStick();
    for (const [b, pointers] of this.#holding) {
      pointers.clear();
      this.#buttons.get(b)?.classList.remove("held");
    }
    this.#pressed.clear();
  }
}
