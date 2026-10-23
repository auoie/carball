// The Stat Graphs (notes/hud-menus.md HUD-21): None by default (a clean screen, the old readouts gone), F10 cycling the
// levels unsaved, a level's rows sampled every frame and drawn over everything, offline the network rows 0. Nothing of
// the 3D drawn (`?render=off`).
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

interface StatView {
  readonly level: string;
  readonly rows: readonly { readonly title: string; readonly summaries: readonly { readonly value: number | null }[] }[];
}
const stats = async (page: Page): Promise<StatView> => page.evaluate(() => (window as unknown as { carballStatGraphs: () => StatView }).carballStatGraphs());

test("Stat Graphs: None by default and no strip; F10 cycles the levels unsaved; the rows sampled and drawn; offline the network's 0", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect((await stats(page)).level).toBe("none");
  await expect(page.locator("canvas.stat-graphs")).toBeHidden();
  await expect(page.locator("#info")).toBeHidden();
  await expect(page.locator("#hint")).toBeHidden();
  // F10: Performance Summary, its rows the game's, the frame rate sampled
  await page.keyboard.press("F10");
  await expect.poll(async () => (await stats(page)).level).toBe("performanceSummary");
  await expect(page.locator("canvas.stat-graphs")).toBeVisible();
  expect((await stats(page)).rows.map((r) => r.title)).toEqual(["FPS", "Frame", "Game", "Render", "GPU", "Audio Base", "Audio Out"]);
  await expect.poll(async () => (await stats(page)).rows[0]?.summaries[0]?.value ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
  // (the browser's audio base latency read: a few ms, never 0 or nonsense)
  const base = (await stats(page)).rows.find((r) => r.title === "Audio Base")?.summaries[0]?.value ?? 0;
  expect(base).toBeGreaterThan(0);
  expect(base).toBeLessThan(100);
  // (three more: Network Summary, offline its rows 0, the input buffer's after them)
  for (let i = 0; i < 3; i++) await page.keyboard.press("F10");
  await expect.poll(async () => (await stats(page)).level).toBe("networkSummary");
  const net = await stats(page);
  expect(net.rows.map((r) => r.title)).toEqual([
    "Out Pkt",
    "In Pkt",
    "Out Loss",
    "In Loss",
    "Out Bytes",
    "In Bytes",
    "Latency",
    "IBuf",
    "IBuf Target",
    "IBuf Miss",
    "Phys Rate",
  ]);
  expect(net.rows.find((r) => r.title === "Out Pkt")?.summaries[0]?.value).toBe(0);
  // Not saved: the page loaded again, None
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  expect((await stats(page)).level).toBe("none");
  await expect(page.locator("canvas.stat-graphs")).toBeHidden();
  expect(errors).toEqual([]);
});
