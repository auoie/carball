// The menu's match buttons online (src/game/forfeitVote.ts: forfeit, vote, leave), each with its yes/no question when
// it has one. Rebuilt only when the buttons change.
import type { MatchAction, MatchMenuItem } from "../game/forfeitVote";

/** [ModalPopups] buttons */
const YES = "Yes";
const NO = "No";

export class MatchMenu {
  readonly #root: HTMLElement;
  #items: readonly MatchMenuItem[] = [];
  #shown = "";
  /** The button whose question is up */
  #asking: MatchMenuItem | null = null;

  constructor(
    root: HTMLElement,
    private readonly onAction: (action: MatchAction) => void,
  ) {
    this.#root = root;
  }

  /** The buttons now; `open`: the menu is up (a closed menu drops its question) */
  update(items: readonly MatchMenuItem[], open: boolean): void {
    if (!open || (this.#asking && !items.some((i) => i.action === this.#asking?.action))) this.#asking = null;
    this.#items = items;
    const shown = JSON.stringify([items, this.#asking]);
    if (shown !== this.#shown) {
      this.#shown = shown;
      this.#render();
    }
  }

  #render(): void {
    const asking = this.#asking;
    if (asking?.confirm) {
      const question = document.createElement("span");
      question.textContent = asking.confirm;
      this.#root.replaceChildren(
        question,
        this.#button(YES, asking.danger, () => {
          this.#asking = null;
          this.onAction(asking.action);
        }),
        this.#button(NO, false, () => {
          this.#asking = null;
          this.update(this.#items, true);
        }),
      );
      return;
    }
    this.#root.replaceChildren(
      ...this.#items.map((item) =>
        this.#button(item.label, item.danger, () => {
          if (item.confirm === null) {
            this.onAction(item.action);
          } else {
            this.#asking = item;
            this.update(this.#items, true);
          }
        }),
      ),
    );
  }

  #button(label: string, danger: boolean, click: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = label;
    button.classList.toggle("danger", danger);
    button.addEventListener("click", click);
    return button;
  }
}
