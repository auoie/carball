// The main menu (notes/hud-menus.md MENU-1/2), over the arena as the page opens: Play (Free Play, or a playlist to search
// online: notes/matchmaking.md MM-1, single selection), Garage (the car and the team colour, kept: src/game/cars.ts; the
// user's feature, 2026-10-16) and Settings. Free Play starts at once on Night, the one map (the user's decision of
// 2026-10-17). The game's labels verbatim (Play, Settings, Free Play, Find Match: the user's decisions,
// 2026-10-14); the playlists' names are ours. No Quit: a browser tab closes itself. Play vs Bots (ours: the
// offline match against bot packages, local/botMatch.ts) shows only when there's a bot to play.
import { OWN_SEARCH_TEXT, PLAYLISTS, SEARCH_TEXT } from "../game/matchmaking";
import type { Team } from "../engine/world";
import { CARS, storeCar, storeTeam, storedCar, storedTeam } from "../game/cars";
import type { BotChoices } from "../local/botMatch";
import { BOT_MATCH_TEXT } from "../local/botText";
import type { BotsPage } from "./botsPage";
import type { PackListing } from "../training/packs";
import { type ShownRating, ratingText } from "../account/api";
import { queueBanText } from "../net/tickets";

export const MAIN_MENU_TEXT = {
  play: "Play",
  garage: "Garage",
  settings: "Settings",
  freePlay: "Free Play",
  /** The region picker's heading ([Global] Regions: notes/matchmaking.md, Regions) */
  regions: "Regions",
} as const;

/** A region as the Play page's picker shows it: its ping (ms; null: not reached; undefined: being measured), ticked */
export interface RegionShown {
  readonly id: string;
  readonly name: string;
  readonly ping: number | null | undefined;
  readonly selected: boolean;
}

/** A region's ping as the picker shows it (our words) */
export function pingText(ping: number | null | undefined): string {
  if (ping === undefined) return "…";
  return ping === null ? "—" : `${String(ping)} ms`;
}

/** Our own words for the garage's team colours (Free Play's car colour; online, the queue's team) */
export const GARAGE_TEXT = { blue: "Blue", orange: "Orange" } as const;

/** Our own word for leaving the Play page */
const BACK_TEXT = "Back";

/** Our own names for the menus' choices, read out with them (RV-709) */
const CHOICE_NAMES = { playlist: "Playlist", car: "Car", team: "Team" } as const;

const PLAYLIST_KEY = "carball.playlist";
/** The menu's pages: the top (Play, Garage, Settings, the account's entry), Play's, the bots' setup, custom training's
 *  packs, the garage, the account (ui/accountPages.ts) */
export type MenuView = "top" | "play" | "bots" | "training" | "garage" | "account";

/** Where Escape (the pad's B) goes from a page: the bots' setup and the training packs back to Play, Play, the garage and
 *  the account to the top; the top stays */
export function backFrom(view: MenuView): MenuView {
  return view === "bots" || view === "training" ? "play" : "top";
}

/** Custom training's words (the game's menu: Custom Training; a pack's line ours) */
export const TRAINING_MENU_TEXT = {
  customTraining: "Custom Training",
  create: "Create Training",
  edit: "Edit",
  shots: (n: number): string => `${String(n)} ${n === 1 ? "shot" : "shots"}`,
  difficulties: { easy: "Easy", medium: "Medium", hard: "Hard" },
} as const;

