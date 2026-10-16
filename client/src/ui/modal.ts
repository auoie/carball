// The error modal over the main menu (GFxModal_Error_TA: MM-38, MM-41): a title, a line, OK. After a lost connection
// or an idle kick (the game's words, cleared verbatim: the user's decisions, 2026-10-14; the connection-lost line without
// its "(Error: 42)").

export const MODAL_TEXT = {
  title: "Connection Lost",
  connectionLost: "Your connection to the game has been lost.",
  idleKicked: "You were kicked for being idle.",
  ok: "OK",
} as const;

export class Modal {
  readonly #root: HTMLDivElement;
  readonly #title: HTMLDivElement;
  readonly #body: HTMLDivElement;
  #onClose: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.#root = document.createElement("div");
    this.#root.id = "modal";
    this.#root.className = "modal";
    const box = document.createElement("div");
    box.className = "modal-box";
    this.#title = document.createElement("div");
    this.#title.className = "modal-title";
    this.#body = document.createElement("div");
    this.#body.className = "modal-body";
    const ok = document.createElement("button");
    ok.className = "modal-ok";
    // (the pad's focus on it; its press the notice's own cue, MENU-18)
    ok.dataset["padDefault"] = "";
    ok.textContent = MODAL_TEXT.ok;
    ok.addEventListener("click", () => {
      this.close();
    });
    box.append(this.#title, this.#body, ok);
    this.#root.append(box);
    this.#root.hidden = true;
    host.append(this.#root);
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  show(title: string, body: string, onClose?: () => void): void {
    this.#title.textContent = title;
    this.#body.textContent = body;
    this.#onClose = onClose ?? null;
    this.#root.hidden = false;
  }

  close(): void {
    if (this.#root.hidden) return;
    this.#root.hidden = true;
    const done = this.#onClose;
    this.#onClose = null;
    done?.();
  }
}
