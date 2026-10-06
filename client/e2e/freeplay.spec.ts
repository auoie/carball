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