export interface MainMenuActions {
  /** Free Play (on Night, the one map) */
  readonly freePlay: () => void;
  /** Find Match: search the ticked playlists (their team sizes) */
  readonly findMatch: (playlists: readonly number[]) => void;
  readonly settings: () => void;
  /** The garage's choice changed (it's kept already): its car and team colour */
  readonly garage?: (choice: { readonly car: number; readonly team: Team }) => void;
  /** The garage's page shown or left: the scene stands the car for it, the game's garage (the user's request,
   *  2026-10-18: the big car swapped in place, no preview of its own) */
  readonly garageShown?: (shown: boolean) => void;
  /** Play vs Bots' Start: the match with these bots */
  readonly botMatch?: (choices: BotChoices) => void;
  /** Custom training: this pack */
  readonly training?: (pack: PackListing) => void;
  /** The training editor: this pack of the player's own, or a new one (null) */
  readonly editTraining?: (pack: PackListing | null) => void;
  /** The account's entry pressed (the deployment's page: setAccountEntry shows it) */
  readonly account?: () => void;
  /** The account's page left (its Turnstile widget let go) */
  readonly accountLeft?: () => void;
  /** Play's page shown (the regions' pings measured: notes/matchmaking.md, Regions) */
  readonly playShown?: () => void;
  /** A region's box pressed on Play's page: its id */
  readonly region?: (id: string) => void;
}

