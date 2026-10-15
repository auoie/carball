// The main menu (notes/hud-menus.md MENU-1/2), over the arena as the page opens: Play (Free Play, or a playlist to search
// online: notes/matchmaking.md MM-1, single selection) and Settings. The game's labels verbatim (Play, Settings, Free Play,
// Find Match: the user's decisions, 2026-10-14); the playlists' names are ours. No Quit: a browser tab closes itself.
import { PLAYLISTS, SEARCH_TEXT } from "../game/matchmaking";

export const MAIN_MENU_TEXT = {
  play: "Play",
  settings: "Settings",
  freePlay: "Free Play",
} as const;

/** Our own word for leaving the Play page */
const BACK_TEXT = "Back";

const PLAYLIST_KEY = "rl-clone.playlist";

export interface MainMenuActions {
  readonly freePlay: () => void;
  /** Find Match: search the playlist with this team size */
  readonly findMatch: (playlist: number) => void;
  readonly settings: () => void;
}

export class MainMenu {
  readonly #root: HTMLDivElement;
  readonly #top: HTMLDivElement;
  readonly #play: HTMLDivElement;
  readonly #playlists: HTMLButtonElement[] = [];
  #playlist = storedPlaylist();

  constructor(host: HTMLElement, actions: MainMenuActions) {
    this.#root = document.createElement("div");
    this.#root.id = "main-menu";
    this.#root.className = "main-menu";
    const column = (): HTMLDivElement => {
      const c = document.createElement("div");
      c.className = "main-menu-column";
      this.#root.append(c);
      return c;
    };
    const button = (parent: HTMLElement, label: string, click: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = "main-menu-button";
      b.textContent = label;
      b.addEventListener("click", click);
      parent.append(b);
      return b;
    };
    this.#top = column();
    button(this.#top, MAIN_MENU_TEXT.play, () => {
      this.#show("play");
    });
    button(this.#top, MAIN_MENU_TEXT.settings, actions.settings);
    this.#play = column();
    button(this.#play, MAIN_MENU_TEXT.freePlay, actions.freePlay);
    // (the playlists: one selected at a time; Find Match searches it)
    const playlists = document.createElement("div");
    playlists.className = "main-menu-playlists";
    playlists.setAttribute("role", "radiogroup");
    for (const p of PLAYLISTS) {
      const b = button(playlists, p.name, () => {
        this.#select(p.teamSize);
      });
      b.classList.add("main-menu-playlist");
      b.setAttribute("role", "radio");
      b.dataset["playlist"] = String(p.teamSize);
      this.#playlists.push(b);
    }
    this.#play.append(playlists);
    this.#select(this.#playlist);
    button(this.#play, SEARCH_TEXT.findMatch, () => {
      actions.findMatch(this.#playlist);
    }).classList.add("main-menu-find");
    button(this.#play, BACK_TEXT, () => {
      this.#show("top");
    });
    this.#show("top");
    host.append(this.#root);
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  open(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.#show("top");
    this.#root.hidden = false;
  }

  close(): void {
    this.#root.hidden = true;
  }

  /** Escape: back from Play to the top; nothing at the top (the menu is where the game starts) */
  back(): void {
    this.#show("top");
  }

  #select(playlist: number): void {
    this.#playlist = playlist;
    storePlaylist(playlist);
    for (const b of this.#playlists) b.setAttribute("aria-checked", String(b.dataset["playlist"] === String(playlist)));
  }

  #show(view: "top" | "play"): void {
    this.#top.hidden = view !== "top";
    this.#play.hidden = view !== "play";
  }
}

function storedPlaylist(): number {
  try {
    const stored = Number(localStorage.getItem(PLAYLIST_KEY));
    return PLAYLISTS.some((p) => p.teamSize === stored) ? stored : 1;
  } catch {
    return 1;
  }
}

function storePlaylist(playlist: number): void {
  try {
    localStorage.setItem(PLAYLIST_KEY, String(playlist));
  } catch {
    // (not kept)
  }
}
