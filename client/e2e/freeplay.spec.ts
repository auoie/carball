// Free play in the browser. The tests that read no pixels load it with `?render=off` (nothing drawn: software WebGL is
// most of the suite's time); the themes' tests and the taken pad's dim look draw as the game does.
import type { Page } from "@playwright/test";

interface AudioStats {
  readonly state: string;
  readonly played: { readonly jump?: number; readonly land?: number; readonly ballHit?: number };
  readonly cars: number;
}
import { expect, test } from "./fixtures";
import { closeMenus, cycleTo, freePlay, openSettings } from "./players";

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

  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
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
  const audio = async (): Promise<AudioStats> => page.evaluate(() => (window as unknown as { carballAudio: () => AudioStats }).carballAudio());
  await page.waitForTimeout(400);
  expect((await audio()).state).toBe("running");
  expect((await audio()).cars).toBe(1);
  await expect(page.locator("#flip")).toHaveAttribute("data-state", "ground");
  // (the flip circle beside the boost meter, both scaled with the HUD's stage: never overlapping, at any window size)
  // (both boxes read at once, once the stage has been fitted to the new size: a frame between two reads put them on
  // different stages)
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 900, height: 900 },
  ]) {
    await page.setViewportSize(size);
    const gap = (): Promise<number | null> =>
      page.evaluate(() => {
        const flip = document.querySelector("#flip")?.getBoundingClientRect();
        const boost = document.querySelector("#boost")?.getBoundingClientRect();
        const stage = document.querySelector<HTMLElement>("#hud-stage");
        const fitted = stage && Math.abs(stage.getBoundingClientRect().width - innerWidth) < 1;
        return flip && boost && fitted ? boost.left - flip.right : null;
      });
    await expect.poll(gap, { message: `${String(size.width)} x ${String(size.height)}` }).toBeGreaterThanOrEqual(-1);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.keyboard.down("Space");
  await page.waitForTimeout(150);
  await page.keyboard.up("Space");
  // The flip indicator: the dodge window counting down in the air, back to the ground on landing
  await expect(page.locator("#flip")).toHaveAttribute("data-state", "window");
  // (its seconds shown under it)
  await expect(page.locator("#flip .flip-seconds")).toHaveClass(/shown/);
  await expect(page.locator("#flip-detail")).toHaveText(/^\d\.\d s$/);
  await page.screenshot({ path: "test-results/flip-window.png" });
  // (software rendering here: a few frames a second, the 5-tick cap running the jump slower than real time: wait for it)
  await expect.poll(async () => (await audio()).played.land ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
  expect((await audio()).played.jump).toBe(1);
  await expect(page.locator("#flip")).toHaveAttribute("data-state", "ground");
  // M mutes (a setting like any other: the Audio tab shows it)
  await page.keyboard.press("KeyM");
  await openSettings(page);
  await page.locator(".settings-tab", { hasText: "Audio" }).click();
  await expect(page.locator('[data-option="muted"]')).toBeChecked();
  // The flip indicator can be turned off (the Gameplay tab's Flip Reset Indicator: MENU-9, RV-169)
  await page.locator(".settings-tab", { hasText: "Gameplay" }).click();
  // (its rows in the game's order, their labels upper-cased, the values as written: HT-5, RV-281)
  const order = await page
    .locator(".caps-labels > *")
    .evaluateAll((rows) =>
      rows.map(
        (r) =>
          r.querySelector("[data-setting], [data-option]")?.getAttribute("data-setting") ?? r.querySelector("[data-option]")?.getAttribute("data-option") ?? "",
      ),
    );
  expect(order.filter((k) => k !== "")).toEqual(["unlimitedBoost", "statDisplayLevel", "flipResetIndicator", "autoSkipReplay"]);
  await expect(page.locator(".caps-labels .option > span").first()).toHaveCSS("text-transform", "uppercase");
  await cycleTo(page, '[data-setting="flipResetIndicator"]', "off");
  await closeMenus(page);
  await expect(page.locator("#flip")).toBeHidden();

  expect(errors).toEqual([]);
});

