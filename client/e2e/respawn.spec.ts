// The respawn view (notes/hud-menus.md HUD-20, RH1): demolished, the game's two bars shrinking toward the hourglass and
// "[A] - RESPAWN LEFT" / "[D] - RESPAWN RIGHT" with the keyboard's steer keys, no seconds; steering picks a side, its spot
// lit; gone at the prespawn. Nothing of the 3D drawn (`?render=off`).
import { expect, test } from "./fixtures";
import { freePlay } from "./players";

test("demolished: the bars and the steer keys' prompts, a side picked by steering, gone at the prespawn (HUD-20)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  const view = page.locator("#respawn");
  await expect(view).toBeHidden();
  // (demolished once free play's own restart has run: one before it is undone by the restart's placing)
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
  await expect(view).toBeVisible();
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
  expect(errors).toEqual([]);
});
