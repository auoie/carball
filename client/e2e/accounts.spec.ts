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
  /** The ban's length from the page's load (ms; 9.5 minutes when only `banned`) */
  banFor?: number;
  /** A sign-up with Turnstile's check (a made-up site key): its next `refuse` sign-ups answered "turnstile" */
  turnstile?: { refuse: number };
  /** config.json's status (200 when unset); /api/me's status when not 200, and its delay (ms) */
  configStatus?: number;
  meStatus?: number;
  meDelay?: number;
  writes: { method: string; path: string; guarded: boolean; body: string | null }[];
}

async function fakeDeployment(page: Page, fake: Fake): Promise<void> {
  // (the ban's end fixed when the fake starts: the page reads /api/me again later, RX30C)
  const banUntil = fake.banned || fake.banFor ? new Date(Date.now() + (fake.banFor ?? 9.5 * 60_000)).toISOString() : null;
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
    ...(banUntil === null ? {} : { queueBanUntil: banUntil }),
  });
  const wrote = (r: Request): void => {
    fake.writes.push({ method: r.method(), path: new URL(r.url()).pathname, guarded: r.headers()["x-carball"] === "1", body: r.postData() });
  };
  await page.route("**/config.json", (route) => json(route, fake.configStatus ?? 200, { gameServer: "https://game.carball.example:4433/play" }));
  await page.route("**/api/**", async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname;
    if (r.method() !== "GET") wrote(r);
    if (path === "/api/auth/steam/start") return route.fulfill({ status: 303, headers: { location: "/?signup=&render=off" } });
    if (path === "/api/me" && r.method() === "GET") {
      if (fake.meDelay) await new Promise((resolve) => setTimeout(resolve, fake.meDelay));
      if (fake.meStatus) return json(route, fake.meStatus, { error: "unavailable" });
      return fake.name === null ? json(route, 401, { error: "signed-out" }) : json(route, 200, account());
    }
    if (path === "/api/signup" && r.method() === "GET")
      return json(route, 200, { provider: "steam", suggestion: "Made Up", turnstileSiteKey: fake.turnstile ? "0x-made-up" : "", nameMaxBytes: 32 });
    if (path === "/api/signup" && fake.turnstile && fake.turnstile.refuse > 0) {
      fake.turnstile.refuse -= 1;
      return json(route, 400, { error: "turnstile" });
    }
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
  // (each box named by its playlist alone, its rating its description; the group named: RV-709)
  await expect(menu.getByRole("group", { name: "Playlist" }).getByRole("checkbox", { name: "1v1", exact: true })).toHaveAttribute(
    "aria-description",
    "Rating 1523",
  );
  await expect(menu.getByRole("checkbox", { name: "2v2", exact: true })).toHaveAttribute("aria-description", "Rating 1500, provisional");
  await expect(menu.locator(".main-menu-ban")).toHaveText("you left a ranked match: you can search again in 10 minutes");
  await menu.getByRole("button", { name: /^back$/i }).click();
  await menu.locator(".main-menu-account").click();
  await expect(menu.locator(".account-ratings")).toHaveText(/1v1 1523\s+2v2 1500\?\s+3v3 1500\?/);
  await expect(menu.locator(".main-menu-account-view .account-note")).toHaveText("? while provisional: a few more matches settle it");
  expect(errors).toEqual([]);
  await context.close();
});

/** Turnstile's script as a fake: a render, its check passed by the test (window.carballTurnstile.pass), resets counted */
const FAKE_TURNSTILE = `(() => {
  const widgets = new Map();
  const seen = { renders: 0, resets: 0, removes: 0, pass: (token) => { for (const o of widgets.values()) o.callback(token); } };
  window.carballTurnstile = seen;
  window.turnstile = {
    render(container, options) { seen.renders += 1; const id = "w" + String(seen.renders); widgets.set(id, options); return id; },
    reset() { seen.resets += 1; },
    remove(id) { seen.removes += 1; widgets.delete(id); },
  };
})();`;

test("the sign-up's check: its script not loading said so and tried again by Create Account, a refused check reset (RX29C)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await hideGamepads(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fake: Fake = { name: null, turnstile: { refuse: 1 }, writes: [] };
  await fakeDeployment(page, fake);
  let scripts = 0;
  await page.route("https://challenges.cloudflare.com/**", (route) => {
    scripts += 1;
    return scripts === 1 ? route.abort() : route.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_TURNSTILE });
  });
  await page.goto("/?signup=&render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  const account = page.locator("#main-menu .main-menu-account-view");
  await expect(account.locator(".main-menu-heading")).toHaveText("Create Account");
  const status = account.locator(".account-status");
  const create = account.getByRole("button", { name: "Create Account" });
  await expect(status).toHaveText("The check didn't load. Create Account tries again.");

  // Create Account: the script loaded this time, the widget drawn, waiting for its check
  await create.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { carballTurnstile?: { renders: number } }).carballTurnstile?.renders)).toBe(1);
  await expect(status).toHaveText("Waiting for the check…");
  const pass = (token: string): Promise<void> =>
    page.evaluate((t) => {
      (window as unknown as { carballTurnstile: { pass: (t: string) => void } }).carballTurnstile.pass(t);
    }, token);
  await pass("made-up-1");
  await expect(status).toHaveText("");

  // The check refused: its token spent, so the widget reset and Create waits for a new one
  await create.click();
  await expect(status).toHaveText("The check didn't pass. Try again.");
  expect(await page.evaluate(() => (window as unknown as { carballTurnstile: { resets: number } }).carballTurnstile.resets)).toBe(1);
  await create.click();
  await expect(status).toHaveText("Waiting for the check…");
  await pass("made-up-2");
  await create.click();
  await expect(account.locator(".account-name")).toHaveText("Made Up");
  expect(fake.writes.map((w) => w.body)).toEqual([
    JSON.stringify({ name: "Made Up", turnstile: "made-up-1" }),
    JSON.stringify({ name: "Made Up", turnstile: "made-up-2" }),
  ]);
  // (the account's page drawn: the widget removed with the sign-up)
  expect(await page.evaluate(() => (window as unknown as { carballTurnstile: { removes: number } }).carballTurnstile.removes)).toBe(1);
  expect(scripts).toBe(2);
  expect(errors).toEqual([]);
  await context.close();
});