test("free play's ball commands from their keys: 4 launches the ball, 1 takes possession, 5 defends a shot (FP3)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" }); // (focus)
  interface Ball {
    pos: { x: number; y: number; z: number };
    vel: { x: number; y: number; z: number };
  }
  const hook = (): Promise<Ball> => page.evaluate(() => (window as unknown as { carballFreeplay: { ball: () => Ball } }).carballFreeplay.ball());
  // (the car at the centre facing +x, the ball resting off to its side)
  await page.evaluate(() => {
    (window as unknown as { carballFreeplay: { place: (car: object, ball: object) => void } }).carballFreeplay.place(
      { x: 0, y: 0, yaw: 0 },
      { x: 0, y: 1500, z: 93 },
    );
  });
  // Launch Ball: 750 up from a resting ball
  await page.keyboard.press("Digit4");
  await expect.poll(async () => (await hook()).vel.z, { timeout: 10_000 }).toBeGreaterThan(400);
  // Take Possession: in front of the car (about 230 ahead, the ball's bounds radius over the floor)
  await page.keyboard.press("Digit1");
  await expect.poll(async () => (await hook()).pos.x, { timeout: 10_000 }).toBeGreaterThan(150);
  const held = await hook();
  expect(Math.abs(held.pos.y)).toBeLessThan(60);
  // Defend Shot: launched at a goal (the nearer, orange or blue: |y| velocity a goal's way), 2778 sideways
  await page.keyboard.press("Digit5");
  await expect.poll(async () => Math.hypot((await hook()).vel.x, (await hook()).vel.y), { timeout: 10_000 }).toBeGreaterThan(2000);
  // Refused at a wall: the car nose to the side wall, Take Possession's spot beyond it; the refusal's cue, the ball left
  // where it was (RV-801)
  const place = (car: object, ball: object): Promise<void> =>
    page.evaluate(
      ([c, b]) => {
        (window as unknown as { carballFreeplay: { place: (car: object, ball: object) => void } }).carballFreeplay.place(c, b);
      },
      [car, ball] as const,
    );
  const backs = (): Promise<number> =>
    page.evaluate(() => (window as unknown as { carballAudio: () => { played: Record<string, number> } }).carballAudio().played["menu-back"] ?? 0);
  await place({ x: 3950, y: 0, yaw: 0 }, { x: 0, y: 1500, z: 93 });
  // (3950 is on the floor's curve up to the wall: placed flat there, the car pops up for about a quarter of a second
  // before it settles nose up, and in the air Take Possession's spot is the air one, inside the field, allowed. The key
  // pressed only once it has settled (on the curve, its wheels down, at rest; not the hop's top, slow too: RV-1106):
  // pressed at once, a slow frame met the hop)
  const car = (): Promise<{ pos: { z: number }; speed: number; onGround: boolean }> =>
    page.evaluate(() =>
      (window as unknown as { carballFreeplay: { car: () => { pos: { z: number }; speed: number; onGround: boolean } } }).carballFreeplay.car(),
    );
  await expect
    .poll(
      async () => {
        const c = await car();
        return c.onGround && c.pos.z > 30 && c.speed < 10;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const refusals = await backs();
  await page.keyboard.press("Digit1");
  await expect.poll(backs, { timeout: 10_000 }).toBe(refusals + 1);
  const kept = await hook();
  expect(Math.abs(kept.pos.x)).toBeLessThan(5);
  expect(Math.abs(kept.pos.y - 1500)).toBeLessThan(5);
  // Demolished: the commands do nothing (Launch Ball pressed, the ball still at rest)
  await place({ x: 0, y: 0, yaw: 0 }, { x: 0, y: 1500, z: 93 });
  await page.evaluate(() => {
    (window as unknown as { carballFreeplay: { demolish: () => void } }).carballFreeplay.demolish();
  });
  await page.keyboard.press("Digit4");
  await page.waitForTimeout(500);
  expect(Math.abs((await hook()).vel.z)).toBeLessThan(50);
  expect(errors).toEqual([]);
});

test("the settings' name field takes Space and Backspace like any text field (RV-482)", async ({ page }) => {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await page
    .locator("#main-menu")
    .getByRole("button", { name: /^settings$/i })
    .click();
  await page.locator(".settings-tab", { hasText: "Chat" }).click();
  const name = page.locator('[data-setting="name"]');
  await name.click();
  await name.press("Control+A");
  await page.keyboard.type("Car ball");
  await page.keyboard.press("Backspace");
  await expect(name).toHaveValue("Car bal");
});

