// The deployment's live counts and leaderboard as the menu shows them (GET /api/stats, GET /api/leaderboard; api/
// internal/server/public.go): the top page's line, a playlist's counts on its box, the Leaderboard page's tabs (the
// bumpers through them), rows, empty and failed states, and Back. The service and config.json are the browser's fakes
// (page.route, as e2e/accounts.spec.ts's), the numbers made up. Nothing drawn.
import type { Page, Route } from "@playwright/test";
import { expect, fakeGamepad, padTap, test } from "./fixtures";

const json = (route: Route, status: number, body: unknown): Promise<void> =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const STATS = {
  playlists: [
    { playlist: 1, matches: 1, players: 2, searching: 1 },
    { playlist: 2, matches: 1, players: 4, searching: 0 },
    { playlist: 3, matches: 0, players: 0, searching: 2 },
  ],
  servers: { "game.carball.example:4433": { matches: 2, players: 6 } },
  playing: 9,
  matches: 2,
};

const BOARDS: Record<string, unknown> = {
  "1v1": {
    playlist: "1v1",
    players: [
      { rank: 1, name: "Made Up One", rating: 1840, games: 51 },
      { rank: 2, name: "Made Up Two", rating: 1712, games: 23 },
    ],
  },
  "2v2": { playlist: "2v2", players: [{ rank: 1, name: "Made Up Three", rating: 1603, games: 12 }] },
  "3v3": { playlist: "3v3", players: [] },
};

/** A signed-out deployment: its config, /api/me signed out, the counts and the boards (`failBoards`: each a 503) */
async function fakeDeployment(page: Page, failBoards = false): Promise<void> {
  await page.route("**/config.json", (route) => json(route, 200, { gameServer: "https://game.carball.example:4433/play" }));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me") return json(route, 401, { error: "signed-out" });
    if (url.pathname === "/api/stats") return json(route, 200, STATS);
    if (url.pathname === "/api/leaderboard") {
      if (failBoards) return json(route, 503, { error: "unavailable" });
      return json(route, 200, BOARDS[url.searchParams.get("playlist") ?? ""] ?? { error: "bad-request" });
    }
    return json(route, 404, { error: "not-found" });
  });
}

test("the menu's live counts: the top page's line, each playlist's on its box", async ({ page }) => {
  await fakeDeployment(page);
  await page.goto("/?render=off");
  const menu = page.locator("#main-menu");
  await expect(menu.locator(".main-menu-live")).toHaveText("9 playing · 2 matches", { timeout: 30_000 });
  await menu.getByRole("button", { name: /^play$/i }).click();
  const count = (name: string) => menu.getByRole("checkbox", { name, exact: true }).locator(".main-menu-live-count");
  await expect(count("1v1")).toHaveText("2 in matches 1 searching");
  await expect(count("2v2")).toHaveText("4 in matches 0 searching");
  await expect(count("3v3")).toHaveText("0 in matches 2 searching");
});

test("the leaderboard: a tab a playlist (the pad's bumpers through them), its rows, an empty one, Back to the top", async ({ page, context }) => {
  await fakeGamepad(context);
  await fakeDeployment(page);
  await page.goto("/?render=off");
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^leaderboard$/i }).click({ timeout: 30_000 });
  const rows = menu.locator(".main-menu-board tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator("td")).toHaveText(["1", "Made Up One", "1840", "51"]);
  await expect(menu.getByRole("tab", { name: "1v1" })).toHaveAttribute("aria-selected", "true");
  // (the pad's right bumper: the next tab, its own rows)
  await padTap(page, [5]);
  await expect(menu.getByRole("tab", { name: "2v2" })).toHaveAttribute("aria-selected", "true");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator("td")).toHaveText(["1", "Made Up Three", "1603", "12"]);
  await padTap(page, [5]);
  await expect(menu.getByRole("tab", { name: "3v3" })).toHaveAttribute("aria-selected", "true");
  await expect(rows).toHaveCount(0);
  await expect(menu.locator(".main-menu-board-state")).toHaveText("No ranked players yet.");
  // (B back to the top, its entry there)
  await padTap(page, [1]);
  await expect(menu.getByRole("button", { name: /^leaderboard$/i })).toBeVisible();
  await expect(menu.locator(".main-menu-board-view")).toBeHidden();
});

test("the leaderboard that can't be reached says so", async ({ page }) => {
  await fakeDeployment(page, true);
  await page.goto("/?render=off");
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^leaderboard$/i }).click({ timeout: 30_000 });
  await expect(menu.locator(".main-menu-board-state")).toHaveText("The leaderboard can't be reached right now. Try again later.");
  await expect(menu.locator(".main-menu-board tbody tr")).toHaveCount(0);
});

test("a development page (no deployment) has neither the counts nor the leaderboard", async ({ page }) => {
  await page.goto("/?render=off");
  const menu = page.locator("#main-menu");
  await expect(menu.getByRole("button", { name: /^play$/i })).toBeVisible({ timeout: 30_000 });
  await expect(menu.getByRole("button", { name: /^leaderboard$/i })).toBeHidden();
  await expect(menu.locator(".main-menu-live")).toBeHidden();
});
