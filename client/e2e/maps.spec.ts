// Free Play's map select (the user's decision, 2026-10-15): Play, Free Play, then the maps by name, the last pick checked
// and focused. Another map loads the page straight into free play on it, and is kept for the next page; the page's own map
// starts at once. With the keyboard (Tab, Enter, Escape); the pad's in padmenus.spec.ts. Nothing drawn (`?render=off`).
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const mapOf = async (page: Page): Promise<string> => page.evaluate(() => (window as unknown as { carballMap: () => string }).carballMap());

test("Free Play's map select with the keyboard: the maps by name, another loads into free play and is kept, Escape backs out", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect(await mapOf(page)).toBe("night");
  const menu = page.locator("#main-menu");
  const map = (name: string) => menu.locator(`.main-menu-map[data-map="${name}"]`);
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await expect(menu.locator(".main-menu-map")).toHaveCount(16);
  await expect(menu.locator(".main-menu-map").first()).toHaveText(/^night$/i);
  await expect(map("meadow")).toHaveText(/^meadow$/i);
  // (the last pick, night before any, checked and focused)
  await expect(map("night")).toHaveAttribute("aria-checked", "true");
  await expect(map("night")).toBeFocused();
  // Escape backs out to Play's page; Free Play again: the maps
  await page.keyboard.press("Escape");
  await expect(menu.getByRole("button", { name: /^free play$/i })).toBeVisible();
  await expect(menu.locator(".main-menu-maps")).toBeHidden();
  await menu.getByRole("button", { name: /^free play$/i }).click();
  // Tab twice: Meadow; Enter: the page loads it, straight into free play
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(map("meadow")).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (window as unknown as { carballMap?: () => string }).carballMap?.() === "meadow", undefined, { timeout: 30_000 });
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("carball.freeplayMap"))).toBe("meadow");
  // Back at the main menu: Meadow checked and focused; Enter starts it on this page, nothing loaded again
  await page.evaluate(() => {
    (window as unknown as { samePage?: boolean }).samePage = true;
  });
  await page.keyboard.press("Escape");
  const pause = page.locator("#pause-menu");
  await pause.getByRole("button", { name: /^exit to main menu$/i }).click();
  await pause.getByRole("button", { name: /^yes$/i }).click();
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await expect(map("meadow")).toHaveAttribute("aria-checked", "true");
  await expect(map("night")).toHaveAttribute("aria-checked", "false");
  await expect(map("meadow")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { samePage?: boolean }).samePage)).toBe(true);
  // A new page opens on the kept map, its menu first
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect(await mapOf(page)).toBe("meadow");
  await expect(menu).toBeVisible();
  expect(errors).toEqual([]);
});

test("?theme= still overrides the map (development); a pick from the map select drops it", async ({ page }) => {
  await page.goto("/?render=off&theme=lake");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect(await mapOf(page)).toBe("lake");
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await menu.locator('.main-menu-map[data-map="city"]').click();
  await page.waitForURL((url) => !url.search.includes("theme="), { timeout: 30_000 });
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect(await mapOf(page)).toBe("city");
  expect(new URL(page.url()).searchParams.get("render")).toBe("off");
});