test("controls can be rebound and are remembered", async ({ page }) => {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);

  // Open settings, rebind throttle (keyboard) to I
  await openSettings(page);
  const slot = page.locator('.binding-slot[data-action="throttleForward"][data-device="keyboard"]');
  await expect(slot).toHaveText("W");
  await slot.click();
  await expect(slot).toHaveClass(/capturing/);
  await page.keyboard.press("KeyI");
  await expect(slot).toHaveText("I");

  // Camera FOV slider
  await page.locator(".settings-tab", { hasText: "Camera" }).click();
  // (our own slider: its keys step it, the focus kept on it as the page is made again: 90 by three Page Ups, a tenth of
  // 60-110 each, to 105, then an arrow down and up)
  const fov = page.locator('[data-setting="fov"]');
  await expect(fov).toHaveAttribute("aria-valuenow", "90");
  await fov.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("PageUp");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await expect(fov).toHaveAttribute("aria-valuenow", "105");
  // (a new profile is Modern: keyboard-and-mouse free look on, the ball cam held; the controller's toggled)
  await expect(page.locator('[data-camera="cameraKbm"][data-option="freeLook"]')).toBeChecked();
  await page.locator('[data-camera="cameraKbm"][data-option="freeLook"]').uncheck();

  // Controller tab: the game's defaults
  await page.locator(".settings-tab", { hasText: "Controller" }).click();
  await expect(page.locator('[data-setting="deadzone"]')).toHaveAttribute("aria-valuenow", "0.2");
  await expect(page.locator('[data-setting="dodgeDeadzone"]')).toHaveAttribute("aria-valuenow", "0.8");
  await page.screenshot({ path: "test-results/settings-controller.png" });
  await closeMenus(page);

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
  await freePlay(page);
  await openSettings(page);
  await expect(page.locator('.binding-slot[data-action="throttleForward"][data-device="keyboard"]')).toHaveText("I");
  await page.locator(".settings-tab", { hasText: "Camera" }).click();
  await expect(page.locator('[data-setting="fov"]')).toHaveAttribute("aria-valuenow", "105");
  await expect(page.locator('[data-camera="cameraKbm"][data-option="freeLook"]')).not.toBeChecked();
  await expect(page.locator('[data-camera="cameraKbm"][data-option="ballCamToggle"]')).not.toBeChecked();
  await expect(page.locator('[data-camera="cameraPad"][data-option="ballCamToggle"]')).toBeChecked();
  await page.screenshot({ path: "test-results/settings.png" });

  // Reset restores the default
  await page.locator(".settings-tab", { hasText: "Controls" }).click();
  await page.locator("button", { hasText: "Reset controls to defaults" }).click();
  await expect(page.locator('.binding-slot[data-action="throttleForward"][data-device="keyboard"]')).toHaveText("W");
});

test("the map (Night) loads and plays", async ({ page }) => {
  await playMap(page);
});

interface AmbienceLevels {
  readonly peak: number;
  readonly median: number;
  readonly loudest: number;
}

test("the map's ambience: no sound sticks out far above the rest, and none is too loud", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await freePlay(page);
  for (const theme of ["night"]) {
    // A minute of it, the same events every run (seeded)
    const levels = await page.evaluate(
      async (t) => (window as unknown as { carballAmbienceLevels: (t: string, s: number) => Promise<AmbienceLevels> }).carballAmbienceLevels(t, 60),
      theme,
    );
    // (every theme's loudest half-second is under 3x its median, its peak under 0.16: an event built too loud, like
    // a buzz added straight onto an envelope's gain, shows far above that)
    expect(levels.peak, theme).toBeLessThan(0.2);
    expect(levels.loudest / levels.median, theme).toBeLessThan(4);
  }
});

async function playMap(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await freePlay(page);
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" }); // focus (right mouse: powerslide)
  // The car drives. (Slowly here: the tests render in software, a few frames a second for this scenery, and the
  // physics only catches up 0.1 s per frame)
  await page.keyboard.down("KeyW");
  // (a heavy theme draws about a frame a second in software: wait for the car to move rather than a fixed time)
  await expect.poll(async () => speed(page), { timeout: 15_000 }).toBeGreaterThan(100);
  await page.keyboard.up("KeyW");
  await page.screenshot({ path: "test-results/night.png" });
  expect(errors).toEqual([]);
}

