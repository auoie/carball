// The stat graphs drawn (notes/hud-menus.md HUD-21, SG2: StatGraphDrawer_TA's look, our drawing). Top-right, over
// everything (drawn in menus, paused, in replays, on the podium, with Hide In-Game HUD on); per row a black 1/3 tile over
// its graph and two columns; the values column (6 W) each summary " %.2f", no units, coloured by its standing; the labels
// column (9 W, right-aligned) the title in white on line 0, then the other summaries' names in grey; the graph (one px a
// 1/60 s sample: 5 or 10 s) a black grid (a line each second, 5 cells high) under a 1-px polyline of the worse side of
// each slot, newest at the right, coloured by its standing. Sizes the game's base px at 1280 x 720 (a 16-px line, W 13)
// scaled by max(min(H 16/9 / 1600 x Interface Scale, 1.8), 1), the same both ways (ultrawide not stretched: ours); the font a
// 16-px line of Arial (the game's SmallFont is a 16-px Arial bitmap). Ours (RV-517): the canvas only the overlay's box at
// the screen's top-right, drawn again only when a new 1/60 s slot starts (the samples' own rate) or the view changes.
import { SAMPLE_RATE, type StatRowView, SUMMARY_LABELS, standing } from "../game/statGraphs";

export const STAT_LAYOUT = { line: 16, w: 13, values: 6, labels: 9, summaryTile: 15, firstRow: 16, cells: 5, tileAlpha: 0.333 } as const;
export const STAT_COLOURS = {
  good: "rgb(64, 255, 64)",
  mid: "rgb(255, 255, 64)",
  bad: "rgb(255, 64, 64)",
  title: "#fff",
  label: "rgb(192, 192, 192)",
  grid: "#000",
} as const;

/** The overlay's scale for a `width` x `height` CSS px screen (SG2's YScale) */
export function statScale(height: number, interfaceScale: number): number {
  return Math.max(Math.min(((height * 16) / 9 / 1600) * interfaceScale, 1.8), 1);
}

/** Where a slot's value is drawn in its graph (0 bottom, 1 top), its range clamped */
export function graphHeight(value: number, range: readonly [number, number]): number {
  const [min, max] = range;
  return max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
}

/** A draw's stamp: its slot, its key, the screen */
function stamp(now: number, key: string): string {
  return `${String(Math.floor(now * SAMPLE_RATE))}|${key}|${String(window.innerWidth)}x${String(window.innerHeight)}x${String(window.devicePixelRatio)}`;
}

export class StatGraphsView {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D | null;
  #size = "";
  #drawn = "";

