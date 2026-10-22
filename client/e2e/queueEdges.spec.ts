// The queue's edge cases against their own queue server (e2e/servers.ts "queue-edges", ports 14441/14442; its matches on
// Night, the one map): Free Play during "Joining in" and a claim naming another map than the server's (RV-446). Nothing
// drawn (`?render=off`).
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

/** Free Play (from the Play page, where Find Match left the player: its search going on under the banner): on this page */
async function freePlay(page: Page): Promise<void> {
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^free play$/i }).click();
}

/** On the match's page with both cars */
async function inMatch(page: Page): Promise<void> {
  await page.waitForURL(/[?&]match(&|$)/, { timeout: 30_000 });
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#net")).toContainText("2 cars", { timeout: 30_000 });
}

const mapOf = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as { carballMap: () => string }).carballMap());

test("Free Play during Joining in keeps the page; the match's map is the server's whatever the claim says (RV-446)", async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  // (A's claim rewritten to name a map index no server sends before its match page reads it: the page shows Night)
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
  await freePlay(a);
  for (const page of [a, b]) await inMatch(page);
  // (no free play page between: straight to the match's)
  expect(pages.filter((url) => !/[?&]match(&|$)/.test(url))).toEqual([]);
  expect(await mapOf(a)).toBe("night");
  expect(await mapOf(b)).toBe("night");
  expect(errors).toEqual([]);
  await a.context().close();
  await b.context().close();
});

test("no rejoin offer while another tab of this browser plays that match (its lock held), offered once it's let go (RX30C)", async ({ browser }) => {
  const errors: string[] = [];
  const matchId = "1311768467294899695";
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  await hideGamepads(context);
  await context.addInitScript(
    (s) => {
      localStorage.setItem("carball.rankedSeat", s);
    },
    JSON.stringify({ matchId, teamSize: 2, joinedAt: Date.now() - 60_000 }),
  );
  // (a tab playing the match: its lock held, as the match page holds it)
  const playing = await context.newPage();
  playing.on("pageerror", (e) => errors.push(e.message));
  await playing.goto(`/?queue=${QUEUE}&render=off`);
  await expect(playing.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await playing.evaluate(async (name) => {
    await new Promise<void>((held) => {
      void navigator.locks.request(name, () => {
        held();
        return new Promise<void>(() => undefined);
      });
    });
  }, `carball.match.${matchId}`);
  // (a second tab: no offer while the first plays it)
  const second = await context.newPage();
  second.on("pageerror", (e) => errors.push(e.message));
  await second.goto(`/?queue=${QUEUE}&render=off`);
  await expect(second.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await second.waitForTimeout(1500);
  await expect(second.locator("#modal")).toBeHidden();
  // (the first tab gone, its lock with it: the offer)
  await playing.close();
  await second.reload();
  await expect(second.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await expect(second.locator("#modal .modal-title")).toHaveText("REJOIN MATCH", { timeout: 10_000 });
  expect(errors).toEqual([]);
  await context.close();
});

test("a ranked match left by accident is offered back for 900 s; a rejoin of a match that's over says so and forgets it (LV1)", async ({ browser }) => {
  const errors: string[] = [];
  const seat = (joinedAt: number) => JSON.stringify({ matchId: "1311768467294899695", teamSize: 2, joinedAt });
  // (joined 20 minutes ago: past the 900 s, no offer)
  const stale = await menuPage(browser, errors, async (p) => {
    await p.addInitScript(
      (s) => {
        localStorage.setItem("carball.rankedSeat", s);
      },
      seat(Date.now() - 20 * 60_000),
    );
  });
  await expect(stale.locator("#main-menu")).toBeVisible();
  await expect(stale.locator("#modal")).toBeHidden();
  await stale.context().close();
  // (joined a minute ago: offered; Yes tries it, the server has no such match: back, told, the offer gone)
  const page = await menuPage(browser, errors, async (p) => {
    await p.addInitScript(
      (s) => {
        if (!sessionStorage.getItem("seeded")) {
          localStorage.setItem("carball.rankedSeat", s);
          sessionStorage.setItem("seeded", "1");
        }
      },
      seat(Date.now() - 60_000),
    );
  });
  const modal = page.locator("#modal");
  await expect(modal.locator(".modal-title")).toHaveText("REJOIN MATCH");
  await modal.getByRole("button", { name: /^yes$/i }).click();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await expect(modal.locator(".modal-title")).toHaveText("MATCH OVER", { timeout: 30_000 });
  await expect(modal).toContainText("That match has ended.");
  expect(await page.evaluate(() => localStorage.getItem("carball.rankedSeat"))).toBeNull();
  expect(new URL(page.url()).searchParams.has("match")).toBe(false);
  expect(errors).toEqual([]);
  await page.context().close();
});
