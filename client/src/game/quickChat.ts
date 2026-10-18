// Quick chat as the game's (notes/quick-chat.md CHAT-1..21): the 76 presets (their English text verbatim, by the
// user's decision, but for the two naming the game, which name ours: "This is Carball!", "This isn't Carball!", the
// user's decision of 2026-10-15), the 24 slots and the four categories they make (category 1 replaced by the post-game set once the
// match has ended), the two-press menu and its timings, the server's spam bucket, and the chat log's line format.

/** A preset: its key (what the wire carries, as the game's ID), its group (1-6), its text */
export interface ChatPreset {
  readonly key: string;
  readonly group: number;
  readonly text: string;
}

/** The categories' names (ChatPresetGroups Group1-6) */
export const GROUP_LABELS = ["Informational", "Compliments", "Reactions", "Apologies", "Post Game", "Pre Game"] as const;

const TEXTS: readonly (readonly string[])[] = [
  [
    "I got it!",
    "Need boost!",
    "Take the shot!",
    "Defending...",
    "Go for it!",
    "Centering!",
    "All yours.",
    "In position.",
    "Incoming!",
    "Faking.",
    "Bumping!",
    "On your left.",
    "On your right.",
    "Passing!",
    "Rotating up!",
    "Rotating back!",
    "You have time!",
    "One more!",
    "Back post!",
    "Leaving.",
    "Oops, wrong quick chat!",
    "Rotating!",
  ],
  [
    "Nice shot!",
    "Great pass!",
    "Thanks!",
    "What a save!",
    "Nice one!",
    "What a play!",
    "Great clear!",
    "Nice block!",
    "Nice bump!",
    "Nice demo!",
    "We got this.",
  ],
  [
    "OMG!",
    "Noooo!",
    "Wow!",
    "Close one!",
    "No way!",
    "Holy cow!",
    "Whew.",
    "Siiiick!",
    "Calculated.",
    "Brutal!",
    "Okay.",
    "Yes!",
    "Unlucky!",
    "This isn't Carball!",
    "Oof.",
    "...",
    "Be careful!",
    "Let's lock in.",
  ],
  ["$#@%!", "No problem.", "Whoops...", "Sorry!", "My bad...", "Oops!", "My fault.", "All good!"],
  ["gg", "Well played.", "That was fun!", "Rematch!", "One. More. Game.", "What a game!", "Nice moves.", "Everybody dance!", "Party up?"],
  ["Good luck!", "Have fun!", "Get ready.", "This is Carball!", "Let's do this!", "Here. We. Go.", "Nice cars!", "I'll do my best."],
];

/** The 76 presets (CHAT-1), in the table's order: a preset's index there is its number on our wire */
export const CHAT_PRESETS: readonly ChatPreset[] = TEXTS.flatMap((texts, g) =>
  texts.map((text, m) => ({ key: `Group${String(g + 1)}Message${String(m + 1)}`, group: g + 1, text })),
);

/** A preset's index by its key (undefined for none) */
export function presetIndex(key: string): number | undefined {
  const i = CHAT_PRESETS.findIndex((p) => p.key === key);
  return i < 0 ? undefined : i;
}

/** Tactical: Group1, Group5 and Group6 (the Block Non-Tactical filter's rule, by the key: Group6Message4 bound in a
 *  match is tactical too) */
export function tactical(key: string): boolean {
  return /^Group[156]Message/.test(key);
}

/** The 24 slots' defaults (ProfileQuickChatSave_TA): slot i = Group(i / 4 + 1)Message(i % 4 + 1) */
export const DEFAULT_SLOTS: readonly string[] = Array.from({ length: 24 }, (_, i) => `Group${String(Math.floor(i / 4) + 1)}Message${String((i % 4) + 1)}`);

