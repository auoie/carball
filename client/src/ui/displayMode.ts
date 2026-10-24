// Display Mode (MENU-19's Window Settings, the game's words: Windowed, Fullscreen). Fullscreen asks the browser for the
// page in full screen at once when chosen, and at a page's first press when it loads so set (a browser grants full screen
// only in answer to one; a match's page, loaded from the menu's, asks again at its loading screen's first press: RV-1111),
// locking the keyboard where it can (Chromium's Keyboard Lock) for the keys needed alone (lockedKeys: Escape, Ctrl+W and
// the like reach the game, so a held Ctrl or Alt bind's chords are the game's alone, RV-1091; never Tab nor the system
// key, Alt+Tab and the Windows key the system's, RV-1112); a long Escape leaves full screen, and the page doesn't pull the
// player back until it's chosen again. Windowed leaves full screen. Nothing where the browser has no full screen (an
// iPhone's Safari: RV-1113).
interface KeyboardLock {
  readonly lock?: (codes?: string[]) => Promise<void>;
}

/** The document's parts Display Mode reads and asks (the page's own, or a test's) */
export interface FullscreenDocument {
  readonly fullscreenElement: Element | null;
  readonly fullscreenEnabled: boolean;
  readonly documentElement: { readonly requestFullscreen?: (options?: FullscreenOptions) => Promise<void> };
  exitFullscreen(): Promise<void>;
  addEventListener(kind: "fullscreenchange", listener: () => void): void;
}

export interface DisplayModeDeps {
  /** The keys the lock takes (lockedKeys of the current bindings) */
  readonly keys: () => string[];
  readonly doc?: FullscreenDocument;
  readonly target?: Pick<Window, "addEventListener">;
  readonly keyboard?: () => KeyboardLock | undefined;
}

const pageKeyboard = (): KeyboardLock | undefined => (navigator as { readonly keyboard?: KeyboardLock }).keyboard;

/** Whether this browser can lock the keyboard in full screen (Chromium's Keyboard Lock; not Firefox's, not Safari's) */
export function keyboardLockAvailable(keyboard: () => KeyboardLock | undefined = pageKeyboard): boolean {
  return typeof keyboard()?.lock === "function";
}

/** Whether this page can go full screen at all (an iPhone's Safari can't: the option hidden there, RV-1113) */
export function fullscreenAvailable(doc: Pick<FullscreenDocument, "fullscreenEnabled" | "documentElement"> = document): boolean {
  return doc.fullscreenEnabled && typeof doc.documentElement.requestFullscreen === "function";
}

export class DisplayMode {
  readonly #keys: () => string[];
  readonly #doc: FullscreenDocument;
  readonly #keyboard: () => KeyboardLock | undefined;
  #fullscreen = false;
  /** This page has asked for full screen since Fullscreen was chosen (or the page loaded) */
  #asked = false;

  constructor(deps: DisplayModeDeps) {
    this.#keys = deps.keys;
    this.#doc = deps.doc ?? document;
    this.#keyboard = deps.keyboard ?? pageKeyboard;
    const target = deps.target ?? window;
    // (any press: a click, a key, a pad's button reaches the page as neither)
    for (const kind of ["pointerdown", "keydown"] as const) {
      target.addEventListener(
        kind,
        () => {
          if (this.#fullscreen && !this.#asked && this.#doc.fullscreenElement === null) this.#request();
        },
        { capture: true },
      );
    }
    this.#doc.addEventListener("fullscreenchange", () => {
      if (this.#doc.fullscreenElement !== null) this.#lock();
    });
  }

  /** Fullscreen or Windowed; `now`: chosen by a press (the settings' own), so asked for at once */
  set(fullscreen: boolean, now: boolean): void {
    if (!fullscreenAvailable(this.#doc)) return;
    this.#fullscreen = fullscreen;
    this.#asked = false;
    if (!fullscreen) {
      if (this.#doc.fullscreenElement !== null) void this.#doc.exitFullscreen().catch(() => undefined);
    } else if (now && this.#doc.fullscreenElement === null) {
      this.#request();
    }
  }

  /** The lock's keys again (the binds changed), in full screen */
  relock(): void {
    if (this.#doc.fullscreenElement !== null) this.#lock();
  }

  #lock(): void {
    void this.#keyboard()
      ?.lock?.(this.#keys())
      .catch(() => undefined);
  }

  #request(): void {
    const request = this.#doc.documentElement.requestFullscreen;
    if (!request) return;
    this.#asked = true;
    // (the lock asked for first, so the browser says both at once; it takes hold in full screen)
    this.#lock();
    // (refused without a press to answer, Escape's among them: asked again at the next)
    request.call(this.#doc.documentElement, { navigationUI: "hide" }).catch(() => {
      this.#asked = false;
    });
  }
}
