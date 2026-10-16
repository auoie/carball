// The main menu (notes/hud-menus.md MENU-1/2), over the arena as the page opens: Play (Free Play, or a playlist to search
// online: notes/matchmaking.md MM-1, single selection) and Settings. Free Play opens the map select first, as the game's
// does (the user's decision, 2026-10-15): the maps by their names, the last one picked kept and focused; picking one
// starts free play on it. The game's labels verbatim (Play, Settings, Free Play, Find Match: the user's decisions,
// 2026-10-14); the playlists' and maps' names are ours. No Quit: a browser tab closes itself.
import { PLAYLISTS, SEARCH_TEXT } from "../game/matchmaking";
import { MAP_NAMES, THEMES, type ThemeName, themeName } from "../render/themes";

export const MAIN_MENU_TEXT = {
  play: "Play",
  settings: "Settings",
  freePlay: "Free Play",
} as const;

/** Our own word for leaving the Play page */
const BACK_TEXT = "Back";

const PLAYLIST_KEY = "carball.playlist";
/** Free play's map: the map select's last pick */
const MAP_KEY = "carball.freeplayMap";

/** The menu's pages: the top (Play, Settings), Play's, and Free Play's map select */
export type MenuView = "top" | "play" | "maps";

/** Where Escape (the pad's B) goes from a page: the map select back to Play, Play to the top; the top stays */
export function backFrom(view: MenuView): MenuView {
  return view === "maps" ? "play" : "top";
}

/** The map select's buttons: every map by its name, the one picked checked */
export function mapChoices(picked: ThemeName): { readonly map: ThemeName; readonly label: string; readonly checked: boolean }[] {
  return THEMES.map((map) => ({ map, label: MAP_NAMES[map], checked: map === picked }));
}

export interface MainMenuActions {
  /** Free Play on this map (the map select's pick) */
  readonly freePlay: (map: ThemeName) => void;
  /** Find Match: search the playlist with this team size */
  readonly findMatch: (playlist: number) => void;
  readonly settings: () => void;
}

export class MainMenu {
  readonly #root: HTMLDivElement;
  readonly #top: HTMLDivElement;
  readonly #play: HTMLDivElement;
  readonly #maps: HTMLDivElement;
  readonly #playlists: HTMLButtonElement[] = [];
  readonly #mapButtons: HTMLButtonElement[] = [];
  #playlist = storedPlaylist();
  #map = storedMap();

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
    button(this.#play, MAIN_MENU_TEXT.freePlay, () => {
      this.#show("maps");
    });
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
    // (the map select: every map, the last one picked checked; a pick starts free play on it)
    this.#maps = column();
    this.#maps.classList.add("main-menu-maps-view");
    const heading = document.createElement("div");
    heading.className = "main-menu-heading";
    heading.textContent = MAIN_MENU_TEXT.freePlay;
    const maps = document.createElement("div");
    maps.className = "main-menu-maps";
    maps.setAttribute("role", "radiogroup");
    for (const { map, label } of mapChoices(this.#map)) {
      const b = button(maps, label, () => {
        this.#pick(map);
        actions.freePlay(map);
      });
      b.classList.add("main-menu-map");
      b.setAttribute("role", "radio");
      b.dataset["map"] = map;
      this.#mapButtons.push(b);
    }
    this.#maps.append(heading, maps);
    this.#mark();
    button(this.#maps, BACK_TEXT, () => {
      this.#show("play");
    });
    this.#show("top");
    host.append(this.#root);
  }

  /** Free play's map: the map select's last pick (night before any) */
  get map(): ThemeName {
    return this.#map;
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

  /** Escape: back from the map select to Play, from Play to the top; nothing at the top (the menu is where the game
   *  starts) */
  back(): void {
    this.#show(backFrom(this.#maps.hidden ? (this.#play.hidden ? "top" : "play") : "maps"));
  }

  #pick(map: ThemeName): void {
    this.#map = map;
    storeMap(map);
    this.#mark();
  }

  #mark(): void {
    const choices = mapChoices(this.#map);
    this.#mapButtons.forEach((b, i) => {
      b.setAttribute("aria-checked", String(choices[i]?.checked ?? false));
    });
  }

  #select(playlist: number): void {
    this.#playlist = playlist;
    storePlaylist(playlist);
    for (const b of this.#playlists) b.setAttribute("aria-checked", String(b.dataset["playlist"] === String(playlist)));
  }

  #show(view: MenuView): void {
    this.#top.hidden = view !== "top";
    this.#play.hidden = view !== "play";
    this.#maps.hidden = view !== "maps";
    // (the last map picked focused: Enter, or the pad's A, starts it at once)
    if (view === "maps") this.#mapButtons.find((b) => b.dataset["map"] === this.#map)?.focus();
  }
}

type MapStore = Pick<Storage, "getItem" | "setItem">;
const local = (): MapStore | null => (typeof localStorage === "undefined" ? null : localStorage);

/** Free play's map, as the map select last left it (night before any, or for one this page doesn't know) */
export function storedMap(storage: MapStore | null = local()): ThemeName {
  try {
    return themeName(storage?.getItem(MAP_KEY) ?? null);
  } catch {
    return "night";
  }
}

export function storeMap(map: ThemeName, storage: MapStore | null = local()): void {
  try {
    storage?.setItem(MAP_KEY, map);
  } catch {
    // (not kept)
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
