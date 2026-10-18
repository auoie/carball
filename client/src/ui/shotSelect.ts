// Custom training's Select Shot (notes/custom-training.md §2.8, CTR-20: OpenShotSelectionMenu, Enter or the pad's
// Back/View): the pack's shots in its order, each lit when completed, the current one marked; one chosen starts at once.
// Ours: its look.
import type { TrainingRun } from "../training/run";
import { ShotStatus } from "../training/run";

export const SHOT_SELECT_TEXT = { title: "Select Shot" } as const;

export class ShotSelect {
  readonly #root: HTMLDivElement;
  readonly #grid: HTMLDivElement;
  readonly #onSelect: (index: number) => void;

  constructor(host: HTMLElement, onSelect: (index: number) => void) {
    this.#onSelect = onSelect;
    this.#root = document.createElement("div");
    this.#root.id = "shot-select";
    this.#root.hidden = true;
    const title = document.createElement("div");
    title.className = "shot-select-title";
    title.textContent = SHOT_SELECT_TEXT.title;
    this.#grid = document.createElement("div");
    this.#grid.className = "shot-select-grid";
    this.#root.append(title, this.#grid);
    host.append(this.#root);
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  /** Open on this run's shots (the current one focused), or closed again */
  toggle(run: TrainingRun | null): void {
    if (this.isOpen || !run) {
      this.close();
      return;
    }
    this.#grid.replaceChildren(
      ...run.status.map((status, i) => {
        const b = document.createElement("button");
        b.className = "shot-select-shot";
        b.textContent = String(i + 1);
        b.classList.toggle("done", status === ShotStatus.Completed);
        b.setAttribute("aria-current", String(i === run.shotIndex));
        // (a pad's focus starts on the current shot: src/ui/padNav.ts)
        if (i === run.shotIndex) b.dataset["padDefault"] = "";
        b.addEventListener("click", () => {
          this.close();
          this.#onSelect(i);
        });
        return b;
      }),
    );
    this.#root.hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.#grid.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus();
  }

  close(): void {
    this.#root.hidden = true;
  }
}
