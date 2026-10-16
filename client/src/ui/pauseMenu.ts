// The pause menu (notes/hud-menus.md MENU-4, HT-2/HT-4, MidGameMenu): Escape brings it up over the game. Resume Game,
// Settings (the settings panel over it; Escape there comes back here), then online the match's buttons (vote or
// forfeit, Leave Match) and the other players (mute, block); in training (freeplay) Exit to Main Menu, with its
// question. (Show Controls is the editor's, the replay viewer's and spectating's only.) Labels verbatim, shown
// upper-cased (the user's decision, 2026-10-14).
import { END_TEXT } from "../game/matchSequence";

export const PAUSE_TEXT = {
  resume: "Resume Game",
  settings: "Settings",
} as const;

export interface PauseActions {
  readonly resume: () => void;
  readonly settings: () => void;
  /** Freeplay: back to the main menu, once its question is answered (absent online: the match's buttons leave) */
  readonly exit?: () => void;
}

export class PauseMenu {
  readonly #root: HTMLDivElement;
  /** Online: where the match's buttons go (src/ui/matchMenu.ts) */
  readonly match: HTMLDivElement;
  /** Online: the other players with mute and block (src/ui/playersMenu.ts) */
  readonly players: HTMLDivElement;
  #question: HTMLElement | null = null;

  constructor(host: HTMLElement, actions: PauseActions) {
    this.#root = document.createElement("div");
    this.#root.id = "pause-menu";
    this.#root.className = "pause-menu";
    const buttons = document.createElement("div");
    buttons.className = "pause-buttons";
    const button = (label: string, click: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = "pause-button";
      b.textContent = label;
      b.addEventListener("click", click);
      buttons.append(b);
      return b;
    };
    button(PAUSE_TEXT.resume, actions.resume);
    button(PAUSE_TEXT.settings, actions.settings);
    this.match = document.createElement("div");
    this.match.className = "settings-match pause-match";
    buttons.append(this.match);
    const exit = actions.exit;
    if (exit) {
      // (ExitMainMenuInquiry, YES / NO: HT-4)
      const question = document.createElement("div");
      question.className = "pause-question";
      const ask = document.createElement("span");
      ask.textContent = END_TEXT.exitInquiry;
      const yes = document.createElement("button");
      yes.textContent = END_TEXT.yes;
      yes.addEventListener("click", () => {
        question.hidden = true;
        exit();
      });
      const no = document.createElement("button");
      no.textContent = END_TEXT.no;
      no.addEventListener("click", () => {
        question.hidden = true;
      });
      no.dataset["padDefault"] = ""; // (a confirm's NO focused: MENU-15)
      question.append(ask, yes, no);
      question.hidden = true;
      button(END_TEXT.exit, () => {
        question.hidden = false;
        no.focus();
      });
      buttons.append(question);
      this.#question = question;
    }
    this.players = document.createElement("div");
    this.players.className = "settings-players pause-players";
    this.#root.append(buttons, this.players);
    this.#root.hidden = true;
    host.append(this.#root);
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  open(): void {
    // (the free look's captured mouse is let go: the menu needs the pointer)
    if (document.pointerLockElement) document.exitPointerLock();
    this.#root.hidden = false;
  }

  close(): void {
    this.#root.hidden = true;
    if (this.#question) this.#question.hidden = true;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** B or Escape with the Exit question up: the question answered NO, the menu kept (RV-478); whether one was up */
  dismissQuestion(): boolean {
    if (!this.#question || this.#question.hidden) return false;
    this.#question.hidden = true;
    return true;
  }
}
