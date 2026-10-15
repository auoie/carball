// The queue against a local queue server (e2e/servers.ts, ports 14439/14440): two players find a 1v1 from the main menu,
// count "Joining in 3, 2, 1", land in the match on its page and see each other; a search cancelled, and one backed out
// of under the banner (notes/matchmaking.md v1 queue checklist). Nothing drawn (`?render=off`).
import type { Browser, Page } from "@playwright/test";
import { expect, hideGamepads, test } from "./fixtures";

const QUEUE = "127.0.0.1:14440";

async function menuPage(browser: Browser, errors: string[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  await hideGamepads(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`/?queue=${QUEUE}&render=off`);
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  return page;
}

/** Play, the playlist, Find Match */
async function findMatch(page: Page, playlist: string): Promise<void> {
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click({ timeout: 30_000 });
  await menu.getByRole("radio", { name: playlist }).click();
  await expect(menu.getByRole("radio", { name: playlist })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("button", { name: /^find match$/i }).click();
}

test("two players find a 1v1, count down and land in the match together", async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const a = await menuPage(browser, errors);
  const b = await menuPage(browser, errors);
  await findMatch(a, "1v1");
  const panel = a.locator("#search-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".search-title")).toHaveText("Searching...");
  await expect(panel.locator(".search-summary")).toHaveText("Searching", { timeout: 15_000 });
  await findMatch(b, "1v1");
  // Found: Joining in 3, 2, 1, then each page goes to the match's
  await expect(panel.locator(".search-summary")).toHaveText("Joining", { timeout: 15_000 });
  await expect(panel.locator(".search-line.countdown").first()).toHaveText("Joining in 3");
  for (const page of [a, b]) {
    await page.waitForURL(/[?&]match(&|$)/, { timeout: 15_000 });
    await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#net")).toContainText("2 cars", { timeout: 30_000 });
  }
  // One a side: each page's own team on the left
  const phases = await a.evaluate(() => (window as unknown as { carballOnline: () => { phases: { phase: string }[] } }).carballOnline().phases.map((p) => p.phase));
  expect(phases[0]).toBe("waiting");
  await expect.poll(async () => a.evaluate(() => (window as unknown as { carballOnline: () => { phases: { phase: string }[] } }).carballOnline().phases.map((p) => p.phase)), { timeout: 20_000 }).toContain("countdown");
  expect(errors).toEqual([]);
  await a.context().close();
  await b.context().close();
});

test("Cancel Search ends the search; Back leaves it under the banner", async ({ browser }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const page = await menuPage(browser, errors);
  await findMatch(page, "3v3");
  const panel = page.locator("#search-panel");
  await expect(panel.locator(".search-summary")).toHaveText("Searching", { timeout: 15_000 });
  // Back: the panel closes, the banner shows the search with its own Cancel Search
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  const banner = page.locator("#search-banner");
  await expect(banner).toBeVisible();
  await expect(banner.locator(".search-summary")).toHaveText("Searching");
  // Free Play under the banner: the search goes on
  await page.locator("#main-menu").getByRole("button", { name: /^free play$/i }).click();
  await expect(page.locator("#main-menu")).toBeHidden();
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: /^cancel search$/i }).click();
  await expect(banner).toBeHidden();
  const state = await page.evaluate(() => (window as unknown as { carballMatchmaking: () => { state: unknown } }).carballMatchmaking().state);
  expect(state).toBeNull();
  expect(errors).toEqual([]);
  await page.context().close();
});
