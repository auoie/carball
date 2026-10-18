// The chat log and the quick-chat panel (notes/quick-chat.md CHAT-13..15): the log top left, its lines as the game's
// ([M:SS] [TEAM] NAME: message), shown on a message and hidden 6 s after the last; the panel at the left's middle, its
// title, category and four rows.
import { CHAT_COLOURS, CHAT_PRESETS, CHAT_TEXT, type ChatGroup, TEAM_FONT_COLOURS, chatNameColour, chatTimestamp } from "../game/quickChat";
import type { RosterEntry } from "../net/protocol";
import { StageLayer } from "./stage";

/** The log (ChatLogViewMovie in its container at (10, 10)): its text at (22, 20), 350 x 185, 18 px with 23 px lines (8
 *  of them: RV-253); fades 0.3 s; hidden 6 s after the last line, 4 s after the scoreboard closes */
export const CHAT_LOG = {
  at: [32, 30] as const,
  size: [350, 185] as const,
  font: 18,
  line: 23,
  lines: 8,
  fade: 0.3,
  hideAfter: 6,
  afterScoreboard: 4,
} as const;

/** The panel (QuickChatViewMovie): x 24, centred vertically, about 140 tall; the title at (7, 10) 16 px #43AFFF, the
 *  category at (7, 25) 20 px white glowing #43AFFF, the rows from y 48, 24 apart: a 30 x 28 key box, the message 16 px
 *  #43AFFF in 200 x 22 at x + 33 (bold white when picked); its background at alpha 0.8 */
export const QUICK_CHAT_PANEL = {
  x: 24,
  height: 140,
  title: [7, 10, 16] as const,
  category: [7, 25, 20] as const,
  rows: 48,
  row: 24,
  key: [30, 28] as const,
  message: [33, 200, 22, 16] as const,
  accent: "#43AFFF",
  background: 0.8,
} as const;

/** A line of the log: who said it and how it reads */
export interface ChatLine {
  /** [M:SS] or empty */
  readonly timestamp: string;
  /** [TEAM] / [SPECTATOR] for a team channel's line, nothing for all */
  readonly channel: "team" | "spectator" | null;
  /** the sender's name (shown upper-case; "YOU" for one's own), its colour; null for a system line */
  readonly name: { readonly text: string; readonly colour: string } | null;
  readonly text: string;
  /** own lines #CCCCCC, others' white, system lines #FFED83 */
  readonly colour: string;
  /** A name the line starts with (system lines: "NAME joined the match"), kept apart from the text (RV-249) */
  readonly lead?: string;
}

/** A quick-chat line as the receiver shows it (AddPresetMessage, formatMessageEvent): the clock's seconds at relay as
 *  [M:SS] (+ in overtime, none once ended), [TEAM] for the team channel, the sender's name upper-case in their team's
 *  lightened colour (YOU, white, for one's own), the preset's text (own #CCCCCC, others' white) */
export function chatMessageLine(
  m: { readonly car: number; readonly preset: number; readonly team: boolean; readonly seconds: number },
  view: { readonly localCar: number; readonly roster: ReadonlyMap<number, RosterEntry>; readonly overtime: boolean; readonly ended: boolean },
): ChatLine {
  const own = m.car === view.localCar;
  const sender = view.roster.get(m.car);
  const colour = sender ? chatNameColour(TEAM_FONT_COLOURS[sender.team === 1 ? 1 : 0]) : CHAT_COLOURS.noTeam;
  return {
    timestamp: chatTimestamp(m.seconds, view.overtime, view.ended),
    channel: m.team ? "team" : null,
    name: own ? { text: CHAT_TEXT.you, colour: CHAT_COLOURS.others } : { text: sender?.name ?? "", colour },
    text: CHAT_PRESETS[m.preset]?.text ?? "",
    colour: own ? CHAT_COLOURS.own : CHAT_COLOURS.others,
  };
}

/** The log's lines for the players who came and went between two rosters ("NAME joined the match", "NAME left the
 *  match", or "NAME lost connection" for one whose connection timed out: [GFxHUD_TA] PlayerJoinString,
 *  PlayerLeaveString, PlayerTimedOutString); system lines */
