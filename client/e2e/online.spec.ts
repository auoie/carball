// Online play against a local rl-server (started by playwright.config.ts on ports 14433/14434).
import type { Page } from "@playwright/test";
import { expect, hideGamepads, test } from "./fixtures";

interface Stats {
  ping: number | null;
  ackFrame: number;
  frame: number;
  cars: { id: number; pos: { x: number; y: number; z: number } }[];
  corrections: number;
  localMispredictions: number;
  kickoffCountdown: number;
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

  // Both see both cars; the first player reloaded the world when the second joined
  await expect(page.locator("#net")).toContainText("2 cars", { timeout: 5_000 });
  await expect(other.locator("#net")).toContainText("2 cars");
  await expect(page.locator("#net")).toContainText(/ping \d+ ms/);
  // The match clock, from the server: full until the ball is first hit (or 5 s after go)
  await expect(page.locator("#clock")).toHaveText("5:00");
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