/** The pools the rebinding offers (CHAT-5): a slot of rows 1-4 from the in-match pool, row 5 post-game, row 6 pre-game */
export const POOLS = {
  match: [...CHAT_PRESETS.filter((p) => p.group <= 4).map((p) => p.key), "Group6Message4"],
  post: CHAT_PRESETS.filter((p) => p.group === 5).map((p) => p.key),
  pre: CHAT_PRESETS.filter((p) => p.group === 6).map((p) => p.key),
} as const;

/** The context: an ongoing match, the match ended (podium: category 1 is Post Game), the pre-match lobby (Pre Game) */
export type ChatContext = "match" | "ended" | "lobby";

/** A visible category: its label, team-only or not, its four presets' keys */
export interface ChatGroup {
  readonly label: string;
  readonly team: boolean;
  readonly keys: readonly string[];
}

/** The four categories shown (UpdateChatGroups, CHAT-2..4): category 1 the team's Informational, or the context's
 *  override (Post Game from slot 16, Pre Game from 20, to all); then Compliments, Reactions, Apologies, to all. The
 *  team flag is the slot's group's, not the message's */
export function visibleGroups(slots: readonly string[], context: ChatContext): ChatGroup[] {
  return [0, 1, 2, 3].map((g) => {
    const override =
      g === 0 && context !== "match" ? (context === "ended" ? { label: GROUP_LABELS[4], offset: 16 } : { label: GROUP_LABELS[5], offset: 20 }) : null;
    const offset = override?.offset ?? 4 * g;
    return {
      label: override?.label ?? GROUP_LABELS[g] ?? "",
      team: g === 0 && override === null,
      keys: [0, 1, 2, 3].map((k) => slots[offset + k] ?? DEFAULT_SLOTS[offset + k] ?? ""),
    };
  });
}

/** The menu's timings (QuickChatView, CHAT-8): shown over 0.25 s, then a 1.5 s timer; hidden over 0.2 s on timeout,
 *  0.8 s after a pick */
export const QUICK_CHAT_TIMING = { fadeIn: 0.25, window: 1.5, fadeTimeout: 0.2, fadePicked: 0.8 } as const;

/** What a press did */
export type QuickChatPress =
  { readonly kind: "open"; readonly group: number } | { readonly kind: "send"; readonly key: string; readonly team: boolean } | { readonly kind: "none" };

/** The two-press menu (CHAT-7, 8): the first press opens category i, the second (the same four keys) sends message i
 *  of it; the menu closes 1.75 s after the first press untouched. Real time (seconds); `available` gates both presses
 *  (online, not the end screen, no pause menu, not typing: CHAT-9) */
export class QuickChatMenu {
  #open: number | null = null;
  /** When the menu was opened, and when it began to hide (with its fade) */
  #openedAt = 0;
  #hiding: { at: number; fade: number } | null = null;
  #selected: number | null = null;

