// The queue's edge cases against their own queue server (e2e/servers.ts "queue-edges", ports 14441/14442; its matches on
// map 2, meadow), in order: a map picked during a search while the page is slow to load (RV-443), one picked during
// "Joining in" and a claim naming another map than the server's (RV-446), a match page whose arena chunk fails (RV-445),
// and a match cancelled while the page builds its arena (RV-444: the one no-show, last). Nothing drawn (`?render=off`).
import type { Browser, Page } from "@playwright/test";
import { expect, hideGamepads, test } from "./fixtures";

const QUEUE = "127.0.0.1:14442";

test.describe.configure({ mode: "serial" });

async function menuPage(browser: Browser, errors: string[], setup?: (page: Page) => Promise<void>): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  await hideGamepads(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await setup?.(page);
  await page.goto(`/?queue=${QUEUE}&render=off`);
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  return page;
}

/** Play, 1v1, Find Match; its search on: searching, or joining at once (another page already waiting: its match can
 *  form before "Searching" is drawn); the queue's connection slow under the full run's load */
async function findMatch(page: Page): Promise<void> {
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click({ timeout: 30_000 });
  await menu.getByRole("radio", { name: "1v1" }).click();
  await menu.getByRole("button", { name: /^find match$/i }).click();
  await expect(page.locator("#search-banner .search-summary")).toHaveText(/^(Searching|Joining)$/, { timeout: 30_000 });
}

/** Free Play's map select, this map (from the Play page, where Find Match left the player: its search going on under
 *  the banner) */
async function pickMap(page: Page, map: string): Promise<void> {
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await menu.locator(`.main-menu-map[data-map="${map}"]`).click();
}

/** On the match's page with both cars */
async function inMatch(page: Page): Promise<void> {
  await page.waitForURL(/[?&]match(&|$)/, { timeout: 30_000 });
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#net")).toContainText("2 cars", { timeout: 30_000 });
}

const mapOf = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as { carballMap: () => string }).carballMap());

test("a map picked during a search while the page is slow to load: the search closed first, no no-show (RV-443)", async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const a = await menuPage(browser, errors);
  const b = await menuPage(browser, errors);
  await findMatch(a);
  // (the next page slow to come, 2.5 s: the old one lives on meanwhile, as RX18's probe R)
  await a.route(
    (url) => url.pathname === "/",
    async (route) => {
      if (route.request().resourceType() === "document") await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    },
  );
  await pickMap(a, "forest");
  await findMatch(b);
  // The match formed with A's new page's search (or followed by the old page if found first): both play, no cooldown
  for (const page of [a, b]) await inMatch(page);
  for (const page of [a, b]) await expect(page.locator("body")).not.toContainText("You can search again");
  expect(errors).toEqual([]);
  await a.context().close();
  await b.context().close();
});

test("a map picked during Joining in keeps the page; the match's map is the server's whatever the claim says (RV-446)", async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  // (A's claim rewritten to name forest before its match page reads it: the welcome's map, meadow, wins)
  const a = await menuPage(browser, errors, async (page) => {
    await page.addInitScript(() => {
      const text = sessionStorage.getItem("carball.claim");
      if (text !== null) sessionStorage.setItem("carball.claim", JSON.stringify({ ...(JSON.parse(text) as object), map: 3 }));
    });
  });
  const b = await menuPage(browser, errors);
  const pages: string[] = [];
  a.on("framenavigated", (frame) => {
    if (frame === a.mainFrame()) pages.push(frame.url());
  });
  await findMatch(a);
  await findMatch(b);
  await expect(a.locator("#search-banner .search-summary")).toHaveText("Joining", { timeout: 15_000 });
  await pickMap(a, "forest");
  for (const page of [a, b]) await inMatch(page);
  // (no free play page between: straight to the match's)
  expect(pages.filter((url) => !/[?&]match(&|$)/.test(url))).toEqual([]);
  expect(await mapOf(a)).toBe("meadow");
  expect(await mapOf(b)).toBe("meadow");
  expect(errors).toEqual([]);
  await a.context().close();
  await b.context().close();
});

test("a match page whose arena chunk fails plays on in night's (RV-445)", async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const a = await menuPage(browser, errors);
  const b = await menuPage(browser, errors, async (page) => {
    await page.route("**/assets/meadow-*.js", (route) => route.abort());
  });
  await findMatch(a);
  await findMatch(b);
  for (const page of [a, b]) await inMatch(page);
  expect(await mapOf(a)).toBe("meadow");
  expect(await mapOf(b)).toBe("night");
  expect(errors).toEqual([]);
  await a.context().close();
  await b.context().close();
});

test("a match cancelled while the page builds its arena: back to the menu, searching again (RV-444)", async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  // (A's arena chunk held 20 s; B never claims: the server cancels the match at 12 s, while A's page waits)
  const a = await menuPage(browser, errors, async (page) => {
    await page.route("**/assets/meadow-*.js", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      await route.continue();
    });
  });
  const b = await menuPage(browser, errors);
  await findMatch(a);
  await findMatch(b);
  await expect(b.locator("#search-banner .search-summary")).toHaveText("Joining", { timeout: 15_000 });
  await b.context().close();
  await a.waitForURL(/[?&]match(&|$)/, { timeout: 30_000 });
  // Back on the menu once the arena is in, its search again at the queue's front
  await a.waitForURL((url) => !/[?&]match(&|$)/.test(url.search), { timeout: 60_000 });
  await expect(a.locator("#loading")).toBeHidden({ timeout: 60_000 });
  // (its warning under the banner for its few seconds, the log's newest line: the timeline's lines follow it)
  await expect(a.locator("#search-banner .search-message")).toHaveText("Not every player joined the match. Searching again.", { timeout: 15_000 });
  await expect(a.locator("#search-banner .search-summary")).toHaveText("Searching", { timeout: 15_000 });
  expect(errors).toEqual([]);
  await a.context().close();
});
