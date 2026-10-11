// The held scoreboard (notes/scoreboard.md SB-1..11): blue's panel over orange's on a dark backdrop, each team's score,
// name, column headers and ping header on one line, then a 38 px row per player (strip, avatar, name, MVP badge, the
// five values, ping). Laid out on the HUD's virtual stage (1120 x 720 re-anchored to the window, HUD-1); held with the
// binding, at least 0.35 s, fading in 0.2 s and out to 0.2 before it goes.
import { SCOREBOARD_COLUMNS, SCOREBOARD_TEXT, type ScoreboardRow, TEAM_NAMES, pingBars, rowColour } from "../game/matchStats";
import { statIconSvg } from "./statIcons";

export interface ScoreboardView {
  readonly teams: readonly [readonly ScoreboardRow[], readonly ScoreboardRow[]];
  readonly score: readonly [number, number];
  /** The four columns' ids */
  readonly columns: readonly string[];
  /** The end screen's winner stamp on that team (MIO-27; null: none) */
  readonly winner?: number | null;
}

/** On the end screen (MIO-26): placed 0.3 of the way down the free height, `shift` 0..1 of its slide right as the menu
 *  comes in */
export interface EndPlacement {
  readonly shift: number;
}

/** The view's geometry (SB-1, SB-2): the panel width the game centres by, the team panels' height for n rows */
const VIEW_WIDTH = 879.6;
const teamHeight = (rows: number): number => Math.max(105, 72.5 + 42 * rows);
const ROW_PITCH = 38;
const FADE_SECONDS = 0.2;
const MIN_SECONDS = 0.35;
/** The MVP badge slams in this long after the MVP is known (SB-11) */
const MVP_DELAY = 1.75;

/** The content stage (HUD-1): scale S from the window, the stage it gives in virtual px */
export function contentStage(width: number, height: number): { readonly scale: number; readonly width: number; readonly height: number } {
  const s = Math.max(0.5, width / height >= 1.5556 ? height / 720 : width / 1120);
  return { scale: s, width: width / s, height: height / s };
}

/** Where the view goes on the stage, and its parts (SB-2, SB-5); on the end screen 0.3 down the free height (at least
 *  30 px), sliding right to make room for the menu (MIO-26) */
