// The menus with a pad (src/ui/padNav.ts): Start opens the pause menu, the D-pad moves a visible focus, A presses, B
// backs out (the settings, then the pause menu), Start closes; a held A after the menu doesn't jump the car. (Nothing
// drawn: `?render=off`.)
import { type Page } from "@playwright/test";
import { expect, fakeGamepad, test } from "./fixtures";

const A = 0;
const B = 1;
const START = 9;
const DOWN = 13;
const LEFT = 14;
const RIGHT = 15;

/** Holds `buttons` (and the sticks at `axes`) for one of the page's frames, then lets go for two: not a fixed time (under
 *  the tests' load a frame can outlast a short hold, the press never seen), and not two frames (two of them can outlast
 *  the menus' 0.4 s repeat delay, a direction moving twice). The game's frame reads the pad before this one's callback
 *  (asked for first), so the press is always seen */
async function tap(page: Page, buttons: number[], axes = [0, 0, 0, 0]): Promise<void> {
  await page.evaluate(
    async ({ b, a }) => {
      const w = window as unknown as { carballSetPad: (down: number[], axes?: number[]) => void };
      const frames = (n: number): Promise<void> =>
        new Promise((resolve) => {
          const step = (k: number): void => {
            if (k === 0) resolve();
            else requestAnimationFrame(() => { step(k - 1); });
          };
          step(n);
        });
      w.carballSetPad(b, a);
      await frames(1);
      w.carballSetPad([]);
      await frames(2);
    },
    { b: buttons, a: axes },
  );
}

test("menus with a pad: Start, the D-pad's focus, A, B (MENU-1/4)", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fakeGamepad(context);
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  // The main menu: its first control (Play) highlighted at once, A presses it: Free Play's page
  const menu = page.locator("#main-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: /^play$/i })).toHaveClass(/pad-focus/);
  await tap(page, [A]);
  await expect(menu.getByRole("button", { name: /^free play$/i })).toBeVisible();
  // (focus Free Play: down from the top until it holds it, then A)
  for (let i = 0; i < 4 && !(await menu.getByRole("button", { name: /^free play$/i }).evaluate((b) => b.classList.contains("pad-focus"))); i++) await tap(page, [DOWN]);
  await tap(page, [A]);
  // (Free Play's map select: the last pick, night before any, highlighted at once; A starts free play on it)
  await expect(menu.locator('.main-menu-map[data-map="night"]')).toHaveClass(/pad-focus/);
  await tap(page, [A]);
  await expect(menu).toBeHidden();
  // Start: the pause menu; down moves the focus; A on Settings opens them; B backs out to the pause menu, B again closes it
  await tap(page, [START]);
  const pause = page.locator("#pause-menu");
  await expect(pause).toBeVisible();
  await tap(page, [DOWN]);
  await expect(pause.locator(".pad-focus")).toHaveCount(1);
  for (let i = 0; i < 4 && !(await pause.getByRole("button", { name: /^settings$/i }).evaluate((b) => b.classList.contains("pad-focus"))); i++) await tap(page, [DOWN]);
  await tap(page, [A]);
  await expect(page.locator("#settings")).toBeVisible();
  await tap(page, [B]);
  await expect(page.locator("#settings")).toBeHidden();
  await expect(pause).toBeVisible();
  await tap(page, [B]);
  await expect(pause).toBeHidden();
  // Start opens it again, Resume Game highlighted; A closes it, and the held A doesn't jump the car
  await tap(page, [START]);
  await expect(pause).toBeVisible();
  await expect(pause.getByRole("button", { name: /^resume game$/i })).toHaveClass(/pad-focus/);
  const z0 = await page.evaluate(() => (window as unknown as { carballFreeplay: { car: () => { pos: { z: number } } } }).carballFreeplay.car().pos.z);
  await tap(page, [A]);
  await expect(pause).toBeHidden();
  await page.waitForTimeout(400);
  const z1 = await page.evaluate(() => (window as unknown as { carballFreeplay: { car: () => { pos: { z: number } } } }).carballFreeplay.car().pos.z);
  expect(Math.abs(z1 - z0)).toBeLessThan(5);
  // The user's path (finding 15): the pause menu opened with Escape, the left stick down to Settings, A opens them
  await page.keyboard.press("Escape");
  await expect(pause).toBeVisible();
  for (let i = 0; i < 4 && !(await pause.getByRole("button", { name: /^settings$/i }).evaluate((el) => el.classList.contains("pad-focus"))); i++) await tap(page, [], [0, 1, 0, 0]);
  await tap(page, [A]);
  await expect(page.locator("#settings")).toBeVisible();
  await tap(page, [B]);
  await tap(page, [B]);
  await expect(pause).toBeHidden();
  expect(errors).toEqual([]);
});

