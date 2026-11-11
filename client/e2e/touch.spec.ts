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
    // (in the air Slide says what it does there; back on the ground, Slide again)
    await expect(page.locator(".touch-slide")).toHaveText("Air Roll");
    await expect(page.locator(".touch-slide")).toHaveText("Slide", { timeout: 5000 });
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

  test("a stray tap between the buttons does nothing (no jump through the mouse events a tap brings: RV-1210)", async ({ page }) => {
    await freePlayByTouch(page);
    await expect.poll(async () => (await car(page)).onGround, { timeout: 5000 }).toBe(true);
    await page.locator("#touch").tap({ position: { x: 600, y: 120 } });
    await page.waitForTimeout(500);
    expect((await car(page)).onGround).toBe(true);
  });

  test("every finger let go when the page loses them: blurred, the stick released (RV-1213)", async ({ page }) => {
    await freePlayByTouch(page);
    const cdp = await page.context().newCDPSession(page);
    await fingers(cdp, "touchStart", [{ id: 1, x: 160, y: 250 }]);
    await fingers(cdp, "touchMove", [{ id: 1, x: 160, y: 180 }]);
    await expect(page.locator(".touch-stick-base")).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.locator(".touch-stick-base")).toBeHidden();
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

test.describe("a touchscreen laptop", () => {
  test.use({ viewport: { width: 1280, height: 720 }, hasTouch: true });

  test("a touch brings the controls; the mouse used takes them away, a click never the stick (RV-1211)", async ({ page }) => {
    await page.goto("/?render=off");
    await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
    const menu = page.locator("#main-menu");
    await menu.getByRole("button", { name: /^play$/i }).tap({ timeout: 30_000 });
    await menu.getByRole("button", { name: /^free play$/i }).tap();
    await expect(menu).toBeHidden();
    const touch = page.locator("#touch");
    await expect(touch).toBeVisible();
    await page.mouse.click(200, 400);
    await expect(touch).toBeHidden();
    await page.locator("#game").tap({ position: { x: 900, y: 300 } });
    await expect(touch).toBeVisible();
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

const IPHONE = (version: string): string =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS ${version} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version.replace("_", ".")} Mobile/15E148 Safari/604.1`;

async function menuPage(page: Page): Promise<void> {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
}

test.describe("the menus on a phone", () => {
  test.use(PHONE);

  test("targets 44 px tall at least; the settings' tabs one row scrolled sideways, its Controls without the keyboard's notices", async ({ page }) => {
    await menuPage(page);
    const menu = page.locator("#main-menu");
    const heights = await menu
      .locator(".main-menu-column:not([hidden]) .main-menu-button")
      .evaluateAll((buttons) => buttons.filter((b) => b.getClientRects().length > 0).map((b) => b.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    await menu.getByRole("button", { name: /^settings$/i }).tap();
    const tabs = page.locator("#settings .settings-tabs");
    await expect(tabs).toBeVisible();
    const row = await tabs.evaluate((t) => ({
      scrolls: t.scrollWidth > t.clientWidth,
      tops: new Set([...t.children].map((c) => Math.round(c.getBoundingClientRect().top))).size,
    }));
    expect(row).toEqual({ scrolls: true, tops: 1 });
    await page.locator("#settings .settings-tab", { hasText: "Controls" }).tap();
    await expect(page.locator("#settings")).not.toContainText("Switch to Fullscreen");
    await expect(page.locator("#settings .browser-notice")).toHaveCount(0);
  });

  test("the training editor by touch: the panel alone (no free camera), its hint the finger's", async ({ page }) => {
    await menuPage(page);
    const menu = page.locator("#main-menu");
    await menu.getByRole("button", { name: /^play$/i }).tap();
    await menu.getByRole("button", { name: /^custom training$/i }).tap();
    await menu.getByRole("button", { name: /^create training$/i }).tap();
    const editor = page.locator("#training-editor");
    await expect(editor).toBeVisible();
    await expect(editor.getByRole("button", { name: /^free camera$/i })).toHaveCount(0);
    await expect(editor.locator(".editor-hint")).toHaveText(/pinch to zoom/i);
  });

  test("the screen kept on in play, let go under the pause menu", async ({ page, context }) => {
    await context.addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { wakeLog: string[] }).wakeLog = log;
      Object.defineProperty(navigator, "wakeLock", {
        value: {
          request: () => {
            log.push("request");
            const sentinel = {
              released: false,
              release: () => {
                log.push("release");
                sentinel.released = true;
                return Promise.resolve();
              },
            };
            return Promise.resolve(sentinel);
          },
        },
        configurable: true,
      });
    });
    await freePlayByTouch(page);
    const log = (): Promise<string[]> => page.evaluate(() => (window as unknown as { wakeLog: string[] }).wakeLog);
    await expect.poll(log).toEqual(["request"]);
    await page.locator("#touch").getByRole("button", { name: "Pause" }).tap();
    await expect.poll(log).toEqual(["request", "release"]);
  });
});

test.describe("an iPhone before 17.5", () => {
  test.use({ ...PHONE, userAgent: IPHONE("17_4") });

  test("Play vs Bots says why it can't run, with no Start; the Add to Home Screen hint once, until dismissed", async ({ page }) => {
    await menuPage(page);
    const hint = page.locator(".browser-notice", { hasText: "Add to Home Screen" });
    await expect(hint).toBeVisible();
    await hint.getByRole("button", { name: "Got it" }).tap();
    await expect(hint).toHaveCount(0);
    const menu = page.locator("#main-menu");
    await menu.getByRole("button", { name: /^play$/i }).tap();
    await menu.getByRole("button", { name: "Play vs Bots" }).tap({ timeout: 15_000 });
    await expect(menu.locator(".main-menu-bots")).toHaveText("Play vs Bots needs iOS 17.5 or later on an iPhone or iPad.");
    await expect(menu.getByRole("button", { name: /^start$/i })).toBeHidden();
    await menuPage(page);
    await expect(page.locator(".browser-notice", { hasText: "Add to Home Screen" })).toHaveCount(0);
  });
});

test.describe("a browser without WebTransport", () => {
  test.use(PHONE);

  test("Find Match is off, with why; the offline modes still there", async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, "WebTransport");
    });
    await menuPage(page);
    const menu = page.locator("#main-menu");
    await menu.getByRole("button", { name: /^play$/i }).tap();
    await expect(menu.getByRole("button", { name: /^find match$/i })).toBeDisabled();
    await expect(menu.getByText("Online play needs WebTransport, which this browser doesn't have.")).toBeVisible();
    await expect(menu.getByRole("button", { name: /^free play$/i })).toBeEnabled();
  });
});

/** A settings cycler stepped by taps on its right chevron until its value is `value` */
async function tapCycleTo(page: Page, selector: string, value: string): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const control = page.locator(selector);
    if ((await control.getAttribute("data-value")) === value) return;
    const box = await control.boundingBox();
    if (!box) throw new Error(`${selector} isn't shown`);
    await control.tap({ position: { x: box.width - 10, y: box.height / 2 } });
  }
  await expect(page.locator(selector)).toHaveAttribute("data-value", value);
}

/** The settings stored before the page loads: the Touch tab's (input/touchSettings.ts) */
async function touchSettings(page: Page, touch: object): Promise<void> {
  await page.addInitScript((t) => {
    localStorage.setItem("carball.settings.v1", JSON.stringify({ touch: t }));
  }, touch);
}

test.describe("the Touch settings on a phone", () => {
  test.use(PHONE);

  test("Auto drive, set in the Touch tab: the car drives with no finger on the stick; Brake backs it up", async ({ page }) => {
    await menuPage(page);
    const menu = page.locator("#main-menu");
    await menu.getByRole("button", { name: /^settings$/i }).tap();
    await page.locator("#settings .settings-tab", { hasText: "Touch" }).tap();
    await tapCycleTo(page, '#settings [data-setting="throttle"]', "auto");
    await expect(page.locator("#settings")).toContainText("hold Brake to slow down and reverse");
    await page.keyboard.press("Escape");
    await menu.getByRole("button", { name: /^play$/i }).tap();
    await menu.getByRole("button", { name: /^free play$/i }).tap();
    await page.evaluate(() => {
      (window as unknown as Hook).carballFreeplay.place({ x: 0, y: -2000, yaw: Math.PI / 2 });
    });
    await expect(page.locator("#touch").getByRole("button", { name: "Brake" })).toBeVisible();
    await expect.poll(async () => (await car(page)).speed, { timeout: 5000 }).toBeGreaterThan(800);
    const cdp = await page.context().newCDPSession(page);
    await fingers(cdp, "touchStart", [{ id: 1, ...(await centre(page, ".touch-brake")) }]);
    await expect.poll(async () => (await car(page)).speed, { timeout: 5000 }).toBeLessThan(300);
    await fingers(cdp, "touchEnd", []);
  });

  test("Split: the stick steers alone (no drive), Gas drives", async ({ page }) => {
    await touchSettings(page, { throttle: "split" });
    await freePlayByTouch(page);
    await page.evaluate(() => {
      (window as unknown as Hook).carballFreeplay.place({ x: 0, y: -2000, yaw: Math.PI / 2 });
    });
    const touch = page.locator("#touch");
    await expect(touch.getByRole("button", { name: "Gas" })).toBeVisible();
    await expect(touch.getByRole("button", { name: "Reverse" })).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    await fingers(cdp, "touchStart", [{ id: 1, x: 160, y: 250 }]);
    await fingers(cdp, "touchMove", [{ id: 1, x: 160, y: 180 }]);
    await page.waitForTimeout(800);
    expect((await car(page)).speed).toBeLessThan(50);
    await fingers(cdp, "touchStart", [
      { id: 1, x: 160, y: 180 },
      { id: 2, ...(await centre(page, ".touch-gas")) },
    ]);
    await expect.poll(async () => (await car(page)).speed, { timeout: 5000 }).toBeGreaterThan(800);
    await fingers(cdp, "touchEnd", []);
  });

  test("a fixed stick: shown at its spot in play; a thumb near it drives, one far from it doesn't", async ({ page }) => {
    await touchSettings(page, { fixedStick: true });
    await freePlayByTouch(page);
    await page.evaluate(() => {
      (window as unknown as Hook).carballFreeplay.place({ x: 0, y: -2000, yaw: Math.PI / 2 });
    });
    const base = page.locator(".touch-stick-base");
    await expect(base).toBeVisible();
    const spot = await centre(page, ".touch-stick-base");
    const cdp = await page.context().newCDPSession(page);
    // (far from it, high in the left half, clear of the buttons (a touch near one is taken as its): nothing)
    await fingers(cdp, "touchStart", [{ id: 1, x: 380, y: 140 }]);
    await fingers(cdp, "touchMove", [{ id: 1, x: 380, y: 80 }]);
    await page.waitForTimeout(800);
    expect((await car(page)).speed).toBeLessThan(50);
    await fingers(cdp, "touchEnd", []);
    // (on it, pushed up: drives; the base where it was)
    await fingers(cdp, "touchStart", [{ id: 2, x: spot.x + 10, y: spot.y }]);
    await fingers(cdp, "touchMove", [{ id: 2, x: spot.x, y: spot.y - 70 }]);
    await expect.poll(async () => (await car(page)).speed, { timeout: 5000 }).toBeGreaterThan(800);
    expect(await centre(page, ".touch-stick-base")).toEqual(spot);
    await fingers(cdp, "touchEnd", []);
  });

  test("the layout editor: Jump dragged, Boost made bigger, Ball Cam hidden; kept across a reload; reset", async ({ page }) => {
    await menuPage(page);
    const menu = page.locator("#main-menu");
    await menu.getByRole("button", { name: /^settings$/i }).tap();
    await page.locator("#settings .settings-tab", { hasText: "Touch" }).tap();
    await page.getByRole("button", { name: "Edit Button Layout" }).tap();
    const touch = page.locator("#touch");
    await expect(touch).toHaveClass(/touch-editing/);
    // (its own screen: the settings out of sight under it, RV-1234)
    await expect(page.locator("#settings")).toBeHidden();
    const cdp = await page.context().newCDPSession(page);
    const jump = await centre(page, ".touch-jump");
    await fingers(cdp, "touchStart", [{ id: 1, ...jump }]);
    await fingers(cdp, "touchMove", [{ id: 1, x: 500, y: 200 }]);
    await fingers(cdp, "touchEnd", []);
    await page.locator(".touch-boost").tap();
    await page.getByRole("button", { name: "Bigger" }).tap();
    await page.getByRole("button", { name: "Bigger" }).tap();
    await page.locator(".touch-ballCam").tap();
    await page.getByRole("button", { name: "Hide" }).tap();
    await page.getByRole("button", { name: "Done" }).tap();
    await expect(touch).not.toHaveClass(/touch-editing/);
    // (the settings back as they were: their Touch tab)
    await expect(page.getByRole("button", { name: "Edit Button Layout" })).toBeVisible();
    // (Escape while editing is Done: the settings still the open menu under it, not closed by it, RV-1249)
    await page.getByRole("button", { name: "Edit Button Layout" }).tap();
    await expect(touch).toHaveClass(/touch-editing/);
    await page.keyboard.press("Escape");
    await expect(touch).not.toHaveClass(/touch-editing/);
    await expect(page.getByRole("button", { name: "Edit Button Layout" })).toBeVisible();
    // (a reload: the layout as left)
    await freePlayByTouch(page);
    const moved = await centre(page, ".touch-jump");
    expect(Math.abs(moved.x - 500)).toBeLessThan(2);
    expect(Math.abs(moved.y - 200)).toBeLessThan(2);
    await expect(page.locator(".touch-boost")).toHaveCSS("scale", "1.2");
    await expect(page.locator(".touch-ballCam")).toBeHidden();
    // (reset: every button back at its default)
    await touch.getByRole("button", { name: "Pause" }).tap();
    await page.getByRole("button", { name: /^settings$/i }).tap();
    await page.locator("#settings .settings-tab", { hasText: "Touch" }).tap();
    await page.getByRole("button", { name: "Reset Button Layout" }).tap();
    expect(await page.evaluate(() => localStorage.getItem("carball.touchLayout"))).toBeNull();
  });

  test("the fixed stick dragged in the editor stays in the left half, where a thumb takes it (RV-1233)", async ({ page }) => {
    await touchSettings(page, { fixedStick: true });
    await menuPage(page);
    await page
      .locator("#main-menu")
      .getByRole("button", { name: /^settings$/i })
      .tap();
    await page.locator("#settings .settings-tab", { hasText: "Touch" }).tap();
    await page.getByRole("button", { name: "Edit Button Layout" }).tap();
    const cdp = await page.context().newCDPSession(page);
    await fingers(cdp, "touchStart", [{ id: 1, ...(await centre(page, ".touch-stick-base")) }]);
    await fingers(cdp, "touchMove", [{ id: 1, x: 760, y: 200 }]);
    await fingers(cdp, "touchEnd", []);
    const base = await page.locator(".touch-stick-base").boundingBox();
    if (!base) throw new Error("the stick isn't shown");
    expect(base.x + base.width).toBeLessThanOrEqual(844 / 2 + 1);
  });

  test("Auto drive in training with Skip Goal Replay: a shot run out, the next one waits in its Countdown too (RV-1246)", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("carball.settings.v1", JSON.stringify({ touch: { throttle: "auto" }, training: { skipReplay: true } }));
    });
    await menuPage(page);
    // (a made-up pack: a 2 s shot with the ball out of reach, then a second)
    const shotAt = (timeLimit: number, ball: number[], start: number[]): unknown => ({
      timeLimit,
      ball: { location: ball, launch: { pitch: 0, yaw: 16384 }, speed: 0 },
      car: { location: start, rotation: { pitch: 0, yaw: 16384, roll: 0 }, startSpeed: 0 },
    });
    const pack = {
      format: 1,
      id: "e2e-touch-pack",
      name: "E2E Touch Pack",
      type: "striker",
      difficulty: "easy",
      shots: [shotAt(2, [1500, 0, 900], [0, -2000, 17]), shotAt(20, [0, 2000, 93], [0, -2000, 17])],
    };
    await page.evaluate((p) => {
      (window as unknown as { carballFreeplay: { startTraining: (p: unknown) => void } }).carballFreeplay.startTraining(p);
    }, pack);
    const shot = (): Promise<string | undefined> =>
      page.evaluate(() => {
        const t = (window as unknown as { carballFreeplay: { training: () => { state: string; shot: number } | null } }).carballFreeplay.training();
        return t ? `${t.state} ${String(t.shot)}` : undefined;
      });
    await expect.poll(shot).toBe("countdown 0");
    const cdp = await page.context().newCDPSession(page);
    await fingers(cdp, "touchStart", [{ id: 1, x: 200, y: 250 }]);
    await fingers(cdp, "touchEnd", []);
    await expect.poll(shot).toBe("active 0");
    // (run out, its slow motion, no replay: the next shot, which waits)
    await expect.poll(shot, { timeout: 15_000 }).toBe("countdown 1");
    await page.waitForTimeout(1500);
    expect(await shot()).toBe("countdown 1");
  });

  test("Auto drive in training: a shot waits in its Countdown till a touch; Next's shot waits again (RV-1232)", async ({ page }) => {
    await touchSettings(page, { throttle: "auto" });
    await menuPage(page);
    const menu = page.locator("#main-menu");
    await menu.getByRole("button", { name: /^play$/i }).tap({ timeout: 30_000 });
    await menu.getByRole("button", { name: /^custom training$/i }).tap();
    await menu.locator(".main-menu-training-tabs").getByRole("tab", { name: "Starter Packs" }).tap();
    await menu.locator('[data-training-panel="starter"] .main-menu-pack', { hasText: "First Touches" }).tap();
    await expect(menu).toBeHidden();
    const shot = (): Promise<string | undefined> =>
      page.evaluate(() => (window as unknown as { carballFreeplay: { training: () => { state: string } | null } }).carballFreeplay.training()?.state);
    await expect.poll(shot).toBe("countdown");
    await page.waitForTimeout(1500);
    expect(await shot(), "no touch yet").toBe("countdown");
    // (the stick touched where it lands, untilted: Auto drive drives, which starts the shot)
    const cdp = await page.context().newCDPSession(page);
    await fingers(cdp, "touchStart", [{ id: 1, x: 200, y: 250 }]);
    await fingers(cdp, "touchEnd", []);
    await expect.poll(shot).toBe("active");
    // (Next: its shot in its Countdown, waiting again; the tap itself no start)
    await page.locator("#touch").getByRole("button", { name: "Next" }).tap();
    await expect.poll(shot).toBe("countdown");
    await page.waitForTimeout(1500);
    expect(await shot(), "Next's shot").toBe("countdown");
  });
});
