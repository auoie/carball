// Display Mode (MENU-19's Window Settings, the game's words: Windowed, Fullscreen). Fullscreen asks the browser for the
// page in full screen at once when chosen, and at a page's first press when it loads so set (a browser grants full screen
// only in answer to one), then locks the keyboard there where it can (Chromium's Keyboard Lock): Escape, Ctrl+W and the
// like reach the game, so a held Ctrl or Alt bind's chords are the game's alone (RV-1091); a long Escape leaves full
// screen, and the page doesn't pull the player back until it's chosen again. Windowed leaves full screen.
interface KeyboardLock {
  readonly lock?: (codes?: string[]) => Promise<void>;
}

export class DisplayMode {
  #fullscreen = false;
  /** This page has asked for full screen since Fullscreen was chosen (or the page loaded) */
  #asked = false;

  constructor(private readonly doc: Document = document) {
    // (any press: a click, a key, a pad's button reaches the page as neither)
    for (const kind of ["pointerdown", "keydown"] as const) {
      window.addEventListener(
        kind,
        () => {
          if (this.#fullscreen && !this.#asked && this.doc.fullscreenElement === null) this.#request();
        },
        { capture: true },
      );
    }
    doc.addEventListener("fullscreenchange", () => {
      if (this.doc.fullscreenElement === null) return;
      const keyboard = (navigator as { readonly keyboard?: KeyboardLock }).keyboard;
      void keyboard?.lock?.().catch(() => undefined);
    });
  }

  /** Fullscreen or Windowed; `now`: chosen by a press (the settings' own), so asked for at once */
  set(fullscreen: boolean, now: boolean): void {
    this.#fullscreen = fullscreen;
    this.#asked = false;
    if (!fullscreen) {
      if (this.doc.fullscreenElement !== null) void this.doc.exitFullscreen().catch(() => undefined);
    } else if (now && this.doc.fullscreenElement === null) {
      this.#request();
    }
  }

  #request(): void {
    this.#asked = true;
    // (refused without a press to answer, Escape's among them: asked again at the next)
    this.doc.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {
      this.#asked = false;
    });
  }
}
