// The chat log and the quick-chat panel (notes/quick-chat.md CHAT-13..15): the log top left, its lines as the game's
// ([M:SS] [TEAM] NAME: message), shown on a message and hidden 6 s after the last; the panel at the left's middle, its
// title, category and four rows.
import { CHAT_COLOURS, CHAT_PRESETS, CHAT_TEXT, type ChatGroup, TEAM_FONT_COLOURS, chatNameColour, chatTimestamp } from "../game/quickChat";
import type { RosterEntry } from "../net/protocol";

/** The log (ChatLogViewMovie in its container at (10, 10)): its text at (22, 20), 350 x 185, 18 px; fades 0.3 s; hidden
 *  6 s after the last line */
export const CHAT_LOG = { at: [32, 30] as const, size: [350, 185] as const, font: 18, fade: 0.3, hideAfter: 6 } as const;

/** The panel (QuickChatViewMovie): x 24, centred vertically, about 140 tall; the title at (7, 10) 16 px #43AFFF, the
 *  category at (7, 25) 20 px white glowing #43AFFF, the rows from y 48, 24 apart: a 30 x 28 key box, the message 16 px
 *  #43AFFF in 200 x 22 at x + 33 (bold white when picked); its background at alpha 0.8 */
export const QUICK_CHAT_PANEL = { x: 24, height: 140, title: [7, 10, 16] as const, category: [7, 25, 20] as const, rows: 48, row: 24, key: [30, 28] as const, message: [33, 200, 22, 16] as const, accent: "#43AFFF", background: 0.8 } as const;

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
  const line = (text: string): ChatLine => ({ timestamp: "", channel: null, name: null, text, colour: CHAT_COLOURS.system });
  const lines: ChatLine[] = [];
  for (const [car, p] of before) if (!after.has(car)) lines.push(line(`${p.name} ${lost.has(car) ? CHAT_TEXT.lostConnection : CHAT_TEXT.left}`));
  for (const [car, p] of after) if (!before.has(car)) lines.push(line(`${p.name} ${CHAT_TEXT.joined}`));
  return lines;
}

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A line's HTML (formatMessageEvent): each part left out when empty, all of it escaped */
export function chatLineHtml(line: ChatLine): string {
  const parts: string[] = [];
  if (line.timestamp) parts.push(`<span style="color:${CHAT_COLOURS.timestamp}">${escape(line.timestamp)}</span>`);
  if (line.channel) parts.push(`[${line.channel === "team" ? CHAT_TEXT.team : CHAT_TEXT.spectator}]`);
  if (line.name) parts.push(`<b style="color:${line.name.colour}">${escape(line.name.text.toUpperCase())}:</b>`);
  parts.push(`<span style="color:${line.colour}">${escape(line.text)}</span>`);
  return parts.join(" ");
}

/** The log in the page: lines appended, the oldest dropped while it overflows its 185 px; shown 0.3 s on a line, hidden
 *  6 s after the last (real time) */
export class ChatLog {
  readonly #box: HTMLElement;
  #last = -Infinity;

  constructor(root: HTMLElement) {
    const L = CHAT_LOG;
    this.#box = document.createElement("div");
    this.#box.id = "chat-log";
    Object.assign(this.#box.style, {
      position: "absolute",
      left: `${String(L.at[0])}px`,
      top: `${String(L.at[1])}px`,
      width: `${String(L.size[0])}px`,
      maxHeight: `${String(L.size[1])}px`,
      overflow: "hidden",
      font: `${String(L.font)}px "Arial Narrow", Arial, sans-serif`,
      color: "#fff",
      lineHeight: "1.1",
      textShadow: "0 0 6px #000, 0 0 2px #000",
      pointerEvents: "none",
      opacity: "0",
      wordWrap: "break-word",
    });
    root.append(this.#box);
  }

  add(line: ChatLine, now: number): void {
    if (!line.text) return;
    const row = document.createElement("div");
    row.innerHTML = chatLineHtml(line);
    this.#box.append(row);
    while (this.#box.scrollHeight > CHAT_LOG.size[1] && this.#box.childElementCount > 1) this.#box.firstElementChild?.remove();
    this.#last = now;
  }

  /** Its opacity now (fading in from the last line, out 6 s after it) */
  update(now: number): void {
    const L = CHAT_LOG;
    const since = now - this.#last;
    const alpha = since < L.fade ? since / L.fade : since < L.hideAfter ? 1 : Math.max(0, 1 - (since - L.hideAfter) / L.fade);
    this.#box.style.opacity = String(alpha);
  }

  /** Its lines' text, for tests */
  get lines(): string[] {
    return [...this.#box.children].map((c) => c.textContent);
  }
}

/** The panel in the page, drawn from the menu's view */
export class QuickChatPanel {
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
    Object.assign(this.#category.style, { color: "#fff", fontSize: `${String(P.category[2])}px`, textTransform: "uppercase", textShadow: `0 0 4px ${P.accent}`, lineHeight: "1" });
    this.#box.append(title, this.#category);
    for (let k = 0; k < 4; k++) {
      const y = P.rows + P.row * k;
      const key = at(document.createElement("div"), 7, y - 3);
      Object.assign(key.style, { width: `${String(P.key[0])}px`, height: `${String(P.key[1])}px`, lineHeight: `${String(P.key[1])}px`, textAlign: "center", color: "#fff", border: `1px solid ${P.accent}`, borderRadius: "3px", boxSizing: "border-box" });
      const text = at(document.createElement("div"), 7 + P.message[0], y);
      Object.assign(text.style, { width: `${String(P.message[1])}px`, height: `${String(P.message[2])}px`, color: P.accent, fontSize: `${String(P.message[3])}px`, whiteSpace: "nowrap", overflow: "hidden" });
      this.#box.append(key, text);
      this.#rows.push({ key, text });
    }
    root.append(this.#box);
  }

  /** Drawn: the menu's view, the categories, each preset's text by key, the four keys' labels (1-4, or the pad's) */
  draw(view: { shown: number | null; selected: number | null; alpha: number }, groups: readonly ChatGroup[], text: (key: string) => string, keys: readonly string[]): void {
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
