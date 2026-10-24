// The real flows end to end against the services (stacks.ts' "flows" stack: the accounts service with its database, two
// game servers, Region A and Region B, whose forfeit votes open at once): a sign-up through the page's own screen and a
// returning sign-in; a matched 1v1 conceded, its result recorded and both ratings moved; a 1v1 abandoned, the leaver's
// ban line under Find Match; a 2v2 rejoin refused at the other region's server (the accounts service asked: the match
// is elsewhere, RV-1008) and let in at its own. Nothing drawn (`?render=off`).
import { randomBytes, randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, hideGamepads, tickPlaylists } from "../fixtures";
import { ends } from "../players";
import { STACKS, signIn, test } from "./fixtures";

test.use({ baseURL: STACKS.flows.origin });
// (one at a time: the stack's searches would match one test's players with another's)
test.describe.configure({ mode: "serial" });

const A = "region-a";
const B = "region-b";

/** Each test's browser contexts, closed at its end */
const opened: BrowserContext[] = [];
test.afterEach(async () => {
  for (const context of opened.splice(0)) await context.close();
});

async function newContext(browser: Browser, viewport = { width: 640, height: 360 }): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport });
  opened.push(context);
  await hideGamepads(context);
  return context;
}

/** A page of the context on the main menu, its errors collected */
async function menuPage(context: BrowserContext, errors: string[]): Promise<Page> {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  return page;
}

/** A player signed in to an account of their own, on the main menu: its page and account id */
async function player(browser: Browser, label: string, errors: string[]): Promise<{ page: Page; account: string }> {
  const context = await newContext(browser);
  const { account } = await signIn(context, label);
  return { page: await menuPage(context, errors), account };
}

/** Play, Region A alone ticked (the player's own choice: both regions measured first), the playlist, Find Match */
async function findMatch(page: Page, playlist: string): Promise<void> {
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click({ timeout: 30_000 });
  const region = (id: string) => menu.locator(`.main-menu-region[data-region="${id}"]`);
  for (const id of [A, B]) await expect(region(id).locator(".main-menu-ping")).toHaveText(/^\d+ ms$/, { timeout: 15_000 });
  if ((await region(A).getAttribute("aria-checked")) !== "true") await region(A).click();
  if ((await region(B).getAttribute("aria-checked")) !== "true") await region(B).click();
  await region(B).click();
  await expect(region(A)).toHaveAttribute("aria-checked", "true");
  await expect(region(B)).toHaveAttribute("aria-checked", "false");
  await tickPlaylists(menu, [playlist]);
  await menu.getByRole("button", { name: /^find match$/i }).click();
}

/** On the match's page with `n` cars */
async function inMatch(page: Page, n: number): Promise<void> {
  await page.waitForURL(/[?&]match(&|$)/, { timeout: 30_000 });
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#net")).toContainText(`${String(n)} cars`, { timeout: 30_000 });
}

/** Back to the main menu from a match that's over, by its address (a modal the match's end left, its connection gone
 *  with the page, dismissed) */
async function toMenu(page: Page): Promise<void> {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  const ok = page.locator("#modal").getByRole("button", { name: /^ok$/i });
  if (await ok.isVisible()) await ok.click();
}

const pauseButton = (page: Page, label: string) => page.locator("#pause-menu").getByRole("button", { name: new RegExp(`^${label}$`, "i") });

/** The account's 1v1 rating as the Play page shows it (a provisional one with its "?"), read back to the main menu */
async function rating(page: Page): Promise<string> {
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click({ timeout: 30_000 });
  const text = (await menu.locator('.main-menu-playlist[data-playlist="1"] .main-menu-rating').textContent()) ?? "";
  await menu.getByRole("button", { name: /^back$/i }).click();
  return text;
}

