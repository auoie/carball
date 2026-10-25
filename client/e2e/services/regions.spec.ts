// Regions (notes/matchmaking.md, Regions and the central matchmaker) against the services (stacks.ts' "regions" stack:
// two game servers, config.json's region-a and region-b, the accounts service's matchmaker; each page signed in to an
// account of its own): the Play page's picker with each region's ping; a player matched only at a server they ticked (one
// who ticked a quiet region alone waits); a search of two playlists matched in one; a self-started search's automatic
// pick. Nothing drawn (`?render=off`).
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, hideGamepads, tickPlaylists } from "../fixtures";
import { STACKS, signIn, test } from "./fixtures";

test.use({ baseURL: STACKS.regions.origin });

const A = "region-a";
const B = "region-b";

/** Each test's browser contexts, closed at its end (a search left running would meet the next test's) */
const opened: BrowserContext[] = [];
test.afterEach(async () => {
  for (const context of opened.splice(0)) await context.close();
});

async function menuPage(browser: Browser, errors: string[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  opened.push(context);
  await hideGamepads(context);
  await signIn(context, "Regions");
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  return page;
}

/** Play, the regions given ticked and the others not (once their pings are measured), the playlists (1v1 by default),
 *  Find Match */
async function findMatch(page: Page, regions: readonly string[], playlists: readonly string[] = ["1v1"]): Promise<void> {
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click({ timeout: 30_000 });
  const boxes = menu.locator(".main-menu-region");
  await expect(boxes).toHaveCount(2);
  // (its ping, and its players in matches once the live counts are read: mainMenu.ts regionText)
  for (const box of await boxes.all()) await expect(box.locator(".main-menu-ping")).toHaveText(/^\d+ ms( · \d+ in matches)?$/, { timeout: 15_000 });
  const region = (id: string) => menu.locator(`.main-menu-region[data-region="${id}"]`);
  for (const id of regions) {
    if ((await region(id).getAttribute("aria-checked")) !== "true") await region(id).click();
    await expect(region(id)).toHaveAttribute("aria-checked", "true");
  }
  // (the others not: unticked once the asked ones are, so one is always ticked; ticked first if need be, so the choice is
  // the player's, kept as such, never the lowest ping's that a pick matching it would stay, which the search's own
  // measure can move to another region)
  for (const id of [A, B].filter((r) => !regions.includes(r))) {
    if ((await region(id).getAttribute("aria-checked")) !== "true") await region(id).click();
    await region(id).click();
    await expect(region(id)).toHaveAttribute("aria-checked", "false");
  }
  // (Space on a focused box ticks it, as a click does: RV-858)
  const first = region(regions[0] ?? "");
  if (regions.length > 1) {
    await first.focus();
    await page.keyboard.press("Space");
    await expect(first).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Space");
    await expect(first).toHaveAttribute("aria-checked", "true");
  }
  await tickPlaylists(menu, playlists);
  await menu.getByRole("button", { name: /^find match$/i }).click();
}

const status = async (page: Page): Promise<string | null> =>
  page.evaluate(() => (window as unknown as { carballMatchmaking: () => { state: { status: string } | null } }).carballMatchmaking().state?.status ?? null);

const inMatch = (page: Page): boolean => /[?&]match(&|$)/.test(page.url());

/** Cancel Search, the banner's button; the search over */
async function cancelSearch(page: Page): Promise<void> {
  await page.locator("#search-banner .search-cancel").click();
  await expect.poll(async () => status(page)).toBeNull();
}

test("the picker shows each region's ping; a search of both is matched at the server it shares; one who ticked a quiet region alone waits", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const a = await menuPage(browser, errors);
  await findMatch(a, [A, B]);
  await a.screenshot({ path: "test-results/regions-picker.png" });
  await expect(a.locator("#search-banner .search-summary")).toHaveText("Searching", { timeout: 15_000 });
  // (the choice kept in this browser, the player's)
  expect(await a.evaluate(() => localStorage.getItem("carball.regions"))).toBe(JSON.stringify({ ids: [A, B], manual: true }));
  // A player searching region B alone: matched with a there
  const b = await menuPage(browser, errors);
  await findMatch(b, [B]);
  for (const page of [a, b]) {
    await page.waitForURL(/[?&]match(&|$)/, { timeout: 20_000 });
    await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#net")).toContainText("2 cars", { timeout: 30_000 });
  }
  // A player searching region A alone: nobody else ticked it (a's search over with its match), still searching
  const c = await menuPage(browser, errors);
  await findMatch(c, [A]);
  await expect.poll(async () => status(c), { timeout: 15_000 }).toBe("searching");
  await c.waitForTimeout(4000);
  expect(await status(c)).toBe("searching");
  expect(inMatch(c)).toBe(false);
  // (its search cancelled, not left to the server's timeout as a closed context's would be)
  await cancelSearch(c);
  expect(errors).toEqual([]);
});

