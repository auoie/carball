// Forfeit votes (notes/match-rules-audit.md MR-7) and quick chat (notes/quick-chat.md), against a 2v2 casual
// carball-server whose votes are allowed once the clock runs (started by playwright.config.ts on ports 14437/14438; one file,
// so its tests take turns on it). Players join blue, orange, blue, ...
// (Under the suite's load a third page can take over 10 s to answer: the checks are on the first page, and the match's
// end is read from the phases it recorded, which outlast its 8.3 s podium.)
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ends, join as joinServer, leave, leaveAll, named, newPlayer as newServerPlayer } from "./players";
import type { Browser } from "@playwright/test";

const SERVER = "127.0.0.1:14438";
const join = (page: Page, errors: string[]): Promise<void> => joinServer(page, SERVER, errors);
const newPlayer = (browser: Browser, errors: string[], name?: string): Promise<Page> => newServerPlayer(browser, SERVER, errors, name);
/** The menu's match button (shown upper-case) */
const button = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(`^${label}$`, "i") });

const others: Page[] = [];

/** A quick-chat category's key, then wait for the panel to show it (shown, not just its text: that stays from the last
 *  time; a second key in the same frame would count as the first's) */
async function category(page: Page, key: string, label: string): Promise<void> {
  await page.keyboard.press(key);
  const panel = page.locator("#quick-chat");
  await expect(panel).toContainText(label, { timeout: 10_000 });
  await expect.poll(() => panel.evaluate((e) => Number((e as HTMLElement).style.opacity)), { timeout: 10_000 }).toBeGreaterThan(0.5);
}

test.afterEach(async ({ page }) => {
  await leaveAll(page, others);
});

test("a team votes to concede: the tally, a failed vote's lockout, a teammate's vote joined, then the forfeit", async ({ page, browser }) => {
  test.setTimeout(240_000); // (three pages joining under the suite's load)
  const errors: string[] = [];
  await join(page, errors);
  await expect(page.locator("#net")).toContainText("1 cars", { timeout: 30_000 }); // (alone: blue)
  const orange = await newPlayer(browser, errors);
  const mate = await newPlayer(browser, errors); // (blue)
  others.push(orange, mate);
  await expect(page.locator("#net")).toContainText("3 cars", { timeout: 30_000 });

  // The menu's one match button (RV-236): the vote once the clock runs (5 s after go: the 3 s warm-up and 4 s countdown
  // first), in leaving's place
  await page.keyboard.press("Escape");
  const vote = button(page, "Vote to Concede");
  await expect(vote).toBeVisible({ timeout: 40_000 });
  await expect(button(page, "Leave Match")).toBeHidden();
  await expect(vote).toHaveCSS("text-transform", "uppercase"); // (RV-268)
  // (the bar's flashes counted: one per new yes, RV-268)
  await page.evaluate(() => {
    const fill = document.querySelector<HTMLElement>("#vote-fill");
    if (!fill) return;
    const counter = window as unknown as { voteFlashes: number };
    counter.voteFlashes = 0;
    const animate = fill.animate.bind(fill);
    fill.animate = (...args: Parameters<HTMLElement["animate"]>): Animation => {
      counter.voteFlashes++;
      return animate(...args);
    };
  });
  await vote.click();
  await expect(page.locator("#pause-menu")).toBeHidden(); // (the vote closes the pause menu)

  // The team's widget: shown at once (no fade-in), its bar flashed; the tally and the time; no hint for the voter
  await expect(page.locator("#vote")).toHaveClass(/shown/, { timeout: 15_000 });
  await expect(page.locator("#vote")).toHaveCSS("transition-duration", "0s");
  await expect(page.locator("#vote")).toHaveCSS("opacity", "1");
  await expect.poll(() => page.evaluate(() => (window as unknown as { voteFlashes: number }).voteFlashes)).toBe(1);
  await expect(page.locator("#vote-tally")).toHaveText("Vote to Concede 1/2");
  await expect(page.locator("#vote-time")).toHaveText(/^0:(20|1\d|0\d)$/);
  await expect(page.locator("#vote-hint")).toBeHidden();

  // Nobody else votes: it fails at its 20 s, stays its 5 s and goes; its starter can't start another (the menu: leaving)
  await expect(page.locator("#vote")).not.toHaveClass(/shown/, { timeout: 45_000 });
  await page.keyboard.press("Escape");
  await expect(button(page, "Leave Match")).toBeVisible();
  await expect(button(page, "Vote to Concede")).toBeHidden();
  await page.keyboard.press("Escape");
  // ... nor after reloading its tab: its key from storage, the lockout on it (RV-265, RV-266; blue again, the old
  // session gone with the page)
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#net")).toContainText("3 cars", { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(button(page, "Leave Match")).toBeVisible({ timeout: 15_000 });
  await expect(button(page, "Vote to Concede")).toBeHidden();
  await page.keyboard.press("Escape");

  // The teammate starts one: the page sees it, with how to vote, and joins it from its menu; blue concedes
  await mate.keyboard.press("Escape");
  await button(mate, "Vote to Concede").click({ timeout: 30_000 });
  await expect(page.locator("#vote")).toHaveClass(/shown/, { timeout: 15_000 });
  await expect(page.locator("#vote-tally")).toHaveText("Vote to Concede 1/2");
  await expect(page.locator("#vote-hint")).toHaveText("Press Esc to Vote");
  await page.keyboard.press("Escape");
  await expect(button(page, "Vote to Concede")).toHaveClass(/danger/); // (red while one runs)
  await button(page, "Vote to Concede").click();
  await expect.poll(() => ends(page), { timeout: 15_000 }).toContainEqual({ winner: 1, forfeit: true });
  await expect.poll(() => ends(orange), { timeout: 30_000 }).toContainEqual({ winner: 1, forfeit: true });
  expect(errors).toEqual([]);
});