interface Hook {
  place: (car: object, ball?: object) => void;
  car: () => { pos: { x: number; y: number }; speed: number; hitbox: { x: number; y: number; z: number } };
  cameraFade: () => number;
}

test("a goal in freeplay with goal replays on: the replay plays, Space skips it, then a kickoff spot, no jump", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  const hook = async (): Promise<{ pos: { x: number; y: number }; speed: number }> =>
    page.evaluate(() => (window as unknown as { carballFreeplay: Hook }).carballFreeplay.car());
  await page.evaluate(() => {
    (window as unknown as { carballFreeplay: Hook }).carballFreeplay.place({ x: 3000, y: 0, yaw: 0 }, { x: 0, y: 5300, z: 200 });
    // (the camera's fade at its largest, frame by frame: the replay cuts in from black through the post-processing)
    const w = window as unknown as { carballFreeplay: Hook; carballFadeMax: number };
    w.carballFadeMax = 0;
    const sample = (): void => {
      w.carballFadeMax = Math.max(w.carballFadeMax, w.carballFreeplay.cameraFade());
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await expect(page.locator("#score-blue")).toHaveText("1", { timeout: 10_000 });
  const played = async (): Promise<Record<string, number>> =>
    page.evaluate(() => (window as unknown as { carballAudio: () => { played: Record<string, number> } }).carballAudio().played);
  const liveGoals = (await played()).goal ?? 0;
  // After PostGoalTime the replay (no freeplay special case: ShouldPlayReplayPlayback), cut in from black (RV-175)
  // (its banner, HUD-11: the blinking REPLAY, the scorer, the skip prompt)
  await expect(page.locator("#replay-banner")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#replay-label")).toHaveText("REPLAY");
  await expect(page.locator("#replay-info .replay-scorer")).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { carballFadeMax: number }).carballFadeMax), { timeout: 10_000 })
    .toBeGreaterThan(0.5);
  await expect(page.locator("#replay-prompt")).toContainText(/skip/i);
  // (the car's voice follows the replayed car, not the live state the replay began in: user finding 7)
  const audioMode = async (): Promise<string> => page.evaluate(() => (window as unknown as { carballAudio: () => { mode: string } }).carballAudio().mode);
  await expect.poll(audioMode, { timeout: 5_000 }).toBe("replay");
  // (its sounds a spectator's view of the live ones: the goal again as it was live, its explosion and horn; no sounds of
  // the replay's own, the user's decision of 2026-10-22)
  await expect.poll(async () => (await played()).goal, { timeout: 15_000 }).toBe(liveGoals + 1);
  expect(Object.keys(await played()).filter((k) => ["swoopOut", "sloMoStart", "sloMoEnd", "replayGoal"].includes(k))).toEqual([]);
  // (its key: the Skip Replay binding's, a word for a keyboard key: HT-3, RV-282)
  await expect(page.locator("#replay-prompt .key-glyph.key-word")).toHaveText("Space");
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" });
  await page.keyboard.press("Space");
  await expect(page.locator("#replay-banner")).toBeHidden({ timeout: 10_000 });
  await expect.poll(audioMode, { timeout: 5_000 }).toBe("live");
  // The new round straight after, the car at rest on its spot: the skip's Space doesn't make it jump
  await expect.poll(async () => Math.abs((await hook()).pos.y), { timeout: 10_000 }).toBeGreaterThan(2000);
  await page.waitForTimeout(500);
  expect((await hook()).speed).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test("free play's goal in the garage's colour: an orange car's explosion orange, live and in the replay, its scorer orange (RX29C)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem("carball.team", "1");
  });
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  const colours = async (): Promise<number[]> =>
    page.evaluate(() => [...(window as unknown as { carballFreeplay: { goalColours: () => readonly number[] } }).carballFreeplay.goalColours()]);
  await page.evaluate(() => {
    (window as unknown as { carballFreeplay: Hook }).carballFreeplay.place({ x: 3000, y: 0, yaw: 0 }, { x: 0, y: 5300, z: 200 });
  });
  await expect.poll(colours, { timeout: 10_000 }).toEqual([0, 1]);
  await expect(page.locator("#replay-banner")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#replay-info .replay-scorer")).toHaveClass(/\bteam-1\b/);
  await expect.poll(colours, { timeout: 15_000 }).toEqual([0, 2]);
  expect(errors).toEqual([]);
});

