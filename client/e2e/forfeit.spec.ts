// Forfeit votes and leaving (notes/match-rules-audit.md MR-7), against a 2v2 casual rl-server whose votes are allowed
// once the clock runs (started by playwright.config.ts on ports 14437/14438). Players join blue, orange, blue, ...
// (Under the suite's load a third page can take over 10 s to answer: the checks are on the first page, and the match's
// end is read from the phases it recorded, which outlast its 8.3 s podium.)
import type { Browser, Page } from "@playwright/test";
import { expect, hideGamepads, test } from "./fixtures";

const SERVER = "127.0.0.1:14438";

async function join(page: Page, errors: string[]): Promise<void> {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`/?server=${SERVER}`);
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
}

async function newPlayer(browser: Browser, errors: string[]): Promise<Page> {
  const context = await browser.newContext();
  await hideGamepads(context);
  const page = await context.newPage();
  await join(page, errors);
  return page;
}

/** The match ends the page saw: each one's winner and whether by forfeit */
async function ends(page: Page): Promise<{ winner: number | null; forfeit: boolean }[]> {
  return page.evaluate(() =>
    (window as unknown as { rlOnline: () => { phases: { phase: string; winner: number | null; forfeit: boolean }[] } })
      .rlOnline()
      .phases.filter((p) => p.phase === "ended")
      .map(({ winner, forfeit }) => ({ winner, forfeit })),
  );
}

/** Leaves the server at once (the page's pagehide closes its session; a closed context's lingers until it times out,
 *  into the next test) */
async function leave(page: Page): Promise<void> {
  await page.goto("about:blank");
}

const others: Page[] = [];

test.afterEach(async ({ page }) => {
  for (const p of [page, ...others.splice(0)]) {
    await leave(p);
    if (p !== page) await p.context().close();
  }
});

test("a team votes to concede: the tally, a failed vote's lockout, a teammate's vote joined, then the forfeit", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  await join(page, errors);
  await expect(page.locator("#net")).toContainText("1 cars", { timeout: 30_000 }); // (alone: blue)
  const orange = await newPlayer(browser, errors);
  const mate = await newPlayer(browser, errors); // (blue)
  others.push(orange, mate);
  await expect(page.locator("#net")).toContainText("3 cars", { timeout: 30_000 });

  // The menu: the vote once the clock runs (5 s after go: the 3 s warm-up and 4 s countdown first), and leaving
  await page.keyboard.press("Escape");
  const vote = page.getByRole("button", { name: "Vote to Concede" });
  await expect(vote).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole("button", { name: "Leave Match" })).toBeVisible();
  await vote.click();
  await expect(page.locator("#settings")).toBeHidden();

  // The team's widget: the tally and the time; no hint for the voter
  await expect(page.locator("#vote")).toHaveClass(/shown/, { timeout: 15_000 });
  await expect(page.locator("#vote-tally")).toHaveText("Vote to Concede 1/2");
  await expect(page.locator("#vote-time")).toHaveText(/^0:(20|1\d|0\d)$/);
  await expect(page.locator("#vote-hint")).toBeHidden();

  // Nobody else votes: it fails at its 20 s and fades; its starter can't start another (the menu has no vote button)
  await expect(page.locator("#vote")).not.toHaveClass(/shown/, { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Leave Match" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vote to Concede" })).toBeHidden();
  await page.keyboard.press("Escape");

  // The teammate starts one: the page sees it, with how to vote, and joins it from its menu; blue concedes
  await mate.keyboard.press("Escape");
  await mate.getByRole("button", { name: "Vote to Concede" }).click({ timeout: 30_000 });
  await expect(page.locator("#vote")).toHaveClass(/shown/, { timeout: 15_000 });
  await expect(page.locator("#vote-tally")).toHaveText("Vote to Concede 1/2");
  await expect(page.locator("#vote-hint")).toHaveText("Press Esc to Vote");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Vote to Concede" }).click();
  await expect.poll(() => ends(page), { timeout: 15_000 }).toContainEqual({ winner: 1, forfeit: true });
  await expect.poll(() => ends(orange), { timeout: 30_000 }).toContainEqual({ winner: 1, forfeit: true });
  expect(errors).toEqual([]);
});

test("leaving: the question, back to freeplay; the car explodes for the others and the emptied team forfeits", async ({ page, browser }) => {
  const errors: string[] = [];
  await join(page, errors);
  // (alone first: the last test's players gone, so the two are on opposite teams)
  await expect(page.locator("#net")).toContainText("1 cars", { timeout: 30_000 });
  const leaving: string[] = [];
  const other = await newPlayer(browser, leaving);
  others.push(other);
  await expect(page.locator("#net")).toContainText("2 cars", { timeout: 30_000 });
  const demolitions = (): Promise<number> =>
    page.evaluate(() => (window as unknown as { rlAudio: () => { played: Record<string, number> } }).rlAudio().played.demo ?? 0);
  const before = await demolitions();

  await other.keyboard.press("Escape");
  await other.getByRole("button", { name: "Leave Match" }).click({ timeout: 30_000 });
  await expect(other.getByText("Are you sure you want to quit the match?")).toBeVisible({ timeout: 30_000 });
  await other.getByRole("button", { name: "No" }).click();
  await expect(other.getByRole("button", { name: "Leave Match" })).toBeVisible({ timeout: 30_000 });
  await other.getByRole("button", { name: "Leave Match" }).click();
  await other.getByRole("button", { name: "Yes" }).click({ timeout: 30_000 });

  // The others: its car explodes and goes; its team, emptied, forfeits (whichever the page's isn't)
  await expect(page.locator("#net")).toContainText("1 cars", { timeout: 15_000 });
  await expect.poll(demolitions, { timeout: 15_000 }).toBeGreaterThan(before);
  await expect.poll(async () => (await ends(page)).filter((e) => e.forfeit).length, { timeout: 15_000 }).toBe(1);
  // The leaver: back to freeplay
  await expect(other).toHaveURL(/:4173\/$/, { timeout: 30_000 });
  await other.waitForFunction(() => "rlFreeplay" in window, null, { timeout: 60_000 });

  expect(errors).toEqual([]);
  expect(leaving).toEqual([]);
});