  press(i: number, now: number, groups: readonly ChatGroup[], available = true): QuickChatPress {
    this.#expire(now);
    if (!available) return { kind: "none" };
    if (this.#open === null) {
      this.#open = i;
      this.#openedAt = now;
      this.#hiding = null;
      this.#selected = null;
      return { kind: "open", group: i };
    }
    const group = groups[this.#open];
    this.#selected = i;
    this.#hide(now, QUICK_CHAT_TIMING.fadePicked);
    const key = group?.keys[i];
    return group && key ? { kind: "send", key, team: group.team } : { kind: "none" };
  }

  /** The open category (null when hidden or hiding), the selected row, and the panel's alpha now */
  view(now: number): { group: number | null; shown: number | null; selected: number | null; alpha: number } {
    this.#expire(now);
    const T = QUICK_CHAT_TIMING;
    if (this.#open !== null) return { group: this.#open, shown: this.#open, selected: null, alpha: Math.min(1, (now - this.#openedAt) / T.fadeIn) };
    if (this.#hiding) {
      const alpha = Math.max(0, 1 - (now - this.#hiding.at) / this.#hiding.fade);
      return { group: null, shown: alpha > 0 ? this.#shown : null, selected: this.#selected, alpha };
    }
    return { group: null, shown: null, selected: null, alpha: 0 };
  }

  /** Closed, as when the pause menu opens */
  close(now: number): void {
    if (this.#open !== null) this.#hide(now, QUICK_CHAT_TIMING.fadeTimeout);
  }

  #shown: number | null = null;

  #hide(now: number, fade: number): void {
    this.#shown = this.#open;
    this.#open = null;
    this.#hiding = { at: now, fade };
  }

  #expire(now: number): void {
    const T = QUICK_CHAT_TIMING;
    if (this.#open !== null && now - this.#openedAt >= T.fadeIn + T.window) this.#hide(this.#openedAt + T.fadeIn + T.window, T.fadeTimeout);
  }
}

/** The server's spam bucket (ApplyChatSpamFilter, CHAT-10..12): the server's twin, for tests and the notice */
export const CHAT_SPAM = { rise: 1.2, multiplier: 0.75, decay: 1, max: 4 } as const;

export class SpamBucket {
  #value = 0;
  #last = 0;
  constructor(readonly rule: { readonly rise: number; readonly multiplier: number; readonly decay: number; readonly max: number } = CHAT_SPAM) {}

  /** A message at real time `now`: null when it passes, else the seconds until chat is allowed again (the blocked
   *  attempt decays the bucket but adds nothing) */
  apply(now: number): number | null {
    const r = this.rule;
    this.#value = Math.max(this.#value - r.decay * (now - this.#last), 0);
    this.#last = now;
    if (this.#value > r.max) return (this.#value - r.max) / r.decay;
    this.#value += r.rise + this.#value * r.multiplier;
    return null;
  }
}

/** The chat log's timestamp (FormatTimeStamp, CHAT-16): [M:SS] of the clock at relay, + in overtime, none once the
 *  match has ended */
export function chatTimestamp(seconds: number, overtime: boolean, ended: boolean): string {
  if (ended) return "";
  const t = Math.max(0, Math.floor(seconds));
  const m = Math.floor(t / 60);
  return `[${overtime ? "+" : ""}${String(m)}:${String(t - 60 * m).padStart(2, "0")}]`;
}

/** A team's name colour in the log (CHAT-15): min(255, 2c) + (0x55, 0x22, 0x55) per channel, clamped; c the team's
 *  font colour (0-255) */
export function chatNameColour(c: readonly [number, number, number]): string {
  const add = [0x55, 0x22, 0x55];
  return `#${c
    .map((v, k) =>
      Math.min(255, Math.min(255, 2 * v) + (add[k] ?? 0))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

/** The teams' font colours (HUD-1: blue #002DBF, orange #B23D00), which chatNameColour lightens to #557CFF / #FF9C55 */
export const TEAM_FONT_COLOURS = [
  [0x00, 0x2d, 0xbf],
  [0xb2, 0x3d, 0x00],
] as const;

/** A preset's text by its key ("" for none) */
export function presetText(key: string): string {
  return CHAT_PRESETS.find((p) => p.key === key)?.text ?? "";
}

/** The log's colours (CHAT-15): timestamps, own text and spectators' names #CCCCCC; system lines #FFED83 */
export const CHAT_COLOURS = { timestamp: "#CCCCCC", own: "#CCCCCC", noTeam: "#CCCCCC", others: "#FFFFFF", system: "#FFED83" } as const;

/** The chat log's text (CHAT-14, 15 and the chat UI text, verbatim): the tags, the spam notice */
export const CHAT_TEXT = {
  title: "Quick Chat",
  team: "TEAM",
  spectator: "SPECTATOR",
  you: "YOU",
  joined: "joined the match",
  left: "left the match",
  lostConnection: "lost connection",
  disabled: (seconds: number): string => `Chat disabled for ${String(Math.ceil(seconds))} second(s).`,
} as const;
