// The Video tab (MENU-19..21, GQ1; src/settings/video.ts): Render Detail's presets and Custom, Render Quality's share of
// the view's resolution (the HUD kept full), and the automatic default on a weak GPU (the user's decisions, 2026-10-16)
import type { Page } from "@playwright/test";
import { expect, test, videoAuto } from "./fixtures";
import { closeMenus, cycleTo, freePlay, openSettings } from "./players";

/** The 3D view's drawing buffer over its box on the page (the device pixel ratio 1 here) */
const drawnShare = async (page: Page): Promise<number> =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#game");
    if (!canvas) throw new Error("no canvas");
    return canvas.width / canvas.clientWidth;
  });

const videoTab = async (page: Page): Promise<void> => {
  await openSettings(page);
  await page.locator('.settings-tab[data-tab="video"]').click();
};

test("Render Detail's presets set the switches, a switch changed makes it Custom; Render Quality draws the view smaller (MENU-19/20)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  expect(await drawnShare(page)).toBeCloseTo(1, 2);
  await videoTab(page);
  const settings = page.locator("#settings");
  // (the game's labels, its no-op rows not shown)
  for (const label of ["Render Quality", "Render Detail", "World Detail", "Particle Detail", "High Quality Shaders", "Depth of Field", "Bloom"]) {
    await expect(settings.getByText(label, { exact: true }).first()).toBeVisible();
  }
  for (const label of ["Ambient Occlusion", "Motion Blur", "Light Shafts", "Lens Flares", "Dynamic Shadows", "Weather Effects", "Effect Intensity"]) {
    await expect(settings.getByText(label, { exact: true })).toHaveCount(0);
  }
  await cycleTo(page, '[data-setting="renderDetail"]', "performance");
  await expect(page.locator('[data-setting="worldDetail"]')).toHaveAttribute("data-value", "performance");
  await expect(page.locator('[data-setting="particleDetail"]')).toHaveAttribute("data-value", "performance");
  await expect(page.locator('[data-setting="highQualityShaders"]')).toHaveAttribute("aria-checked", "false");
  await expect(page.locator('[data-option="bloom"]')).toHaveAttribute("aria-checked", "false");
  // A switch changed by hand: Custom
  await page.locator('[data-option="bloom"]').click();
  await expect(page.locator('[data-setting="renderDetail"]')).toHaveAttribute("data-value", "custom");
  // Render Quality: High Performance, 55 % each way (and Custom stays)
  await cycleTo(page, '[data-setting="renderQuality"]', "highPerformance");
  await expect.poll(async () => drawnShare(page)).toBeCloseTo(0.55, 2);
  await closeMenus(page);
  // Remembered
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect(await drawnShare(page)).toBeCloseTo(0.55, 2);
  expect(errors).toEqual([]);
});

test("on a weak GPU the default is Performance (70 %) and Quality until the player chooses; Default goes back to it (MENU-21, the user's decision)", async ({
  page,
  context,
}) => {
  await videoAuto(context, true, false);
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  expect(await drawnShare(page)).toBeCloseTo(0.7, 2);
  await videoTab(page);
  await expect(page.locator('[data-setting="renderQuality"]')).toHaveAttribute("data-value", "performance");
  await expect(page.locator('[data-setting="renderDetail"]')).toHaveAttribute("data-value", "quality");
  await expect(page.locator('[data-option="bloom"]')).toHaveAttribute("aria-checked", "false");
  // The player's own choice wins, the page loaded again too
  await cycleTo(page, '[data-setting="renderQuality"]', "highQuality");
  await expect.poll(async () => drawnShare(page)).toBeCloseTo(1, 2);
  await closeMenus(page);
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect(await drawnShare(page)).toBeCloseTo(1, 2);
  // (the choice undone, as the tab's Default does: settingsPanel pageDefaults): the automatic default again
  await page.evaluate(() => {
    const raw = localStorage.getItem("carball.settings.v1") ?? "{}";
    const s = JSON.parse(raw) as { video?: Record<string, unknown> };
    localStorage.setItem("carball.settings.v1", JSON.stringify({ ...s, video: { ...s.video, chosen: false } }));
  });
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect(await drawnShare(page)).toBeCloseTo(0.7, 2);
});

test("the frame-rate guard on a slow page: one step down after its warm-up and measure, saved, never again (RV-499)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await videoAuto(context, false, true);
  // (a synthetic clock, whatever the page really takes: a 60 Hz display's, its first 60 frames at its rate (the refresh
  // meter reads 60: RV-514, RV-519), then each frame 33 ms on, varied as a GPU-bound page's)
  await context.addInitScript(() => {
    const real = window.requestAnimationFrame.bind(window);
    const pattern = [0.85, 1.15, 1, 0.9, 1.1];
    let t = 0;
    let i = 0;
    window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
      real(() => {
        t += i < 60 ? 1000 / 60 : (1000 / 30) * (pattern[i % pattern.length] ?? 1);
        i++;
        callback(t);
      });
  });
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await freePlay(page);
  expect(await drawnShare(page)).toBeCloseTo(1, 2);
  // (3 s of warm-up and 4 of measure on the synthetic clock: Performance 70 % and Quality)
  await expect.poll(async () => drawnShare(page), { timeout: 90_000 }).toBeCloseTo(0.7, 2);
  const saved = await page.evaluate(
    () => (JSON.parse(localStorage.getItem("carball.settings.v1") ?? "{}") as { video?: { autoLevel?: number; stepped?: boolean } }).video,
  );
  expect(saved).toMatchObject({ autoLevel: 1, stepped: true });
});
