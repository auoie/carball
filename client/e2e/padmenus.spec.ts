// The menus with a pad (src/ui/padNav.ts): Start opens the pause menu, the D-pad moves a visible focus along the page's
// rows, A presses, B backs out (the settings, then the pause menu), Start closes; a held A after the menu doesn't jump
// the car; the settings' tabs on the bumpers, a value changed in place by left and right. (Nothing drawn: `?render=off`.)
import { type Page } from "@playwright/test";
import { expect, fakeGamepad, test } from "./fixtures";

const A = 0;
const B = 1;
const LB = 4;
const RB = 5;
const START = 9;
const DOWN = 13;
const RIGHT = 15;

/** Holds `buttons` (and the sticks at `axes`) for one of the page's frames, then lets go for two: not a fixed time (under
 *  the tests' load a frame can outlast a short hold, the press never seen), and not two frames (two of them can outlast
 *  the menus' 0.2 s repeat delay, a direction moving twice). The game's frame reads the pad before this one's callback
 *  (asked for first), so the press is always seen */
async function tap(page: Page, buttons: number[], axes = [0, 0, 0, 0]): Promise<void> {
  await page.evaluate(
    async ({ b, a }) => {
      const w = window as unknown as { carballSetPad: (down: number[], axes?: number[]) => void };
      const frames = (n: number): Promise<void> =>
        new Promise((resolve) => {
          const step = (k: number): void => {
            if (k === 0) resolve();
            else
              requestAnimationFrame(() => {
                step(k - 1);
              });
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
  // (Start on the main menu: nothing, never a step back: RV-475)
  await tap(page, [START]);
  await expect(menu.getByRole("button", { name: /^free play$/i })).toBeVisible();
  await expect(page.locator("#pause-menu")).toBeHidden();
  // (focus Free Play: down from the top until it holds it, then A)
  for (let i = 0; i < 4 && !(await menu.getByRole("button", { name: /^free play$/i }).evaluate((b) => b.classList.contains("pad-focus"))); i++)
    await tap(page, [DOWN]);
  // (A on Free Play: free play at once, on the one map offered)
  await tap(page, [A]);
  await expect(menu).toBeHidden();
  // Start: the pause menu; down moves the focus; A on Settings opens them; B backs out to the pause menu, B again closes it
  await tap(page, [START]);
  const pause = page.locator("#pause-menu");
  await expect(pause).toBeVisible();
  await tap(page, [DOWN]);
  await expect(pause.locator(".pad-focus")).toHaveCount(1);
  for (let i = 0; i < 4 && !(await pause.getByRole("button", { name: /^settings$/i }).evaluate((b) => b.classList.contains("pad-focus"))); i++)
    await tap(page, [DOWN]);
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
  for (let i = 0; i < 4 && !(await pause.getByRole("button", { name: /^settings$/i }).evaluate((el) => el.classList.contains("pad-focus"))); i++)
    await tap(page, [], [0, 1, 0, 0]);
  await tap(page, [A]);
  await expect(page.locator("#settings")).toBeVisible();
  // (Start with the settings open: the pause menu closed, the settings with it, no page backed out of: RV-475)
  await tap(page, [START]);
  await expect(page.locator("#settings")).toBeHidden();
  await expect(pause).toBeHidden();
  expect(errors).toEqual([]);
});

test("a pad input bound in the settings: Circle (B) and Start bind, they don't back out or close (the user's finding)", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fakeGamepad(context);
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await page
    .locator("#main-menu")
    .getByRole("button", { name: /^settings$/i })
    .click();
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
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        }),
    );
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

test("the settings with a pad: the bumpers step the tabs (stopping at the ends), right steps a slider in place, its row kept and highlighted, the hints (MENU-12..17)", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fakeGamepad(context);
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await page
    .locator("#main-menu")
    .getByRole("button", { name: /^settings$/i })
    .click();
  const settings = page.locator("#settings");
  await expect(settings).toBeVisible();
  const tabs = settings.locator(".settings-tab");
  const count = await tabs.count();
  // Opened on the first tab; RB through every tab, staying on the last; LB back, staying on the first
  await expect(tabs.nth(0)).toHaveClass(/\bactive\b/);
  for (let i = 1; i < count; i++) {
    await tap(page, [RB]);
    await expect(tabs.nth(i)).toHaveClass(/\bactive\b/);
  }
  await tap(page, [RB]);
  await expect(tabs.nth(count - 1)).toHaveClass(/\bactive\b/);
  for (let i = count - 2; i >= 0; i--) {
    await tap(page, [LB]);
    await expect(tabs.nth(i)).toHaveClass(/\bactive\b/);
  }
  await tap(page, [LB]);
  await expect(tabs.nth(0)).toHaveClass(/\bactive\b/);
  // The Camera tab: its first row (the first preset) focused; down to its first slider, its row highlighted; right steps
  // it, the focus kept there
  await tap(page, [RB]);
  await expect(tabs.nth(1)).toHaveClass(/\bactive\b/);
  await expect(settings.locator(".settings-body button").first()).toHaveClass(/pad-focus/);
  const slider = settings.locator('.settings-body [role="slider"]').first();
  for (let i = 0; i < 4 && !(await slider.evaluate((s) => s.classList.contains("pad-focus"))); i++) await tap(page, [DOWN]);
  await expect(slider).toHaveClass(/pad-focus/);
  await expect(settings.locator(".pad-row")).toHaveCount(1);
  const before = Number(await slider.getAttribute("aria-valuenow"));
  await tap(page, [RIGHT]);
  await expect.poll(async () => Number(await settings.locator('.settings-body [role="slider"]').first().getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  await expect(settings.locator('.settings-body [role="slider"]').first()).toHaveClass(/pad-focus/);
  // Down: the next row
  await tap(page, [DOWN]);
  await expect(settings.locator('.settings-body [role="slider"]').nth(1)).toHaveClass(/pad-focus/);
  // The hints (the pad's mode): B Back, X Default (this page has a reset), in the pad's glyphs
  await expect(page.locator("#menu-hints")).toBeVisible();
  await expect(page.locator("#menu-hints")).toContainText("Back");
  await expect(page.locator("#menu-hints")).toContainText("Default");
  await expect(page.locator("#menu-hints .key-pad")).toHaveCount(2);
  // The Gameplay tab (our own controls, src/ui/controls.ts): its first row a checkbox, A toggles it; down to a list,
  // right steps its value in place (no popup)
  await tap(page, [RB]);
  await tap(page, [RB]);
  await expect(tabs.nth(3)).toHaveClass(/\bactive\b/);
  const boost = settings.locator('[data-option="unlimitedBoost"]');
  await expect(boost).toHaveClass(/pad-focus/);
  await expect(boost).toHaveAttribute("aria-checked", "true");
  await tap(page, [A]);
  await expect(settings.locator('[data-option="unlimitedBoost"]')).toHaveAttribute("aria-checked", "false");
  await tap(page, [DOWN]);
  const level = settings.locator('[data-setting="statDisplayLevel"]');
  await expect(level).toHaveClass(/pad-focus/);
  const was = await level.getAttribute("data-value");
  await tap(page, [RIGHT]);
  await expect(settings.locator('[data-setting="statDisplayLevel"]')).not.toHaveAttribute("data-value", was ?? "");
  await expect(settings.locator('[data-setting="statDisplayLevel"]')).toHaveClass(/pad-focus/);
  await tap(page, [B]);
  await expect(settings).toBeHidden();
  expect(errors).toEqual([]);
});

test("online with a pad: Leave Match's question opens on NO, so a second A keeps the match (MENU-15, RV-472)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await fakeGamepad(context);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?server=127.0.0.1:14444&render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await tap(page, []);
  await tap(page, [START]);
  const menu = page.locator("#pause-menu");
  await expect(menu).toBeVisible();
  // (down the menu's rows to the match's own button: Leave Match, or Forfeit Match where a vote is open)
  const focused = (): Promise<string> => page.evaluate(() => document.querySelector(".pad-focus")?.textContent.trim() ?? "");
  for (let i = 0; i < 12 && !/^(leave|forfeit) match$/i.test(await focused()); i++) await tap(page, [DOWN]);
  await expect.poll(focused).toMatch(/^(leave|forfeit) match$/i);
  await tap(page, [A]);
  await expect(menu.locator("button", { hasText: /^yes$/i })).toBeVisible();
  await expect.poll(focused).toMatch(/^no$/i);
  // (a second A: NO, the question gone, the match kept)
  await tap(page, [A]);
  await expect(menu.locator("button", { hasText: /^yes$/i })).toHaveCount(0);
  await expect(menu).toBeVisible();
  // (asked again, B: only the question goes, the pause menu stays: RV-478)
  for (let i = 0; i < 12 && !/^(leave|forfeit) match$/i.test(await focused()); i++) await tap(page, [DOWN]);
  await tap(page, [A]);
  await expect(menu.locator("button", { hasText: /^yes$/i })).toBeVisible();
  await tap(page, [B]);
  await expect(menu.locator("button", { hasText: /^yes$/i })).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(page).toHaveURL(/server=127\.0\.0\.1:14444/);
  expect(errors).toEqual([]);
});
