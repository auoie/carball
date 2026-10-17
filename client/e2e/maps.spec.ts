// Night, the one map (the user's decision, 2026-10-17): free play's and every match's. Play, Free Play starts free play
// on it at once, on this page; a pick an older page's map select kept is ignored. Nothing drawn (`?render=off`).
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const mapOf = async (page: Page): Promise<string> => page.evaluate(() => (window as unknown as { carballMap: () => string }).carballMap());

test("one map: the page opens on Night (an old pick ignored), Free Play starts on it at once", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // (a pick an older page's map select kept: not used)
  await context.addInitScript(() => {
    localStorage.setItem("carball.freeplayMap", "meadow");
  });
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect(await mapOf(page)).toBe("night");
  await page.evaluate(() => {
    (window as unknown as { samePage?: boolean }).samePage = true;
  });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await expect(menu).toBeHidden();
  // Back at the main menu, Free Play again: at once, nothing loaded again
  await page.keyboard.press("Escape");
  const pause = page.locator("#pause-menu");
  await pause.getByRole("button", { name: /^exit to main menu$/i }).click();
  await pause.getByRole("button", { name: /^yes$/i }).click();
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { samePage?: boolean }).samePage)).toBe(true);
  expect(await mapOf(page)).toBe("night");
  expect(errors).toEqual([]);
});
