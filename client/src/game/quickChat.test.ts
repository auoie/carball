// Quick chat's rules (notes/quick-chat.md): the presets and their categories, the slots and the context override, the
// two-press menu's timings, the spam bucket's outcomes (CHAT-12) and the log's format.
import { describe, expect, it } from "vitest";
import {
  CHAT_PRESETS,
  CHAT_SPAM,
  CHAT_TEXT,
  DEFAULT_SLOTS,
  POOLS,
  QUICK_CHAT_TIMING,
  QuickChatMenu,
  SpamBucket,
  chatNameColour,
  chatTimestamp,
  presetIndex,
  tactical,
  visibleGroups,
} from "./quickChat";

describe("the presets (CHAT-1, 2, 5)", () => {
  it("76 of them in six groups (22, 11, 18, 8, 9, 8), keyed GroupNMessageM, their text the game's", () => {
    expect(CHAT_PRESETS).toHaveLength(76);
    expect([1, 2, 3, 4, 5, 6].map((g) => CHAT_PRESETS.filter((p) => p.group === g).length)).toEqual([22, 11, 18, 8, 9, 8]);
    const text = (key: string): string | undefined => CHAT_PRESETS.find((p) => p.key === key)?.text;
    expect(text("Group1Message1")).toBe("I got it!");
    expect(text("Group1Message21")).toBe("Oops, wrong quick chat!");
    expect(text("Group3Message14")).toBe("This isn't Carball!"); // (the two naming the game name ours: the user's decision)
    expect(text("Group6Message4")).toBe("This is Carball!");
    expect(text("Group4Message1")).toBe("$#@%!");
    expect(text("Group5Message1")).toBe("gg");
    expect(text("Group6Message8")).toBe("I'll do my best.");
    expect(presetIndex("Group2Message1")).toBe(22);
    expect(presetIndex("Group7Message1")).toBeUndefined();
  });

  it("tactical: groups 1, 5 and 6 (Group6Message4 too, wherever bound); the pools as the rebinding's", () => {
    expect(["Group1Message3", "Group5Message9", "Group6Message4"].every(tactical)).toBe(true);
    expect(["Group2Message1", "Group3Message18", "Group4Message8"].some(tactical)).toBe(false);
    expect([POOLS.match.length, POOLS.post.length, POOLS.pre.length]).toEqual([60, 9, 8]);
    expect(POOLS.match).toContain("Group6Message4");
  });
});

describe("the slots and categories (CHAT-3, 4)", () => {
  it("in a match: Informational to the team, the rest to all; the default slots", () => {
    const groups = visibleGroups(DEFAULT_SLOTS, "match");
    expect(groups.map((g) => g.label)).toEqual(["Informational", "Compliments", "Reactions", "Apologies"]);
    expect(groups.map((g) => g.team)).toEqual([true, false, false, false]);
    expect(groups[0]?.keys).toEqual(["Group1Message1", "Group1Message2", "Group1Message3", "Group1Message4"]);
    expect(groups[3]?.keys).toEqual(["Group4Message1", "Group4Message2", "Group4Message3", "Group4Message4"]);
  });

  it("once the match has ended category 1 is Post Game (slots 16-19, to all); in the lobby Pre Game (20-23)", () => {
    const ended = visibleGroups(DEFAULT_SLOTS, "ended");
    expect(ended[0]).toEqual({ label: "Post Game", team: false, keys: ["Group5Message1", "Group5Message2", "Group5Message3", "Group5Message4"] });
    expect(ended[1]?.label).toBe("Compliments");
    expect(visibleGroups(DEFAULT_SLOTS, "lobby")[0]?.keys).toEqual(["Group6Message1", "Group6Message2", "Group6Message3", "Group6Message4"]);
  });

  it("team or all is the slot's group's: a compliment rebound into category 1 goes to the team", () => {
    const slots = [...DEFAULT_SLOTS];
    slots[0] = "Group2Message1";
    slots[4] = "Group1Message1";
    const [first, second] = visibleGroups(slots, "match");
    expect([first?.keys[0], first?.team]).toEqual(["Group2Message1", true]);
    expect([second?.keys[0], second?.team]).toEqual(["Group1Message1", false]);
  });
});

