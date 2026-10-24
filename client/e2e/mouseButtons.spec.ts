// The thumb buttons, Mouse 4 and 5: the game's to bind (air roll, often), never the browser's back and forward, which on a
// match page would leave the match (a loss and a ban). Pressed through Chrome's own input (the DevTools protocol's
// "back" and "forward" buttons, which Playwright's mouse doesn't have), on a page with somewhere to go either way.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { freePlay } from "./players";

/** The thumb button pressed over the game's middle, held `holdMs`, released */
async function thumb(page: Page, which: "back" | "forward", holdMs = 50): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  const at = { x: size.width / 2, y: size.height / 2 };
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: which, buttons: which === "back" ? 8 : 16, clickCount: 1 });
  await page.waitForTimeout(holdMs);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: which, buttons: 0, clickCount: 1 });
  await cdp.detach();
}

/** The page marked, then after each thumb press `stays` checks it's still this document at this URL: back then forward
 *  would come back to the same URL, a page loaded again (its match left and joined again), which only the mark tells */
async function marked(page: Page): Promise<() => Promise<void>> {
  const url = page.url();
  await page.evaluate(() => {
    (window as unknown as { thumbMark?: boolean }).thumbMark = true;
  });
  return async () => {
    await page.waitForTimeout(500);
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => (window as unknown as { thumbMark?: boolean }).thumbMark === true), "the same page").toBe(true);
  };
}

/** `url` loaded between two other pages: one to go back to, one to go forward to */
async function between(page: Page, url: string): Promise<void> {
  await page.goto("/version.json");
  await page.goto(url);
  await page.goto("/version.json?after");
  await page.goBack();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
}

/** Mouse 4 and 5 bound (`bindings`: by action, as the settings keep them) before the page loads */
async function bind(page: Page, bindings: Record<string, { kind: "mouse"; button: number }>): Promise<void> {
  const saved = Object.fromEntries(Object.entries(bindings).map(([action, keyboard]) => [action, { keyboard }]));
  await page.addInitScript((s) => {
    localStorage.setItem("carball.settings.v1", JSON.stringify({ bindings: s }));
  }, saved);
}

test("Mouse 4 and 5 never take free play's page back or forward, and do what they're bound to", async ({ page }) => {
  // (Launch Ball on Mouse 4, Defend Shot on Mouse 5: both seen in the ball)
  await bind(page, { launchBall: { kind: "mouse", button: 3 }, defendShot: { kind: "mouse", button: 4 } });
  await between(page, "/?render=off");
  await freePlay(page);
  const stays = await marked(page);
  await page.evaluate(() => {
    (window as unknown as { carballFreeplay: { place: (car: object, ball: object) => void } }).carballFreeplay.place(
      { x: 0, y: 0, yaw: 0 },
      { x: 0, y: 1500, z: 93 },
    );
  });
  const ball = (): Promise<{ vel: { x: number; y: number; z: number } }> =>
    page.evaluate(() => (window as unknown as { carballFreeplay: { ball: () => { vel: { x: number; y: number; z: number } } } }).carballFreeplay.ball());
  await thumb(page, "back");
  await stays();
  await expect.poll(async () => (await ball()).vel.z, { timeout: 10_000 }).toBeGreaterThan(400);
  await thumb(page, "forward");
  await stays();
  await expect.poll(async () => Math.hypot((await ball()).vel.x, (await ball()).vel.y), { timeout: 10_000 }).toBeGreaterThan(2000);
  await expect(page.locator("#main-menu")).toBeHidden();
});

test("Mouse 4 and 5 never take a match's page back or forward (a leave), and do what they're bound to", async ({ page }) => {
  // (the scoreboard on Mouse 4: shown while it's held)
  await bind(page, { scoreboard: { kind: "mouse", button: 3 } });
  await between(page, "/?server=127.0.0.1:14446&render=off");
  const stays = await marked(page);
  const board = page.locator("#scoreboard");
  const held = thumb(page, "back", 1500);
  await expect(board).toBeVisible({ timeout: 5_000 });
  await held;
  await stays();
  await thumb(page, "forward");
  await stays();
  // (still in the match: its world still coming)
  const tick = (): Promise<number> => page.evaluate(() => (window as unknown as { carballOnline: () => { ackFrame: number } }).carballOnline().ackFrame);
  const before = await tick();
  await expect.poll(tick, { timeout: 5_000 }).toBeGreaterThan(before);
});
