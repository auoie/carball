// The chat log's lines as the game's (notes/quick-chat.md CHAT-15): [M:SS] [TEAM] NAME: message, parts left out when
// empty, escaped.
import { describe, expect, it } from "vitest";
import { CHAT_COLOURS, CHAT_TEXT } from "../game/quickChat";
import type { RosterEntry } from "../net/protocol";
import { chatLineHtml, chatMessageLine, rosterLines } from "./chatLog";

const text = (html: string): string => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&amp;/g, "&");

describe("the chat log's lines (CHAT-15)", () => {
  it("[M:SS] [TEAM] NAME: message; the name upper-case", () => {
    const html = chatLineHtml({ timestamp: "[4:12]", channel: "team", name: { text: "Merc", colour: "#557CFF" }, text: "Need boost!", colour: CHAT_COLOURS.others });
    expect(text(html)).toBe("[4:12] [TEAM] MERC: Need boost!");
    expect(html).toContain('color:#557CFF">MERC:');
  });

  it("all-chat has no tag; once ended no timestamp; a system line no name; text escaped", () => {
    expect(text(chatLineHtml({ timestamp: "", channel: null, name: { text: CHAT_TEXT.you, colour: "#FFFFFF" }, text: "gg", colour: CHAT_COLOURS.own }))).toBe("YOU: gg");
    const notice = chatLineHtml({ timestamp: "", channel: null, name: null, text: CHAT_TEXT.disabled(2.2), colour: CHAT_COLOURS.system });
    expect(text(notice)).toBe("Chat disabled for 3 second(s).");
    expect(notice).toContain(CHAT_COLOURS.system);
    expect(chatLineHtml({ timestamp: "", channel: null, name: null, text: "<b>x</b> & y", colour: "#fff" })).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
  });

  it("a quick-chat message's line: the sender's name and team colour, YOU for one's own, the clock (CHAT-15, 16)", () => {
    const roster = new Map<number, RosterEntry>([
      [1, { car: 1, team: 0, name: "Merc" }],
      [2, { car: 2, team: 1, name: "Ziggy" }],
    ]);
    const view = { localCar: 1, roster, overtime: false, ended: false };
    const theirs = chatMessageLine({ car: 2, preset: 22, team: false, seconds: 251 }, view);
    expect(text(chatLineHtml(theirs))).toBe("[4:11] ZIGGY: Nice shot!");
    expect(theirs.name?.colour).toBe("#FF9C55");
    const mine = chatMessageLine({ car: 1, preset: 0, team: true, seconds: 65 }, { ...view, overtime: true });
    expect(text(chatLineHtml(mine))).toBe("[+1:05] [TEAM] YOU: I got it!");
    expect(mine.colour).toBe(CHAT_COLOURS.own);
    expect(text(chatLineHtml(chatMessageLine({ car: 2, preset: 59, team: false, seconds: 0 }, { ...view, ended: true })))).toBe("ZIGGY: gg");
  });

  it("players coming and going: joined, left, or lost connection (system lines)", () => {
    const a: RosterEntry = { car: 1, team: 0, name: "Merc" };
    const b: RosterEntry = { car: 2, team: 1, name: "Ziggy" };
    const c: RosterEntry = { car: 3, team: 1, name: "Bo" };
    const lines = rosterLines(new Map([[1, a], [2, b]]), new Map([[1, a], [3, c]]), new Set());
    expect(lines.map((l) => l.text)).toEqual(["Ziggy left the match", "Bo joined the match"]);
    expect(lines.every((l) => l.colour === CHAT_COLOURS.system && l.name === null)).toBe(true);
    expect(rosterLines(new Map([[2, b]]), new Map(), new Set([2])).map((l) => l.text)).toEqual(["Ziggy lost connection"]);
  });
});
