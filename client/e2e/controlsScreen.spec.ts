// The Controls screen: the right button bound by right-clicking the slot waiting for it (that click's context menu not
// clearing what it just bound), right-click on an idle slot still clearing it; and its Fullscreen notice: binds a normal
// tab can lose to the browser (the defaults' Left Ctrl, rear camera) named, Windowed, with the switch to Fullscreen.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function controls(page: Page): Promise<void> {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await page
    .locator("#main-menu")
    .getByRole("button", { name: /^settings$/i })
    .click();
  await page.locator(".settings-tab", { hasText: "Controls" }).click();
}

const slot = (page: Page, action: string): ReturnType<Page["locator"]> => page.locator(`.binding-slot[data-action="${action}"][data-device="keyboard"]`);

test("the right button binds by right-clicking the waiting slot; right-click clears an idle slot", async ({ page }) => {
  await controls(page);
  await slot(page, "boost").click();
  await expect(slot(page, "boost")).toHaveClass(/capturing/);
  // (the capture takes mouse buttons from the frame after its click)
  await page.waitForTimeout(100);
  await slot(page, "boost").click({ button: "right" });
  await expect(slot(page, "boost")).toHaveText("Right mouse");
  await page.waitForTimeout(300);
  await expect(slot(page, "boost"), "kept: its own click's context menu didn't clear it").toHaveText("Right mouse");
  // (an idle slot: right-click clears it)
  await slot(page, "throttleForward").click({ button: "right" });
  await expect(slot(page, "throttleForward")).toHaveClass(/empty/);
});

test("the Fullscreen notice names the binds a normal tab can lose, and switches to Fullscreen", async ({ page }) => {
  await controls(page);
  const notice = page.locator("#settings .fullscreen-notice");
  await expect(notice).toContainText("Some of your binds (Left Ctrl) work fully only in Fullscreen");
  await notice.getByRole("button", { name: "Switch to Fullscreen" }).click();
  await expect.poll(async () => page.evaluate(() => document.fullscreenElement !== null), { timeout: 5_000 }).toBe(true);
  await expect(notice).toHaveCount(0);
});

test("no Fullscreen notice without such a bind", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("carball.settings.v1", JSON.stringify({ bindings: { rearCamera: { keyboard: { kind: "key", code: "KeyR" } } } }));
  });
  await controls(page);
  await expect(page.locator(".bindings")).toBeVisible();
  await expect(page.locator("#settings .fullscreen-notice")).toHaveCount(0);
});
