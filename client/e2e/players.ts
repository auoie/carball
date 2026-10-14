// Online players for the browser tests: joining a server (with a name), leaving it at once, what a page's game saw.
import type { Browser, Page } from "@playwright/test";
import { expect, hideGamepads } from "./fixtures";

/** Joins `server` (host:info port), the page's errors collected in `errors` (nothing drawn, `?render=off`: no online test
 *  reads pixels) */
export async function join(page: Page, server: string, errors: string[]): Promise<void> {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`/?server=${server}&render=off`);
  // (generous: a third page under the suite's load can take over 30 s to its first frame)
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
}

/** Another player in a context of their own (drawn small: every page renders in software, and a third page under the
 *  suite's load otherwise starves) */
export async function newPlayer(browser: Browser, server: string, errors: string[], name?: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  await hideGamepads(context);
  const page = await context.newPage();
  if (name !== undefined) await named(page, name);
  await join(page, server, errors);
  return page;
}

/** The page's player name, in its saved settings */
export async function named(page: Page, name: string): Promise<void> {
  await page.addInitScript((n) => {
    // (not on about:blank, where leaving takes the page: no storage there)
    if (location.protocol.startsWith("http")) localStorage.setItem("rl-clone.settings.v1", JSON.stringify({ chat: { name: n } }));
  }, name);
}

/** The match ends the page saw: each one's winner and whether by forfeit */
export async function ends(page: Page): Promise<{ winner: number | null; forfeit: boolean }[]> {
  return page.evaluate(() =>
    (window as unknown as { rlOnline: () => { phases: { phase: string; winner: number | null; forfeit: boolean }[] } })
      .rlOnline()
      .phases.filter((p) => p.phase === "prePodium")
      .map(({ winner, forfeit }) => ({ winner, forfeit })),
  );
}

/** Leaves the server at once (the page's pagehide closes its session; a closed context's lingers until it times out,
 *  into the next test) */
export async function leave(page: Page): Promise<void> {
  await page.goto("about:blank");
}

/** Pages to leave after a test, the fixture's first (its other contexts closed) */
export async function leaveAll(page: Page, others: Page[]): Promise<void> {
  for (const p of [page, ...others.splice(0)]) {
    await leave(p);
    if (p !== page) await p.context().close();
  }
}

/** The main menu's Play, then Free Play (MENU-1/2): the game starts */
export async function freePlay(page: Page): Promise<void> {
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click({ timeout: 30_000 });
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await expect(menu).toBeHidden();
}

/** The pause menu (Escape: MENU-4), then its Settings */
export async function openSettings(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.locator("#pause-menu").getByRole("button", { name: /^settings$/i }).click();
  await expect(page.locator("#settings")).toBeVisible();
}

/** Back to the game: Escape closes the settings, then the pause menu */
export async function closeMenus(page: Page): Promise<void> {
  if (await page.locator("#settings").isVisible()) await page.keyboard.press("Escape");
  await expect(page.locator("#settings")).toBeHidden();
  if (await page.locator("#pause-menu").isVisible()) await page.keyboard.press("Escape");
  await expect(page.locator("#pause-menu")).toBeHidden();
}