test("Exit to Main Menu during a goal replay, then Free Play: a fresh round, no replay banner (MENU-1, RV-284)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  const hook = async (): Promise<{ pos: { x: number; y: number }; speed: number }> =>
    page.evaluate(() => (window as unknown as { carballFreeplay: Hook }).carballFreeplay.car());
  await page.evaluate(() => {
    (window as unknown as { carballFreeplay: Hook }).carballFreeplay.place({ x: 3000, y: 0, yaw: 0 }, { x: 0, y: 5300, z: 200 });
  });
  await expect(page.locator("#replay-banner")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#score-blue")).toHaveText("1");
  await page.keyboard.press("Escape");
  const pause = page.locator("#pause-menu");
  await pause.getByRole("button", { name: /^exit to main menu$/i }).click();
  await pause.getByRole("button", { name: /^yes$/i }).click();
  await expect(page.locator("#main-menu")).toBeVisible();
  await expect(page.locator("#replay-banner")).toBeHidden();
  await freePlay(page);
  await expect(page.locator("#replay-banner")).toBeHidden();
  await expect.poll(async () => Math.abs((await hook()).pos.y), { timeout: 10_000 }).toBeGreaterThan(2000);
  // (a new free play: the goals back to 0, RV-287)
  await expect(page.locator("#score-blue")).toHaveText("0");
  expect(errors).toEqual([]);
});

test("a goal in freeplay, skipping replays: no message, 3 s later a kickoff spot (released after 0.01 s), Backspace: the other half", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem("carball.settings.v1", JSON.stringify({ options: { autoSkipReplay: true } }));
  });
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  const hook = async (): Promise<{ pos: { x: number; y: number }; speed: number }> =>
    page.evaluate(() => (window as unknown as { carballFreeplay: Hook }).carballFreeplay.car());
  // The car out on the side, the ball dropped into orange's goal
  await page.evaluate(() => {
    (window as unknown as { carballFreeplay: Hook }).carballFreeplay.place({ x: 3000, y: 0, yaw: 0 }, { x: 0, y: 5300, z: 200 });
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

interface PadsHook {
  place: (car: object, ball?: object) => void;
  pads: () => { pads: { x: number; y: number; big: boolean; active: boolean }[]; boost: number };
}

test("Unlimited boost in free play: on (the default) a full car takes no pad; off (the settings) 33 boost, a small pad is taken and drawn dim", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  await page.waitForFunction(() => "carballFreeplay" in window);
  const place = async (car: object): Promise<void> => {
    await page.evaluate((c) => {
      (window as unknown as { carballFreeplay: PadsHook }).carballFreeplay.place(c, { x: 0, y: 3000, z: 93 });
    }, car);
  };
  const pads = async (): Promise<{ active: boolean | undefined; boost: number }> =>
    page.evaluate(() => {
      const s = (window as unknown as { carballFreeplay: PadsHook }).carballFreeplay.pads();
      return { active: s.pads.find((p) => !p.big && p.x === 0 && p.y === -1024)?.active, boost: s.boost };
    });
  const onPad = { x: 0, y: -1024, yaw: Math.PI / 2 };
  const behind = { x: 0, y: -1700, yaw: Math.PI / 2 };

  // On: onto the small pad at (0, -1024) with a full tank, and it stays (CanPickup: !IsFull)
  await place(onPad);
  await page.waitForTimeout(1500);
  expect(await pads()).toEqual({ active: true, boost: 100 });

  // Off, in the settings' Gameplay tab (the car off the pad first: at 33 it would take it at once): the tank at a
  // round's 33
  await place(behind);
  await openSettings(page);
  await page.locator('.settings-tab[data-tab="gameplay"]').click();
  const box = page.locator('[data-option="unlimitedBoost"]');
  await expect(box).toBeChecked();
  await box.uncheck();
  await closeMenus(page);
  await expect.poll(async () => (await pads()).boost, { timeout: 5_000 }).toBeCloseTo(100 / 3, 3);

  // The pad lit, from behind it; then onto it (taken, +12 boost); then the same look again
  const region = { x: 540, y: 340, width: 200, height: 140 };
  // (a look after the placement's frames: 0.8 s and at least 4 frames drawn, as under load a frame can take 0.4 s: RV-494)
  const settled = async (): Promise<void> => {
    await page.waitForTimeout(800);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const step = (k: number): void => {
            if (k === 0) resolve();
            else
              requestAnimationFrame(() => {
                step(k - 1);
              });
          };
          step(4);
        }),
    );
  };
  await place(behind);
  await settled();
  const lit = (await page.screenshot({ clip: region })).toString("base64");
  await place(onPad);
  await expect.poll(async () => (await pads()).active, { timeout: 10_000 }).toBe(false);
  expect((await pads()).boost).toBeGreaterThan(45);
  await place(behind);
  await settled();
  const taken = (await page.screenshot({ clip: region })).toString("base64");
  // (the pixels much darker in the second look, against those much brighter: the pad's dim look, its glow off)
  const change = await page.evaluate(
    async ([a, b]) => {
      const read = async (png: string): Promise<Uint8ClampedArray> => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const c = document.createElement("canvas");
        [c.width, c.height] = [img.width, img.height];
        const g = c.getContext("2d");
        if (!g) throw new Error("no 2d context");
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      const [p, q] = [await read(a ?? ""), await read(b ?? "")];
      let darker = 0;
      let brighter = 0;
      for (let k = 0; k < p.length; k += 4) {
        const lum = (d: Uint8ClampedArray): number => (0.2126 * (d[k] ?? 0) + 0.7152 * (d[k + 1] ?? 0) + 0.0722 * (d[k + 2] ?? 0)) / 255;
        const d = lum(p) - lum(q);
        if (d > 0.15) darker++;
        else if (d < -0.15) brighter++;
      }
      return { darker, brighter };
    },
    [lit, taken],
  );
  expect(change.darker, JSON.stringify(change)).toBeGreaterThan(150);
  expect(change.brighter, JSON.stringify(change)).toBeLessThan(change.darker / 3);
  expect(errors).toEqual([]);
});

