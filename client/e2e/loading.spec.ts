// The loading screen (src/ui/loadingScreen.ts: ours, the user's request): over the whole game layer while loading (no
// HUD piece through it: the user's finding), its steps over the bar, free play's map and mode named, then faded into
// the game's first frame. Nothing drawn (`?render=off`).
import { expect, test } from "./fixtures";

test("the loading screen covers the game layer until the first frame, names free play's map, and fades out", async ({ page, context }) => {
  // (the engine's download held: the loading screen stays up to be looked at)
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route("**/*.wasm", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/?render=off");
  const loading = page.locator("#loading");
  await expect(loading.locator(".loading-step")).toHaveText("Loading the physics engine");
  await expect(loading.locator(".loading-title")).toHaveText("Carball");
  // (the menu page: no map or mode line)
  await expect(loading.locator(".loading-place")).toBeHidden();
  // Whatever's under the corners and the top centre is the loading screen's
  const topmost = async (): Promise<boolean[]> =>
    page.evaluate(() =>
      [
        [10, 10],
        [innerWidth / 2, 20],
        [innerWidth - 10, innerHeight - 10],
      ].map(([x = 0, y = 0]) => document.elementFromPoint(x, y)?.closest("#loading") !== null),
    );
  expect(await topmost()).toEqual([true, true, true]);
  release();
  await expect(loading).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#main-menu")).toBeVisible();
  // Free play on another map from the map select: its page loads it, named on the loading screen
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await menu.locator('.main-menu-map[data-map="meadow"]').click();
  await expect(page.locator("#loading .loading-place")).toHaveText("Meadow · Free Play", { timeout: 30_000 });
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await expect(menu).toBeHidden();
});