describe("the two-press menu (CHAT-7, 8)", () => {
  const groups = visibleGroups(DEFAULT_SLOTS, "match");
  const T = QUICK_CHAT_TIMING;

  it("the first press opens a category, the second sends its message (1, 1: I got it!, to the team)", () => {
    const menu = new QuickChatMenu();
    expect(menu.press(0, 10, groups)).toEqual({ kind: "open", group: 0 });
    // (at once, even during the fade-in)
    expect(menu.press(0, 10.1, groups)).toEqual({ kind: "send", key: "Group1Message1", team: true });
    // (then it fades out over 0.8 s, the pick shown)
    expect(menu.view(10.5)).toMatchObject({ group: null, shown: 0, selected: 0 });
    expect(menu.view(10.5).alpha).toBeCloseTo(0.5, 6);
    expect(menu.view(11).alpha).toBe(0);
  });

  it("untouched it closes 1.75 s after the first press; a press then opens a category again", () => {
    const menu = new QuickChatMenu();
    menu.press(2, 0, groups);
    expect(menu.view(T.fadeIn / 2).alpha).toBeCloseTo(0.5, 6);
    expect(menu.view(1.74).group).toBe(2);
    expect(menu.view(1.76).group).toBeNull();
    expect(menu.press(1, 1.8, groups)).toEqual({ kind: "open", group: 1 });
    expect(menu.press(3, 1.9, groups)).toEqual({ kind: "send", key: "Group2Message4", team: false });
  });

  it("a press while it fades out after a pick starts a new menu; none while unavailable", () => {
    const menu = new QuickChatMenu();
    menu.press(1, 0, groups);
    menu.press(1, 0.5, groups);
    expect(menu.press(3, 0.7, groups)).toEqual({ kind: "open", group: 3 });
    expect(new QuickChatMenu().press(0, 0, groups, false)).toEqual({ kind: "none" });
  });
});

describe("the spam bucket (CHAT-10..12)", () => {
  it("from rest a burst of three; the fourth blocked for 2.975 s (the notice: 3 second(s))", () => {
    const b = new SpamBucket();
    expect([b.apply(0), b.apply(0), b.apply(0)]).toEqual([null, null, null]);
    const wait = b.apply(0);
    expect(wait).toBeCloseTo(2.975, 9);
    expect(CHAT_TEXT.disabled(wait ?? 0)).toBe("Chat disabled for 3 second(s).");
  });

  it("one every 1.2 s holds; faster blocks", () => {
    const steady = new SpamBucket();
    for (let k = 0; k < 50; k++) expect(steady.apply(1.2 * k)).toBeNull();
    const fast = new SpamBucket();
    const blocked = Array.from({ length: 50 }, (_, k) => fast.apply(k)).some((w) => w !== null);
    expect(blocked).toBe(true);
  });

  it("sending as soon as allowed: three at 0, then 2.975, 7.175, 11.375; at most five in any 10 s", () => {
    const b = new SpamBucket();
    const sent: number[] = [];
    // (each retry when the notice says)
    for (let t = 0; t <= 20; ) {
      const wait = b.apply(t);
      if (wait === null) sent.push(t);
      else t += wait + 1e-9;
    }
    [0, 0, 0, 2.975, 7.175, 11.375].forEach((want, k) => {
      expect(sent[k]).toBeCloseTo(want, 6);
    });
    for (const t of sent) expect(sent.filter((s) => s >= t && s < t + 10).length).toBeLessThanOrEqual(5);
  });

  it("the harsh bucket (chat-banned quick chat): the first free, the next 5 s on, the one after 10.4 s later", () => {
    const b = new SpamBucket({ ...CHAT_SPAM, rise: 9, multiplier: 0.35 });
    expect(b.apply(0)).toBeNull();
    expect(b.apply(4.99)).not.toBeNull();
    expect(b.apply(5)).toBeNull();
    expect(b.apply(15.39)).not.toBeNull();
    expect(b.apply(15.4)).toBeNull();
  });
});

describe("the chat log's format (CHAT-15, 16)", () => {
  it("[M:SS] of the clock, + in overtime, none once ended", () => {
    expect(chatTimestamp(300, false, false)).toBe("[5:00]");
    expect(chatTimestamp(65.7, false, false)).toBe("[1:05]");
    expect(chatTimestamp(5, true, false)).toBe("[+0:05]");
    expect(chatTimestamp(65, false, true)).toBe("");
  });

  it("the teams' names lightened: blue #557CFF, orange #FF9C55 (from their font colours #002DBF, #B23D00)", () => {
    expect(chatNameColour([0x00, 0x2d, 0xbf])).toBe("#557CFF");
    expect(chatNameColour([0xb2, 0x3d, 0x00])).toBe("#FF9C55");
  });
});