test("the engine's contacts as the game's impact triggers: driving into the ball sounds it (Impact_Ball)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  await page.waitForFunction(() => "carballFreeplay" in window);
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" }); // (focus; the sound unlocked)
  const audio = async (): Promise<AudioStats> => page.evaluate(() => (window as unknown as { carballAudio: () => AudioStats }).carballAudio());
  // The ball 500 uu ahead of the car, resting; then full throttle into it
  await page.evaluate(() => {
    (window as unknown as { carballFreeplay: PadsHook }).carballFreeplay.place({ x: 0, y: -1500, yaw: Math.PI / 2 }, { x: 0, y: -1000, z: 93 });
  });
  await page.waitForTimeout(300);
  const before = (await audio()).played.ballHit ?? 0;
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await audio()).played.ballHit ?? 0, { timeout: 10_000 }).toBeGreaterThan(before);
  await page.keyboard.up("KeyW");
  expect(errors).toEqual([]);
});

test("the garage's car is the one free play drives, with its preset (CM28), kept for the next page", async ({ page }) => {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const hitbox = (): Promise<{ x: number; y: number; z: number }> =>
    page.evaluate(() => (window as unknown as { carballFreeplay: Hook }).carballFreeplay.car().hitbox);
  const sport = await hitbox();
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^garage$/i }).click();
  await menu.getByRole("radio", { name: /^tall$/i }).click();
  // (the Tall's hitbox: 123.22 x 79.21 x 44.16, taller and narrower than the Sport's)
  await expect.poll(async () => (await hitbox()).z).toBeCloseTo(44.16, 1);
  expect((await hitbox()).y).toBeLessThan(sport.y);
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect((await hitbox()).z).toBeCloseTo(44.16, 1);
});

