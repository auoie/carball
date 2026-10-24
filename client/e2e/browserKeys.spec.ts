// The browser's keys in play (RV-1091, RV-1092): a bound key, or a chord with a bound modifier held, never the browser's
// action (F5's reload, Ctrl+D's bookmark; Ctrl+W, T and N reach a page only in full screen), anything else left to it,
// and nothing taken under a menu; Display Mode's Fullscreen (MENU-19's Window Settings) the page's full screen, Windowed
// out of it. Whether the browser's action was taken: the key event's default, read by a listener after the game's.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { freePlay } from "./players";

/** Whether `key` pressed (with Left Control held: `ctrl`) had its default cancelled by the page: a listener after the
 *  game's, for that key alone */
async function taken(page: Page, key: string, ctrl = false): Promise<boolean> {
  await page.evaluate((code) => {
    const w = window as unknown as { lastKeyTaken?: boolean };
    delete w.lastKeyTaken;
    const read = (e: KeyboardEvent): void => {
      if (e.code !== code) return;
      w.lastKeyTaken = e.defaultPrevented;
      window.removeEventListener("keydown", read);
    };
    window.addEventListener("keydown", read);
  }, key);
  if (ctrl) await page.keyboard.down("ControlLeft");
  await page.keyboard.press(key);
  if (ctrl) await page.keyboard.up("ControlLeft");
  return page.evaluate(() => (window as unknown as { lastKeyTaken?: boolean }).lastKeyTaken === true);
}

test("in play, a bound key and a bound modifier's chords are the game's alone; the rest, and a menu's, the browser's", async ({ page }) => {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  await page.locator("#game").click({ position: { x: 320, y: 180 }, button: "right" }); // (focus)
  // (W throttle, bound; F5 not: its reload the browser's; Ctrl held, the defaults' rear camera: Ctrl+J the game's)
  expect(await taken(page, "KeyW"), "W").toBe(true);
  expect(await taken(page, "F7"), "F7, unbound").toBe(false);
  expect(await taken(page, "KeyJ", true), "Ctrl+J, Ctrl bound").toBe(true);
  // (under the pause menu: none of it)
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-menu")).toBeVisible();
  expect(await taken(page, "KeyJ", true), "Ctrl+J under a menu").toBe(false);
});

test("Display Mode: Fullscreen takes the page full screen, Windowed back out", async ({ page }) => {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await page
    .locator("#main-menu")
    .getByRole("button", { name: /^settings$/i })
    .click();
  await page.locator(".settings-tab", { hasText: "Video" }).click();
  const mode = page.locator('[data-option="fullscreen"]');
  await expect(mode).toHaveAttribute("data-value", "windowed");
  const full = (): Promise<boolean> => page.evaluate(() => document.fullscreenElement !== null);
  // (a cycler's right half: the next value, a press the browser grants full screen to)
  const step = async (): Promise<void> => {
    const box = await mode.boundingBox();
    if (box) await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
  };
  await step();
  await expect(mode).toHaveAttribute("data-value", "fullscreen");
  await expect.poll(full, { timeout: 5_000 }).toBe(true);
  await step();
  await expect(mode).toHaveAttribute("data-value", "windowed");
  await expect.poll(full, { timeout: 5_000 }).toBe(false);
});

test("a browser without every bind (Firefox's name, no keyboard lock): its limits once on the main menu, always on Controls", async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "keyboard", { value: undefined });
  });
  const page = await context.newPage();
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const notice = page.locator("#main-menu .browser-notice");
  await expect(notice).toBeVisible();
  await expect(notice.locator("li")).toHaveCount(3);
  await expect(notice).toContainText("Chrome or another Chromium browser (Edge, Brave)");
  await notice.getByRole("button", { name: "Got it" }).click();
  await expect(notice).toHaveCount(0);
  // (dismissed for good: not on the next page)
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#main-menu .browser-notice")).toHaveCount(0);
  // (always on the Controls screen, with nothing to dismiss)
  await page
    .locator("#main-menu")
    .getByRole("button", { name: /^settings$/i })
    .click();
  await page.locator(".settings-tab", { hasText: "Controls" }).click();
  const inline = page.locator("#settings .browser-notice.inline");
  await expect(inline.locator("li")).toHaveCount(3);
  await expect(inline.getByRole("button")).toHaveCount(0);
  await context.close();
});
