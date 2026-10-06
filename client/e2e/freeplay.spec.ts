import { type Page, expect, test } from "@playwright/test";

async function speed(page: Page): Promise<number> {
  const text = (await page.locator("#speed").textContent()) ?? "";
  return Number.parseInt(text, 10);
}

test("freeplay loads, drives and resets", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#boost-value")).toHaveText("33"); // kickoff boost
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "middle" }); // focus

  // Hold W: the car accelerates (about 1350 uu/s after 2 s of throttle)
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1500);
  expect(await speed(page)).toBeGreaterThan(500);
  await page.keyboard.up("KeyW");
  await page.screenshot({ path: "test-results/driving.png" });

  // Space toggles ball cam
  await page.keyboard.press("Space");
  await expect(page.locator("#camera-mode")).toHaveText("Ball cam");

  // Backspace resets to a kickoff: stopped, 33 boost
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(200);
  expect(await speed(page)).toBeLessThan(5);
  await expect(page.locator("#boost-value")).toHaveText("33");

  // H shows the controls
  await page.keyboard.press("KeyH");
  await expect(page.locator("#help")).toBeVisible();

  expect(errors).toEqual([]);
});

test("controls can be rebound and are remembered", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });

  // Open settings, rebind throttle (keyboard) to I
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings")).toBeVisible();
  const slot = page.locator('.binding-slot[data-action="throttleForward"][data-device="keyboard"]');
  await expect(slot).toHaveText("W");
  await slot.click();
  await expect(slot).toHaveClass(/capturing/);
  await page.keyboard.press("KeyI");
  await expect(slot).toHaveText("I");

  // Camera FOV slider
  await page.locator(".settings-tab", { hasText: "Camera" }).click();
  const fov = page.locator('input[data-setting="fov"]');
  await fov.fill("105");
  await fov.dispatchEvent("change");
  await page.locator('input[data-option="invertSwivelPitch"]').uncheck();

  // Controller tab: the game's defaults
  await page.locator(".settings-tab", { hasText: "Controller" }).click();
  await expect(page.locator('input[data-setting="deadzone"]')).toHaveValue("0.2");
  await expect(page.locator('input[data-setting="dodgeDeadzone"]')).toHaveValue("0.8");
  await page.screenshot({ path: "test-results/settings-controller.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings")).toBeHidden();

  // I now drives; W no longer does
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(600);
  expect(await speed(page)).toBeLessThan(50);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("KeyI");
  await page.waitForTimeout(1200);
  expect(await speed(page)).toBeGreaterThan(400);
  await page.keyboard.up("KeyI");

  // Remembered after a reload
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(page.locator('.binding-slot[data-action="throttleForward"][data-device="keyboard"]')).toHaveText("I");
  await page.locator(".settings-tab", { hasText: "Camera" }).click();
  await expect(page.locator('input[data-setting="fov"]')).toHaveValue("105");
  await expect(page.locator('input[data-option="invertSwivelPitch"]')).not.toBeChecked();
  await expect(page.locator('input[data-option="ballCamToggle"]')).toBeChecked();
  await page.screenshot({ path: "test-results/settings.png" });

  // Reset restores the default
  await page.locator(".settings-tab", { hasText: "Controls" }).click();
  await page.locator("button", { hasText: "Reset controls to defaults" }).click();
  await expect(page.locator('.binding-slot[data-action="throttleForward"][data-device="keyboard"]')).toHaveText("W");
});
