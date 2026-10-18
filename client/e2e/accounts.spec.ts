// The deployment's accounts as the page shows them (notes/accounts.md §5, step 2): the account's entry, Find Match asking
// to sign in first, a provider's sign-in going to the API and back to the sign-up, the account's page, rename and sign
// out, a sign-in's notice; a development page with none of it. The accounts service and config.json are the browser's
// fakes (page.route): no network, and no Turnstile (an empty site key, a development API's). Nothing drawn.
import type { Page, Request, Route } from "@playwright/test";
import { expect, hideGamepads, test } from "./fixtures";

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

/** The fake service's state, and the writes it saw (each with its X-Carball header) */
interface Fake {
  name: string | null;
  banned?: boolean;
  writes: { method: string; path: string; guarded: boolean; body: string | null }[];
}

async function fakeDeployment(page: Page, fake: Fake): Promise<void> {
  const json = (route: Route, status: number, body?: unknown): Promise<void> =>
    route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
  const account = (): object => ({
    id: ID,
    name: fake.name,
    providers: ["steam"],
    createdAt: "2026-01-02T03:04:05Z",
    ratings: [
      { playlist: 1, rating: 1523, deviation: 80, provisional: false, games: 12 },
      { playlist: 2, rating: 1500, deviation: 500, provisional: true, games: 0 },
      { playlist: 3, rating: 1500, deviation: 500, provisional: true, games: 0 },
    ],
    ...(fake.banned ? { queueBanUntil: new Date(Date.now() + 9.5 * 60_000).toISOString() } : {}),
  });
  const wrote = (r: Request): void => {
    fake.writes.push({ method: r.method(), path: new URL(r.url()).pathname, guarded: r.headers()["x-carball"] === "1", body: r.postData() });
  };
  await page.route("**/config.json", (route) => json(route, 200, { gameServer: "https://game.carball.example:4433/play" }));
  await page.route("**/api/**", async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname;
    if (r.method() !== "GET") wrote(r);
    if (path === "/api/auth/steam/start") return route.fulfill({ status: 303, headers: { location: "/?signup=&render=off" } });
    if (path === "/api/me" && r.method() === "GET") return fake.name === null ? json(route, 401, { error: "signed-out" }) : json(route, 200, account());
    if (path === "/api/signup" && r.method() === "GET")
      return json(route, 200, { provider: "steam", suggestion: "Made Up", turnstileSiteKey: "", nameMaxBytes: 32 });
    if (path === "/api/signup") {
      fake.name = (JSON.parse(r.postData() ?? "{}") as { name: string }).name;
      return json(route, 201, account());
    }
    if (path === "/api/me/name") {
      fake.name = (JSON.parse(r.postData() ?? "{}") as { name: string }).name;
      return json(route, 200, account());
    }
    if (path === "/api/signout") {
      fake.name = null;
      return json(route, 204);
    }
    return json(route, 404, { error: "not-found" });
  });
}

test("the deployment's page: Find Match asks to sign in, Steam's sign-in comes back to the sign-up, the account's page", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await hideGamepads(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fake: Fake = { name: null, writes: [] };
  await fakeDeployment(page, fake);
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  const menu = page.locator("#main-menu");
  const entry = menu.locator(".main-menu-account");
  await expect(entry).toHaveText("Sign In");

  // Signed out: Find Match shows the account's page, no search
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^find match$/i }).click();
  const account = menu.locator(".main-menu-account-view");
  await expect(account).toBeVisible();
  await expect(account.locator(".account-note")).toHaveText("Sign in to play online.");
  await expect(account.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(account.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy.html");
  await expect(page.locator("#search-banner")).toBeHidden();

  // Steam's sign-in: the API's start, back at the sign-up (its return out of the address), the suggested name changed
  await account.getByRole("button", { name: "Sign in with Steam" }).click();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await expect(account.locator(".main-menu-heading")).toHaveText("Create Account");
  expect(new URL(page.url()).searchParams.has("signup")).toBe(false);
  await expect(account).toContainText("Signed in with Steam. Choose the name other players see.");
  const name = account.locator(".account-input");
  await expect(name).toHaveValue("Made Up");
  await name.fill("Ziggy");
  await account.getByRole("button", { name: "Create Account" }).click();
  await expect(account.locator(".account-name")).toHaveText("Ziggy");
  await expect(account).toContainText("Signed in with Steam");

  // Renamed; Back: the entry the account's name
  await account.locator(".account-rename .account-input").fill("Stardust");
  await account.getByRole("button", { name: "Save" }).click();
  await expect(account.locator(".account-name")).toHaveText("Stardust");
  await account.getByRole("button", { name: "Back" }).click();
  await expect(entry).toHaveText("Stardust");

  // Sign Out: the sign-in page, the entry Sign In
  await entry.click();
  await account.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(account.getByRole("button", { name: "Sign in with Steam" })).toBeVisible();
  await expect(entry).toHaveText("Sign In");
  // (every write the page's: its header)
  expect(fake.writes.map((w) => `${w.method} ${w.path}`)).toEqual(["POST /api/signup", "PUT /api/me/name", "POST /api/signout"]);
  expect(fake.writes.every((w) => w.guarded)).toBe(true);
  expect(fake.writes[0]?.body).toBe(JSON.stringify({ name: "Ziggy", turnstile: "" }));
  expect(errors).toEqual([]);
  await context.close();
});

test("a sign-in's notice (a ban's end) and a development page with no accounts; the privacy page", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await hideGamepads(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fakeDeployment(page, { name: null, writes: [] });
  await page.goto("/?signin=banned&until=2026-12-01&render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  const modal = page.locator("#modal");
  await expect(modal).toContainText("This account is banned until 2026-12-01.");
  expect(new URL(page.url()).search).toBe("?render=off");
  await modal.getByRole("button", { name: /^ok$/i }).click();
  // (a development page: its queue named, its server's own tickets, no entry)
  await page.goto("/?queue=127.0.0.1:1&render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#main-menu .main-menu-account")).toBeHidden();
  await page.goto("/privacy.html");
  await expect(page.locator("h1")).toHaveText("Privacy");
  await expect(page).toHaveTitle("Carball: privacy");
  expect(errors).toEqual([]);
  await context.close();
});

test("the account's ratings beside the playlists (\"?\" while provisional) and a leaver's queue ban under Find Match (LV1)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await hideGamepads(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fakeDeployment(page, { name: "Ziggy", banned: true, writes: [] });
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  const menu = page.locator("#main-menu");
  await expect(menu.locator(".main-menu-account")).toHaveText("Ziggy");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await expect(menu.locator('.main-menu-playlist[data-playlist="1"] .main-menu-rating')).toHaveText("1523");
  await expect(menu.locator('.main-menu-playlist[data-playlist="2"] .main-menu-rating')).toHaveText("1500?");
  await expect(menu.locator(".main-menu-ban")).toHaveText("you left a ranked match: you can search again in 10 minutes");
  await menu.getByRole("button", { name: /^back$/i }).click();
  await menu.locator(".main-menu-account").click();
  await expect(menu.locator(".account-ratings")).toHaveText(/1v1 1523\s+2v2 1500\?\s+3v3 1500\?/);
  expect(errors).toEqual([]);
  await context.close();
});
