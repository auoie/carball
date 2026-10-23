// Regions (notes/matchmaking.md, Regions) against two local queue servers (e2e/servers.ts: region-a 14445/14446,
// region-b 14447/14448): the Play page's picker with each region's ping; a search of both regions matched in one, the
// other region's search taken out of its queue; two regions matching one searcher at once, one match joined and the
// other given up with no no-show counted. Nothing drawn (`?render=off`).
import { readFileSync } from "node:fs";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, hideGamepads, test } from "./fixtures";

const A = "127.0.0.1:14446";
const B = "127.0.0.1:14448";

/** Each test's browser contexts, closed at its end (a search left running would meet the next test's) */
const opened: BrowserContext[] = [];
test.afterEach(async () => {
  for (const context of opened.splice(0)) await context.close();
});

async function menuPage(browser: Browser, queue: string, errors: string[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  opened.push(context);
  await hideGamepads(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?queue=${queue}&render=off`);
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  return page;
}

/** Play, the regions ticked as given (once their pings are measured), the playlist, Find Match */
async function findMatch(page: Page, regions: readonly string[] | null): Promise<void> {
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click({ timeout: 30_000 });
  if (regions) {
    const boxes = menu.locator(".main-menu-region");
    await expect(boxes).toHaveCount(2);
    for (const box of await boxes.all()) await expect(box.locator(".main-menu-ping")).toHaveText(/^\d+ ms$/, { timeout: 15_000 });
    for (const id of regions) {
      const box = menu.locator(`.main-menu-region[data-region="${id}"]`);
      if ((await box.getAttribute("aria-checked")) !== "true") await box.click();
      await expect(box).toHaveAttribute("aria-checked", "true");
    }
  } else {
    await expect(menu.locator(".main-menu-regions")).toBeHidden();
  }
  await menu.getByRole("radio", { name: "1v1" }).click();
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

const serverLog = (name: string): string => readFileSync(`test-results/servers/${name}.log`, "utf8");

test("the picker shows each region's ping; a search of both is matched in one, the other region's search let go", async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const a = await menuPage(browser, `${A},${B}`, errors);
  await findMatch(a, [A, B]);
  await a.screenshot({ path: "test-results/regions-picker.png" });
  await expect(a.locator("#search-banner .search-summary")).toHaveText("Searching", { timeout: 15_000 });
  // (the choice kept in this browser)
  expect(await a.evaluate(() => localStorage.getItem("carball.regions"))).toBe(JSON.stringify([A, B]));
  // A player searching region B alone: matched with a there
  const b = await menuPage(browser, B, errors);
  await findMatch(b, null);
  for (const page of [a, b]) {
    await page.waitForURL(/[?&]match(&|$)/, { timeout: 20_000 });
    await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#net")).toContainText("2 cars", { timeout: 30_000 });
  }
  // A player searching region A alone: nobody's there (a's search there was taken out of its queue), still searching
  const c = await menuPage(browser, A, errors);
  await findMatch(c, null);
  await expect.poll(async () => status(c), { timeout: 15_000 }).toBe("searching");
  await c.waitForTimeout(4000);
  expect(await status(c)).toBe("searching");
  expect(inMatch(c)).toBe(false);
  // (its search cancelled, not left to the server's timeout as a closed context's would be)
  await cancelSearch(c);
  expect(errors).toEqual([]);
});

test("two regions matching one searcher at once: one match joined, the other given up, no no-show counted", async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const before = { a: serverLog("region-a").length, b: serverLog("region-b").length };
  // One player waiting in each region
  const waitingA = await menuPage(browser, A, errors);
  await findMatch(waitingA, null);
  const waitingB = await menuPage(browser, B, errors);
  await findMatch(waitingB, null);
  for (const page of [waitingA, waitingB]) await expect.poll(async () => status(page), { timeout: 15_000 }).toBe("searching");
  // A searcher of both: matched in both at once
  const both = await menuPage(browser, `${A},${B}`, errors);
  await findMatch(both, [A, B]);
  await both.waitForURL(/[?&]match(&|$)/, { timeout: 20_000 });
  await expect(both.locator("#net")).toContainText("2 cars", { timeout: 60_000 });
  // Exactly one waiting player plays with it; the other searches again (its match given up, or never made)
  await expect
    .poll(
      async () => {
        const [ina, inb] = [inMatch(waitingA), inMatch(waitingB)];
        const searching = ina ? await status(waitingB) : inb ? await status(waitingA) : null;
        return ina !== inb && searching === "searching";
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  // Neither server counted a no-show; a decline, if the race happened, said so in its server's log
  const logs = { a: serverLog("region-a").slice(before.a), b: serverLog("region-b").slice(before.b) };
  expect(logs.a + logs.b).not.toContain("stalled by a no-show");
  const declined = [logs.a, logs.b].filter((l) => l.includes("given up for another region's match")).length;
  expect(declined).toBeLessThanOrEqual(1);
  console.log(declined === 1 ? "the race happened: the second region's match was declined" : "no race: the second region's search ended first");
  for (const page of [waitingA, waitingB]) if (!inMatch(page)) await cancelSearch(page);
  expect(errors).toEqual([]);
});

test("a search the page starts by itself (Play Again) waits for the pings and goes to the lowest; that pick kept (RX43C-1)", async ({ browser }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  opened.push(context);
  await hideGamepads(context);
  // (back from a match's end with Play Again: the menu searches the playlist again as it opens; nothing chosen yet)
  await context.addInitScript(() => {
    if (sessionStorage.getItem("carball.played") === null) {
      sessionStorage.setItem("carball.played", "1");
      sessionStorage.setItem("carball.menuNotice", JSON.stringify({ search: 1 }));
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?queue=${A},${B}&render=off`);
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
  expect(await page.evaluate(() => localStorage.getItem("carball.regions"))).toBe(JSON.stringify(searched));
  await expect.poll(async () => status(page), { timeout: 15_000 }).toBe("searching");
  await cancelSearch(page);
  expect(errors).toEqual([]);
});
