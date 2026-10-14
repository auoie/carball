// The match's end on screen (notes/match-intro-outro.md §2.4): the winner banner (MIO-18/19, its 0.7 s slam, then up to
// the top on the podium: MIO-22), the screen's dimming and the podium's vignette (MIO-20), the podium cars' name tags
// (MIO-22), and the end screen's menu with the next match's countdown (MIO-26, 29, 31). On the HUD's virtual stage.
import { END_TEXT } from "../game/matchSequence";
import { scoreboardLayout } from "./scoreboard";
import { type ContentStage, fitStage } from "./stage";

/** A podium title as shown: its name (upper-cased) and its stat line */
interface ShownTitle {
  readonly title: string;
  readonly line: string;
}

function div(className: string, parent: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  parent.appendChild(el);
  return el;
}

/** A layer on the virtual stage (HUD-1), rescaled to the window when it changes */
class Stage {
  readonly root: HTMLDivElement;
  readonly #fitted = { key: "" };

  constructor(parent: HTMLElement, id: string) {
    this.root = div("hud-stage", parent);
    this.root.id = id;
  }

  fit(): ContentStage {
    return fitStage(this.root, this.#fitted);
  }
}

/** The winner banner: the win word over the team's name, tinted with the team's colour (additive: blue +(0, 45, 191),
 *  orange +(178, 61, 0)); it slams in over 0.7 s, and on the podium rises to 0.15 of the height at 0.8 scale in 1 s */
export class WinnerBanner {
  readonly #stage: Stage;
  readonly #box: HTMLDivElement;
  readonly #label: HTMLDivElement;
  readonly #team: HTMLDivElement;
  #shown = "";

  constructor(parent: HTMLElement) {
    this.#stage = new Stage(parent, "winner-banner");
    this.#box = div("winner", this.#stage.root);
    div("winner-band", this.#box);
    this.#label = div("winner-label", this.#box);
    this.#team = div("winner-team", this.#box);
    this.#stage.root.hidden = true;
  }

  /** `banner`: the words (null: hidden); `raised`: on the podium */
  update(banner: { readonly label: string; readonly team: string; readonly side: number } | null, raised: boolean): void {
    const shown = banner === null ? "" : JSON.stringify(banner);
    if (shown !== this.#shown) {
      this.#shown = shown;
      this.#stage.root.hidden = banner === null;
      if (banner) {
        this.#label.textContent = banner.label;
        this.#team.textContent = banner.team;
        this.#box.dataset["side"] = String(banner.side);
        this.#box.classList.remove("slam");
        this.#box.getBoundingClientRect(); // (a reflow: restarts the slam)
        this.#box.classList.add("slam");
      }
    }
    if (banner === null) return;
    const stage = this.#stage.fit();
    this.#box.style.left = `${String(stage.width / 2)}px`;
    this.#box.style.top = `${String(stage.height / 2)}px`;
    this.#box.style.setProperty("--raise", `${String(-0.35 * stage.height)}px`);
    this.#box.classList.toggle("raised", raised);
  }
}

/** MIO-20: the darkening filter (a radial grey, multiplied) and the podium's team-tinted edge vignette */
export class ScreenDimming {
  readonly #filter: HTMLDivElement;
  readonly #vignette: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.#filter = div("screen-filter", parent);
    this.#vignette = div("podium-vignette", parent);
  }

  update(alphas: { readonly filter: number; readonly vignette: number }, side: number): void {
    this.#filter.style.opacity = alphas.filter.toFixed(3);
    this.#vignette.style.opacity = alphas.vignette.toFixed(3);
    this.#vignette.dataset["side"] = String(side);
  }
}

/** MIO-22: a panel under each podium car, at the car's ground point projected to the screen (`at`: CSS px): the name,
 *  then the primary title over its stat line and the secondary's (fading in 0.5 s into the podium, over 0.3 s) */
export class PodiumTags {
  readonly #root: HTMLDivElement;
  readonly #tags = new Map<number, { readonly el: HTMLDivElement; readonly name: HTMLElement; readonly titles: HTMLDivElement; shown: string }>();

  constructor(parent: HTMLElement) {
    this.#root = div("podium-tags", parent);
  }

