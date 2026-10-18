// The search's banner (notes/matchmaking.md MM-5, 6, 10, 12, 14; MS1, 2026-10-16). Find Match shows it at once wherever
// the search starts and the player stays where they were (the game's in-game path: its Play menu closes, the banner alone
// shows; no centred panel, the user's decision). A full-width strip across the top, 26 units of the HUD's stage tall
// (ContentScale: 39 CSS px at 1080p, 52 at 1440p), extended up into the safe zone, opaque #00101D with a light line along
// its foot; created and removed at once. The summary centred (upper case, slanted), the state's clip beside it (three
// pulsing pills; the join's spinner and its streak; a failure's triangle), each state change replaying its intro. Cancel
// Search at the left where the pad's Y cancels (MM-10: a menu up, the main or pause menu; never while driving): "‹Y›
// CANCEL SEARCH" in the pad's mode, the slanted button in the mouse's. The queue time's place at the right is empty (the
// estimate 0: MM-9).
//
// Ours: the log's newest line under the strip, in the log's colours (the game shows its log only in the panel we don't
// build; the user's request: the search's messages and "Joining in N", MM-14, still seen): a new line for 6 s, the join's
// countdown and a failure's reason while they last.
import { OWN_SEARCH_TEXT, SEARCH_TEXT, type LogLine, type SearchViewState } from "../game/matchmaking";
import { glyphElement, keyGlyph } from "./keyGlyph";
import { fitStage } from "./stage";

const SUMMARY: Record<SearchViewState["status"], string> = {
  connecting: SEARCH_TEXT.connecting,
  searching: SEARCH_TEXT.searching,
  joining: SEARCH_TEXT.joining,
  failed: SEARCH_TEXT.failed,
  ended: OWN_SEARCH_TEXT.ended,
};

/** The banner's geometry on the HUD's stage (MS1: 720 units of height) */
export const BANNER = { height: 26, line: 2 } as const;

/** How long a new line shows under the banner (s) */
export const MESSAGE_SECONDS = 6;

/** The line under the banner: the join's latest countdown, a failed or ended search's last line, while that lasts; else
 *  each line new to this search for MESSAGE_SECONDS, in the order they came (a warning not pushed out at once by the log's
 *  timeline: a search back from a cancelled match keeps its clock, its timeline's line due as it starts) */
export class BannerMessage {
  readonly #seen = new Set<string>();
  readonly #queue: LogLine[] = [];
  #line: LogLine | null = null;
  #since = 0;

