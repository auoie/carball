// A queue match's page left by accident (RV-1091, RV-1103, RV-1104): a reload, the tab closed (Ctrl+W, with a held Ctrl
// among the game's binds outside full screen), the browser's back (a thumb button Firefox never lets a page cancel): the
// browser asks first, as leaving is an abandon (a loss and a ban), and Back stays in the page (a same-document entry).
// From the page's start, its seat claimed while it loads; not once the match is over or its connection gone (`live`), nor
// when the page leaves it itself (the menu's Leave, the end screen's exit, a failed claim or load: RV-1108).
// The entry is pushed at a press (a key, a click), never without one: browsers skip entries a page added with no press
// since on the Back button (Chromium's history intervention; Firefox's browser.navigation.requireUserInteraction), so one
// pushed at the start would be skipped; after a Back, pushed again at the next press, a second Back before it asked by
// the browser's own question (RV-1109). A pad alone presses nothing a browser counts: a controller-only player's reload or
// closed tab isn't asked about, the page's own question needing a press, rare and accepted.
interface History {
  pushState(data: unknown, unused: string): void;
  back(): void;
}

export class LeaveGuard {
  /** Whether leaving now would leave the match: so until the game says otherwise (a claimed seat, loading) */
  live: () => boolean = () => true;
  #leaving = false;
  /** An entry of this page's is in place for Back to take */
  #armed = false;

  constructor(target: Pick<Window, "addEventListener"> = window, entries: History = history) {
    target.addEventListener("beforeunload", (e) => {
      if (this.asks()) e.preventDefault();
    });
    const press = (): void => {
      if (this.#armed || !this.asks()) return;
      entries.pushState({ carballMatch: true }, "");
      this.#armed = true;
    };
    for (const kind of ["keydown", "pointerdown"] as const) target.addEventListener(kind, press, { capture: true });
    target.addEventListener("popstate", () => {
      // (Back took the entry: another at the next press while the match lives; once it's over, on to where Back goes)
      this.#armed = false;
      if (!this.asks() && !this.#leaving) entries.back();
    });
  }

  /** Whether leaving now is asked about */
  asks(): boolean {
    return !this.#leaving && this.live();
  }

  /** The page leaving the match on purpose: not asked */
  leaving(): void {
    this.#leaving = true;
  }
}
