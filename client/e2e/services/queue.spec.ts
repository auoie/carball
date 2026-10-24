// The queue against the services (stacks.ts' "queue" stack: the accounts service's matchmaker, a game server; each page
// signed in to an account of its own): two players find a 1v1 from the main menu,
// count "Joining in 3, 2, 1" under the banner, land in the match on its page and see each other; a search under the banner
// alone (no panel: MS1, the user's decision) into free play and cancelled; the pad's Y cancelling it from the menus
// (notes/matchmaking.md v1 queue checklist, MM-5, MM-10). Nothing drawn (`?render=off`).
import type { Browser, Page } from "@playwright/test";
import { expect, fakeGamepad, hideGamepads, tickPlaylists } from "../fixtures";
import { STACKS, signIn, test } from "./fixtures";

test.use({ baseURL: STACKS.queue.origin });

async function menuPage(browser: Browser, errors: string[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  await hideGamepads(context);
  await signIn(context, "Queue");
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  return page;
}

/** Play (one server: no region picker, RV-1048), the playlist, Find Match */
async function findMatch(page: Page, playlist: string): Promise<void> {
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click({ timeout: 30_000 });
  await expect(menu.locator(".main-menu-regions")).toBeHidden();
  await tickPlaylists(menu, [playlist]);
  await menu.getByRole("button", { name: /^find match$/i }).click();
}

test("two players find a 1v1, count down and land in the match together", async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const a = await menuPage(browser, errors);
  const b = await menuPage(browser, errors);
  await findMatch(a, "1v1");
  // The banner at once, no panel; the Play page kept, its Free Play focused (free play next while searching)
  const banner = a.locator("#search-banner");
  await expect(banner).toBeVisible();
  await expect(a.locator("#main-menu").getByRole("button", { name: /^free play$/i })).toBeFocused();
  await expect(a.locator("#search-panel")).toHaveCount(0);
  await expect(banner.locator(".search-summary")).toHaveText("Searching", { timeout: 15_000 });
  await findMatch(b, "1v1");
  // Found: Joining in 3, 2, 1 under the banner, then each page goes to the match's
  await expect(banner.locator(".search-summary")).toHaveText("Joining", { timeout: 15_000 });
  await expect(banner.locator(".search-message")).toHaveText(/^Joining in [123]$/);
  await expect(banner.locator(".search-message")).toHaveAttribute("data-kind", "countdown");
  for (const page of [a, b]) {
    await page.waitForURL(/[?&]match(&|$)/, { timeout: 15_000 });
    await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#net")).toContainText("2 cars", { timeout: 30_000 });
    // (the server's map, the same for both: Night, the one map)
    expect(await page.evaluate(() => (window as unknown as { carballMap: () => string }).carballMap())).toBe("night");
  }
  // One a side: each page's own team on the left
  const phases = await a.evaluate(() =>
    (window as unknown as { carballOnline: () => { phases: { phase: string }[] } }).carballOnline().phases.map((p) => p.phase),
  );
  expect(phases[0]).toBe("waiting");
  await expect
    .poll(
      async () => a.evaluate(() => (window as unknown as { carballOnline: () => { phases: { phase: string }[] } }).carballOnline().phases.map((p) => p.phase)),
      { timeout: 20_000 },
    )
    .toContain("countdown");
  expect(errors).toEqual([]);
  await a.context().close();
  await b.context().close();
});

test("the search under the banner: Cancel Search over the menus, none while driving; free play under it; Cancel Search ends it", async ({ browser }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const page = await menuPage(browser, errors);
  await findMatch(page, "3v3");
  const banner = page.locator("#search-banner");
  await expect(banner).toBeVisible();
  await expect(banner.locator(".search-summary")).toHaveText("Searching", { timeout: 15_000 });
  // (over the menu, the mouse's Cancel Search; the pad's form not, no pad used)
  await expect(banner.getByRole("button", { name: /^cancel search$/i })).toBeVisible();
  await expect(banner.locator(".search-cancel-pad")).toBeHidden();
  // Free Play under the banner (the one map, this page's): the search goes on, no Cancel Search while driving
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await expect(menu).toBeHidden();
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("button", { name: /^cancel search$/i })).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { carballMatchmaking: () => { state: unknown } }).carballMatchmaking().state)).not.toBeNull();
  // (the pause menu up: Cancel Search there)
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-menu")).toBeVisible();
  await banner.getByRole("button", { name: /^cancel search$/i }).click();
  await expect(banner).toBeHidden();
  const state = await page.evaluate(() => (window as unknown as { carballMatchmaking: () => { state: unknown } }).carballMatchmaking().state);
  expect(state).toBeNull();
  expect(errors).toEqual([]);
  await page.context().close();
});

test("the pad's Y cancels the search from the menus, its hint on the banner; in the settings Y stays theirs (MM-10)", async ({ browser }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  await hideGamepads(context);
  await fakeGamepad(context);
  await signIn(context, "Queue Pad");
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  const tap = async (button: number): Promise<void> => {
    await page.evaluate(async (b) => {
      const w = window as unknown as { carballSetPad: (down: number[]) => void };
      const frames = async (n: number): Promise<void> =>
        new Promise((r) => {
          const step = (k: number): void => {
            if (k === 0) r();
            else
              requestAnimationFrame(() => {
                step(k - 1);
              });
          };
          step(n);
        });
      w.carballSetPad([b]);
      await frames(2);
      w.carballSetPad([]);
      await frames(3);
    }, button);
  };
  await findMatch(page, "2v2");
  const banner = page.locator("#search-banner");
  await expect(banner.locator(".search-summary")).toHaveText("Searching", { timeout: 15_000 });
  // Driving under the banner: Y the ball cam's, the search kept, no cancel shown (MM-10, RV-529's CM32)
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await expect(menu).toBeHidden();
  await tap(3);
  await expect(banner).toBeVisible();
  await expect(banner.locator(".search-cancel-pad")).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { carballMatchmaking: () => { state: unknown } }).carballMatchmaking().state)).not.toBeNull();
  // (back to the main menu by the pause menu's Exit; a D-pad press: the pad's mode, its "‹Y› CANCEL SEARCH")
  await page.keyboard.press("Escape");
  const pause = page.locator("#pause-menu");
  await pause.getByRole("button", { name: /^exit to main menu$/i }).click();
  await pause.getByRole("button", { name: /^yes$/i }).click();
  await tap(13);
  await expect(page.locator("#main-menu").getByRole("button", { name: /^settings$/i })).toBeVisible();
  await expect(banner.locator(".search-cancel-pad")).toBeVisible();
  await expect(banner.locator(".search-cancel-pad")).toContainText("Cancel Search");
  // The settings over the menu: Y theirs, the search kept
  await page
    .locator("#main-menu")
    .getByRole("button", { name: /^settings$/i })
    .click();
  await expect(page.locator("#settings")).toBeVisible();
  await tap(3);
  await expect(banner).toBeVisible();
  await tap(1);
  await expect(page.locator("#settings")).toBeHidden();
  // Y over the main menu: the search cancelled
  await tap(3);
  await expect(banner).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { carballMatchmaking: () => { state: unknown } }).carballMatchmaking().state)).toBeNull();
  expect(errors).toEqual([]);
  await context.close();
});