test("the main menu, the pause menu, the HUD and its Interface options (MENU-1/4/6, HUD-5/12/16, HT-4)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  // The main menu over the arena: Play, then Free Play
  await expect(page.locator("#main-menu")).toBeVisible();
  await freePlay(page);
  // The boost meter: freeplay's unlimited boost, full, its "max" look (the fuel gauge's glow); no scoreboard in training (HUD-4)
  await expect(page.locator("#boost")).toBeVisible();
  await expect(page.locator("#boost-value")).toHaveText("100");
  await expect(page.locator("#boost")).toHaveClass(/max/);
  // (#score the board's 0 x 0 anchor: its digits and clock)
  await expect(page.locator("#score-blue")).toBeHidden();
  await expect(page.locator("#clock")).toBeHidden();
  await page.screenshot({ path: "test-results/hud-freeplay.png" });
  // The ball cam held (the middle button, Modern's): its indicator, no toggle line while it's held
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: "middle" });
  await expect(page.locator("#ballcam")).toHaveClass(/shown/);
  await expect(page.locator("#ballcam-toggle")).toHaveText("");
  // (BALL CAM's capitals as tall as Bourgeois Medium's at its 32: 0.5679 em, whatever font stands in for it here)
  const cap = await page.locator(".ballcam-head > span:not(.rec-dot)").evaluate((el) => {
    const style = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return 0;
    ctx.font = `${style.fontSize} ${style.fontFamily}`;
    return ctx.measureText("H").actualBoundingBoxAscent;
  });
  expect(cap / 32).toBeCloseTo(0.5679, 1);
  // (the bundled fonts in: Rajdhani SemiBold and Light, Orbitron; each number glyph's ink fitted to the game's)
  const fonts = await page.evaluate(() => ({
    loaded: [...document.fonts]
      .filter((f) => f.status === "loaded")
      .map((f) => f.family.replace(/"/g, ""))
      .sort(),
    zero: Number(getComputedStyle(document.documentElement).getPropertyValue("--num-s-0")),
  }));
  expect(fonts.loaded).toEqual(expect.arrayContaining(["Orbitron", "Rajdhani Light", "Rajdhani SemiBold"]));
  expect(fonts.zero).toBeGreaterThan(0.5);
  // (HUD-12, the user's findings 13, 16 and 26: the dot's centre on the label's capitals' middle, in any font; the hint's box
  // starting where the label's does; in stage px)
  const place = await page.evaluate(() => {
    const head = document.querySelector(".ballcam-head");
    const dot = head?.querySelector(".rec-dot");
    const label = head?.querySelector("span:not(.rec-dot)");
    const hint = document.querySelector("#ballcam-toggle");
    if (!head || !dot || !label || !hint) return null;
    const probe = document.createElement("span"); // (an empty inline box: its bottom is the line's baseline)
    probe.style.display = "inline-block";
    label.append(probe);
    const baseline = probe.getBoundingClientRect().bottom;
    probe.remove();
    const d = dot.getBoundingClientRect();
    const scale = d.width / 32;
    return { above: (baseline - (d.top + d.height / 2)) / scale, hint: (hint.getBoundingClientRect().left - label.getBoundingClientRect().left) / scale };
  });
  expect(Math.abs((place?.above ?? 0) - cap / 2)).toBeLessThan(0.5);
  expect(Math.abs(place?.hint ?? 99)).toBeLessThan(0.5);
  await page.mouse.up({ button: "middle" });
  await expect(page.locator("#ballcam")).not.toHaveClass(/shown/);
  // The pause menu: the boost meter goes under it (HUD-16); Resume Game (no Show Controls in a match: HT-4)
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-menu")).toBeVisible();
  await expect(page.locator("#boost")).toBeHidden();
  await expect(page.locator("#pause-menu").getByRole("button", { name: /^show controls$/i })).toHaveCount(0);
  await page.screenshot({ path: "test-results/pause-menu.png" });
  await page
    .locator("#pause-menu")
    .getByRole("button", { name: /^resume game$/i })
    .click();
  await expect(page.locator("#pause-menu")).toBeHidden();
  await expect(page.locator("#boost")).toBeVisible();
  // The Interface tab: the plain boost meter, then the HUD hidden
  await openSettings(page);
  await page.locator('.settings-tab[data-tab="interface"]').click();
  await page.locator('[data-setting="teamColoredBoost"]').uncheck();
  await page.locator('[data-setting="hideHud"]').check();
  await closeMenus(page);
  await expect(page.locator("#boost")).toHaveClass(/plain/);
  await expect(page.locator("#hud")).toHaveClass(/hud-hidden/);
  await expect(page.locator("#hud-stage")).toBeHidden();
  // Exit to Main Menu, its question answered (HT-4)
  await page.keyboard.press("Escape");
  await page
    .locator("#pause-menu")
    .getByRole("button", { name: /^exit to main menu$/i })
    .click();
  await expect(page.locator("#pause-menu")).toContainText("Are you sure you want to exit to the main menu?");
  await page.locator("#pause-menu").getByRole("button", { name: /^yes$/i }).click();
  await expect(page.locator("#main-menu")).toBeVisible();
  expect(errors).toEqual([]);
});
