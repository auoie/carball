// The main menu (notes/hud-menus.md MENU-1/2), over the arena as the page opens: Play (Free Play, or a server to join
// online) and Settings. The game's labels verbatim (Play, Settings, Free Play: the user's decisions, 2026-10-14); the
// online entry is ours (the game's playlists have no counterpart here). No Quit: a browser tab closes itself.
export const MAIN_MENU_TEXT = {
  play: "Play",
  settings: "Settings",
  freePlay: "Free Play",
} as const;

/** Our own words for the online entry */
const ONLINE_TEXT = { online: "Online", server: "Server", join: "Join", back: "Back" } as const;

const SERVER_KEY = "rl-clone.server";

export interface MainMenuActions {
  readonly freePlay: () => void;
  readonly join: (server: string) => void;
  readonly settings: () => void;
}

export class MainMenu {
  readonly #root: HTMLDivElement;
  readonly #top: HTMLDivElement;
  readonly #play: HTMLDivElement;

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
    const online = document.createElement("form");
    online.className = "main-menu-online";
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = `${ONLINE_TEXT.online} · ${ONLINE_TEXT.server}`;
    const address = document.createElement("input");
    address.name = "server";
    address.placeholder = "127.0.0.1:4434";
    address.value = storedServer();
    label.append(caption, address);
    const join = document.createElement("button");
    join.type = "submit";
    join.className = "main-menu-button";
    join.textContent = ONLINE_TEXT.join;
    online.append(label, join);
    online.addEventListener("submit", (e) => {
      e.preventDefault();
      const server = address.value.trim();
      if (server === "") return;
      storeServer(server);
      actions.join(server);
    });
    this.#play.append(online);
    button(this.#play, ONLINE_TEXT.back, () => {
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

  #show(view: "top" | "play"): void {
    this.#top.hidden = view !== "top";
    this.#play.hidden = view !== "play";
  }
}

function storedServer(): string {
  try {
    return localStorage.getItem(SERVER_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeServer(server: string): void {
  try {
    localStorage.setItem(SERVER_KEY, server);
  } catch {
    // (not kept)
  }
}