test("Find Match waits for the account; a deployment's config or accounts that can't be read are said so, not taken for signed out (RX29C)", async ({
  browser,
}) => {
  const errors: string[] = [];
  const open = async (fake: Fake): Promise<Page> => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await hideGamepads(context);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await fakeDeployment(page, fake);
    await page.goto("/?render=off");
    await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
    return page;
  };
  const findMatch = async (page: Page): Promise<void> => {
    const menu = page.locator("#main-menu");
    await menu.getByRole("button", { name: /^play$/i }).click();
    await menu.getByRole("button", { name: /^find match$/i }).click();
  };
  // (config.json failing: no search, no development server's in its place, no account entry)
  const down = await open({ name: "Ziggy", configStatus: 503, writes: [] });
  await findMatch(down);
  await expect(down.locator("#modal")).toContainText("The game's servers can't be reached right now. Try again later.");
  await expect(down.locator("#search-banner")).toBeHidden();
  await expect(down.locator("#main-menu .main-menu-account")).toBeHidden();
  await down.context().close();
  // (/api/me failing: the accounts unreachable, not the sign-in page)
  const unknown = await open({ name: "Ziggy", meStatus: 503, writes: [] });
  await findMatch(unknown);
  await expect(unknown.locator("#modal")).toContainText("Accounts aren't reachable right now. Try again later.");
  await expect(unknown.locator(".main-menu-account-view")).toBeHidden();
  await unknown.context().close();
  // (/api/me slow: a signed-in player's Find Match waits for it, then searches; never the sign-in page)
  const slow = await open({ name: "Ziggy", meDelay: 4000, writes: [] });
  await findMatch(slow);
  await expect(slow.locator("#search-banner")).toBeVisible({ timeout: 15_000 });
  await expect(slow.locator(".main-menu-account-view")).toBeHidden();
  await expect(slow.locator("#main-menu .main-menu-account")).toHaveText("Ziggy");
  await slow.context().close();
  expect(errors).toEqual([]);
});

test("the ban line under Find Match counts down, and goes when the ban's over (RX30C)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await hideGamepads(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // (just over a minute: "2 minutes", then "1 minute" a second or two on; /api/me read late as a fresh page's)
  const fake: Fake = { name: "Ziggy", banFor: 61_500, writes: [] };
  await fakeDeployment(page, fake);
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  const line = menu.locator(".main-menu-ban");
  await expect(line).toHaveText(/search again in (2 minutes|1 minute)$/);
  await expect(line).toHaveText(/search again in 1 minute$/, { timeout: 10_000 });
  await context.close();
  // (a ban of a few seconds: shown, then gone at its end)
  const short = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await hideGamepads(short);
  const next = await short.newPage();
  next.on("pageerror", (e) => errors.push(e.message));
  await fakeDeployment(next, { name: "Ziggy", banFor: 8_000, writes: [] });
  await next.goto("/?render=off");
  await expect(next.locator("#loading")).toBeHidden({ timeout: 60_000 });
  await next
    .locator("#main-menu")
    .getByRole("button", { name: /^play$/i })
    .click();
  const shortLine = next.locator("#main-menu .main-menu-ban");
  await expect(shortLine).toBeHidden({ timeout: 15_000 });
  await short.close();
  expect(errors).toEqual([]);
});

test("a deployment's page going while it searches deletes its search, with the write's header and the session's cookie (RV-866, RV-894)", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await hideGamepads(context);
  await context.addCookies([{ name: "cb_made_up", value: "session", url: "http://localhost:4173" }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fakeDeployment(page, { name: "Ziggy", writes: [] });
  // (the search's calls, over the fake's (routes tried newest first): the start answered, its poll held, the delete seen)
  const deletes: { guarded: boolean; cookie: string }[] = [];
  let started = false;
  await page.route("**/api/search**", async (route) => {
    const r = route.request();
    const headers = await r.allHeaders();
    if (r.method() === "POST") {
      started = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ search: "ab".repeat(16), version: 1, state: "searching" }) });
    }
    if (r.method() === "DELETE") {
      deletes.push({ guarded: headers["x-carball"] === "1", cookie: headers.cookie ?? "" });
      return route.fulfill({ status: 204 });
    }
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 1, state: "searching" }) }).catch(() => undefined);
  });
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  const menu = page.locator("#main-menu");
  await expect(menu.locator(".main-menu-account")).toHaveText("Ziggy");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^find match$/i }).click();
  await expect.poll(() => started, { timeout: 15_000 }).toBe(true);
  await expect(page.locator("#search-banner .search-summary")).toHaveText("Searching", { timeout: 15_000 });
  // (the page's pagehide as a reload or a close fires it: a real unload's keepalive delete goes, but Playwright doesn't
  // see a request of a page that's gone; the reload itself is e2e/queueEdges.spec.ts's, at a development matchmaker)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect.poll(() => deletes.length, { timeout: 10_000 }).toBe(1);
  expect(deletes[0]).toEqual({ guarded: true, cookie: "cb_made_up=session" });
  expect(errors).toEqual([]);
  await context.close();
});
