// Custom training's play mode (notes/custom-training.md §2, CTR-5..13), on a pack of ours given through the page's test
// hook: the shot held until input, its timer running out into a failure and the next shot; the HUD's shot, timer and
// completion; next, previous, mirror and shuffle; a striker's goal after a touch completing the shot; Carball's starter
// packs offered in a build. Nothing of the 3D drawn (`?render=off`).
import type { Page } from "@playwright/test";
import { CUSTOM_TRAINING } from "../src/features";
import { expect, fakeGamepad, padTap, test } from "./fixtures";

interface TrainingState {
  readonly state: string;
  readonly shot: number;
  readonly timeLeft: number | null;
  readonly completion: number;
  readonly shuffle: boolean;
  readonly mirror: boolean;
  readonly result: string | null;
}

const shot = (timeLimit: number, ball: [number, number, number], speed: number, car: [number, number, number]): unknown => ({
  timeLimit,
  ball: { location: ball, launch: { pitch: 0, yaw: 16384 }, speed },
  car: { location: car, rotation: { pitch: 0, yaw: 16384, roll: 0 }, startSpeed: 0 },
});
// (shot 1: the ball floating high, 2 s to run out; shot 2: the ball resting in front of the orange goal, the car behind it)
const PACK = {
  format: 1,
  id: "e2e-pack",
  name: "E2E Pack",
  type: "striker",
  difficulty: "easy",
  shots: [shot(2, [1500, 0, 900], 0, [0, -2000, 17]), shot(20, [0, 4300, 93], 0, [0, 3900, 17])],
};

const state = (page: Page): Promise<TrainingState | null> =>
  page.evaluate(() => (window as unknown as { carballFreeplay: { training: () => TrainingState | null } }).carballFreeplay.training());

async function start(page: Page): Promise<void> {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await page.evaluate((pack) => {
    localStorage.removeItem("carball.training.progress.e2e-pack");
    (window as unknown as { carballFreeplay: { startTraining: (p: unknown) => void } }).carballFreeplay.startTraining(pack);
  }, PACK);
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" }); // (focus; right: powerslide)
}

test("a shot held until input, its timer run out into a failure, then the next shot; the HUD's shot, timer and completion", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await expect(page.locator("#training")).toBeVisible();
  await expect(page.locator(".training-shot")).toHaveText(/^shot 1 \/ 2$/i);
  await expect(page.locator(".training-type")).toHaveText(/^striker$/i);
  await expect(page.locator(".training-timer")).toHaveText("0:02");
  await expect(page.locator(".training-pips i")).toHaveCount(2);
  // (held: no timer while nothing's pressed)
  await page.waitForTimeout(1500);
  expect(await state(page)).toMatchObject({ state: "countdown", shot: 0, timeLeft: 2 });
  // Throttle starts it; the frozen ball (speed 0) never touched: out at 0, a failure, then shot 2 after the explosion's
  // slow motion and its replay (played out: a skip's Space would be a jump, which starts the next shot)
  await page.keyboard.press("KeyW");
  await expect.poll(async () => (await state(page))?.state, { timeout: 10_000 }).toBe("active");
  await expect.poll(async () => (await state(page))?.result, { timeout: 30_000 }).toBe("failure");
  await expect.poll(async () => (await state(page))?.shot, { timeout: 60_000 }).toBe(1);
  expect(await state(page)).toMatchObject({ state: "countdown", completion: 0 });
  await expect(page.locator(".training-shot")).toHaveText(/^shot 2 \/ 2$/i);
  expect(errors).toEqual([]);
});

test("next and previous wrap; mirror flips the shot until it changes; shuffle keeps the shot; Select Shot starts one", async ({ page }) => {
  await start(page);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await state(page))?.shot).toBe(1);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await state(page))?.shot).toBe(0);
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await state(page))?.mirror).toBe(true);
  await expect(page.locator(".training-flags")).toHaveText(/mirror/i);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => state(page)).toMatchObject({ shot: 1, mirror: false });
  await page.keyboard.press("ArrowUp");
  await expect.poll(async () => state(page)).toMatchObject({ shot: 1, shuffle: true });
  // Select Shot (Enter): the pack's shots in its order, one chosen starting at once
  await page.keyboard.press("Enter");
  const select = page.locator("#shot-select");
  await expect(select).toBeVisible();
  await expect(select.locator(".shot-select-shot")).toHaveCount(2);
  await select.locator(".shot-select-shot", { hasText: /^1$/ }).click();
  await expect(select).toBeHidden();
  await expect.poll(async () => state(page)).toMatchObject({ shot: 0, state: "countdown" });
});