  update(
    tags: readonly {
      readonly car: number;
      readonly name: string;
      readonly side: number;
      readonly titles: readonly ShownTitle[];
      readonly at: { readonly x: number; readonly y: number } | null;
    }[],
  ): void {
    const seen = new Set<number>();
    for (const t of tags) {
      seen.add(t.car);
      let tag = this.#tags.get(t.car);
      if (!tag) {
        const el = div("podium-panel", this.#root);
        const banner = div("podium-tag", el);
        const name = document.createElement("bdi");
        banner.append(name);
        tag = { el, name, titles: div("podium-titles", el), shown: "" };
        this.#tags.set(t.car, tag);
      }
      const { el, name } = tag;
      if (name.textContent !== t.name) name.textContent = t.name;
      const shown = JSON.stringify(t.titles);
      if (shown !== tag.shown) {
        tag.shown = shown;
        tag.titles.replaceChildren(
          ...t.titles.flatMap((x) => {
            const title = document.createElement("div");
            title.className = "podium-title";
            title.textContent = x.title;
            const line = document.createElement("div");
            line.className = "podium-title-line";
            line.textContent = x.line;
            return [title, line];
          }),
        );
        tag.titles.hidden = t.titles.length === 0;
      }
      el.dataset["side"] = String(t.side);
      el.hidden = t.at === null;
      if (t.at) {
        el.style.left = `${String(t.at.x)}px`;
        el.style.top = `${String(t.at.y)}px`;
      }
    }
    for (const [car, tag] of this.#tags) {
      if (!seen.has(car)) {
        tag.el.remove();
        this.#tags.delete(car);
      }
    }
  }
}

export interface EndScreenState {
  /** On the end screen now */
  readonly shown: boolean;
  /** Real seconds since it came up (the menu joins after 1 s) */
  readonly since: number;
  /** The next match's countdown */
  readonly secondsLeft: number;
  /** This player is ready */
  readonly ready: boolean;
  /** This player's podium titles (MIO-28 "My Accolades": none, hidden) */
  readonly accolades: readonly ShownTitle[];
  /** The scoreboard's rows per team (the accolades sit above it) */
  readonly rows: readonly [number, number];
}

/** MIO-26/29/31: the end screen's menu on the left (Ready, Exit to Main Menu with its question, Options), joining 1 s in,
 *  and the next match's countdown above it; MIO-28: the player's titles above the scoreboard, moving aside with it */
export class EndScreen {
  readonly #stage: Stage;
  readonly #accolades: HTMLDivElement;
  readonly #tiles: HTMLDivElement;
  #accoladesShown = "";
  readonly #menu: HTMLDivElement;
  readonly #countdown: HTMLDivElement;
  readonly #ready: HTMLButtonElement;
  readonly #buttons: HTMLDivElement;
  readonly #question: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    actions: { readonly ready: () => void; readonly exit: () => void; readonly options: () => void },
  ) {
    this.#stage = new Stage(parent, "end-screen");
    this.#accolades = div("end-accolades", this.#stage.root);
    div("end-accolades-header", this.#accolades).textContent = END_TEXT.myAccolades;
    this.#tiles = div("end-accolade-tiles", this.#accolades);
    this.#accolades.hidden = true;
    this.#menu = div("end-menu", this.#stage.root);
    this.#countdown = div("end-countdown", this.#menu);
    this.#buttons = div("end-buttons", this.#menu);
    const button = (label: string, desc: string, click: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = "end-button";
      const l = document.createElement("span");
      l.className = "end-label";
      l.textContent = label;
      const d = document.createElement("span");
      d.className = "end-desc";
      d.textContent = desc;
      b.append(l, d);
      b.addEventListener("click", click);
      this.#buttons.append(b);
      return b;
    };
    this.#ready = button(END_TEXT.ready, END_TEXT.readyDesc, actions.ready);
    this.#ready.dataset["action"] = "ready";
    button(END_TEXT.exit, END_TEXT.exitDesc, () => {
      this.#question.hidden = false;
    }).dataset["action"] = "exit";
    button(END_TEXT.options, END_TEXT.optionsDesc, actions.options).dataset["action"] = "options";
    this.#question = div("end-question", this.#menu);
    const ask = document.createElement("span");
    ask.textContent = END_TEXT.exitInquiry;
    const yes = document.createElement("button");
    yes.textContent = END_TEXT.yes;
    yes.addEventListener("click", actions.exit);
    const no = document.createElement("button");
    no.textContent = END_TEXT.no;
    no.addEventListener("click", () => {
      this.#question.hidden = true;
    });
    this.#question.append(ask, yes, no);
    this.#question.hidden = true;
    this.#stage.root.hidden = true;
  }

  /** The menu's slide-in so far, 0..1 (the scoreboard moves aside with it) */
  static menuShift(since: number): number {
    return Math.min(1, Math.max(0, (since - 1) / 0.3));
  }

  update(s: EndScreenState): void {
    this.#stage.root.hidden = !s.shown;
    if (!s.shown) {
      this.#question.hidden = true;
      return;
    }
    const stage = this.#stage.fit();
    const shift = EndScreen.menuShift(s.since);
    // (the accolades: centred, then 130 right with the scoreboard's slide; their bottom on its top, fading in with it)
    const shown = JSON.stringify(s.accolades);
    if (shown !== this.#accoladesShown) {
      this.#accoladesShown = shown;
      this.#tiles.replaceChildren(
        ...s.accolades.map((a) => {
          const tile = document.createElement("div");
          tile.className = "end-accolade";
          div("end-accolade-title", tile).textContent = a.title;
          div("end-accolade-line", tile).textContent = a.line;
          return tile;
        }),
      );
    }
    this.#accolades.hidden = s.accolades.length === 0;
    const board = scoreboardLayout(stage, s.rows, { shift });
    this.#accolades.style.left = `${String(stage.width / 2 + 130 * shift)}px`;
    this.#accolades.style.top = `${String(board.y - 8)}px`;
    this.#accolades.style.opacity = Math.min(1, s.since / 0.3).toFixed(3);
    this.#menu.style.opacity = shift.toFixed(3);
    this.#menu.style.pointerEvents = shift > 0 ? "auto" : "none";
    // ("Next Match In" and the seconds, hidden at 0; a no-break space after a last digit 1: the font's kerning)
    const seconds = String(s.secondsLeft);
    this.#countdown.hidden = s.secondsLeft <= 0;
    this.#countdown.textContent = `${END_TEXT.nextMatchIn} ${seconds}${seconds.endsWith("1") ? " " : ""}`;
    this.#ready.disabled = s.ready;
    this.#ready.classList.toggle("done", s.ready);
  }
}