test("a pad input bound in the settings: Circle (B) and Start bind, they don't back out or close (the user's finding)", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fakeGamepad(context);
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await page.locator("#main-menu").getByRole("button", { name: /^settings$/i }).click();
  const settings = page.locator("#settings");
  await expect(settings).toBeVisible();
  const slot = settings.locator('.binding-slot[data-device="gamepad"]').first();
  const action = await slot.getAttribute("data-action");
  const same = settings.locator(`.binding-slot[data-device="gamepad"][data-action="${action ?? ""}"]`);
  for (const [button, name] of [
    [B, /^(B|Circle)$/],
    [START, /^(Menu|Options)$/],
  ] as const) {
    await same.click();
    await expect(same).toHaveText("Press or move a gamepad input…");
    // (two of the page's frames first: the capture waits to see the pad released, so a press before its first poll is
    // rightly not taken, RV-448)
    await page.evaluate(() => new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); }));
    await tap(page, [button]);
    await expect(settings).toBeVisible();
    await expect(same).toHaveText(name);
  }
  // Escape still cancels a capture, the binding as it was
  await same.click();
  await page.keyboard.press("Escape");
  await expect(same).toHaveText(/^(Menu|Options)$/);
  await expect(settings).toBeVisible();
  expect(errors).toEqual([]);
});

test("the settings' tabs with a pad: right and left step through them in order across their wrapped rows (the user's finding)", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fakeGamepad(context);
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await page.locator("#main-menu").getByRole("button", { name: /^settings$/i }).click();
  const settings = page.locator("#settings");
  await expect(settings).toBeVisible();
  const tabs = settings.locator(".settings-tab");
  // (the panel is at most 760 px wide: on a desktop window its tabs wrap as on the user's)
  const rows = await tabs.evaluateAll((all) => new Set(all.map((t) => Math.round(t.getBoundingClientRect().top))).size);
  expect(rows).toBeGreaterThan(1);
  const count = await tabs.count();
  // The panel's first control, the first tab, highlighted at once; right through every tab (Camera to Controller, the
  // last of a row to the first of the next), then left back
  await expect(tabs.nth(0)).toHaveClass(/pad-focus/);
  for (let i = 1; i < count; i++) {
    await tap(page, [RIGHT]);
    await expect(tabs.nth(i)).toHaveClass(/pad-focus/);
  }
  for (let i = count - 2; i >= 0; i--) {
    await tap(page, [LEFT]);
    await expect(tabs.nth(i)).toHaveClass(/pad-focus/);
  }
  // A on a highlighted tab shows its page
  await tap(page, [RIGHT]);
  await tap(page, [A]);
  await expect(tabs.nth(1)).toHaveClass(/\bactive\b/);
  expect(errors).toEqual([]);
});

test("Free Play's map select with a pad: the D-pad along the maps, A loads another into free play, B backs out (the user's decision)", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fakeGamepad(context);
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const menu = page.locator("#main-menu");
  await tap(page, [A]); // (Play)
  for (let i = 0; i < 4 && !(await menu.getByRole("button", { name: /^free play$/i }).evaluate((b) => b.classList.contains("pad-focus"))); i++) await tap(page, [DOWN]);
  await tap(page, [A]);
  await expect(menu.locator('.main-menu-map[data-map="night"]')).toHaveClass(/pad-focus/);
  // B: back to Play's page; A on Free Play: the maps again
  await tap(page, [B]);
  await expect(menu.getByRole("button", { name: /^free play$/i })).toBeVisible();
  await expect(menu.locator(".main-menu-maps")).toBeHidden();
  for (let i = 0; i < 4 && !(await menu.getByRole("button", { name: /^free play$/i }).evaluate((b) => b.classList.contains("pad-focus"))); i++) await tap(page, [DOWN]);
  await tap(page, [A]);
  // Right: Stadium, beside Night; A loads it, straight into free play
  await tap(page, [RIGHT]);
  await expect(menu.locator('.main-menu-map[data-map="stadium"]')).toHaveClass(/pad-focus/);
  // (the press loads the page anew while the tap still waits on its frames)
  await tap(page, [A]).catch((e: unknown) => {
    if (!String(e).includes("Execution context was destroyed")) throw e;
  });
  await page.waitForFunction(() => (window as unknown as { carballMap?: () => string }).carballMap?.() === "stadium", undefined, { timeout: 30_000 });
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#main-menu")).toBeHidden();
  expect(errors).toEqual([]);
});
