// Online play against a local rl-server (started by playwright.config.ts on ports 14433/14434).
import type { Page } from "@playwright/test";
import { expect, hideGamepads, test } from "./fixtures";
import { ends, join as joinServer, leaveAll, newPlayer } from "./players";

interface Stats {
  ping: number | null;
  ackFrame: number;
  frame: number;
  cars: { id: number; pos: { x: number; y: number; z: number } }[];
  corrections: number;
  localMispredictions: number;
  kickoffCountdown: number;
  phases: { phase: string; at: number; frame: number }[];
  replaying: boolean;
  goal: { frame: number | null; explodedFrame: number | null; minDilation: number };
}

const SERVER = "127.0.0.1:14434";

async function join(page: Page, errors: string[]): Promise<void> {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`/?server=${SERVER}`);
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
}

async function stats(page: Page): Promise<Stats> {
  return page.evaluate(() => (window as unknown as { rlOnline: () => Stats }).rlOnline());
}

test("two players: one drives, the other sees it through the server", async ({ page, browser }) => {
  const errors: string[] = [];
  await join(page, errors);
  const otherContext = await browser.newContext();
  await hideGamepads(otherContext);
  const other = await otherContext.newPage();
  await join(other, errors);

  // Both see both cars; the first player reloaded the world when the second joined. (Generous: software WebGL shares
  // the CPU with the other workers' tests, the stadium's reflection capture among them, and the second page can take a
  // while to show its first server state)
  await expect(page.locator("#net")).toContainText("2 cars", { timeout: 15_000 });
  await expect(other.locator("#net")).toContainText("2 cars", { timeout: 15_000 });
  await expect(page.locator("#net")).toContainText(/ping \d+ ms/);
  // The match clock, from the server: full until the ball is first hit or 5 s after go, then counting down (how far
  // depends on how long the test took to get here: not the point; a fresh match, so within its first minute)
  await expect(page.locator("#clock")).toHaveText(/^[45]:\d\d$/);
  const [minutes = 0, seconds = 0] = ((await page.locator("#clock").textContent()) ?? "").split(":").map(Number);
  expect(minutes * 60 + seconds).toBeLessThanOrEqual(300);
  expect(minutes * 60 + seconds).toBeGreaterThan(240);
  await expect(other.locator("#clock")).toBeVisible();

  // The kickoff countdown (4 s from the first player's join) ends: cars take input again
  await expect.poll(async () => (await stats(page)).kickoffCountdown, { timeout: 10_000 }).toBe(0);

  const me = await stats(page);
  const ids = me.cars.map((c) => c.id);
  const start = (await stats(other)).cars;

  // The first player holds W
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" }); // focus (right mouse: powerslide)
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1500);
  await page.keyboard.up("KeyW");
  await page.screenshot({ path: "test-results/online.png" });

  // The server consumed (nearly) all its input frames: it acknowledges frames close to the newest
  const after = await stats(page);
  expect(after.ackFrame).toBeGreaterThan(after.frame - 60);
  expect(after.corrections).toBeGreaterThan(50);
  // The server agrees with the local prediction. It differs when joining the server's timeline, at the world reload,
  // and once per buffer underrun or catch-up on the server (each shifts its timeline by a tick); the slow
  // software-rendered pages send in bursts and stall, and cause many (over 10% under parallel load). A determinism bug
  // would make nearly every correction differ.
  expect(after.localMispredictions).toBeLessThan(after.corrections / 2);

  // The other player sees exactly one car having moved far: the one that drove (its page may lag under load)
  const movedCars = async (): Promise<number[]> =>
    (await stats(other)).cars
      .filter((c) => {
        const s = start.find((x) => x.id === c.id);
        return s !== undefined && Math.hypot(c.pos.x - s.pos.x, c.pos.y - s.pos.y) > 500;
      })
      .map((c) => c.id);
  await expect
    .poll(movedCars, { timeout: 5_000, message: `other player's view: ${JSON.stringify(await stats(other))}` })
    .toHaveLength(1);
  expect(ids).toContain((await movedCars())[0]);

  await otherContext.close();
  expect(errors).toEqual([]);
});