test("a reset during a shot asks first, the first time ever: No keeps the shot, Yes retries it; after, at once (§2.7)", async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    localStorage.removeItem("carball.training.resetWarned");
  });
  // (on the 20 s shot: the first's 2 s, still running while the question is up, could run out under load)
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => state(page)).toMatchObject({ shot: 1, state: "countdown" });
  await page.keyboard.press("KeyW");
  await expect.poll(async () => (await state(page))?.state, { timeout: 10_000 }).toBe("active");
  const modal = page.locator("#modal");
  await page.keyboard.press("Backspace");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("By resetting, you will not earn points by completing the round. Would you like to continue?");
  await modal.getByRole("button", { name: /^no$/i }).click();
  await expect(modal).toBeHidden();
  expect((await state(page))?.state).toBe("active");
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" });
  await page.keyboard.press("Backspace");
  await modal.getByRole("button", { name: /^yes$/i }).click();
  await expect.poll(async () => (await state(page))?.state).toBe("countdown");
  // (answered once: a reset during the next shot retries at once)
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" });
  await page.keyboard.press("KeyW");
  await expect.poll(async () => (await state(page))?.state, { timeout: 10_000 }).toBe("active");
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await state(page))?.state).toBe("countdown");
  await expect(modal).toBeHidden();
});

test("a striker's goal after the car's touch completes the shot (CTR-8)", async ({ page }) => {
  await start(page);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await state(page))?.shot).toBe(1);
  // (the car drives into the resting ball, which rolls into the orange goal)
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  await expect.poll(async () => (await state(page))?.result, { timeout: 30_000 }).toBe("success");
  await page.keyboard.up("ShiftLeft");
  await page.keyboard.up("KeyW");
  expect(await state(page)).toMatchObject({ completion: 50 });
  await expect(page.locator(".training-pips i.done")).toHaveCount(1);
});

test("a build offers Carball's starter packs: Custom Training's Starter Packs tab lists them (My Packs doesn't), one starts at its first shot", async ({
  page,
}) => {
  // (the menu's way in: none while it's switched off; the play mode above runs through the test hook still)
  test.skip(!CUSTOM_TRAINING, "Custom Training is switched off (src/features.ts CUSTOM_TRAINING)");
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^custom training$/i }).click();
  await expect(menu.locator('[data-training-panel="mine"] .main-menu-pack')).toHaveCount(0);
  await menu.locator(".main-menu-training-tabs").getByRole("tab", { name: "Starter Packs" }).click();
  const starters = menu.locator('[data-training-panel="starter"]');
  await expect(starters.locator(".main-menu-pack-name")).toHaveText(["First Touches", "Open Net", "Bounce Shots", "Air Starters", "Keeper Basics"]);
  await starters.locator(".main-menu-pack", { hasText: "Keeper Basics" }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".training-type")).toHaveText(/^goalie$/i);
  await expect(page.locator(".training-shot")).toHaveText(/^shot 1 \/ 8$/i);
  // (no timer on the goalie's HUD: §6)
  await expect(page.locator(".training-timer")).toBeHidden();
});

test("Select Shot with a pad: View opens it on the current shot, the D-pad moves, A picks one, B closes it (RV-564)", async ({ page, context }) => {
  const [A, B, VIEW, RIGHT] = [0, 1, 8, 15];
  await fakeGamepad(context);
  await start(page);
  const select = page.locator("#shot-select");
  const focused = select.locator(".shot-select-shot:focus");
  await padTap(page, [VIEW]);
  await expect(select).toBeVisible();
  await expect(focused).toHaveText("1");
  await padTap(page, [RIGHT]);
  await expect(focused).toHaveText("2");
  await padTap(page, [A]);
  await expect(select).toBeHidden();
  await expect.poll(async () => (await state(page))?.shot).toBe(1);
  await padTap(page, [VIEW]);
  await expect(select).toBeVisible();
  await padTap(page, [B]);
  await expect(select).toBeHidden();
  expect((await state(page))?.shot).toBe(1);
});