export function scoreboardLayout(stage: { readonly width: number; readonly height: number }, rows: readonly [number, number], end: EndPlacement | null = null): {
  readonly x: number;
  readonly y: number;
  readonly team1Y: number;
  readonly backdropHeight: number;
  readonly heights: readonly [number, number];
} {
  const h0 = teamHeight(rows[0]);
  const h1 = teamHeight(rows[1]);
  const team1Y = 22 + h0 - 20;
  const backdropHeight = team1Y + h1 + 90;
  const h = backdropHeight - 120;
  const centred = (stage.width - VIEW_WIDTH) / 2;
  if (end) {
    const slid = (350 + stage.width - VIEW_WIDTH) / 2;
    return { x: centred + (slid - centred) * end.shift, y: Math.max(30, (stage.height - h) * 0.3), team1Y, backdropHeight, heights: [h0, h1] };
  }
  return { x: centred, y: (stage.height - h) / 2, team1Y, backdropHeight, heights: [h0, h1] };
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

function div(className: string, parent?: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  parent?.appendChild(el);
  return el;
}

function box(el: HTMLElement, x: number, y: number, w: number, h: number): HTMLElement {
  el.style.left = `${String(x)}px`;
  el.style.top = `${String(y)}px`;
  el.style.width = `${String(w)}px`;
  el.style.height = `${String(h)}px`;
  return el;
}

/** The end screen's winner stamp (UIText [Global] Winner, verbatim; upper-cased) */
const WINNER_STAMP = "WINNER";

const AVATAR = `<svg viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="12" r="6.5"/><path d="M5 31c1-8 6-12 12-12s11 4 12 12z"/></svg>`;

export class HeldScoreboard {
  readonly #root: HTMLDivElement;
  readonly #stage: HTMLDivElement;
  #drawn = "";
  #pinnedAt: number | null = null; // (on the end screen since)
  #openedAt: number | null = null; // (shown since)
  #closing: { at: number; from: number } | null = null;
  #alpha = 0;
  readonly #mvpSince = new Map<number, number>();

  constructor(parent: HTMLElement) {
    this.#root = div("scoreboard-layer", parent);
    this.#root.id = "scoreboard";
    this.#stage = div("scoreboard-stage", this.#root);
    this.#root.hidden = true;
  }

  /** Shown now (for tests and the HUD's other parts) */
  get shown(): boolean {
    return !this.#root.hidden;
  }

  /** The end screen's scoreboard (MIO-26/27): shown, fading in over 0.3 s, placed for the end screen */
  pin(now: number, view: ScoreboardView, end: EndPlacement): void {
    this.#track(now, view);
    this.#pinnedAt ??= now;
    this.#root.hidden = false;
    this.#root.style.opacity = Math.min(1, (now - this.#pinnedAt) / 0.3).toFixed(3);
    this.#draw(now, view, end);
  }

  unpin(): void {
    if (this.#pinnedAt === null) return;
    this.#pinnedAt = null;
    this.#hide();
  }

  #track(now: number, view: ScoreboardView): void {
    for (const row of [...view.teams[0], ...view.teams[1]]) {
      if (row.mvp && !this.#mvpSince.has(row.car)) this.#mvpSince.set(row.car, now);
      if (!row.mvp) this.#mvpSince.delete(row.car);
    }
  }

  /** Each frame: whether its binding is held and it may show (SB-10), what it shows; `now`: real seconds */
  update(now: number, held: boolean, allowed: boolean, view: ScoreboardView | null): void {
    if (view) this.#track(now, view);
    if (!allowed || !view) {
      this.#hide();
      return;
    }
    if (held) {
      if (this.#openedAt === null || this.#closing) {
        this.#openedAt = now - (this.#closing ? this.#alpha * FADE_SECONDS : 0);
        this.#closing = null;
      }
    } else if (this.#openedAt !== null && !this.#closing && now - this.#openedAt >= MIN_SECONDS) {
      this.#closing = { at: now, from: this.#alpha };
    }
    if (this.#openedAt === null) return;
    if (this.#closing) {
      const t = Math.min(1, (now - this.#closing.at) / FADE_SECONDS);
      if (t >= 1) {
        this.#hide(); // (the last 0.2 pops off)
        return;
      }
      this.#alpha = this.#closing.from + (0.2 - this.#closing.from) * easeOut(t);
    } else {
      this.#alpha = easeOut(Math.min(1, (now - this.#openedAt) / FADE_SECONDS));
    }
    this.#root.hidden = false;
    this.#root.style.opacity = this.#alpha.toFixed(3);
    this.#draw(now, view);
  }

  #hide(): void {
    this.#root.hidden = true;
    this.#openedAt = null;
    this.#closing = null;
    this.#alpha = 0;
  }

  #draw(now: number, view: ScoreboardView, end: EndPlacement | null = null): void {
    const stage = contentStage(window.innerWidth, window.innerHeight);
    const slams = [...this.#mvpSince].map(([car, since]) => `${String(car)}:${String(now - since >= MVP_DELAY)}`).join(",");
    const key = JSON.stringify([view, stage, slams, end]);
    if (key === this.#drawn) return;
    this.#drawn = key;
    this.#stage.replaceChildren();
    this.#stage.style.width = `${String(stage.width)}px`;
    this.#stage.style.height = `${String(stage.height)}px`;
    this.#stage.style.transform = `scale(${String(stage.scale)})`;
    const layout = scoreboardLayout(stage, [view.teams[0].length, view.teams[1].length], end);
    const viewEl = div("sb-view", this.#stage);
    viewEl.style.left = `${String(layout.x)}px`;
    viewEl.style.top = `${String(layout.y)}px`;
    box(div("sb-backdrop", viewEl), -70, -35, 950, layout.backdropHeight);
    const headers = [SCOREBOARD_TEXT.score, ...view.columns.map((id) => SCOREBOARD_COLUMNS.find((c) => c.id === id)?.label ?? "")];
    for (const team of [0, 1] as const) {
      const panel = div(`sb-team sb-team-${String(team)}`, viewEl);
      panel.style.left = "62px";
      panel.style.top = `${String(team === 0 ? 22 : layout.team1Y)}px`;
      // The seam glow (toward the other panel) and the team name's glow
      const glow = box(div("sb-seam-glow", panel), 0, team === 0 ? -15 : 10, 800, layout.heights[team] - 5);
      glow.dataset["side"] = team === 0 ? "top" : "bottom";
      box(div("sb-name-glow", panel), -136, -12, 600, 60);
      const score = box(div("sb-team-score", panel), -20, 0, 50, 44);
      score.textContent = String(view.score[team]);
      const name = box(div("sb-team-name", panel), 30, 0, 260, 40.5);
      name.textContent = TEAM_NAMES[team].toUpperCase();
      if (view.winner === team) box(div("sb-winner-stamp", panel), 160, 4, 130, 34).textContent = WINNER_STAMP;
      headers.forEach((text, i) => {
        const h = box(div("sb-header", panel), 293 + 69 * i, 2, 66, 35);
        h.textContent = text;
      });
      box(div("sb-header sb-ping-header", panel), 638, 2, 55, 35).textContent = SCOREBOARD_TEXT.ping;
      view.teams[team].forEach((row, i) => {
        this.#row(panel, row, team, 33 + ROW_PITCH * i, now);
      });
    }
  }

  #row(panel: HTMLElement, row: ScoreboardRow, team: number, y: number, now: number): void {
    const el = box(div(`sb-row${row.local ? " sb-local" : ""}`, panel), -8, y, 705, 50);
    el.dataset["car"] = String(row.car);
    if (row.ready) box(div("sb-ready", el), -34, 13, 26, 25).textContent = "✓"; // (the end screen's ready check)
    box(div("sb-strip", el), 0, 9, 705, 32);
    const avatar = box(div("sb-avatar", el), 8, 8, 34, 34);
    avatar.innerHTML = AVATAR;
    const colour = rowColour(team, row.local);
    const name = box(div("sb-name", el), 46, 13, 230, 25);
    name.textContent = row.name; // (text, isolated: a name's bidi controls stay inside it, RV-249)
    name.style.color = colour;
    const since = this.#mvpSince.get(row.car);
    if (row.mvp && since !== undefined && now - since >= MVP_DELAY) {
      const badge = box(div("sb-mvp", el), 276, 9, 30, 30);
      badge.innerHTML = statIconSvg("mvp");
    }
    row.values.forEach((v, i) => {
      const value = box(div("sb-value", el), 304 + 69 * i, 13, 60, 25);
      value.textContent = String(v);
      value.style.color = colour;
    });
    const ping = pingBars(row.ping);
    const label = box(div("sb-ping", el), 645, 13, 50, 22);
    label.style.color = ping.colour;
    const bars = div("sb-bars", label);
    for (let b = 1; b <= 4; b++) {
      const bar = div(b <= ping.bars ? "sb-bar on" : "sb-bar", bars);
      bar.style.height = `${String(4 + 4 * b)}px`;
    }
    div("sb-ping-value", label).textContent = ping.text;
  }
}