test("leaving: the question, back to freeplay; the car explodes for the others and the emptied team forfeits", async ({ page, browser }) => {
  // (on this server votes wait for the clock's first minute, so the menu's match button is leaving's: RV-236)
  const errors: string[] = [];
  const others: Page[] = [];
  await joinServer(page, SERVER, errors);
  // (alone first: the last test's players gone, so the two are on opposite teams)
  await expect(page.locator("#net")).toContainText("1 cars", { timeout: 30_000 });
  const leaving: string[] = [];
  const other = await newPlayer(browser, SERVER, leaving);
  others.push(other);
  await expect(page.locator("#net")).toContainText("2 cars", { timeout: 30_000 });
  const demolitions = (): Promise<number> =>
    page.evaluate(() => (window as unknown as { rlAudio: () => { played: Record<string, number> } }).rlAudio().played.demo ?? 0);
  const before = await demolitions();
  const button = (label: string) => other.getByRole("button", { name: new RegExp(`^${label}$`, "i") });

  await other.keyboard.press("Escape");
  await button("Leave Match").click({ timeout: 30_000 });
  await expect(other.getByText("Are you sure you want to quit the match?")).toBeVisible({ timeout: 30_000 });
  await button("No").click();
  await expect(button("Leave Match")).toBeVisible({ timeout: 30_000 });
  await button("Leave Match").click();
  await button("Yes").click({ timeout: 30_000 });

  // The others: its car explodes and goes; its team, emptied, forfeits (whichever the page's isn't)
  await expect(page.locator("#net")).toContainText("1 cars", { timeout: 15_000 });
  await expect.poll(demolitions, { timeout: 15_000 }).toBeGreaterThan(before);
  await expect.poll(async () => (await ends(page)).filter((e) => e.forfeit).length, { timeout: 15_000 }).toBe(1);
  // The leaver: back to freeplay
  await expect(other).toHaveURL(/:4173\/$/, { timeout: 30_000 });
  await other.waitForFunction(() => "rlFreeplay" in window, null, { timeout: 60_000 });

  expect(errors).toEqual([]);
  expect(leaving).toEqual([]);
  await leaveAll(page, others);
});

test("a goal: the game slows down for 3.53 s, the goal replay plays, Space skips it, then the kickoff", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 }); // (software rendering: keep over 24 fps, LT-2)
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // (this server knocks the ball into a goal 1 s after each go)
  await page.goto("/?server=127.0.0.1:14436");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await expect.poll(async () => (await stats(page)).replaying, { timeout: 30_000 }).toBe(true);
  await expect(page.locator("#message")).toContainText("REPLAY");
  const { phases } = await stats(page);
  const goal = phases.findLast((p) => p.phase === "postGoal");
  const replay = phases.findLast((p) => p.phase === "replay");
  expect(goal && replay).toBeTruthy();
  if (!goal || !replay) return;
  // 360 ticks after the goal, slowed at first: 3.53 s of real time (the server's clock)
  expect((replay.at - goal.at) / 1000).toBeGreaterThan(3.25);
  expect((replay.at - goal.at) / 1000).toBeLessThan(3.85);
  // This client's clock slowed with it, down to the curve's 0.1875, keyed to the server's goal tick: the frame its
  // corrected history has the goal in (how many frames it ran depends on its frame rate: under 24 fps, the game's 5
  // ticks a frame fall behind real time, as software rendering here does)
  const { goal: slowed } = await stats(page);
  // (sampled once a frame: a slow page may step past the curve's lowest point)
  expect(slowed.minDilation).toBeGreaterThanOrEqual(0.1875);
  expect(slowed.minDilation).toBeLessThan(0.3);
  expect(slowed.frame).not.toBeNull();
  // (within a few frames: the server tick to client frame mapping moves by a frame each time the server repeats or
  // skips an input, which a stalling software-rendered page makes it do often)
  expect(Math.abs((slowed.frame ?? 0) - (slowed.explodedFrame ?? 0)), JSON.stringify(slowed)).toBeLessThanOrEqual(8);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "test-results/replay.png" });

  // Space: the only player is ready, so the replay ends and the next kickoff counts down
  await page.locator("#game").click({ position: { x: 320, y: 180 }, button: "right" });
  await page.keyboard.press("Space");
  await expect.poll(async () => (await stats(page)).replaying, { timeout: 3_000 }).toBe(false);
  await expect.poll(async () => (await stats(page)).phases.at(-1)?.phase).toBe("countdown");
  await expect(page.locator("#message")).not.toContainText("REPLAY");
  expect(errors).toEqual([]);
});
