// Online play against a local carball-server (started by playwright.config.ts on ports 14433/14434). Nothing here reads
// pixels: the pages load with `?render=off` (nothing drawn; software WebGL for two or three pages starved the suite),
// but for the goal's, which draws the online effects (RV-327).
import type { Page } from "@playwright/test";
import { expect, hideGamepads, test } from "./fixtures";
import { ends, join as joinServer, leave, leaveAll, newPlayer } from "./players";

interface Stats {
  ping: number | null;
  ackFrame: number;
  frame: number;
  cars: { id: number; pos: { x: number; y: number; z: number }; model: number }[];
  localCar: number;
  corrections: number;
  localMispredictions: number;
  kickoffCountdown: number;
  phases: { phase: string; at: number; frame: number }[];
  replaying: boolean;
  goal: { frame: number | null; explodedFrame: number | null; minDilation: number; offsetSpread: number };
}

const SERVER = "127.0.0.1:14434";

async function join(page: Page, errors: string[]): Promise<void> {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`/?server=${SERVER}&render=off`);
  // (generous: under the suite's load a page can take over 30 s to its first frame)
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
}

async function stats(page: Page): Promise<Stats> {
  return page.evaluate(() => (window as unknown as { carballOnline: () => Stats }).carballOnline());
}

test("two players: one drives, the other sees it through the server", async ({ page, browser }) => {
  test.setTimeout(180_000); // (two pages joining under the suite's load)
  const errors: string[] = [];
  await join(page, errors);
  const otherContext = await browser.newContext({ viewport: { width: 640, height: 360 } }); // (small: software rendering)
  await hideGamepads(otherContext);
  // (the second player's garage car the Tall, chosen before: its hello asks for it, CM29)
  await otherContext.addInitScript(() => {
    try {
      localStorage.setItem("carball.car", "3");
    } catch {
      // (a blank page's: no storage)
    }
  });
  const other = await otherContext.newPage();
  await join(other, errors);

  // Both see both cars; the first player reloaded the world when the second joined. (Generous: software WebGL shares
  // the CPU with the other workers' tests, the stadium's reflection capture among them, and the second page can take a
  // while to show its first server state)
  await expect(page.locator("#net")).toContainText("2 cars", { timeout: 15_000 });
  await expect(other.locator("#net")).toContainText("2 cars", { timeout: 15_000 });
  await expect(page.locator("#net")).toContainText(/ping \d+ ms/);
  // Each car drawn as its player's garage car, from the roster (CM27): the second player's the Tall on both pages, the
  // first's the default Sport
  const tall = (await stats(other)).localCar;
  const sport = (await stats(page)).localCar;
  for (const p of [page, other]) {
    await expect
      .poll(async () => Object.fromEntries((await stats(p)).cars.map((c) => [c.id, c.model])), { timeout: 10_000 })
      .toEqual({ [tall]: 3, [sport]: 0 });
  }
  // The match clock, from the server: full until the ball is first hit or 5 s after go, then counting down (how far
  // depends on how long the test took to get here: not the point; a fresh match, so within its first minute)
  await expect(page.locator("#clock")).toHaveText(/^[45]:\d\d$/);
  const [minutes = 0, seconds = 0] = ((await page.locator("#clock").textContent()) ?? "").split(":").map(Number);
  expect(minutes * 60 + seconds).toBeLessThanOrEqual(300);
  expect(minutes * 60 + seconds).toBeGreaterThan(240);
  await expect(other.locator("#clock")).toBeVisible();
  // The HUD's scoreboard (HUD-2): each page's own team on the left (the orange player's swapped); the other car's
  // nameplate (HUD-13)
  await expect(page.locator("#score")).not.toHaveClass(/swapped/);
  await expect(other.locator("#score")).toHaveClass(/swapped/);
  // (drawn in the world, depth-tested: HT-12)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { carballNameplates: () => { name: string }[] }).carballNameplates().length), { timeout: 10_000 })
    .toBe(1);
  await page.screenshot({ path: "test-results/hud-online.png" });

  // Holding Tab shows the scoreboard: a row per player under its team's headers; released, it fades away (SB-10)
  await page.locator("#game").click({ position: { x: 640, y: 360 }, button: "right" });
  await page.keyboard.down("Tab");
  const board = page.locator("#scoreboard");
  await expect(board).toBeVisible({ timeout: 5_000 });
  await expect(board.locator(".sb-row")).toHaveCount(2, { timeout: 10_000 });
  await expect(board.locator(".sb-team-0 .sb-header").first()).toHaveText("SCORE");
  await expect(board).toContainText("GOALS");
  await expect(board).toContainText("PING");
  await expect(board.locator(".sb-local")).toHaveCount(1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/scoreboard.png" });
  await page.keyboard.up("Tab");
  await expect(board).toBeHidden({ timeout: 3_000 });

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
  await expect.poll(movedCars, { timeout: 5_000, message: `other player's view: ${JSON.stringify(await stats(other))}` }).toHaveLength(1);
  expect(ids).toContain((await movedCars())[0]);

  // (both leave at once: the next test starts alone on this server)
  await leave(other);
  await otherContext.close();
  await leave(page);
  expect(errors).toEqual([]);
});

test("leaving: the question, back to freeplay; the car explodes for the others and the emptied team forfeits", async ({ page, browser }) => {
  test.setTimeout(180_000); // (two pages joining, one going back to freeplay, under the suite's load)
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
    page.evaluate(() => (window as unknown as { carballAudio: () => { played: Record<string, number> } }).carballAudio().played.demo ?? 0);
  const before = await demolitions();
  // (a forfeit before this, a slow last player's leave in this match's countdown, isn't this test's)
  const forfeitsBefore = (await ends(page)).filter((e) => e.forfeit).length;
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
  await expect.poll(async () => (await ends(page)).filter((e) => e.forfeit).length, { timeout: 15_000 }).toBe(forfeitsBefore + 1);
  // The leaver: back to freeplay (the server's address gone; the tests' `render=off` kept)
  await expect(other).toHaveURL(/:4173\/(\?render=off)?$/, { timeout: 30_000 });
  await other.waitForFunction(() => "carballFreeplay" in window, null, { timeout: 60_000 });

  expect(errors).toEqual([]);
  expect(leaving).toEqual([]);
  await leaveAll(page, others);
});

test("a goal: the game slows down for 3.53 s, the goal replay plays, Space skips it, then the kickoff", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 }); // (software rendering: keep over 24 fps, LT-2)
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // (this server knocks the ball into a goal 1 s after each go)
  // (drawn: one online test draws the online effects, the goal's explosion and replay among them, RV-327)
  await page.goto("/?server=127.0.0.1:14436");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  // The banner: nobody touched the ball, so the team's name (GoalScored, "{Player} scored!")
  await expect(page.locator("#message")).toHaveText("BLUE SCORED!", { timeout: 30_000 });
  await expect.poll(async () => (await stats(page)).replaying, { timeout: 30_000 }).toBe(true);
  await expect(page.locator("#replay-banner")).toBeVisible();
  const { phases } = await stats(page);
  const goal = phases.findLast((p) => p.phase === "postGoal");
  const replay = phases.findLast((p) => p.phase === "replay");
  expect(goal && replay).toBeTruthy();
  if (!goal || !replay) return;
  // 360 ticks after the goal, slowed at first: 3.53 s of real time (the server's clock)
  expect((replay.at - goal.at) / 1000).toBeGreaterThan(3.25);
  expect((replay.at - goal.at) / 1000).toBeLessThan(3.85);
  // This client's clock slowed with it, through the curve's 0.1875, keyed to the server's goal tick: the frame its
  // corrected history has the goal in (how many frames it ran depends on its frame rate: under 24 fps, the game's 5
  // ticks a frame fall behind real time, as software rendering here does; the curve read at each tick it ran, which a
  // slow page's frames don't step past, RX31)
  const { goal: slowed } = await stats(page);
  expect(slowed.minDilation).toBeCloseTo(0.1875, 3);
  expect(slowed.frame).not.toBeNull();
  // (within the frames the server tick to client frame mapping moved by around the goal: a frame each time the server
  // repeated or skipped an input, which a stalling software-rendered page makes it do often; not a fixed bound, which
  // failed under load though the mapping wasn't late: RV-379)
  expect(Math.abs((slowed.frame ?? 0) - (slowed.explodedFrame ?? 0)), JSON.stringify(slowed)).toBeLessThanOrEqual(slowed.offsetSpread + 1);
  // (the replay draws every car's plate where the replay has it, this player's own saying YOU: RV-279, RV-288, RV-292)
  const plates = (): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { carballNameplates: () => { name: string }[] }).carballNameplates().map((p) => p.name));
  await expect.poll(plates, { timeout: 5_000 }).toEqual(["YOU"]);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "test-results/replay.png" });

  // Space: the only player is ready, so the replay ends and the next kickoff counts down
  await page.locator("#game").click({ position: { x: 320, y: 180 }, button: "right" });
  await page.keyboard.press("Space");
  await expect.poll(async () => (await stats(page)).replaying, { timeout: 3_000 }).toBe(false);
  await expect.poll(async () => (await stats(page)).phases.at(-1)?.phase).toBe("countdown");
  await expect(page.locator("#replay-banner")).toBeHidden();
  expect(errors).toEqual([]);
});
