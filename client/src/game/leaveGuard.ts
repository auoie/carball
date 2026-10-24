// A queue match's page left by accident (RV-1091, RV-1103, RV-1104): a reload, the tab closed (Ctrl+W, with a held Ctrl
// among the game's binds outside full screen), the browser's back (a thumb button Firefox never lets a page cancel): the
// browser asks first, as leaving is an abandon (a loss and a ban), and Back stays in the page (a same-document entry,
// pushed again at each Back). From the page's start, its seat claimed while it loads; not once the match is over or its
// connection gone (`live`), nor when the page leaves it itself (the menu's Leave, the end screen's exit, a failed load's)
interface History {
  pushState(data: unknown, unused: string): void;
  back(): void;
}

export class LeaveGuard {
  /** Whether leaving now would leave the match: so until the game says otherwise (a claimed seat, loading) */
  live: () => boolean = () => true;
  #leaving = false;

  constructor(target: Pick<Window, "addEventListener"> = window, entries: History = history) {
    target.addEventListener("beforeunload", (e) => {
      if (this.asks()) e.preventDefault();
    });
    entries.pushState({ carballMatch: true }, "");
    target.addEventListener("popstate", () => {
      // (Back while the match lives: another entry, the page kept; once it's over, on to where Back would have gone)
      if (this.asks()) entries.pushState({ carballMatch: true }, "");
      else if (!this.#leaving) entries.back();
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