export class MainMenu {
  readonly #root: HTMLDivElement;
  readonly #top: HTMLDivElement;
  readonly #play: HTMLDivElement;
  readonly #playFreePlay: HTMLButtonElement;
  readonly #garage: HTMLDivElement;
  readonly #carButtons: HTMLButtonElement[] = [];
  readonly #teamButtons: HTMLButtonElement[] = [];
  readonly #garageShown: ((shown: boolean) => void) | null;
  /** The garage's page shows (garageShown told) */
  #garageOn = false;
  #car = storedCar();
  #team: Team = storedTeam();
  readonly #playlistBoxes: HTMLButtonElement[] = [];
  /** Play vs Bots: its button on Play's page, its own page, the page's body and Start (none in a build without bots:
   *  RV-541) */
  readonly #botsView: {
    readonly entry: HTMLButtonElement;
    readonly page: HTMLDivElement;
    readonly body: HTMLDivElement;
    readonly start: HTMLButtonElement;
  } | null;
  /** Custom Training: its button on Play's page (hidden until there are packs) and its page of packs */
  readonly #playTraining: HTMLButtonElement;
  readonly #training: HTMLDivElement;
  readonly #trainingList: HTMLDivElement;
  readonly #trainingAction: ((pack: PackListing) => void) | undefined;
  readonly #editAction: ((pack: PackListing | null) => void) | undefined;
  /** The bots' page body (ui/botsPage.ts, a chunk of its own): none until the packages are listed */
  #botsPage: BotsPage | null = null;
  #ticked = storedPlaylists();
  /** The account's entry on the top page (hidden without accounts: a development page) and its page's column */
  readonly #accountEntry: HTMLButtonElement;
  readonly #account: HTMLDivElement;
  readonly #accountLeft: (() => void) | undefined;
  /** The account's page, its body filled by ui/accountPages.ts */
  readonly accountBody: HTMLDivElement;
  /** Each playlist's rating beside its name (the account's: none signed out or on a development page) */
  readonly #ratingTags = new Map<number, HTMLSpanElement>();
  /** The region picker on Play's page (shown with two regions or more) and its boxes, by region */
  readonly #regions: HTMLDivElement;
  readonly #regionBoxes = new Map<string, { readonly box: HTMLButtonElement; readonly ping: HTMLSpanElement }>();
  readonly #regionAction: ((id: string) => void) | undefined;
  readonly #playShown: (() => void) | undefined;
  /** A leaver's queue ban under Find Match (LV1: the Play menu shows it), until when (ms) */
  readonly #banLine: HTMLDivElement;
  #banUntil: number | null = null;
  #cooldownUntil: number | null = null;
  /** The ban line's countdown, each second while the ban runs (RX30C) */
  #banTimer: ReturnType<typeof setInterval> | null = null;

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
    this.#accountEntry = button(this.#top, "", () => {
      actions.account?.();
    });
    this.#accountEntry.classList.add("main-menu-account");
    this.#accountEntry.hidden = true;
    this.#play = column();
    this.#play.dataset["padPage"] = "play";
    this.#playFreePlay = button(this.#play, MAIN_MENU_TEXT.freePlay, actions.freePlay);
    // (hidden until a bot package is there to play: setBots)
    const playBots = __CARBALL_BOTS__
      ? button(this.#play, BOT_MATCH_TEXT.play, () => {
          this.#show("bots");
        })
      : null;
    if (playBots) playBots.hidden = true;
    // (hidden until a pack is there to play: setTrainingPacks)
    this.#playTraining = button(this.#play, TRAINING_MENU_TEXT.customTraining, () => {
      this.#show("training");
    });
    this.#playTraining.hidden = true;
    // (the playlists: a box each, several ticked at once as the game's Multiple Selection (MM-1), one at least; Find
    // Match searches them all: notes/matchmaking.md, the central matchmaker)
    const playlists = document.createElement("div");
    playlists.className = "main-menu-playlists";
    playlists.setAttribute("role", "group");
    playlists.setAttribute("aria-label", CHOICE_NAMES.playlist);
    playlists.dataset["padBoxes"] = ""; // (one row: the pad's left and right move along it, A ticks: RV-883)
    for (const p of PLAYLISTS) {
      const b = button(playlists, p.name, () => {
        this.#toggle(p.teamSize);
      });
      const tag = document.createElement("span");
      tag.className = "main-menu-rating";
      b.append(tag);
      this.#ratingTags.set(p.teamSize, tag);
      b.classList.add("main-menu-playlist");
      b.setAttribute("role", "checkbox");
      // (its name the playlist's alone, its rating read as its description: not "1v11523", RV-709)
      b.setAttribute("aria-label", p.name);
      tag.setAttribute("aria-hidden", "true");
      b.dataset["playlist"] = String(p.teamSize);
      this.#playlistBoxes.push(b);
    }
    this.#play.append(playlists);
    this.#tick(this.#ticked);
    // (the regions searched: a box each, its ping beside it; hidden until two or more are set: setRegions)
    this.#regions = document.createElement("div");
    this.#regions.className = "main-menu-regions";
    this.#regions.setAttribute("role", "group");
    this.#regions.setAttribute("aria-label", MAIN_MENU_TEXT.regions);
    this.#regions.hidden = true;
    const regionsHeading = document.createElement("div");
    regionsHeading.className = "main-menu-regions-heading";
    regionsHeading.textContent = MAIN_MENU_TEXT.regions;
    this.#regions.append(regionsHeading);
    this.#play.append(this.#regions);
    this.#regionAction = actions.region;
    this.#playShown = actions.playShown;
    button(this.#play, SEARCH_TEXT.findMatch, () => {
      actions.findMatch(this.#ticked);
    }).classList.add("main-menu-find");
    this.#banLine = document.createElement("div");
    this.#banLine.className = "main-menu-ban";
    this.#banLine.hidden = true;
    this.#play.append(this.#banLine);
    // (each page's own Back row: no B Back hint under it as well, one Back, the user's call (2026-10-18); B and Escape
    // still go back)
    button(this.#play, BACK_TEXT, () => {
      this.#show("top");
    });
    // (the bots' setup: the team size, each teammate's and opponent's bot, the bots' credits; Start)
    if (playBots) {
      const page = column();
      page.dataset["padPage"] = "bots";
      page.classList.add("main-menu-bots-view");
      const botsHeading = document.createElement("div");
      botsHeading.className = "main-menu-heading";
      botsHeading.textContent = BOT_MATCH_TEXT.play;
      const body = document.createElement("div");
      body.className = "main-menu-bots";
      page.append(botsHeading, body);
      const start = button(page, BOT_MATCH_TEXT.start, () => {
        const choices = this.#botsPage?.choices();
        if (choices) actions.botMatch?.(choices);
      });
      start.classList.add("main-menu-find");
      button(page, BACK_TEXT, () => {
        this.#show("play");
      });
      this.#botsView = { entry: playBots, page, body, start };
    } else this.#botsView = null;
    // (custom training's packs: one button each, its name, shots and difficulty)
    this.#training = column();
    this.#training.dataset["padPage"] = "training";
    this.#training.classList.add("main-menu-training-view");
    const trainingHeading = document.createElement("div");
    trainingHeading.className = "main-menu-heading";
    trainingHeading.textContent = TRAINING_MENU_TEXT.customTraining;
    this.#trainingList = document.createElement("div");
    this.#trainingList.className = "main-menu-training";
    this.#training.append(trainingHeading, this.#trainingList);
    this.#trainingAction = actions.training;
    this.#editAction = actions.editTraining;
    button(this.#training, BACK_TEXT, () => {
      this.#show("play");
    });
    // (the garage: the cars and the team colours, each kept as chosen, the car shown standing in its colour)
    this.#garage = column();
    this.#garage.dataset["padPage"] = "garage";
    this.#garage.classList.add("main-menu-garage-view");
    const garageHeading = document.createElement("div");
    garageHeading.className = "main-menu-heading";
    garageHeading.textContent = MAIN_MENU_TEXT.garage;
    this.#garageShown = actions.garageShown ?? null;
    const group = (className: string, name: string): HTMLDivElement => {
      const g = document.createElement("div");
      g.className = `main-menu-choices ${className}`;
      g.setAttribute("role", "radiogroup");
      g.setAttribute("aria-label", name);
      g.dataset["padChoose"] = "";
      return g;
    };
    const cars = group("main-menu-cars", CHOICE_NAMES.car);
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
    const teams = group("main-menu-teams", CHOICE_NAMES.team);
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
    this.#garage.append(garageHeading, cars, teams);
    this.#chooseCar(this.#car);
    this.#chooseTeam(this.#team);
    button(this.#garage, BACK_TEXT, () => {
      this.#show("top");
    });
    // (the account's page: its body drawn by ui/accountPages.ts, its own Back among it)
    this.#account = column();
    this.#account.dataset["padPage"] = "account";
    this.#account.classList.add("main-menu-account-view");
    this.accountBody = document.createElement("div");
    this.accountBody.className = "main-menu-account-body";
    this.#account.append(this.accountBody);
    this.#accountLeft = actions.accountLeft;
    this.#show("top");
    host.append(this.#root);
  }

  /** A notice on the menu (the browser's limits for binds: browserNotice.ts) */
  showNotice(notice: HTMLElement): void {
    this.#root.append(notice);
  }

  /** The account's entry on the top page: the account's name, or Sign In; null hides it (no accounts here) */
  setAccountEntry(label: string | null): void {
    this.#accountEntry.hidden = label === null;
    this.#accountEntry.textContent = label ?? "";
  }

  /** The account's ratings beside the playlists' names (null: none shown) */
  setRatings(ratings: readonly ShownRating[] | null): void {
    for (const [teamSize, tag] of this.#ratingTags) {
      const r = ratings?.find((x) => x.playlist === teamSize);
      tag.textContent = r ? ratingText(r) : "";
      const radio = tag.parentElement;
      if (r) radio?.setAttribute("aria-description", `Rating ${String(r.rating)}${r.provisional ? ", provisional" : ""}`);
      else radio?.removeAttribute("aria-description");
    }
  }

  /** The regions on Play's page (notes/matchmaking.md, Regions): a box each, ticked or not, its ping; shown with two or
   *  more. The boxes kept while the regions are the same (a focused one keeps its focus as pings come) */
  setRegions(regions: readonly RegionShown[]): void {
    this.#regions.hidden = regions.length < 2;
    const same = regions.length === this.#regionBoxes.size && regions.every((r) => this.#regionBoxes.has(r.id));
    if (!same) {
      for (const { box } of this.#regionBoxes.values()) box.remove();
      this.#regionBoxes.clear();
      for (const r of regions) {
        const box = document.createElement("button");
        box.className = "main-menu-button main-menu-region";
        box.setAttribute("role", "checkbox");
        box.dataset["region"] = r.id;
        const name = document.createElement("span");
        name.className = "main-menu-region-name";
        name.textContent = r.name;
        const ping = document.createElement("span");
        ping.className = "main-menu-ping";
        box.append(name, ping);
        box.addEventListener("click", () => {
          this.#regionAction?.(r.id);
        });
        this.#regions.append(box);
        this.#regionBoxes.set(r.id, { box, ping });
      }
    }
    for (const r of regions) {
      const shown = this.#regionBoxes.get(r.id);
      if (!shown) continue;
      shown.box.setAttribute("aria-checked", String(r.selected));
      shown.ping.textContent = pingText(r.ping);
    }
  }

  /** A leaver's queue ban's end (ms; null: none): its line under Find Match while it runs */
  setQueueBan(until: number | null): void {
    this.#banUntil = until;
    this.#drawBanLine();
  }

  /** A no-show's search cooldown's end (ms; null: none): its line under Find Match while it runs, the ban's first (a
   *  match it stalled: claimed and left before its start, or not claimed in time; said nowhere else until a search) */
  setSearchCooldown(until: number | null): void {
    this.#cooldownUntil = until;
    this.#drawBanLine();
  }

  #drawBanLine(): void {
    this.#drawBan();
    if (this.#banTimer === null && !this.#banLine.hidden) {
      this.#banTimer = setInterval(() => {
        this.#drawBan();
      }, 1000);
    }
  }

  /** The line as the ban (else the cooldown) stands now: its time left, gone (its countdown stopped) once both are over */
  #drawBan(): void {
    const now = Date.now();
    const banned = this.#banUntil !== null && this.#banUntil > now;
    const cooling = this.#cooldownUntil !== null && this.#cooldownUntil > now;
    const on = banned || cooling;
    this.#banLine.hidden = !on;
    if (banned && this.#banUntil !== null) this.#banLine.textContent = queueBanText(this.#banUntil, now);
    else if (cooling && this.#cooldownUntil !== null) this.#banLine.textContent = OWN_SEARCH_TEXT.cooldown((this.#cooldownUntil - now) / 1000);
    if (!on && this.#banTimer !== null) {
      clearInterval(this.#banTimer);
      this.#banTimer = null;
    }
  }

  /** The account's page shown (its body drawn first), the menu open */
  showAccount(): void {
    if (this.#root.hidden) this.open();
    this.#show("account");
  }

  /** Back to the top page (the account's page left) */
  showTop(): void {
    this.#show("top");
  }

  /** The bots' page body, once the bot packages are listed (`draw`: ui/botsPage.ts's, into the page): Play vs Bots shown
   *  with one to play, else hidden */
  setBots(draw: (body: HTMLElement) => BotsPage): void {
    if (!this.#botsView) return;
    this.#botsPage = draw(this.#botsView.body);
    this.#botsView.entry.hidden = !this.#botsPage.playable;
  }

  /** The training packs there are: Custom Training shown with one to play (or the editor to make one), each a button on
   *  its page, the player's own with Edit beside it; Create Training first */
  setTrainingPacks(packs: readonly PackListing[]): void {
    const edit = this.#editAction;
    this.#playTraining.hidden = packs.length === 0 && !edit;
    const create = document.createElement("button");
    create.className = "main-menu-button main-menu-create";
    create.textContent = TRAINING_MENU_TEXT.create;
    create.addEventListener("click", () => {
      edit?.(null);
    });
    create.hidden = !edit;
    this.#trainingList.replaceChildren(
      create,
      ...packs.map((pack) => {
        const b = document.createElement("button");
        b.className = "main-menu-button main-menu-pack";
        b.dataset["pack"] = pack.id;
        const name = document.createElement("span");
        name.className = "main-menu-pack-name";
        name.textContent = pack.name;
        const about = document.createElement("span");
        about.className = "main-menu-pack-about";
        about.textContent = `${TRAINING_MENU_TEXT.shots(pack.shots)} · ${TRAINING_MENU_TEXT.difficulties[pack.difficulty]}`;
        b.append(name, about);
        b.addEventListener("click", () => {
          this.#trainingAction?.(pack);
        });
        if (!pack.mine || !edit) return b;
        const editButton = document.createElement("button");
        editButton.className = "main-menu-button main-menu-pack-edit";
        editButton.textContent = TRAINING_MENU_TEXT.edit;
        editButton.dataset["edit"] = pack.id;
        editButton.addEventListener("click", () => {
          edit(pack);
        });
        const row = document.createElement("div");
        row.className = "main-menu-pack-row";
        row.append(b, editButton);
        return row;
      }),
    );
  }

  /** Back on the training packs' page (from the editor) */
  showTraining(): void {
    this.open();
    this.#show("training");
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
    if (!this.#account.hidden) this.#accountLeft?.();
    this.#root.hidden = true;
    this.#setGarage(false);
  }

  /** The Play page's Free Play focused (the pad's highlight follows): Find Match's search started, free play next (the
   *  user's decision, 2026-10-16) */
  focusFreePlay(): void {
    this.#playFreePlay.focus({ preventScroll: true });
  }

  /** Back a page (Escape's, a pad's B); whether there was one to go back from (none at the top: nothing, silently) */
  back(): boolean {
    const view: MenuView =
      this.#botsView && !this.#botsView.page.hidden
        ? "bots"
        : !this.#training.hidden
          ? "training"
          : !this.#play.hidden
            ? "play"
            : !this.#garage.hidden
              ? "garage"
              : !this.#account.hidden
                ? "account"
                : "top";
    this.#show(backFrom(view));
    return view !== "top";
  }

  #setGarage(on: boolean): void {
    if (on === this.#garageOn) return;
    this.#garageOn = on;
    this.#garageShown?.(on);
  }

  #chooseCar(car: number): void {
    this.#car = car;
    storeCar(car);
    for (const b of this.#carButtons) b.setAttribute("aria-checked", String(b.dataset["car"] === String(car)));
  }

  #chooseTeam(team: Team): void {
    this.#team = team;
    storeTeam(team);
    for (const b of this.#teamButtons) b.setAttribute("aria-checked", String(b.dataset["team"] === String(team)));
  }

  /** A playlist's box pressed: toggled, the last one never unticked */
  #toggle(playlist: number): void {
    const next = this.#ticked.includes(playlist) ? this.#ticked.filter((p) => p !== playlist) : [...this.#ticked, playlist];
    if (next.length > 0) this.#tick(next);
  }

  #tick(playlists: readonly number[]): void {
    this.#ticked = PLAYLISTS.map((p) => p.teamSize).filter((p) => playlists.includes(p));
    storePlaylists(this.#ticked);
    for (const b of this.#playlistBoxes) b.setAttribute("aria-checked", String(this.#ticked.includes(Number(b.dataset["playlist"]))));
  }

  #show(view: MenuView): void {
    if (view !== "account" && !this.#account.hidden) this.#accountLeft?.();
    this.#account.hidden = view !== "account";
    this.#top.hidden = view !== "top";
    this.#play.hidden = view !== "play";
    if (view === "play") {
      this.#drawBan();
      this.#playShown?.();
    }
    if (this.#botsView) this.#botsView.page.hidden = view !== "bots";
    this.#training.hidden = view !== "training";
    this.#garage.hidden = view !== "garage";
    // (the scene's garage while its page shows; the car chosen focused)
    this.#setGarage(view === "garage");
    if (view === "garage") this.#carButtons.find((b) => b.dataset["car"] === String(this.#car))?.focus();
    // (the bots' Start focused: Enter, or the pad's A, starts it at once)
    if (view === "bots") this.#botsView?.start.focus();
    // (the first pack focused)
    if (view === "training") this.#trainingList.querySelector("button")?.focus();
  }
}

/** The ticked playlists as kept ("1,3"; one from before the boxes, "3", that one); none kept or none good, 1v1 */
export function storedPlaylists(storage: Pick<Storage, "getItem"> | null = localStore()): number[] {
  try {
    const kept = (storage?.getItem(PLAYLIST_KEY) ?? "").split(",").map(Number);
    const good = PLAYLISTS.map((p) => p.teamSize as number).filter((p) => kept.includes(p));
    return good.length > 0 ? good : [1];
  } catch {
    return [1];
  }
}

function storePlaylists(playlists: readonly number[]): void {
  try {
    localStore()?.setItem(PLAYLIST_KEY, playlists.join(","));
  } catch {
    // (not kept)
  }
}

function localStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
