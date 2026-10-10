import type { Page } from "@playwright/test";

interface AudioStats {
  readonly state: string;
  readonly played: { readonly jump?: number; readonly land?: number };
  readonly cars: number;
}
import { expect, test } from "./fixtures";

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
  await expect(page.locator("#boost-value")).toHaveText("100"); // (freeplay's Unlimited boost)
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" }); // focus (right mouse: powerslide)

  // Hold W: the car accelerates (about 1350 uu/s after 2 s of throttle; under 24 fps, as software rendering here, the
  // game's 5 ticks a frame run slower than real time: LT-2)
  await page.keyboard.down("KeyW");
  await expect.poll(async () => speed(page), { timeout: 6_000 }).toBeGreaterThan(500);
  await page.keyboard.up("KeyW");
  await page.screenshot({ path: "test-results/driving.png" });

  // Middle mouse is the ball cam (the Modern layout), held on keyboard and mouse (the Modern camera preset)
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: "middle" });
  await expect(page.locator("#camera-mode")).toHaveText("Ball cam");
  await page.mouse.up({ button: "middle" });
  await expect(page.locator("#camera-mode")).toHaveText("Car cam");

  // Backspace resets to a kickoff: stopped, boost still 100 (Unlimited). (Its cooldown is 1.0 game s since the last
  // reset, the first spawn's too, and under load the drive above can take less than that: pressed again until it
  // takes; a press inside the cooldown does nothing)
  await expect
    .poll(
      async () => {
        await page.keyboard.press("Backspace");
        await page.waitForTimeout(300);
        return speed(page);
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(5);
  await expect(page.locator("#boost-value")).toHaveText("100");

  // H shows the controls
  await page.keyboard.press("KeyH");
  await expect(page.locator("#help")).toBeVisible();

  // Sound: running since the first key press, the car's engine playing; a jump (space) and its landing heard
  const audio = async (): Promise<AudioStats> => page.evaluate(() => (window as unknown as { rlAudio: () => AudioStats }).rlAudio());
  await page.waitForTimeout(400);
  expect((await audio()).state).toBe("running");
  expect((await audio()).cars).toBe(1);
  await expect(page.locator("#flip")).toHaveAttribute("data-state", "ground");
  await page.keyboard.down("Space");
  await page.waitForTimeout(150);
  await page.keyboard.up("Space");
  // The flip indicator: the dodge window counting down in the air, back to the ground on landing
  await expect(page.locator("#flip")).toHaveAttribute("data-state", "window");
  await expect(page.locator("#flip-detail")).toHaveText(/^\d\.\d s$/);
  await page.screenshot({ path: "test-results/flip-window.png" });
  await expect.poll(async () => (await audio()).played.land ?? 0, { timeout: 5000 }).toBeGreaterThan(0);
  expect((await audio()).played.jump).toBe(1);
  await expect(page.locator("#flip")).toHaveAttribute("data-state", "ground");
  // M mutes (a setting like any other: the Audio tab shows it)
  await page.keyboard.press("KeyM");
  await page.keyboard.press("Escape");
  await page.locator(".settings-tab", { hasText: "Audio" }).click();
  await expect(page.locator('input[data-option="muted"]')).toBeChecked();
  // The flip indicator can be turned off
  await page.locator(".settings-tab", { hasText: "Controller" }).click();
  await page.locator('input[data-option="flipIndicator"]').uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator("#flip")).toBeHidden();

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
  // (a new profile is Modern: keyboard-and-mouse free look on, the ball cam held; the controller's toggled)
  await expect(page.locator('input[data-camera="cameraKbm"][data-option="freeLook"]')).toBeChecked();
  await page.locator('input[data-camera="cameraKbm"][data-option="freeLook"]').uncheck();

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
  await expect.poll(async () => speed(page), { timeout: 6_000 }).toBeGreaterThan(400);
  await page.keyboard.up("KeyI");

  // Remembered after a reload
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(page.locator('.binding-slot[data-action="throttleForward"][data-device="keyboard"]')).toHaveText("I");
  await page.locator(".settings-tab", { hasText: "Camera" }).click();
  await expect(page.locator('input[data-setting="fov"]')).toHaveValue("105");
  await expect(page.locator('input[data-camera="cameraKbm"][data-option="freeLook"]')).not.toBeChecked();
  await expect(page.locator('input[data-camera="cameraKbm"][data-option="ballCamToggle"]')).not.toBeChecked();
  await expect(page.locator('input[data-camera="cameraPad"][data-option="ballCamToggle"]')).toBeChecked();
  await page.screenshot({ path: "test-results/settings.png" });

  // Reset restores the default
  await page.locator(".settings-tab", { hasText: "Controls" }).click();
  await page.locator("button", { hasText: "Reset controls to defaults" }).click();
  await expect(page.locator('.binding-slot[data-action="throttleForward"][data-device="keyboard"]')).toHaveText("W");
});

const THEMED = ["stadium", "meadow", "forest", "city", "infested", "kawaii", "platformer", "haunted", "ghosts", "dimension", "summit", "crater", "temple", "island", "lake"];
for (const theme of THEMED) {
  test(`the ${theme} theme loads and plays`, async ({ page }) => {
    await playTheme(page, theme);
  });
}