test("signs up through the page's sign-up screen, searches signed in, signs out and back in", async ({ browser }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  // (the account's page at the size the accounts spec gives it: all of it in view)
  const context = await newContext(browser, { width: 1280, height: 720 });
  const subject = `e2e-${randomUUID()}`;
  // (a new identity back from its provider, as a callback leaves it: the sign-up's cookie, then the page's /?signup)
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/healthz");
  const status = await page.evaluate(
    async (body) => {
      const response = await fetch("/api/e2e/sign-up", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Carball": "1" },
        body: JSON.stringify(body),
      });
      return response.status;
    },
    { subject, suggestion: "Made Up" },
  );
  expect(status).toBe(204);
  await page.goto("/?signup&render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  const menu = page.locator("#main-menu");
  const account = menu.locator(".main-menu-account-view");
  await expect(account.locator(".main-menu-heading")).toHaveText("Create Account", { timeout: 15_000 });
  const input = account.locator(".account-input");
  await expect(input).toHaveValue("Made Up");
  const name = `Flows ${randomBytes(3).toString("hex")}`;
  await input.fill(name);
  await account.getByRole("button", { name: "Create Account" }).click();
  await expect(account.locator(".account-name")).toHaveText(name);
  await account.getByRole("button", { name: "Back" }).click();
  const entry = menu.locator(".main-menu-account");
  await expect(entry).toHaveText(name);
  // (signed in: Find Match searches, the account's search the matchmaker's; cancelled)
  await findMatch(page, "3v3");
  await expect(page.locator("#search-banner .search-summary")).toHaveText("Searching", { timeout: 15_000 });
  await page.locator("#search-banner .search-cancel").click();
  await expect(page.locator("#search-banner")).toBeHidden();
  // Sign Out (from the main menu's entry): Sign In; the same identity signing in again: the same account, its name kept
  await menu.getByRole("button", { name: /^back$/i }).click();
  await entry.click();
  await account.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(entry).toHaveText("Sign In");
  await signIn(context, "Unused", subject);
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await expect(entry).toHaveText(name);
  expect(errors).toEqual([]);
});

test("a matched 1v1 conceded: the forfeit its result, the winner's rating up and the loser's down, neither banned", async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const winner = await player(browser, "Flows Win", errors);
  const loser = await player(browser, "Flows Lose", errors);
  await findMatch(winner.page, "1v1");
  await findMatch(loser.page, "1v1");
  for (const p of [winner.page, loser.page]) await inMatch(p, 2);
  // (a 1v1's forfeit once the clock runs, asked first in the pause menu: a team of one's vote passing at once)
  await loser.page.keyboard.press("Escape");
  await pauseButton(loser.page, "Forfeit Match").click({ timeout: 40_000 });
  await pauseButton(loser.page, "Yes").click();
  for (const p of [winner.page, loser.page]) {
    await expect.poll(async () => (await ends(p)).some((e) => e.forfeit), { timeout: 30_000 }).toBe(true);
  }
  // Back on the menu: the result recorded, the ratings moved apart from a new account's 1500, provisional still
  for (const p of [winner.page, loser.page]) await toMenu(p);
  const won = async (): Promise<number> => parseInt(await rating(winner.page), 10);
  await expect.poll(won, { timeout: 40_000 }).toBeGreaterThan(1500);
  const lost = parseInt(await rating(loser.page), 10);
  expect(lost).toBeLessThan(1500);
  expect(await rating(winner.page)).toMatch(/^\d+\?$/);
  for (const p of [winner.page, loser.page]) await expect(p.locator("#main-menu .main-menu-ban")).toBeHidden();
  expect(errors).toEqual([]);
});

