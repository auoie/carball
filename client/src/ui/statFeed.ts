// The stat popups and the feed (notes/match-stats.md §6, hud-menus.md HUD-9/14, scoreboard.md SB-15): the player's own
// awards pop up one at a time at the top centre (2.633 s each: the icon, the label rising in, "+N" popping, all
// floating off); everyone's go to the feed at the top right, a row each (the names and the icon), 6 at most, 4 s each.
import { POPUP_SECONDS, type StatPopup, TICKER, type TickerRow } from "../game/matchStats";
import { TEAM_FONT_COLOURS } from "../game/quickChat";
import { contentStage } from "./scoreboard";
import { statIconSvg } from "./statIcons";

function div(className: string, parent: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  parent.appendChild(el);
  return el;
}

/** A layer on the HUD's virtual stage (HUD-1), rescaled to the window each frame */
class StageLayer {
  readonly root: HTMLDivElement;
  #size = "";

  constructor(parent: HTMLElement, id: string) {
    this.root = div("hud-stage", parent);
    this.root.id = id;
  }

  /** The stage's virtual width */
  fit(): number {
    const stage = contentStage(window.innerWidth, window.innerHeight);
    const size = `${String(stage.width)}x${String(stage.height)}x${String(stage.scale)}`;
    if (size !== this.#size) {
      this.#size = size;
      this.root.style.width = `${String(stage.width)}px`;
      this.root.style.height = `${String(stage.height)}px`;
      this.root.style.transform = `scale(${String(stage.scale)})`;
    }
    return stage.width;
  }
}

export class StatPopups {
  readonly #layer: StageLayer;
  readonly #queue: StatPopup[] = [];
  #current: { readonly el: HTMLElement; readonly since: number } | null = null;

  constructor(parent: HTMLElement) {
    this.#layer = new StageLayer(parent, "stat-popups");
  }

  /** Queued: unbounded, in order, no merging (GFxHUD_TA's StatEventView) */
  push(popup: StatPopup): void {
    this.#queue.push(popup);
  }

  /** Each frame (`now`: real seconds) */
  update(now: number): void {
    const width = this.#layer.fit();
    if (this.#current && now - this.#current.since >= POPUP_SECONDS) {
      this.#current.el.remove();
      this.#current = null;
    }
    const next = this.#current ? undefined : this.#queue.shift();
    if (!next) return;
    const el = div("stat-popup", this.#layer.root);
    el.style.left = `${String(width / 2)}px`;
    div("stat-popup-icon", el).innerHTML = statIconSvg(next.icon);
    div("stat-popup-label", el).textContent = next.label;
    if (next.points !== null) div("stat-popup-points", el).textContent = next.points;
    this.#current = { el, since: now };
  }

  /** What's showing and waiting (tests) */
  get pending(): number {
    return this.#queue.length + (this.#current ? 1 : 0);
  }
}

export class StatTicker {
  readonly #layer: StageLayer;
  readonly #rows: { readonly el: HTMLElement; readonly since: number }[] = [];

  constructor(parent: HTMLElement) {
    this.#layer = new StageLayer(parent, "stat-ticker");
  }

  add(row: TickerRow, now: number): void {
    const el = div("ticker-row", this.#layer.root);
    const pill = (name: TickerRow["receiver"]): void => {
      const p = div("ticker-name", el);
      p.textContent = name.text;
      const [r, g, b] = TEAM_FONT_COLOURS[name.team === 1 ? 1 : 0];
      p.style.backgroundColor = `rgba(${String(r)}, ${String(g)}, ${String(b)}, 0.85)`;
    };
    pill(row.receiver);
    div("ticker-icon", el).innerHTML = statIconSvg(row.icon);
    if (row.victim) pill(row.victim);
    this.#rows.push({ el, since: now });
    while (this.#rows.length > TICKER.rows) this.#rows.shift()?.el.remove();
    this.#place();
  }

  update(now: number): void {
    this.#layer.fit();
    let removed = false;
    while (this.#rows.length > 0 && now - (this.#rows[0]?.since ?? now) >= TICKER.seconds) {
      this.#rows.shift()?.el.remove();
      removed = true;
    }
    if (removed) this.#place();
  }

  /** New rows below the older, 36 px apart, from the top right (W - 10, 10) */
  #place(): void {
    this.#rows.forEach((r, i) => {
      r.el.style.top = `${String(10 + 36 * i)}px`;
    });
  }

  get rows(): number {
    return this.#rows.length;
  }
}
