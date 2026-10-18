// Custom training's HUD (notes/custom-training.md §6 TrainingView): the pack's type (STRIKER, GOALIE, AERIAL) and name,
// SHOT n / total (n the shot's place in the pack), the timer M:SS (hidden for the goalie; its last 3 s flashing), one pip
// per shot lit when completed with the current one marked, COMPLETION x %, shuffle and mirror shown when on, and the
// controls panel. The finished pack's line once every shot is completed. An editor's test (notes/training-editor.md
// §6.4): the pack's name in the type's place, no completion, the controls Reset Shot and Edit Shot alone. Ours: the
// layout and look.
import type { TrainingRun } from "../training/run";
import { ShotStatus } from "../training/run";
import { type KeyGlyph, glyphElement } from "./keyGlyph";

/** The HUD's words (the game's where known: notes/custom-training.md §2.7, §6; the rest ours) */
export const TRAINING_TEXT = {
  types: { striker: "Striker", goalie: "Goalie", aerial: "Aerial" },
  shot: "Shot",
  completion: "Completion",
  shuffle: "Shuffle",
  mirror: "Mirror",
  reset: "Reset Shot",
  randomize: "Randomize Shot",
  navigate: "Navigate Shots",
  select: "Select Shot",
  finished: "Training Complete",
  /** The reset's first-time warning (TutorialMessage.RoundResetBody, verbatim; its title ours) */
  resetWarningTitle: "Reset Shot",
  resetWarning: "By resetting, you will not earn points by completing the round. Would you like to continue?",
  restart: "Restart Training",
  /** An editor's test: back to the editor (Training.ExitTestInstructions, verbatim) */
  editShot: "Edit Shot",
} as const;

/** The keys shown in the controls panel (their glyphs: words, or the pad's icons) */
export interface TrainingKeys {
  readonly reset: KeyGlyph;
  readonly previous: KeyGlyph;
  readonly next: KeyGlyph;
  readonly shuffle: KeyGlyph;
  readonly mirror: KeyGlyph;
  readonly select: KeyGlyph;
  /** An editor's test: its end (the editor's Test Shot key) */
  readonly editShot: KeyGlyph;
}

/** M:SS, whole seconds rounded up (SecondsRemaining = int(t) + 1 while running) */
export function trainingClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-9));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
}

export class TrainingHud {
  readonly root: HTMLDivElement;
  readonly #type: HTMLDivElement;
  readonly #name: HTMLDivElement;
  readonly #shot: HTMLDivElement;
  readonly #timer: HTMLDivElement;
  readonly #pips: HTMLDivElement;
  readonly #completion: HTMLDivElement;
  readonly #flags: HTMLDivElement;
  readonly #controls: HTMLDivElement;
  readonly #finished: HTMLDivElement;
  #shown = "";

  constructor(host: HTMLElement) {
    const div = (className: string, parent: HTMLElement): HTMLDivElement => {
      const d = document.createElement("div");
      d.className = className;
      parent.append(d);
      return d;
    };
    this.root = document.createElement("div");
    this.root.id = "training";
    this.root.hidden = true;
    const head = div("training-head", this.root);
    this.#type = div("training-type", head);
    this.#name = div("training-name", head);
    this.#shot = div("training-shot", head);
    this.#timer = div("training-timer", head);
    this.#pips = div("training-pips", head);
    this.#completion = div("training-completion", head);
    this.#flags = div("training-flags", head);
    this.#controls = div("training-controls", this.root);
    this.#finished = div("training-finished", this.root);
    host.append(this.root);
  }

  /** The run's state now (null: not training), the keys' glyphs; `modifiers`: the settings vary the shots (the reset
   *  then randomizes in the countdown: Training.RandomizeShotInstructions); `menuUp`: a menu over the game (the controls
   *  panel hidden under it, not across its buttons: RX25) */
  update(run: TrainingRun | null, keys: TrainingKeys, modifiers = false, menuUp = false): void {
    this.root.hidden = run === null;
    this.#controls.hidden = menuUp;
    if (!run) return;
    const time = run.timeLeft;
    const goalie = run.pack.type === "goalie";
    const randomize = modifiers && run.state === "countdown";
    const view = JSON.stringify([run.pack.id, run.test, run.shotIndex, run.state, time === null ? null : trainingClock(time), run.status, run.shuffle, run.mirror, keys, randomize]);
    if (view === this.#shown) return;
    this.#shown = view;
    const test = run.test !== null;
    this.#type.textContent = test ? run.pack.name : TRAINING_TEXT.types[run.pack.type];
    this.#name.textContent = test ? "" : run.pack.name;
    this.#shot.textContent = `${TRAINING_TEXT.shot} ${String(run.shotIndex + 1)} / ${String(run.pack.shots.length)}`;
    this.#timer.hidden = goalie || time === null;
    this.#timer.textContent = time === null ? "" : trainingClock(time);
    this.#timer.classList.toggle("low", run.state === "active" && time !== null && time <= 3);
    this.#pips.replaceChildren(
      ...run.status.map((s, i) => {
        const pip = document.createElement("i");
        pip.classList.toggle("done", s === ShotStatus.Completed);
        pip.classList.toggle("current", i === run.shotIndex);
        return pip;
      }),
    );
    this.#completion.hidden = test;
    this.#completion.textContent = `${TRAINING_TEXT.completion} ${String(run.completion)}%`;
    const flags: string[] = [];
    if (run.shuffle) flags.push(TRAINING_TEXT.shuffle);
    if (run.mirror) flags.push(TRAINING_TEXT.mirror);
    this.#flags.textContent = flags.join(" · ");
    const row = (glyphs: readonly KeyGlyph[], label: string): HTMLDivElement => {
      const r = document.createElement("div");
      for (const g of glyphs) {
        const k = glyphElement(g);
        k.classList.add("training-key");
        r.append(k, " ");
      }
      r.append(label);
      return r;
    };
    if (test) {
      this.#controls.replaceChildren(row([keys.reset], TRAINING_TEXT.reset), row([keys.editShot], TRAINING_TEXT.editShot));
      this.#finished.hidden = true;
      return;
    }
    this.#controls.replaceChildren(
      row([keys.reset], randomize ? TRAINING_TEXT.randomize : TRAINING_TEXT.reset),
      row([keys.previous, keys.next], TRAINING_TEXT.navigate),
      row([keys.select], TRAINING_TEXT.select),
      row([keys.shuffle], TRAINING_TEXT.shuffle),
      row([keys.mirror], TRAINING_TEXT.mirror),
    );
    this.#finished.hidden = run.state !== "finished";
    this.#finished.replaceChildren(TRAINING_TEXT.finished, row([keys.reset], TRAINING_TEXT.restart));
  }
}