export function rosterLines(before: ReadonlyMap<number, RosterEntry>, after: ReadonlyMap<number, RosterEntry>, lost: ReadonlySet<number>): ChatLine[] {
  const line = (lead: string, text: string): ChatLine => ({ timestamp: "", channel: null, name: null, lead, text, colour: CHAT_COLOURS.system });
  const lines: ChatLine[] = [];
  for (const [car, p] of before) if (!after.has(car)) lines.push(line(p.name, lost.has(car) ? CHAT_TEXT.lostConnection : CHAT_TEXT.left));
  for (const [car, p] of after) if (!before.has(car)) lines.push(line(p.name, CHAT_TEXT.joined));
  return lines;
}

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A line's HTML (formatMessageEvent): each part left out when empty, all of it escaped; names isolated in <bdi> (a
 *  name's direction controls can't turn the rest of the line: RV-249) */
export function chatLineHtml(line: ChatLine): string {
  const parts: string[] = [];
  if (line.timestamp) parts.push(`<span style="color:${CHAT_COLOURS.timestamp}">${escape(line.timestamp)}</span>`);
  if (line.channel) parts.push(`[${line.channel === "team" ? CHAT_TEXT.team : CHAT_TEXT.spectator}]`);
  if (line.name) parts.push(`<b style="color:${line.name.colour}"><bdi>${escape(line.name.text.toUpperCase())}</bdi>:</b>`);
  const lead = line.lead === undefined ? "" : `<bdi>${escape(line.lead)}</bdi> `;
  parts.push(`<span style="color:${line.colour}">${lead}${escape(line.text)}</span>`);
  return parts.join(" ");
}

/** The log in the page: lines appended at the bottom of its 8 lines, the first visual lines going off the top (a long
 *  message loses its first line, not all of it: RV-253); fading in 0.3 s from where it is on a line (RV-252), hidden 6 s
 *  after the last; held up while the menu is open, after the match and while the scoreboard is (real time) */
export class ChatLog {
  /** Its stage (its measures the movie's units, scaled with the screen: the user's finding, 2026-10-16) */
  readonly #layer: StageLayer;
  readonly #box: HTMLElement;
  readonly #lines: HTMLElement;
  #hideAt = -Infinity;
  #alpha = 0;
  #updated: number | null = null;

  constructor(root: HTMLElement) {
    const L = CHAT_LOG;
    this.#box = document.createElement("div");
    this.#box.id = "chat-log";
    Object.assign(this.#box.style, {
      position: "absolute",
      left: `${String(L.at[0])}px`,
      top: `${String(L.at[1])}px`,
      width: `${String(L.size[0])}px`,
      height: `${String(L.line * L.lines)}px`,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
      font: `${String(L.font)}px "Arial Narrow", Arial, sans-serif`,
      color: "#fff",
      lineHeight: `${String(L.line)}px`,
      textShadow: "0 0 6px #000, 0 0 2px #000",
      pointerEvents: "none",
      opacity: "0",
      wordWrap: "break-word",
    });
    this.#lines = document.createElement("div");
    this.#box.append(this.#lines);
    this.#layer = new StageLayer(root, "chat-layer");
    this.#layer.root.append(this.#box);
  }

  add(line: ChatLine, now: number): void {
    if (!line.text) return;
    const row = document.createElement("div");
    row.innerHTML = chatLineHtml(line);
    this.#lines.append(row);
    // (the lines wholly out of sight above go)
    const L = CHAT_LOG;
    while (this.#lines.childElementCount > 1 && this.#lines.offsetHeight - (this.#lines.firstElementChild as HTMLElement).offsetHeight >= L.line * L.lines) {
      this.#lines.firstElementChild?.remove();
    }
    this.#hideAt = Math.max(this.#hideAt, now + L.hideAfter);
  }

  /** Its opacity now, moving toward shown or hidden over 0.3 s from where it is. `hold`: kept up (the menu open, the
   *  match over: RV-254), hiding `release` s after the hold ends (the scoreboard's 4 s) */
  update(now: number, hold = false, release: number = CHAT_LOG.hideAfter): void {
    this.#layer.fit();
    const L = CHAT_LOG;
    if (hold) this.#hideAt = Math.max(this.#hideAt, now + release);
    const dt = this.#updated === null ? 0 : Math.max(0, now - this.#updated);
    this.#updated = now;
    const target = now < this.#hideAt ? 1 : 0;
    const step = dt / L.fade;
    this.#alpha = target > this.#alpha ? Math.min(target, this.#alpha + step) : Math.max(target, this.#alpha - step);
    this.#box.style.opacity = this.#alpha.toFixed(3);
  }

  /** Its lines' text, for tests */
  get lines(): string[] {
    return [...this.#lines.children].map((c) => c.textContent);
  }
}