  constructor(parent: HTMLElement) {
    this.#canvas = document.createElement("canvas");
    this.#canvas.className = "stat-graphs";
    this.#canvas.hidden = true;
    this.#canvas.setAttribute("aria-hidden", "true");
    parent.append(this.#canvas);
    this.#ctx = this.#canvas.getContext("2d");
  }

  hide(): void {
    this.#canvas.hidden = true;
    this.#drawn = "";
  }

  /** Whether a draw is due at `now` (s): a new slot since the last, or `key` (the level, the scales) or the screen changed */
  due(now: number, key: string): boolean {
    return stamp(now, key) !== this.#drawn;
  }

  /** The level's rows at `now` (s), its window's `seconds` (0 for the Summary levels), the Interface and Display Scales;
   *  `key` what `due` is asked with */
  draw(rows: readonly StatRowView[], seconds: number, now: number, interfaceScale: number, displayScale: number, key = ""): void {
    const ctx = this.#ctx;
    if (!ctx || rows.length === 0) {
      this.hide();
      return;
    }
    this.#canvas.hidden = false;
    const [W, H, dpr] = [window.innerWidth, window.innerHeight, window.devicePixelRatio || 1];
    const k = statScale(H, interfaceScale);
    const L = STAT_LAYOUT.line * k;
    const w = STAT_LAYOUT.w * k;
    // (the safe zone's inset, the right edge in from it)
    const inset = ((1 - displayScale) * H) / 2;
    const X = W - inset * (W / ((H * 16) / 9));
    const values = STAT_LAYOUT.values * w;
    const labels = STAT_LAYOUT.labels * w;
    const graph = seconds * SAMPLE_RATE * k;
    const textX = X - values;
    const graphRight = textX - labels;
    const newest = Math.floor(now * SAMPLE_RATE);
    // (the canvas the overlay's box: from its tiles' left to the screen's right, down to the last row's foot)
    const left = seconds > 0 ? graphRight - graph : X - STAT_LAYOUT.summaryTile * w;
    const top = STAT_LAYOUT.firstRow * k + inset;
    const foot = top + rows.reduce((t, r) => t + (r.summaries.length + 1) * L, 0);
    const [boxX, boxW, boxH] = [Math.floor(left), W - Math.floor(left), Math.ceil(foot)];
    const size = `${String(boxW)}x${String(boxH)}x${String(dpr)}`;
    if (size !== this.#size) {
      this.#size = size;
      this.#canvas.width = Math.round(boxW * dpr);
      this.#canvas.height = Math.round(boxH * dpr);
      this.#canvas.style.width = `${String(boxW)}px`;
      this.#canvas.style.height = `${String(boxH)}px`;
    }
    this.#drawn = stamp(now, key);
    ctx.setTransform(dpr, 0, 0, dpr, -boxX * dpr, 0);
    ctx.clearRect(boxX, 0, boxW, boxH);
    ctx.font = `${String(STAT_LAYOUT.line * k)}px Arial, "Helvetica Neue", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;
    let y = top;
    for (const row of rows) {
      const n = row.summaries.length;
      const h = n * L;
      ctx.fillStyle = `rgba(0, 0, 0, ${String(STAT_LAYOUT.tileAlpha)})`;
      ctx.fillRect(left, y, X - left, h);
      row.summaries.forEach((s, i) => {
        const mid = y + (i + 0.5) * L;
        ctx.textAlign = "right";
        ctx.fillStyle = i === 0 ? STAT_COLOURS.title : STAT_COLOURS.label;
        ctx.fillText(i === 0 ? row.title : SUMMARY_LABELS[s.type], textX, mid);
        ctx.textAlign = "left";
        ctx.fillStyle = s.standing ? STAT_COLOURS[s.standing] : STAT_COLOURS.label;
        ctx.fillText(s.value === null ? " -" : ` ${s.value.toFixed(2)}`, textX, mid);
      });
      if (seconds > 0) this.#graph(ctx, row, seconds, now, graphRight - graph, y, graph, h, newest, k);
      y += (n + 1) * L;
    }
  }

  /** A row's graph: the grid, then the polyline of each slot's worse side, coloured by its standing */
  #graph(
    ctx: CanvasRenderingContext2D,
    row: StatRowView,
    seconds: number,
    now: number,
    x: number,
    y: number,
    width: number,
    height: number,
    newest: number,
    k: number,
  ): void {
    ctx.strokeStyle = STAT_COLOURS.grid;
    ctx.beginPath();
    for (let gx = 0; gx <= width + 0.5; gx += SAMPLE_RATE * k) {
      ctx.moveTo(Math.round(x + width - gx) + 0.5, y);
      ctx.lineTo(Math.round(x + width - gx) + 0.5, y + height);
    }
    for (let c = 0; c <= STAT_LAYOUT.cells; c++) {
      const gy = Math.round(y + (height * c) / STAT_LAYOUT.cells) + 0.5;
      ctx.moveTo(x, gy);
      ctx.lineTo(x + width, gy);
    }
    ctx.stroke();
    let colour = "";
    let [lastX, lastY] = [Number.NaN, Number.NaN];
    row.graph?.forEachSlot(now, seconds, (tick, low, high) => {
      const value = row.higherBetter ? low : high;
      const px = x + width - (newest - tick) * k;
      const py = y + height * (1 - graphHeight(value, row.range));
      const c = STAT_COLOURS[standing(value, row.good, row.bad, row.base)];
      if (c !== colour) {
        if (colour) ctx.stroke();
        colour = c;
        ctx.strokeStyle = c;
        ctx.beginPath();
        if (Number.isNaN(lastX)) ctx.moveTo(px, py);
        else ctx.moveTo(lastX, lastY);
      }
      ctx.lineTo(px, py);
      [lastX, lastY] = [px, py];
    });
    if (colour) ctx.stroke();
  }
}
