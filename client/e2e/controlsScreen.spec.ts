// The Controls screen: the right button bound by right-clicking the slot waiting for it (that click's context menu not
// clearing what it just bound), right-click on an idle slot still clearing it; and its Fullscreen notice: binds a normal
// tab can lose to the browser (the defaults' Left Ctrl, rear camera) named, Windowed, with the switch to Fullscreen.
import type { Page } from "@playwright/test";
import { expect, fakeGamepad, test } from "./fixtures";
import { freePlay } from "./players";

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

test("the Fullscreen line, above the slots, whatever the binds; its button switches to Fullscreen", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("carball.settings.v1", JSON.stringify({ bindings: { rearCamera: { keyboard: { kind: "key", code: "KeyR" } } } }));
  });
  await controls(page);
  const notice = page.locator("#settings .fullscreen-notice");
  await expect(notice).toHaveText(
    /^Some binds \(for example with Ctrl, Alt or Escape\) may not work reliably in a windowed tab\. For the best results, use Fullscreen \(Video → Display Mode\)\./,
  );
  // (above the slots, seen before binding: the user's)
  const [box, table] = [await notice.boundingBox(), await page.locator("#settings .bindings").boundingBox()];
  expect(box && table && box.y + box.height <= table.y).toBe(true);
  await notice.getByRole("button", { name: "Switch to Fullscreen" }).click();
  await expect.poll(async () => page.evaluate(() => document.fullscreenElement !== null), { timeout: 5_000 }).toBe(true);
  // (still there in Fullscreen: one fixed line)
  await expect(notice).toBeVisible();
});

test("the wheel binds by a turn, Shift's sideways one too, and fires its action in play; PrintScreen binds by its keyup alone (RV-1096, RV-1100, RV-1126)", async ({
  page,
}) => {
  await controls(page);
  await slot(page, "launchBall").click();
  await page.waitForTimeout(100);
  await page.mouse.wheel(0, -120);
  await expect(slot(page, "launchBall")).toHaveText("Wheel up");
  await slot(page, "passBall").click();
  await page.keyboard.up("PrintScreen");
  await expect(slot(page, "passBall")).toHaveText("PrintScreen");
  // (Shift's turn, which Chromium sends sideways: the same turn, RV-1126)
  await slot(page, "defendShot").click();
  await page.waitForTimeout(100);
  await page.mouse.wheel(120, 0);
  await expect(slot(page, "defendShot")).toHaveText("Wheel down");
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings")).toBeHidden();
  await freePlay(page);
  // (free play taking input first: a click until the car leaves the floor; then the ball's fastest up, read each frame)
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  const at = { x: size.width / 2, y: size.height / 2 };
  await expect
    .poll(
      async () => {
        await page.mouse.click(at.x, at.y);
        return page.evaluate(() => !(window as unknown as { carballFreeplay: { car: () => { onGround: boolean } } }).carballFreeplay.car().onGround);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.evaluate(() => {
    const w = window as unknown as {
      peakUp: number;
      carballFreeplay: { place: (car: object, ball: object) => void; ball: () => { vel: { z: number } } };
    };
    w.carballFreeplay.place({ x: 0, y: 0, yaw: 0 }, { x: 0, y: 1500, z: 93 });
    w.peakUp = 0;
    const sample = (): void => {
      w.peakUp = Math.max(w.peakUp, w.carballFreeplay.ball().vel.z);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => page.evaluate(() => (window as unknown as { peakUp: number }).peakUp), { timeout: 10_000 }).toBeGreaterThan(400);
});

test("a controller the browser doesn't map: never read in play, the Controls screen saying it can't be used (RV-1124)", async ({ browser }) => {
  const context = await browser.newContext();
  await fakeGamepad(context, "");
  const page = await context.newPage();
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  // (its button held for a while: still the keyboard's prompts, no pad mode)
  await page.evaluate(async () => {
    const w = window as unknown as { carballSetPad: (down: number[], axes?: number[]) => void };
    w.carballSetPad([0, 9], [-0.6, 0, 0, 0]);
    await new Promise((r) => setTimeout(r, 1500));
    w.carballSetPad([]);
  });
  await expect(page.locator("#ballcam-toggle .key-pad")).toHaveCount(0);
  await expect(page.locator("#pause-menu")).toBeHidden();
  await page.keyboard.press("Escape");
  await page
    .locator("#pause-menu")
    .getByRole("button", { name: /^settings$/i })
    .click();
  await page.locator(".settings-tab", { hasText: "Controls" }).click();
  await expect(page.locator("#settings .unmapped-pad")).toHaveText("This controller isn't one the browser maps, so it can't be used here.");
  await context.close();
});