  /** The line shown now (null: none), from the search's state at `now` (s) */
  update(state: SearchViewState | null, now: number): LogLine | null {
    if (state === null) {
      this.#seen.clear();
      this.#queue.length = 0;
      this.#line = null;
      return null;
    }
    const key = (l: LogLine): string => `${l.kind}|${l.text}`;
    for (const l of state.lines) {
      if (this.#seen.has(key(l))) continue;
      this.#seen.add(key(l));
      if (l.kind !== "countdown") this.#queue.push(l);
    }
    if (state.status === "joining") {
      return state.lines.findLast((l) => l.kind === "countdown") ?? null;
    }
    if (state.status === "failed" || state.status === "ended") return state.lines.at(-1) ?? null;
    if (this.#line === null || now - this.#since >= MESSAGE_SECONDS) {
      const next = this.#queue.shift();
      if (next) {
        this.#line = next;
        this.#since = now;
      }
    }
    return this.#line && now - this.#since < MESSAGE_SECONDS ? this.#line : null;
  }
}

/** Where the search's cancel shows and the pad's Y cancels (MM-10): over the main or pause menu with nothing over them
 *  (the settings' panel, a question); never while driving, Y the ball cam's */
export function cancelShown(open: { readonly mainMenu: boolean; readonly pause: boolean; readonly panel: boolean; readonly modal: boolean }): boolean {
  return (open.mainMenu || open.pause) && !open.panel && !open.modal;
}

/** Where the cancel shows: a menu up (the main or pause menu: MM-10's), in the pad's form or the mouse's */
export interface BannerContext {
  readonly menuUp: boolean;
  readonly padMode: boolean;
  /** Real time (s) */
  readonly now: number;
}

const NS = "http://www.w3.org/2000/svg";

/** The state's clip (MS1): the searching pills, the join's three arcs, a failure's triangle; none once ended */
function clipFor(status: SearchViewState["status"]): DocumentFragment {
  const clip = document.createDocumentFragment();
  if (status === "connecting" || status === "searching") {
    for (let i = 0; i < 3; i++) {
      const pill = document.createElement("span");
      pill.className = "search-pill";
      pill.style.animationDelay = `${String(0.4 * i)}s`;
      clip.append(pill);
    }
  } else if (status === "joining" || status === "failed") {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 26 26");
    svg.setAttribute("class", status === "joining" ? "search-spinner" : "search-alert");
    svg.innerHTML =
      status === "joining"
        ? // (three arcs of 80 degrees, 40 apart)
          [0, 120, 240].map((a) => `<path d="${arc(13, 13, 10.5, a, a + 80)}"/>`).join("")
        : `<path d="M13 1.5 L25 23.5 H1 Z"/><path class="search-alert-mark" d="M13 8.5 V16 M13 19 V20.5"/>`;
    clip.append(svg);
  }
  return clip;
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const at = (deg: number): string => {
    const a = (deg * Math.PI) / 180;
    return `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  };
  return `M ${at(from)} A ${String(r)} ${String(r)} 0 0 1 ${at(to)}`;
}

export class SearchView {
  readonly #banner: HTMLDivElement;
  readonly #stage: HTMLDivElement;
  readonly #summary: HTMLDivElement;
  readonly #clip: HTMLDivElement;
  readonly #glow: HTMLDivElement;
  readonly #cancelPad: HTMLDivElement;
  readonly #cancelButton: HTMLButtonElement;
  readonly #message: HTMLDivElement;
  readonly #messages = new BannerMessage();
  readonly #fitted = { key: "" };
  #status: SearchViewState["status"] | null = null;
  #messageShown = "";

  constructor(host: HTMLElement, cancel: () => void) {
    const div = (className: string, parent: HTMLElement): HTMLDivElement => {
      const el = document.createElement("div");
      el.className = className;
      parent.append(el);
      return el;
    };
    this.#banner = document.createElement("div");
    this.#banner.id = "search-banner";
    this.#banner.className = "search-banner";
    this.#banner.hidden = true;
    div("search-strip", this.#banner);
    this.#stage = div("search-stage", this.#banner);
    const centre = div("search-centre", this.#stage);
    div("search-streak", centre);
    this.#glow = div("search-glow", centre);
    this.#summary = div("search-summary", centre);
    this.#clip = div("search-clip", centre);
    this.#cancelButton = document.createElement("button");
    this.#cancelButton.className = "search-cancel";
    this.#cancelButton.textContent = SEARCH_TEXT.cancel;
    this.#cancelButton.addEventListener("click", cancel);
    this.#stage.append(this.#cancelButton);
    this.#cancelPad = div("search-cancel-pad", this.#stage);
    this.#cancelPad.append(glyphElement(keyGlyph({ kind: "padButton", button: 3 })), document.createTextNode(SEARCH_TEXT.cancel));
    this.#message = div("search-message", this.#stage);
    host.append(this.#banner);
  }

  /** The banner's height on the page now (CSS px: the safe zone's border and its 26 units) */
  get height(): number {
    if (this.#banner.hidden) return 0;
    return this.#banner.getBoundingClientRect().height;
  }

  /** Each frame: the search's state (null: none, the banner gone) and where the cancel may show */
  update(state: SearchViewState | null, context: BannerContext): void {
    this.#banner.hidden = state === null;
    const message = this.#messages.update(state, context.now);
    if (state === null) {
      this.#status = null;
      this.#messageShown = "";
      return;
    }
    const stage = fitStage(this.#stage, this.#fitted);
    this.#banner.style.setProperty("--banner-scale", String(stage.scale));
    this.#banner.style.setProperty("--banner-top", `${String(stage.top)}px`);
    // (the cancel where the pad's Y cancels: its form by the last device used)
    this.#cancelPad.classList.toggle("shown", context.menuUp && context.padMode);
    this.#cancelButton.classList.toggle("shown", context.menuUp && !context.padMode);
    this.#cancelButton.tabIndex = context.menuUp && !context.padMode ? 0 : -1;
    if (state.status !== this.#status) {
      const first = this.#status === null;
      this.#status = state.status;
      this.#summary.textContent = SUMMARY[state.status];
      this.#banner.dataset["status"] = state.status;
      this.#clip.replaceChildren(clipFor(state.status));
      if (!first || state.status !== "connecting") this.#intro(state.status);
    }
    const shown = message ? `${message.kind}|${message.text}` : "";
    if (shown !== this.#messageShown) {
      this.#messageShown = shown;
      if (message) {
        this.#message.textContent = message.text;
        this.#message.dataset["kind"] = message.kind;
      }
      this.#message.classList.toggle("shown", message !== null);
    }
  }

  /** A state change's intro (0.37 s, MS1): the text jumps left and eases back, the clip pops in with a white flash (the
   *  join's spinner from 1.87 times its size, the others' from 2.73), the glow fades in */
  #intro(status: SearchViewState["status"]): void {
    const skew = "skewX(-6.8deg)";
    this.#summary.animate([{ transform: `translateX(-9px) ${skew}` }, { transform: `translateX(-4.5px) ${skew}`, offset: 0.2 }, { transform: skew }], {
      duration: 370,
      easing: "cubic-bezier(0.215, 0.61, 0.355, 1)",
    });
    const from = status === "joining" ? 1.87 : 2.73;
    this.#clip.animate(
      [
        { transform: `scale(${String(from)})`, filter: "brightness(3)" },
        { transform: "scale(1)", filter: "brightness(1)" },
      ],
      {
        duration: 370,
        easing: "cubic-bezier(0.215, 0.61, 0.355, 1)",
      },
    );
    this.#glow.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 370 });
  }
}
