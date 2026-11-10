// Play by touch on a phone (src/input/touch.ts; notes/mobile.md), under the browser's phone emulation (a touch screen,
// its pointer coarse): the controls in free play and hidden under the pause menu, their Pause; the stick driving and
// steering with a second finger boosting at once, Jump jumping; a pad's use hiding them till the next touch; a phone held
// upright asked to turn; a desktop page without them. Nothing drawn (`?render=off`).
import type { CDPSession, Page } from "@playwright/test";
import { expect, fakeGamepad, padTap, test } from "./fixtures";

const PHONE = { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } as const;

interface Car {
  readonly pos: { x: number; y: number; z: number };
  readonly speed: number;
  readonly onGround: boolean;
}
interface Hook {
  readonly carballFreeplay: { car: () => Car; place: (car: object) => void };
}
const car = (page: Page): Promise<Car> => page.evaluate(() => (window as unknown as Hook).carballFreeplay.car());

/** Fingers on the screen through the browser's protocol (Playwright's own touchscreen only taps): every finger down
 *  each call (id, x, y), the type as the protocol's */
async function fingers(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", points: { id: number; x: number; y: number }[]): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
}

/** A button's centre */
async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} isn't shown`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function freePlayByTouch(page: Page): Promise<void> {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).tap({ timeout: 30_000 });
  await menu.getByRole("button", { name: /^free play$/i }).tap();
  await expect(menu).toBeHidden();
}

test.describe("a phone in landscape", () => {
  test.use(PHONE);

  test("free play shows the touch controls (its Reset, no other mode's); Pause opens the pause menu, which hides them", async ({ page }) => {
    await freePlayByTouch(page);
    const touch = page.locator("#touch");
    await expect(touch).toBeVisible();
    for (const label of ["Jump", "Boost", "Slide", "Ball Cam", "Pause", "Reset"]) await expect(touch.getByRole("button", { name: label })).toBeVisible();
    for (const label of ["Prev", "Next", "Scores"]) await expect(touch.getByRole("button", { name: label })).toBeHidden();
    await touch.getByRole("button", { name: "Pause" }).tap();
    await expect(page.locator(".pause-menu")).toBeVisible();
    await expect(touch).toBeHidden();
    await page.getByRole("button", { name: /^resume game$/i }).tap();
    await expect(touch).toBeVisible();
  });

  test("the stick drives forward and steers; a second finger boosts at once; Jump jumps", async ({ page }) => {
    await freePlayByTouch(page);
    await page.evaluate(() => {
      (window as unknown as Hook).carballFreeplay.place({ x: 0, y: -2000, yaw: Math.PI / 2, boost: 100 });
    });
    const cdp = await page.context().newCDPSession(page);
    // (the thumb lands on the left half and pushes up past the stick's travel: full throttle forward)
    await fingers(cdp, "touchStart", [{ id: 1, x: 160, y: 250 }]);
    await fingers(cdp, "touchMove", [{ id: 1, x: 160, y: 180 }]);
    await expect.poll(async () => (await car(page)).speed, { timeout: 5000 }).toBeGreaterThan(800);
    expect((await car(page)).pos.y).toBeGreaterThan(-2000);
    // (Boost under a second finger, the stick still held: past the throttle's top speed)
    const boost = await centre(page, ".touch-boost");
    await fingers(cdp, "touchStart", [
      { id: 1, x: 160, y: 180 },
      { id: 2, ...boost },
    ]);
    await expect.poll(async () => (await car(page)).speed, { timeout: 5000 }).toBeGreaterThan(1500);
    // (the stick turned to the side as well: the car turns off its straight line along y)
    const before = (await car(page)).pos.x;
    await fingers(cdp, "touchMove", [
      { id: 1, x: 220, y: 200 },
      { id: 2, ...boost },
    ]);
    await expect.poll(async () => Math.abs((await car(page)).pos.x - before), { timeout: 5000 }).toBeGreaterThan(300);
    await fingers(cdp, "touchEnd", []);
    // (Jump tapped: off the ground)
    await expect.poll(async () => (await car(page)).onGround, { timeout: 5000 }).toBe(true);
    const jump = await centre(page, ".touch-jump");
    await fingers(cdp, "touchStart", [{ id: 3, ...jump }]);
    await fingers(cdp, "touchEnd", []);
    await expect.poll(async () => (await car(page)).onGround, { timeout: 2000 }).toBe(false);
  });

  test("a training pack's controls: its Prev, Reset and Next", async ({ page }) => {
    await page.goto("/?render=off");
    await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
    const menu = page.locator("#main-menu");
    await menu.getByRole("button", { name: /^play$/i }).tap({ timeout: 30_000 });
    await menu.getByRole("button", { name: /^custom training$/i }).tap();
    await menu.locator(".main-menu-training-tabs").getByRole("tab", { name: "Starter Packs" }).tap();
    await menu.locator('[data-training-panel="starter"] .main-menu-pack', { hasText: "First Touches" }).tap();
    await expect(menu).toBeHidden();
    const touch = page.locator("#touch");
    for (const label of ["Prev", "Reset", "Next", "Jump"]) await expect(touch.getByRole("button", { name: label })).toBeVisible();
    await expect(touch.getByRole("button", { name: "Scores" })).toBeHidden();
  });

  test("a pad used hides the controls until the next touch", async ({ page, context }) => {
    await fakeGamepad(context);
    await freePlayByTouch(page);
    const touch = page.locator("#touch");
    await expect(touch).toBeVisible();
    await padTap(page, [0]);
    await expect(touch).toBeHidden();
    await page.locator("#game").tap({ position: { x: 600, y: 120 } });
    await expect(touch).toBeVisible();
  });
});

test.describe("a phone held upright", () => {
  test.use({ ...PHONE, viewport: { width: 390, height: 844 } });

  test("is asked to turn it; turned, the prompt goes", async ({ page }) => {
    await page.goto("/?render=off");
    const rotate = page.locator("#rotate");
    await expect(rotate).toBeVisible({ timeout: 30_000 });
    await expect(rotate).toHaveText(/turn your phone sideways/i);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(rotate).toBeHidden();
  });
});

test("a desktop page (a mouse, no touch screen) has no touch controls and no prompt to turn", async ({ page }) => {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click({ timeout: 30_000 });
  await menu.getByRole("button", { name: /^free play$/i }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator("#touch")).toBeHidden();
  await expect(page.locator("#rotate")).toBeHidden();
});
