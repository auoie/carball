// The main menu (notes/hud-menus.md MENU-1/2), over the arena as the page opens: Play (Free Play, or a playlist to search
// online: notes/matchmaking.md MM-1, single selection), Garage (the car and the team colour, kept: src/game/cars.ts; the
// user's feature, 2026-10-16) and Settings. Free Play opens the map select first, as the game's
// does (the user's decision, 2026-10-15): the maps by their names, the last one picked kept and focused; picking one
// starts free play on it. The game's labels verbatim (Play, Settings, Free Play, Find Match: the user's decisions,
// 2026-10-14); the playlists' and maps' names are ours. No Quit: a browser tab closes itself.
import { PLAYLISTS, SEARCH_TEXT } from "../game/matchmaking";
import { MAP_NAMES, THEMES, type ThemeName, themeName } from "../render/themes";
import type { Team } from "../engine/world";
import { CARS, storeCar, storeTeam, storedCar, storedTeam } from "../game/cars";
import type { GaragePreview } from "./garagePreview";

export const MAIN_MENU_TEXT = {
  play: "Play",
  garage: "Garage",
  settings: "Settings",
  freePlay: "Free Play",
} as const;

/** Our own words for the garage's team colours (Free Play's car colour; online, the queue's team) */
export const GARAGE_TEXT = { blue: "Blue", orange: "Orange" } as const;

/** Our own word for leaving the Play page */
const BACK_TEXT = "Back";

const PLAYLIST_KEY = "carball.playlist";
/** Free play's map: the map select's last pick */
const MAP_KEY = "carball.freeplayMap";

/** The menu's pages: the top (Play, Garage, Settings), Play's, Free Play's map select, and the garage */
export type MenuView = "top" | "play" | "maps" | "garage";

/** Where Escape (the pad's B) goes from a page: the map select back to Play, Play and the garage to the top; the top
 *  stays */
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
  /** The garage's choice changed (it's kept already): its car and team colour */
  readonly garage?: (choice: { readonly car: number; readonly team: Team }) => void;
  /** The garage's preview of a car (none: no preview) */
  readonly preview?: GaragePreview;
}

export class MainMenu {
  readonly #root: HTMLDivElement;
  readonly #top: HTMLDivElement;
  readonly #play: HTMLDivElement;
  readonly #playFreePlay: HTMLButtonElement;
  readonly #maps: HTMLDivElement;
  readonly #garage: HTMLDivElement;
  readonly #carButtons: HTMLButtonElement[] = [];
  readonly #teamButtons: HTMLButtonElement[] = [];
  readonly #preview: GaragePreview | null;
  #car = storedCar();
  #team: Team = storedTeam();
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
    // (each page a page of the pad's: its focus kept while the menu is open)
    this.#top = column();
    this.#top.dataset["padPage"] = "top";
    button(this.#top, MAIN_MENU_TEXT.play, () => {
      this.#show("play");
    });
    button(this.#top, MAIN_MENU_TEXT.garage, () => {
      this.#show("garage");
    });
    button(this.#top, MAIN_MENU_TEXT.settings, actions.settings);
    this.#play = column();
    this.#play.dataset["padPage"] = "play";
    this.#play.dataset["padBack"] = ""; // (B Back in the pad's hints: a page under the top)
    this.#playFreePlay = button(this.#play, MAIN_MENU_TEXT.freePlay, () => {
      this.#show("maps");
    });
    // (the playlists: one selected at a time; Find Match searches it)
    const playlists = document.createElement("div");
    playlists.className = "main-menu-playlists";
    playlists.setAttribute("role", "radiogroup");
    playlists.dataset["padChoose"] = ""; // (a pad's left and right choose as they move: src/ui/padNav.ts)
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
    this.#maps.dataset["padPage"] = "maps";
    this.#maps.dataset["padBack"] = "";
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
    // (the garage: the cars and the team colours, each kept as chosen, the car shown turning in its colour)
    this.#garage = column();
    this.#garage.dataset["padPage"] = "garage";
    this.#garage.dataset["padBack"] = "";
    this.#garage.classList.add("main-menu-garage-view");
    const garageHeading = document.createElement("div");
    garageHeading.className = "main-menu-heading";
    garageHeading.textContent = MAIN_MENU_TEXT.garage;
    this.#preview = actions.preview ?? null;
    const group = (className: string): HTMLDivElement => {
      const g = document.createElement("div");
      g.className = `main-menu-choices ${className}`;
      g.setAttribute("role", "radiogroup");
      g.dataset["padChoose"] = "";
      return g;
    };
    const cars = group("main-menu-cars");
    for (const car of CARS) {
      const b = button(cars, car.name, () => {
        this.#chooseCar(car.id);
        actions.garage?.({ car: this.#car, team: this.#team });
      });
      b.classList.add("main-menu-car");
      b.setAttribute("role", "radio");
      b.dataset["car"] = String(car.id);
      this.#carButtons.push(b);
    }
    const teams = group("main-menu-teams");
    for (const [team, label] of [
      [0, GARAGE_TEXT.blue],
      [1, GARAGE_TEXT.orange],
    ] as const) {
      const b = button(teams, label, () => {
        this.#chooseTeam(team);
        actions.garage?.({ car: this.#car, team: this.#team });
      });
      b.classList.add("main-menu-team", `team-${String(team)}`);
      b.setAttribute("role", "radio");
      b.dataset["team"] = String(team);
      this.#teamButtons.push(b);
    }
    this.#garage.append(garageHeading, ...(this.#preview ? [this.#preview.element] : []), cars, teams);
    this.#chooseCar(this.#car);
    this.#chooseTeam(this.#team);
    button(this.#garage, BACK_TEXT, () => {
      this.#show("top");
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
    this.#preview?.stop();
  }

  /** The Play page's Free Play focused (the pad's highlight follows): Find Match's search started, free play next (the
   *  user's decision, 2026-10-16) */
  focusFreePlay(): void {
    this.#playFreePlay.focus({ preventScroll: true });
  }

  /** Escape: back from the map select to Play, from Play to the top; nothing at the top (the menu is where the game
   *  starts) */
  /** Back a page (Escape's, a pad's B); whether there was one to go back from (none at the top: nothing, silently) */
  back(): boolean {
    const view: MenuView = !this.#maps.hidden ? "maps" : !this.#play.hidden ? "play" : !this.#garage.hidden ? "garage" : "top";
    this.#show(backFrom(view));
    return view !== "top";
  }

  #chooseCar(car: number): void {
    this.#car = car;
    storeCar(car);
    for (const b of this.#carButtons) b.setAttribute("aria-checked", String(b.dataset["car"] === String(car)));
    this.#preview?.show(this.#car, this.#team);
  }

  #chooseTeam(team: Team): void {
    this.#team = team;
    storeTeam(team);
    for (const b of this.#teamButtons) b.setAttribute("aria-checked", String(b.dataset["team"] === String(team)));
    this.#preview?.show(this.#car, this.#team);
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
    this.#garage.hidden = view !== "garage";
    // (the preview turning only while the garage shows; the car chosen focused)
    if (view === "garage") {
      this.#preview?.start();
      this.#carButtons.find((b) => b.dataset["car"] === String(this.#car))?.focus();
    } else this.#preview?.stop();
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
