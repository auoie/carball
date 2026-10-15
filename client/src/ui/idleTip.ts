// The idle warning (notes/matchmaking.md MM-36): the HUD's tip panel with the header "Warning" (shown upper-cased) and
// "You will be kicked for being idle." (the game's words, cleared verbatim: the user's decision, 2026-10-14), no countdown
// digits; while the server flags it, during play with the car's camera. It hides at once when the player acts.

export const IDLE_TEXT = {
  warning: "Warning",
  willBeKicked: "You will be kicked for being idle.",
} as const;

export class IdleTip {
  readonly #root: HTMLDivElement;

  constructor(host: HTMLElement) {
    this.#root = document.createElement("div");
    this.#root.id = "idle-tip";
    this.#root.className = "idle-tip";
    const header = document.createElement("div");
    header.className = "idle-tip-header";
    header.textContent = IDLE_TEXT.warning;
    const body = document.createElement("div");
    body.className = "idle-tip-body";
    body.textContent = IDLE_TEXT.willBeKicked;
    this.#root.append(header, body);
    this.#root.hidden = true;
    host.append(this.#root);
  }

  update(shown: boolean): void {
    if (this.#root.hidden === shown) this.#root.hidden = !shown;
  }
}
