// The error modal over the main menu (GFxModal_Error_TA: MM-38, MM-41): a title, a line, OK. After a lost connection
// or an idle kick (the game's words, cleared verbatim: the user's decisions, 2026-10-14; the connection-lost line without
// its "(Error: 42)"). Or a question, Yes and No (custom training's reset warning), No the default; or a choice of its
// own buttons (the training editor's Save and Exit, Delete Sequence).

export const MODAL_TEXT = {
  title: "Connection Lost",
  connectionLost: "Your connection to the game has been lost.",
  idleKicked: "You were kicked for being idle.",
  ok: "OK",
  yes: "Yes",
  no: "No",
} as const;

/** The rejoin offer and its refusal, the game's (TAGame.int [GFxShell_TA] RankedReconnectTitle/Body, TAErrors.int
 *  [Errors] MatchHasConcluded: RV-716, the titles upper-cased as its modals do); another tab's, ours (the game has none) */
export const REJOIN_TEXT = {
  title: "Reconnect",
  body: "It appears you accidentally left a ranked match. Would you like to rejoin?",
  concluded: "Match has concluded.",
  elsewhere: "You're playing that match in another tab or window.",
  /** The matchmaker refused it (ours: the account searched or played another match since, RV-882) */
  gone: "That match can't be rejoined: you've searched or played another match since.",
  /** The matchmaker couldn't be asked at the rejoin (ours: refused, never let in unconfirmed; offered again, RV-1008) */
  unconfirmed: "Your rejoin couldn't be confirmed right now. Try again in a moment.",
} as const;

/** A page older than the servers (ours: a claim or a rejoin refused on version, RV-865, RV-884) */
export const RELOAD_TEXT = {
  title: "New Version",
} as const;

export class Modal {
  readonly #root: HTMLDivElement;
  readonly #box: HTMLDivElement;
  /** A warning's icon (WarningModalPopup's), shown with its title */
  readonly #icon: SVGSVGElement;
  readonly #title: HTMLDivElement;
  readonly #body: HTMLDivElement;
  readonly #ok: HTMLButtonElement;
  readonly #yes: HTMLButtonElement;
  readonly #no: HTMLButtonElement;
  /** a choice's own buttons */
  readonly #choices: HTMLDivElement;
  #onClose: (() => void) | null = null;
  #onYes: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.#root = document.createElement("div");
    this.#root.id = "modal";
    this.#root.className = "modal";
    const box = document.createElement("div");
    box.className = "modal-box";
    this.#box = box;
    this.#icon = warningIcon();
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
    this.#ok = ok;
    this.#yes = document.createElement("button");
    this.#yes.className = "modal-ok";
    this.#yes.textContent = MODAL_TEXT.yes;
    this.#yes.hidden = true;
    this.#yes.addEventListener("click", () => {
      const yes = this.#onYes;
      this.close();
      yes?.();
    });
    this.#no = document.createElement("button");
    this.#no.className = "modal-ok";
    this.#no.textContent = MODAL_TEXT.no;
    this.#no.hidden = true;
    this.#no.addEventListener("click", () => {
      this.close();
    });
    this.#choices = document.createElement("div");
    this.#choices.className = "modal-choices";
    this.#choices.hidden = true;
    const head = document.createElement("div");
    head.className = "modal-head";
    head.append(this.#icon, this.#title);
    box.append(head, this.#body, ok, this.#yes, this.#no, this.#choices);
    this.#root.append(box);
    this.#root.hidden = true;
    host.append(this.#root);
    // (Tab kept to its own buttons while it's up: nothing behind it reached, the pause menu's either, RX34)
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Tab" || !this.isOpen) return;
        const buttons = [...this.#root.querySelectorAll("button")].filter((b) => !b.hidden && b.closest("[hidden]") === null);
        if (buttons.length === 0) return;
        e.preventDefault();
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = at < 0 ? (e.shiftKey ? buttons.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      },
      true,
    );
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  show(title: string, body: string, onClose?: () => void): void {
    this.#warning(false);
    this.#title.textContent = title;
    this.#body.textContent = body;
    this.#onClose = onClose ?? null;
    this.#onYes = null;
    this.#setButtons(false);
    this.#open();
  }

  /** A question: Yes runs `yes`; No (the default, Escape's) leaves it. `warning`: the game's WarningModalPopup, its
   *  icon by the title and YES and NO red (the leave penalty's question: RV-715, RV-753) */
  ask(title: string, body: string, yes: () => void, warning = false): void {
    this.#warning(warning);
    this.#title.textContent = title;
    this.#body.textContent = body;
    this.#onClose = null;
    this.#onYes = yes;
    this.#setButtons(true);
    this.#open();
    this.#no.focus();
  }

  /** A choice: its buttons in order, each closing it and running its own; `focus` the default's index (the pad's and
   *  Enter's); `dismiss` the one B and Escape answer (its act run as they close it; none: they only close it) */
  choose(
    title: string,
    body: string,
    choices: readonly { readonly label: string; readonly act?: () => void }[],
    focus = choices.length - 1,
    dismiss?: number,
  ): void {
    this.#warning(false);
    this.#title.textContent = title;
    this.#body.textContent = body;
    this.#onClose = (dismiss === undefined ? undefined : choices[dismiss]?.act) ?? null;
    this.#onYes = null;
    this.#ok.hidden = this.#yes.hidden = this.#no.hidden = true;
    delete this.#ok.dataset["padDefault"];
    delete this.#no.dataset["padDefault"];
    const buttons = choices.map((c, i) => {
      const b = document.createElement("button");
      b.className = "modal-ok";
      b.textContent = c.label;
      if (i === focus) b.dataset["padDefault"] = "";
      b.addEventListener("click", () => {
        this.#onClose = null; // (its own act alone, not the dismissal's too)
        this.close();
        c.act?.();
      });
      return b;
    });
    this.#choices.replaceChildren(...buttons);
    this.#choices.hidden = false;
    this.#open();
    buttons[focus]?.focus();
  }

  #warning(on: boolean): void {
    this.#box.classList.toggle("modal-warning", on);
    this.#icon.style.display = on ? "" : "none";
  }

  /** Shown, the pointer let go (a question asked over the game, where it's locked to the canvas) */
  #open(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.#root.hidden = false;
  }

  #setButtons(question: boolean): void {
    this.#choices.hidden = true;
    this.#ok.hidden = question;
    this.#yes.hidden = this.#no.hidden = !question;
    if (question) {
      delete this.#ok.dataset["padDefault"];
      this.#no.dataset["padDefault"] = "";
    } else {
      delete this.#no.dataset["padDefault"];
      this.#ok.dataset["padDefault"] = "";
    }
  }

  close(): void {
    if (this.#root.hidden) return;
    this.#root.hidden = true;
    this.#onYes = null;
    const done = this.#onClose;
    this.#onClose = null;
    done?.();
  }
}

/** The warning's icon: a triangle with its exclamation mark (our drawing of the popup's) */
function warningIcon(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "modal-icon");
  svg.setAttribute("aria-hidden", "true");
  const triangle = document.createElementNS(ns, "path");
  triangle.setAttribute("d", "M12 2 23 21H1Z");
  triangle.setAttribute("class", "modal-icon-triangle");
  const mark = document.createElementNS(ns, "path");
  mark.setAttribute("d", "M11 8h2v7h-2zM11 17h2v2h-2z");
  mark.setAttribute("class", "modal-icon-mark");
  svg.append(triangle, mark);
  svg.style.display = "none";
  return svg;
}