test("a search of two playlists is matched in one, out of the other's list", async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const both = await menuPage(browser, errors);
  await findMatch(both, [B], ["1v1", "2v2"]);
  await expect.poll(async () => status(both), { timeout: 15_000 }).toBe("searching");
  const ones = await menuPage(browser, errors);
  await findMatch(ones, [B], ["1v1"]);
  for (const page of [both, ones]) {
    await page.waitForURL(/[?&]match(&|$)/, { timeout: 20_000 });
    await expect(page.locator("#net")).toContainText("2 cars", { timeout: 60_000 });
  }
  // (three 2v2 searches now: still waiting, the one who searched both out of the 2v2 list with its 1v1; with it still
  // there, they'd make four, a match: RV-885)
  const twos = [];
  for (let i = 0; i < 3; i++) {
    const page = await menuPage(browser, errors);
    await findMatch(page, [B], ["2v2"]);
    twos.push(page);
  }
  for (const page of twos) await expect.poll(async () => status(page), { timeout: 15_000 }).toBe("searching");
  await twos[0]?.waitForTimeout(3000);
  for (const page of twos) {
    expect(await status(page)).toBe("searching");
    await cancelSearch(page);
  }
  expect(errors).toEqual([]);
});

test("a search the page starts by itself (Play Again) waits for the pings and goes to the lowest; that pick kept (RX43C-1)", async ({ browser }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  opened.push(context);
  await hideGamepads(context);
  await signIn(context, "Regions Again");
  // (back from a match's end with Play Again: the menu searches the playlist again as it opens; nothing chosen yet)
  await context.addInitScript(() => {
    if (sessionStorage.getItem("carball.played") === null) {
      sessionStorage.setItem("carball.played", "1");
      sessionStorage.setItem("carball.menuNotice", JSON.stringify({ search: [1] }));
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  interface Regions {
    pings: Record<string, number | null>;
    chosen: string[];
    searched: string[];
  }
  const regions = (): Promise<Regions> => page.evaluate(() => (window as unknown as { carballRegions: () => Regions }).carballRegions());
  await expect.poll(async () => (await regions()).searched.length, { timeout: 15_000 }).toBe(1);
  const { pings, searched } = await regions();
  // (both measured before it searched: the lowest, the list's first of equals)
  const [pa, pb] = [pings[A], pings[B]];
  expect(typeof pa === "number" && typeof pb === "number").toBe(true);
  expect(searched).toEqual([(pb ?? 0) < (pa ?? 0) ? B : A]);
  // (kept as the lowest ping's pick, not the player's: chosen again as the pings change, RV-862)
  expect(await page.evaluate(() => localStorage.getItem("carball.regions"))).toBe(JSON.stringify({ ids: searched, manual: false }));
  await expect.poll(async () => status(page), { timeout: 15_000 }).toBe("searching");
  await cancelSearch(page);
  expect(errors).toEqual([]);
});
