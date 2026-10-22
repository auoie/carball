// The queue's edge cases against their own queue server (e2e/servers.ts "queue-edges", ports 14441/14442; its matches on
// Night, the one map): Free Play during "Joining in" and a claim naming another map than the server's (RV-446). Nothing
// drawn (`?render=off`).
import type { Browser, BrowserContext, Page } from "@playwright/test";
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
  await expect(second.locator("#modal .modal-title")).toHaveText("Reconnect", { timeout: 10_000 });
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
  await expect(modal.locator(".modal-title")).toHaveText("Reconnect");
  await expect(modal).toContainText("It appears you accidentally left a ranked match. Would you like to rejoin?");
  await modal.getByRole("button", { name: /^yes$/i }).click();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await expect(modal).toContainText("Match has concluded.", { timeout: 30_000 });
  expect(await page.evaluate(() => localStorage.getItem("carball.rankedSeat"))).toBeNull();
  expect(new URL(page.url()).searchParams.has("match")).toBe(false);
  expect(errors).toEqual([]);
  await page.context().close();
});

test("a 2v2 left by accident: a rejoin into the running match, its lock and record; the first leaver's search refused, a later one's searching (RX31)", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const menu = async (context: BrowserContext): Promise<Page> => {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/?queue=${QUEUE}&render=off`);
    await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
    return page;
  };
  const search = async (page: Page): Promise<void> => {
    const main = page.locator("#main-menu");
    await main.getByRole("button", { name: /^play$/i }).click({ timeout: 30_000 });
    await main.getByRole("radio", { name: "2v2", exact: true }).click();
    await main.getByRole("button", { name: /^find match$/i }).click();
  };
  const cars = async (page: Page, n: number): Promise<void> => {
    await page.waitForURL(/[?&]match(&|$)/, { timeout: 30_000 });
    await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#net")).toContainText(`${String(n)} cars`, { timeout: 30_000 });
  };
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  for (let i = 0; i < 4; i++) {
    const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
    await hideGamepads(context);
    contexts.push(context);
    pages.push(await menu(context));
  }
  for (const page of pages) await search(page);
  for (const page of pages) await cars(page, 4);
  const [a, b, c, d] = pages as [Page, Page, Page, Page];
  const [aContext, , cContext, dContext] = contexts as [BrowserContext, BrowserContext, BrowserContext, BrowserContext];
  // (each match page holds its match's lock, and its ranked seat saved: RX30C, RJ1)
  const locked = (page: Page): Promise<boolean> =>
    page.evaluate(async () => ((await navigator.locks.query()).held ?? []).some((l) => l.name?.startsWith("carball.match.") === true));
  expect(await locked(a)).toBe(true);
  const savedAt = (page: Page): Promise<number | null> =>
    page.evaluate(() => {
      const s = localStorage.getItem("carball.rankedSeat");
      return s === null ? null : (JSON.parse(s) as { joinedAt: number }).joinedAt;
    });
  const firstJoin = await savedAt(c);
  expect(firstJoin).not.toBeNull();
  // (a queue's match is ranked: with every seat filled, the pause menu's leave is ABANDON MATCH, asking WARNING and the
  // ban's question, RV-715, RX32)
  await b.keyboard.press("Escape");
  const pause = b.locator("#pause-menu");
  await pause.getByRole("button", { name: /^abandon match$/i }).click({ timeout: 15_000 });
  await expect(pause.locator(".match-menu-warning")).toHaveText("Warning");
  await expect(pause).toContainText("Abandoning a ranked game will temporarily ban you from matchmaking. ARE YOU SURE?");
  await pause.getByRole("button", { name: /^no$/i }).click();
  await b.keyboard.press("Escape");
  // A leaves first (reported: a quitter), then C (a later leaver: not)
  await a.close();
  await c.close();
  // C back: the offer, Yes, into the running match (the three still there), its lock held, its record saved anew
  const cBack = await menu(cContext);
  await expect(cBack.locator("#modal .modal-title")).toHaveText("Reconnect", { timeout: 10_000 });
  await cBack.locator("#modal").getByRole("button", { name: /^yes$/i }).click();
  await cars(cBack, 3);
  expect(await locked(cBack)).toBe(true);
  await expect.poll(() => savedAt(cBack)).toBeGreaterThan(firstJoin ?? 0);
  // (A's seat still away: the lobby not full, no leave penalty, so B's pause menu leaves plainly, RV-715)
  await b.keyboard.press("Escape");
  await expect(pause.getByRole("button", { name: /^leave match$/i })).toBeVisible({ timeout: 15_000 });
  await expect(pause.getByRole("button", { name: /^abandon match$/i })).toHaveCount(0);
  await b.keyboard.press("Escape");
  // (C drops again: a fresh offer, its record saved again at the rejoin's join, RJ1, RV-714)
  await cBack.close();
  const cAgain = await menu(cContext);
  await expect(cAgain.locator("#modal .modal-title")).toHaveText("Reconnect", { timeout: 10_000 });
  await cAgain.locator("#modal").getByRole("button", { name: /^no$/i }).click();
  // A back: the offer declined; its search refused as the reported quitter's (Refused 7)
  const aBack = await menu(aContext);
  await expect(aBack.locator("#modal .modal-title")).toHaveText("Reconnect", { timeout: 10_000 });
  await aBack.locator("#modal").getByRole("button", { name: /^no$/i }).click();
  await search(aBack);
  await expect(aBack.locator("#search-banner")).toContainText("you left a ranked match", { timeout: 30_000 });
  // D leaves after the first leaver: no quitter; its search goes on, giving its seat up (its record gone with it)
  await d.close();
  const dBack = await menu(dContext);
  await expect(dBack.locator("#modal .modal-title")).toHaveText("Reconnect", { timeout: 10_000 });
  await dBack.locator("#modal").getByRole("button", { name: /^no$/i }).click();
  await search(dBack);
  await expect(dBack.locator("#search-banner .search-summary")).toHaveText("Searching", { timeout: 30_000 });
  // (A's and D's team all away: it forfeits, the match over on B's page, whose saved seat goes with it: RJ1, RX32)
  await expect.poll(() => savedAt(b), { timeout: 15_000 }).toBeNull();
  expect(errors).toEqual([]);
  for (const context of contexts) await context.close();
});
