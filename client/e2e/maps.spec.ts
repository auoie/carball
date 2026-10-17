// The one map offered (the user's decision, 2026-10-17): Night's greenhouse, free play's and every match's. Play, Free
// Play starts free play on it at once, on this page: no map select (its code kept, out of the flow), an old pick ignored.
// ?theme= still overrides the map (development). Nothing drawn (`?render=off`).
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const mapOf = async (page: Page): Promise<string> => page.evaluate(() => (window as unknown as { carballMap: () => string }).carballMap());

test("one map: the page opens on Night's greenhouse (an old pick ignored), Free Play starts on it at once, no map select", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // (a pick the map select kept before: not used)
  await context.addInitScript(() => {
    localStorage.setItem("carball.freeplayMap", "meadow");
  });
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect(await mapOf(page)).toBe("greenhouse");
  await page.evaluate(() => {
    (window as unknown as { samePage?: boolean }).samePage = true;
  });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".main-menu-maps")).toBeHidden();
  // Back at the main menu, Free Play again: at once, nothing loaded again
  await page.keyboard.press("Escape");
  const pause = page.locator("#pause-menu");
  await pause.getByRole("button", { name: /^exit to main menu$/i }).click();
  await pause.getByRole("button", { name: /^yes$/i }).click();
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { samePage?: boolean }).samePage)).toBe(true);
  expect(await mapOf(page)).toBe("greenhouse");
  expect(errors).toEqual([]);
});

test("?theme= still overrides the map (development); Free Play then loads the one offered", async ({ page }) => {
  await page.goto("/?render=off&theme=lake");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect(await mapOf(page)).toBe("lake");
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await page.waitForURL((url) => !url.search.includes("theme="), { timeout: 30_000 });
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect(await mapOf(page)).toBe("greenhouse");
  await expect(menu).toBeHidden();
  expect(new URL(page.url()).searchParams.get("render")).toBe("off");
});