/** The panel in the page, drawn from the menu's view */
export class QuickChatPanel {
  readonly #layer: StageLayer;
  readonly #box: HTMLElement;
  readonly #category: HTMLElement;
  readonly #rows: { key: HTMLElement; text: HTMLElement }[] = [];

  constructor(root: HTMLElement) {
    const P = QUICK_CHAT_PANEL;
    this.#box = document.createElement("div");
    this.#box.id = "quick-chat";
    Object.assign(this.#box.style, {
      position: "absolute",
      left: `${String(P.x)}px`,
      top: "50%",
      transform: "translateY(-50%)",
      width: `${String(P.message[0] + P.message[1] + 14)}px`,
      height: `${String(P.height)}px`,
      background: `rgba(8, 16, 32, ${String(P.background)})`,
      borderRadius: "4px",
      pointerEvents: "none",
      opacity: "0",
      font: '16px "Arial Narrow", Arial, sans-serif',
    });
    const at = (el: HTMLElement, x: number, y: number): HTMLElement => {
      Object.assign(el.style, { position: "absolute", left: `${String(x)}px`, top: `${String(y)}px` });
      return el;
    };
    const title = at(document.createElement("div"), P.title[0], P.title[1]);
    Object.assign(title.style, { color: P.accent, fontSize: `${String(P.title[2])}px`, textTransform: "uppercase", lineHeight: "1" });
    title.textContent = CHAT_TEXT.title;
    this.#category = at(document.createElement("div"), P.category[0], P.category[1]);
    Object.assign(this.#category.style, {
      color: "#fff",
      fontSize: `${String(P.category[2])}px`,
      textTransform: "uppercase",
      textShadow: `0 0 4px ${P.accent}`,
      lineHeight: "1",
    });
    this.#box.append(title, this.#category);
    for (let k = 0; k < 4; k++) {
      const y = P.rows + P.row * k;
      const key = at(document.createElement("div"), 7, y - 3);
      Object.assign(key.style, {
        width: `${String(P.key[0])}px`,
        height: `${String(P.key[1])}px`,
        lineHeight: `${String(P.key[1])}px`,
        textAlign: "center",
        color: "#fff",
        border: `1px solid ${P.accent}`,
        borderRadius: "3px",
        boxSizing: "border-box",
      });
      const text = at(document.createElement("div"), 7 + P.message[0], y);
      Object.assign(text.style, {
        width: `${String(P.message[1])}px`,
        height: `${String(P.message[2])}px`,
        color: P.accent,
        fontSize: `${String(P.message[3])}px`,
        whiteSpace: "nowrap",
        overflow: "hidden",
      });
      this.#box.append(key, text);
      this.#rows.push({ key, text });
    }
    this.#layer = new StageLayer(root, "quick-chat-layer");
    this.#layer.root.append(this.#box);
  }

  /** Drawn: the menu's view, the categories, each preset's text by key, the four keys' labels (1-4, or the pad's) */
  draw(
    view: { shown: number | null; selected: number | null; alpha: number },
    groups: readonly ChatGroup[],
    text: (key: string) => string,
    keys: readonly string[],
  ): void {
    this.#layer.fit();
    this.#box.style.opacity = String(view.alpha);
    const group = view.shown === null ? undefined : groups[view.shown];
    if (!group) return;
    this.#category.textContent = group.label;
    this.#rows.forEach((row, k) => {
      row.key.textContent = keys[k] ?? String(k + 1);
      row.text.textContent = text(group.keys[k] ?? "");
      const picked = view.selected === k;
      row.text.style.color = picked ? "#fff" : QUICK_CHAT_PANEL.accent;
      row.text.style.fontWeight = picked ? "bold" : "normal";
    });
  }
}