interface AmbienceLevels {
  readonly peak: number;
  readonly median: number;
  readonly loudest: number;
}

test("every theme's ambience: no sound sticks out far above the rest, and none is too loud", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  for (const theme of ["night", ...THEMED]) {
    // A minute of it, the same events every run (seeded)
    const levels = await page.evaluate(
      async (t) => (window as unknown as { rlAmbienceLevels: (t: string, s: number) => Promise<AmbienceLevels> }).rlAmbienceLevels(t, 60),
      theme,
    );
    // (every theme's loudest half-second is under 3x its median, its peak under 0.16: an event built too loud, like
    // a buzz added straight onto an envelope's gain, shows far above that)
    expect(levels.peak, theme).toBeLessThan(0.2);
    expect(levels.loudest / levels.median, theme).toBeLessThan(4);
  }
});

async function playTheme(page: Page, theme: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(`/?theme=${theme}`);
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" }); // focus (right mouse: powerslide)
  // The car drives. (Slowly here: the tests render in software, a few frames a second for this scenery, and the
  // physics only catches up 0.1 s per frame)
  await page.keyboard.down("KeyW");
  // (a heavy theme draws about a frame a second in software: wait for the car to move rather than a fixed time)
  await expect.poll(async () => speed(page), { timeout: 15_000 }).toBeGreaterThan(100);
  await page.keyboard.up("KeyW");
  await page.screenshot({ path: `test-results/${theme}.png` });
  expect(errors).toEqual([]);
}

interface Hook {
  place: (car: object, ball?: object) => void;
  car: () => { pos: { x: number; y: number }; speed: number };
}

test("a goal in freeplay with goal replays on: the replay plays, Space skips it, then a kickoff spot, no jump", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const hook = async (): Promise<{ pos: { x: number; y: number }; speed: number }> =>
    page.evaluate(() => (window as unknown as { rlFreeplay: Hook }).rlFreeplay.car());
  await page.evaluate(() => {
    (window as unknown as { rlFreeplay: Hook }).rlFreeplay.place({ x: 3000, y: 0, yaw: 0 }, { x: 0, y: 5300, z: 200 });
  });
  await expect(page.locator("#score-blue")).toHaveText("1", { timeout: 10_000 });
  // After PostGoalTime the replay (no freeplay special case: ShouldPlayReplayPlayback)
  await expect(page.locator("#message")).toHaveText("REPLAY", { timeout: 20_000 });
  await expect(page.locator("#message-hint")).toContainText("skip");
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" });
  await page.keyboard.press("Space");
  await expect(page.locator("#message")).toBeHidden({ timeout: 10_000 });
  // The new round straight after, the car at rest on its spot: the skip's Space doesn't make it jump
  await expect.poll(async () => Math.abs((await hook()).pos.y), { timeout: 10_000 }).toBeGreaterThan(2000);
  await page.waitForTimeout(500);
  expect((await hook()).speed).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test("a goal in freeplay, skipping replays: no message, 3 s later a kickoff spot (released after 0.01 s), Backspace: the other half", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem("rl-clone.settings.v1", JSON.stringify({ options: { autoSkipReplay: true } }));
  });
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const hook = async (): Promise<{ pos: { x: number; y: number }; speed: number }> =>
    page.evaluate(() => (window as unknown as { rlFreeplay: Hook }).rlFreeplay.car());
  // The car out on the side, the ball dropped into orange's goal
  await page.evaluate(() => {
    (window as unknown as { rlFreeplay: Hook }).rlFreeplay.place({ x: 3000, y: 0, yaw: 0 }, { x: 0, y: 5300, z: 200 });
  });
  // Scored for the player's team, with no message (offline freeplay: RV-38)
  await expect(page.locator("#score-blue")).toHaveText("1", { timeout: 10_000 });
  await expect(page.locator("#message")).toBeHidden();
  // The new round: the car on a kickoff spot (|y| 2560 .. 4608), released with no input: at rest
  await expect.poll(async () => Math.abs((await hook()).pos.y), { timeout: 20_000 }).toBeGreaterThan(2000);
  await expect(page.locator("#message")).toBeHidden();
  await page.waitForTimeout(500);
  expect((await hook()).speed).toBeLessThan(1);
  // Backspace: the next spot of the session's cycle, in the other half (RV-39); again at once: ignored (at most once a
  // game second)
  const half = Math.sign((await hook()).pos.y);
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" });
  await page.keyboard.press("Backspace");
  await expect.poll(async () => Math.sign((await hook()).pos.y), { timeout: 10_000 }).toBe(-half);
  expect(Math.abs((await hook()).pos.y)).toBeGreaterThan(2000);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(150);
  expect(Math.sign((await hook()).pos.y)).toBe(-half);
  // W: it drives off
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await hook()).speed, { timeout: 6_000 }).toBeGreaterThan(100);
  await page.keyboard.up("KeyW");
  expect(errors).toEqual([]);
});
