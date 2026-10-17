// The menu's player list online (notes/scoreboard.md SB-12..14): the other players, each with Mute / Unmute and Block /
// Unblock (the button text verbatim; report is left out: the clone has no report system). Mute: the server stops
// relaying their chat to this player; block: this client drops their chat. A block's confirmation shows as a toast.
export interface PlayerItem {
  readonly car: number;
  readonly name: string;
  readonly team: number;
  readonly muted: boolean;
  readonly blocked: boolean;
}

/** The buttons and the block's confirmations ([Friends] NowBlocked / NowUnblocked), verbatim */
export const PLAYER_TEXT = {
  mute: "Mute",
  unmute: "Unmute",
  block: "Block",
  unblock: "Unblock",
  blocked: (name: string): string => `You have blocked ${name}.`,
  unblocked: (name: string): string => `You have unblocked ${name}.`,
} as const;

/** The entry's own label (the game's names Report: by key only) */
const PLAYERS_LABEL = "Players";

export class PlayersMenu {
  readonly #root: HTMLElement;
  #open = false;
  #shown = "";
  #players: readonly PlayerItem[] = [];

  constructor(
    root: HTMLElement,
    private readonly onToggle: (car: number, what: "mute" | "block") => void,
  ) {
    this.#root = root;
  }

  /** The players now; `menuOpen`: the menu is up (the list folds when it closes) */
  update(players: readonly PlayerItem[], menuOpen: boolean): void {
    if (!menuOpen) this.#open = false;
    this.#players = players;
    const shown = JSON.stringify([players, this.#open]);
    if (shown === this.#shown) return;
    this.#shown = shown;
    this.#render();
  }

  #render(): void {
    if (this.#players.length === 0) {
      this.#root.replaceChildren();
      return;
    }
    const toggle = document.createElement("button");
    // (the menu's own buttons: the toggle a pause menu button, the rows' actions its question's)
    toggle.className = "pause-button players-toggle";
    toggle.textContent = PLAYERS_LABEL;
    toggle.setAttribute("aria-expanded", String(this.#open));
    toggle.addEventListener("click", () => {
      this.#open = !this.#open;
      this.update(this.#players, true);
    });
    const rows = this.#open
      ? this.#players.map((p) => {
          const row = document.createElement("div");
          row.className = `player-row team-${String(p.team === 1 ? 1 : 0)}`;
          row.dataset["car"] = String(p.car);
          const name = document.createElement("bdi");
          name.className = "player-name";
          name.textContent = p.name;
          row.append(name, this.#button(p.muted ? PLAYER_TEXT.unmute : PLAYER_TEXT.mute, "mute", p.car), this.#button(p.blocked ? PLAYER_TEXT.unblock : PLAYER_TEXT.block, "block", p.car, p.blocked));
          return row;
        })
      : [];
    this.#root.replaceChildren(toggle, ...rows);
  }

  #button(label: string, what: "mute" | "block", car: number, crossed = false): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "players-action";
    button.textContent = label;
    button.dataset["action"] = what;
    button.classList.toggle("crossed", crossed); // (Unblock's small red X)
    button.addEventListener("click", () => {
      this.onToggle(car, what);
    });
    return button;
  }
}

/** A short toast (the block's confirmation): its title the player's name, 3 s */
export class Toast {
  readonly #box: HTMLElement;
  #until = 0;

  constructor(root: HTMLElement) {
    this.#box = document.createElement("div");
    this.#box.id = "toast";
    this.#box.hidden = true;
    root.append(this.#box);
  }

  show(title: string, body: string, now: number): void {
    const t = document.createElement("bdi");
    t.className = "toast-title";
    t.textContent = title;
    const b = document.createElement("div");
    b.textContent = body;
    this.#box.replaceChildren(t, b);
    this.#box.hidden = false;
    this.#until = now + 3;
  }

  update(now: number): void {
    if (!this.#box.hidden && now >= this.#until) this.#box.hidden = true;
  }
}
