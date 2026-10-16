// The HUD's key prompts (HT-3) hold their place whatever glyph they show (the user's finding, 2026-10-16): the ball-cam
// indicator's head (the dot and BALL CAM) and its hint row don't move when the last input switches between the mouse (an
// outline), the pad (a badge) and the keyboard (a word). Nothing drawn (`?render=off`).
import type { Page } from "@playwright/test";
import { expect, fakeGamepad, test } from "./fixtures";
import { closeMenus, freePlay, openSettings } from "./players";

/** The pad held so for one of the page's frames, then let go for two (as padmenus.spec.ts taps) */
async function tap(page: Page, buttons: number[], axes: number[]): Promise<void> {
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

/** The indicator's label, dot and hint row (CSS px), once its slide in is over (its 20 px: waited for, not timed, a
 *  loaded page's transition can outlast a fixed wait) */
async function boxes(page: Page): Promise<Record<"label" | "dot" | "hint", { left: number; top: number; bottom: number } | null>> {
  await page.waitForFunction(() => {
    const el = document.querySelector("#ballcam");
    return el !== null && new DOMMatrix(getComputedStyle(el).transform).m41 === 20;
  });
  return page.evaluate(() => {
    const box = (selector: string): { left: number; top: number; bottom: number } | null => {
      const r = document.querySelector(selector)?.getBoundingClientRect();
      return r ? { left: r.left, top: r.top, bottom: r.bottom } : null;
    };
    return { label: box(".ballcam-head > span:not(.rec-dot)"), dot: box(".ballcam-head .rec-dot"), hint: box("#ballcam .rec-hint") };
  });
}

test("the ball-cam label holds its place whether its prompt shows the mouse, a pad button or a key (HUD-12, HT-3)", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fakeGamepad(context);
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  // (the keyboard's and mouse's ball cam toggled too, so its prompt shows)
  await openSettings(page);
  await page.locator(".settings-tab", { hasText: "Camera" }).click();
  await page.locator('input[data-camera="cameraKbm"][data-option="ballCamToggle"]').check();
  await closeMenus(page);
  const indicator = page.locator("#ballcam");
  const toggle = page.locator("#ballcam-toggle");
  // The middle button toggles it on: the prompt shows the mouse
  await page.mouse.move(640, 360);
  await page.mouse.click(640, 360, { button: "middle" });
  await expect(indicator).toHaveClass(/shown/);
  await expect(toggle.locator(".key-glyph.key-mouse")).toHaveCount(1);
  const mouse = await boxes(page);
  // The pad's stick moved: the pad's Y badge
  await tap(page, [], [0.8, 0, 0, 0]);
  await expect(toggle.locator(".key-glyph.key-pad")).toHaveCount(1);
  const pad = await boxes(page);
  // Rebound to B, the keyboard last: the word (the settings reopen on their last tab, the camera's)
  await openSettings(page);
  await page.locator(".settings-tab", { hasText: "Controls" }).click();
  const slot = page.locator('.binding-slot[data-action="ballCam"][data-device="keyboard"]');
  await slot.click();
  await expect(slot).toHaveClass(/capturing/);
  await page.keyboard.press("KeyB");
  await expect(slot).toHaveText("B");
  await closeMenus(page);
  await expect(indicator).toHaveClass(/shown/);
  await expect(toggle.locator(".key-glyph.key-word")).toHaveText("B");
  const word = await boxes(page);
  // (the same boxes, to a hundredth of a pixel: the head and the hint's row)
  for (const [name, other] of [["pad", pad], ["word", word]] as const) {
    for (const part of ["label", "dot", "hint"] as const) {
      for (const edge of ["left", "top", "bottom"] as const) {
        expect(Math.abs((other[part]?.[edge] ?? Number.NaN) - (mouse[part]?.[edge] ?? Number.NaN)), `${name}: ${part} ${edge}`).toBeLessThan(0.01);
      }
    }
  }
  expect(errors).toEqual([]);
});
