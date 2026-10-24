// The respawn view (notes/hud-menus.md HUD-20, RH1): demolished, the game's two bars shrinking toward the hourglass and
// "[A] - RESPAWN LEFT" / "[D] - RESPAWN RIGHT" with the keyboard's steer keys, no seconds; steering picks a side, its spot
// lit; gone at the prespawn. Nothing of the 3D drawn (`?render=off`).
import type { Page } from "@playwright/test";
import { expect, fakeGamepad, test } from "./fixtures";
import { freePlay } from "./players";

test("demolished: the bars and the steer keys' prompts, a side picked by steering, gone at the prespawn (HUD-20)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  const view = page.locator("#respawn");
  await expect(view).toBeHidden();
  await expect(page.locator("#boost")).toBeVisible();
  await demolished(page);
  await expect(view).toBeVisible();
  // (no car's HUD while demolished: the boost meter gone, HUD-16, RV-513)
  await expect(page.locator("#boost")).toBeHidden();
  await expect(page.locator("#respawn-left")).toHaveText("[A] - Respawn Left");
  await expect(page.locator("#respawn-right")).toHaveText("[D] - Respawn Right");
  await expect(view).not.toContainText(/\d\s*s\b/);
  // (steer right: that side picked, its inner spot lit)
  await page.keyboard.down("KeyD");
  await expect(page.locator(".respawn-side.right")).toHaveClass(/picked/);
  await expect(page.locator(".respawn-side.right .respawn-spots i.lit")).toHaveCount(1);
  await page.keyboard.up("KeyD");
  // (orange from 60 %, then gone at the prespawn: 1 and 2.5 game s after the demolition, the game's time slower than the
  // clock's under the suite's load: its frames' time clamped)
  await expect(view).toHaveClass(/late/, { timeout: 20_000 });
  await expect(view).toBeHidden({ timeout: 40_000 });
  // (respawned: the meter back)
  await expect(page.locator("#boost")).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

/** Demolished once free play's own restart has run (one before it is undone by the restart's placing) */
async function demolished(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const el = document.querySelector<HTMLElement>("#respawn");
          const shown = el !== null && !el.hidden;
          if (!shown) (window as unknown as { carballFreeplay: { demolish: () => void } }).carballFreeplay.demolish();
          return shown;
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
}

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`with a pad: the sticks' badges in the prompts, the two sides apart at ${String(width)}x${String(height)} (RV-512)`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height } });
    await fakeGamepad(context);
    const page = await context.newPage();
    await page.goto("/?render=off");
    await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
    await freePlay(page);
    // (a pad press: the pad's prompts. Held until the page draws them, the ball cam indicator's toggle in a pad button's
    // glyph (drawn while the indicator is unseen): a press shorter than a loaded page's frame was never polled, the
    // keyboard's prompts kept)
    const setPad = (down: number[]): Promise<void> =>
      page.evaluate((d) => {
        (window as unknown as { carballSetPad: (down: number[]) => void }).carballSetPad(d);
      }, down);
    const padGlyph = page.locator("#ballcam-toggle .key-pad");
    await expect(padGlyph, "the keyboard's before the press").toHaveCount(0);
    await setPad([0]);
    await expect(padGlyph).toBeAttached({ timeout: 15_000 });
    await setPad([]);
    await demolished(page);
    await expect(page.locator("#respawn-left .key-stick")).toHaveText("L◂");
    await expect(page.locator("#respawn-right .key-stick")).toHaveText("L▸");
    const box = async (side: string): Promise<{ x: number; width: number }> => {
      const b = await page.locator(`.respawn-side.${side}`).boundingBox();
      if (!b) throw new Error(`no ${side} prompt`);
      return b;
    };
    const [left, right] = [await box("left"), await box("right")];
    expect(left.x + left.width).toBeLessThan(right.x);
    // (both on the screen)
    expect(left.x).toBeGreaterThan(0);
    expect(right.x + right.width).toBeLessThan(width);
    await context.close();
  });
}