test("quick chat: the two presses, to all and to the team, names and comings and goings in the log", async ({ page, browser }) => {
  test.setTimeout(300_000); // (two pages, eight chat lines, the menu's mute and block)
  const errors: string[] = [];
  await named(page, "Merc");
  await join(page, errors);
  await expect(page.locator("#net")).toContainText("1 cars", { timeout: 30_000 }); // (alone: blue)
  const other = await newPlayer(browser, errors, "Ziggy"); // (orange)
  others.push(other);
  const log = page.locator("#chat-log");
  await expect(log).toContainText("Ziggy joined the match", { timeout: 30_000 });

  // 2 then 1: Compliments' first, "Nice shot!", to all; both see it, the sender as YOU, the clock before it
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" });
  await category(page, "Digit2", "Compliments");
  await page.keyboard.press("Digit1");
  await expect(log).toContainText(/\[\d:\d\d\] YOU: Nice shot!/, { timeout: 15_000 });
  await expect(other.locator("#chat-log")).toContainText(/\[\d:\d\d\] MERC: Nice shot!/, { timeout: 30_000 });
  // 1 then 1: Informational's first, "I got it!", to the team only (orange doesn't see it). (Each press seen by its own
  // frame: two inside one frame are one press)
  await category(page, "Digit1", "Informational");
  await page.keyboard.press("Digit1");
  await expect(log).toContainText("[TEAM] YOU: I got it!", { timeout: 15_000 });
  // (then a line to all, and once orange has it, the team line before it hasn't come: RV-258)
  await category(page, "Digit2", "Compliments");
  await page.keyboard.press("Digit2");
  await expect(other.locator("#chat-log")).toContainText("MERC: Great pass!", { timeout: 30_000 });
  await expect(other.locator("#chat-log")).not.toContainText("I got it!");

  // Blocking from the menu's player list: the button turns to Unblock, a toast confirms, and Ziggy's lines no longer
  // show here (they still do on Ziggy's page)
  await page.keyboard.press("Escape");
  await page.locator(".players-toggle").click();
  const row = page.locator(".player-row", { hasText: "Ziggy" });
  await row.locator("button[data-action=block]").click();
  await expect(row.locator("button[data-action=block]")).toHaveText("Unblock");
  await expect(page.locator("#toast")).toContainText("You have blocked Ziggy.");
  await page.keyboard.press("Escape");
  await other.locator("#game").click({ button: "right" }); // (its centre: this page is drawn small)
  await category(other, "Digit2", "Compliments");
  await other.keyboard.press("Digit4");
  await expect(other.locator("#chat-log")).toContainText("YOU: What a save!", { timeout: 15_000 });
  await page.waitForTimeout(1000);
  await expect(log).not.toContainText("What a save!");
  // Muting from Ziggy's side: the server keeps Merc's lines from Ziggy (a positive control: Merc's own line arrives)
  await other.keyboard.press("Escape");
  await other.locator(".players-toggle").click();
  await other.locator(".player-row", { hasText: "Merc" }).locator("button[data-action=mute]").click();
  await expect(other.locator(".player-row", { hasText: "Merc" }).locator("button[data-action=mute]")).toHaveText("Unmute");
  await other.keyboard.press("Escape");
  await page.waitForTimeout(3000); // (Merc's spam bucket drains)
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" });
  await category(page, "Digit2", "Compliments");
  await page.keyboard.press("Digit1");
  const line = (p: typeof page, text: string) => p.locator("#chat-log > div > div", { hasText: text });
  await expect(line(page, "YOU: Nice shot!")).toHaveCount(2, { timeout: 15_000 });
  await other.waitForTimeout(1500);
  await expect(line(other, "MERC: Nice shot!")).toHaveCount(1);
  // The other leaves: the log says so
  await leave(other);
  await expect(log).toContainText("Ziggy left the match", { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("the match's end: the winner banner, the podium with the winner's tag, the end screen, ready for the next match", async ({ page, browser }) => {
  test.setTimeout(240_000); // (two pages joining under the suite's load)
  const errors: string[] = [];
  await named(page, "Merc");
  await join(page, errors);
  await expect(page.locator("#net")).toContainText("1 cars", { timeout: 30_000 }); // (alone: blue)
  const orange = await newPlayer(browser, errors, "Ziggy"); // (orange, alone: its vote passes at once)
  others.push(orange);
  await expect(page.locator("#net")).toContainText("2 cars", { timeout: 30_000 });
  // Orange concedes once votes are allowed (this server: as soon as the clock runs)
  await orange.keyboard.press("Escape");
  await button(orange, "Vote to Concede").click({ timeout: 60_000 });
  // The winner banner (MIO-18/19): the win word over the team's name
  const banner = page.locator("#winner-banner");
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner.locator(".winner-label")).toHaveText("WINNER BY FORFEIT");
  await expect(banner.locator(".winner-team")).toHaveText("BLUE");
  await expect(page.locator("#score")).toBeHidden(); // (the HUD's match parts go: MIO-17)
  // The podium: the winner's car on it, its name under it (MIO-22); the banner raised
  await expect(page.locator(".podium-tag", { hasText: "Merc" })).toBeVisible({ timeout: 15_000 });
  await expect(banner.locator(".winner")).toHaveClass(/raised/);
  await page.screenshot({ path: "test-results/podium.png" });
  // The end screen (MIO-26, 31): the scoreboard with the winner stamp, the countdown, Ready; both ready: the next match
  const end = page.locator("#end-screen");
  await expect(end).toBeVisible({ timeout: 15_000 });
  await expect(end.locator(".end-countdown")).toContainText(/Next Match In \d+/, { timeout: 10_000 });
  await expect(page.locator("#scoreboard .sb-winner-stamp")).toHaveText("WINNER");
  await page.screenshot({ path: "test-results/end-screen.png" });
  await end.locator("button[data-action=ready]").click({ timeout: 10_000 });
  await expect(page.locator("#scoreboard .sb-local .sb-ready")).toBeVisible({ timeout: 10_000 });
  await orange.locator("#end-screen button[data-action=ready]").click({ timeout: 30_000 });
  await expect.poll(async () => (await phases(page)).at(-1), { timeout: 30_000 }).toBe("waiting");
  await expect(end).toBeHidden();
  expect(errors).toEqual([]);
});

/** The match phases the page saw, in order */
async function phases(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { carballOnline: () => { phases: { phase: string }[] } }).carballOnline().phases.map((p) => p.phase));
}