test("a 1v1 left: the leaver reported, its ban line under Find Match; the other's win recorded", async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const stays = await player(browser, "Flows Stay", errors);
  const leaves = await player(browser, "Flows Leave", errors);
  await findMatch(stays.page, "1v1");
  await findMatch(leaves.page, "1v1");
  for (const p of [stays.page, leaves.page]) await inMatch(p, 2);
  // (its page gone with every seat filled: an armed leave, reported; a forfeit vote's menu button not needed, this stack's
  // votes open as the clock runs)
  const context = leaves.page.context();
  await leaves.page.close();
  const back = await menuPage(context, errors);
  // The leaver's Play page: the ban's line (the game server's report, the service's first step: 5 minutes)
  const menu = back.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click({ timeout: 30_000 });
  await expect(menu.locator(".main-menu-ban")).toHaveText(/^you left a ranked match: you can search again in [45] minutes$/, { timeout: 40_000 });
  // (the one who stayed: its win, its team left without players)
  await expect.poll(async () => (await ends(stays.page)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await toMenu(stays.page);
  await expect.poll(async () => parseInt(await rating(stays.page), 10), { timeout: 40_000 }).toBeGreaterThan(1500);
  await expect(stays.page.locator("#main-menu .main-menu-ban")).toBeHidden();
  expect(errors).toEqual([]);
});

test("a 2v2 left by accident: a rejoin at the other region's server refused (the service asked: the match is elsewhere, RV-1008), at its own let in", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const players = [];
  for (let i = 0; i < 4; i++) players.push(await player(browser, `Flows Duo ${String(i)}`, errors));
  for (const { page } of players) await findMatch(page, "2v2");
  for (const { page } of players) await inMatch(page, 4);
  const [, , gone] = players as [(typeof players)[number], (typeof players)[number], (typeof players)[number]];
  // (its saved seat: the match, at Region A)
  const saved = await gone.page.evaluate(() => localStorage.getItem("carball.rankedSeat"));
  const seat = JSON.parse(saved ?? "null") as { matchId: string; server?: string } | null;
  expect(seat?.server).toBe(A);
  const context = gone.page.context();
  await gone.page.close();
  // Its record pointed at Region B: the offer, Yes, Region B's server asks the service, which knows the match at Region
  // A's: refused, said so, back on the menu
  const seeded = (server: string) => JSON.stringify({ matchId: seat?.matchId, teamSize: 2, joinedAt: Date.now() - 30_000, account: gone.account, server });
  const elsewhere = await context.newPage();
  elsewhere.on("pageerror", (e) => errors.push(e.message));
  await elsewhere.addInitScript(
    ([record]) => {
      if (sessionStorage.getItem("seeded") === null) {
        localStorage.setItem("carball.rankedSeat", record ?? "");
        sessionStorage.setItem("seeded", "1");
      }
    },
    [seeded(B)],
  );
  await elsewhere.goto("/?render=off");
  await expect(elsewhere.locator("#loading")).toBeHidden({ timeout: 60_000 });
  const modal = elsewhere.locator("#modal");
  await expect(modal.locator(".modal-title")).toHaveText("Reconnect", { timeout: 15_000 });
  await modal.getByRole("button", { name: /^yes$/i }).click();
  await expect(modal).toContainText("That match can't be rejoined: you've searched or played another match since.", { timeout: 30_000 });
  expect(new URL(elsewhere.url()).searchParams.has("match")).toBe(false);
  await elsewhere.close();
  // The record at Region A again (a fresh page of the same browser): let in, the four cars again
  const home = await context.newPage();
  home.on("pageerror", (e) => errors.push(e.message));
  await home.addInitScript(
    ([record]) => {
      if (sessionStorage.getItem("seeded") === null) {
        localStorage.setItem("carball.rankedSeat", record ?? "");
        sessionStorage.setItem("seeded", "1");
      }
    },
    [seeded(A)],
  );
  await home.goto("/?render=off");
  await expect(home.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await expect(home.locator("#modal .modal-title")).toHaveText("Reconnect", { timeout: 15_000 });
  await home.locator("#modal").getByRole("button", { name: /^yes$/i }).click();
  await inMatch(home, 4);
  expect(errors).toEqual([]);
});
