// Custom Training's shared packs (src/ui/sharedPacks.ts; notes/custom-training.md §9) on the deployment's page: its tabs;
// Browse's list, search, order and next page, a pack played and saved; Enter Code's checks and its find; signed in, the
// player's own shared packs (a hidden one says why) and Delete, a report, the editor's Share (its code shown, a refusal in
// words); a development page has no tabs. The accounts service and config.json are the browser's fakes (page.route):
// made-up packs and codes, no network. Nothing drawn.
import type { Page, Route } from "@playwright/test";
import { expect, fakeGamepad, padTap, test } from "./fixtures";

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

/** A made-up shared pack's listing: its code from `n` */
const listed = (n: number, name = `Drill ${String(n).padStart(2, "0")}`) => ({
  code: `0A1B-2C3D-4E5F-${String(6000 + n)}`,
  name,
  description: "",
  creator: "Some_Creator",
  type: "striker",
  difficulty: "easy",
  shots: 2,
  downloads: Math.max(0, 40 - n),
  createdAt: "2026-10-29T12:00:00Z",
});

/** A made-up pack's file (format 1: as the page writes one) */
const file = (name: string) => ({
  format: 1,
  id: "shared-0a1b-2c3d-4e5f-6001",
  name,
  type: "striker",
  difficulty: "easy",
  tags: [],
  description: "",
  creator: "",
  shots: [
    {
      timeLimit: 10,
      ball: { location: [120.5, 3010.25, 140.75], launch: { pitch: 4100, yaw: 50123 }, speed: 1450 },
      car: { location: [-210.5, -300.25, 17.25], rotation: { pitch: 10, yaw: 15000, roll: 20 }, startSpeed: 0 },
    },
  ],
});

interface Fake {
  signedIn: boolean;
  /** The next shares' answers (a refusal's status and body), else 201 with a code */
  shareRefusals: { status: number; body: object }[];
  calls: { method: string; path: string; query: string; body: string | null }[];
}

async function fakeDeployment(page: Page, fake: Fake): Promise<void> {
  const packs = Array.from({ length: 35 }, (_, i) => listed(i + 1));
  const mine = [
    { ...listed(90, "My Shared One"), creator: "Pack_Maker" },
    { ...listed(91, "Hidden Mine"), creator: "Pack_Maker", hidden: true, hiddenReason: "made-up reason" },
  ];
  const json = (route: Route, status: number, body?: unknown): Promise<void> =>
    route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
  await page.route("**/config.json", (route) => json(route, 200, { gameServer: "https://game.carball.example:4433/play" }));
  await page.route("**/api/**", (route) => {
    const r = route.request();
    const url = new URL(r.url());
    fake.calls.push({ method: r.method(), path: url.pathname, query: url.search, body: r.postData() });
    if (url.pathname === "/api/me") {
      return fake.signedIn
        ? json(route, 200, { id: ID, name: "Pack_Maker", providers: ["steam"], createdAt: "2026-01-02T03:04:05Z", ratings: [] })
        : json(route, 401, { error: "signed-out" });
    }
    if (url.pathname === "/api/me/packs") return fake.signedIn ? json(route, 200, { packs: mine, most: 100 }) : json(route, 401, { error: "signed-out" });
    if (url.pathname === "/api/packs" && r.method() === "GET") {
      const search = (url.searchParams.get("search") ?? "").toLowerCase();
      const found = packs.filter((p) => p.name.toLowerCase().includes(search));
      const from = url.searchParams.get("cursor") === "page-2" ? 30 : 0;
      return json(route, 200, { packs: found.slice(from, from + 30), next: from === 0 && found.length > 30 ? "page-2" : null });
    }
    if (url.pathname === "/api/packs" && r.method() === "POST") {
      const refusal = fake.shareRefusals.shift();
      return refusal ? json(route, refusal.status, refusal.body) : json(route, 201, { code: "9F8E-7D6C-5B4A-3928" });
    }
    const one = /^\/api\/packs\/([0-9A-F-]{19})(\/report)?$/.exec(url.pathname);
    const pack = one ? [...packs, ...mine].find((p) => p.code === one[1]) : undefined;
    if (one && pack && one[2]) return json(route, 204);
    if (one && pack && r.method() === "DELETE") return json(route, 204);
    if (one && pack) return json(route, 200, { ...pack, pack: file(pack.name) });
    return json(route, 404, { error: "not-found" });
  });
}

async function customTraining(page: Page): Promise<void> {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^custom training$/i }).click();
}

test("Browse lists, searches, orders and pages the shared packs; one played and one saved; Enter Code checks and finds a code", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fake: Fake = { signedIn: false, shareRefusals: [], calls: [] };
  await fakeDeployment(page, fake);
  await customTraining(page);
  const menu = page.locator("#main-menu");
  const tabs = menu.locator(".main-menu-training-tabs");
  await expect(tabs.getByRole("tab")).toHaveText(["My Packs", "Browse", "Enter Code"]);
  // (My Packs signed out: the line to sign in for the shared ones)
  await expect(menu.locator(".main-menu-shared-mine .main-menu-shared-state")).toHaveText(/sign in to share packs/i);
  await tabs.getByRole("tab", { name: "Browse" }).click();
  const rows = menu.locator(".main-menu-shared-browse .main-menu-shared-row");
  await expect(rows).toHaveCount(30);
  await expect(rows.first().locator(".main-menu-pack-about")).toHaveText("by Some_Creator · 2 shots · 39 downloads");
  await menu.getByRole("button", { name: "More" }).click();
  await expect(rows).toHaveCount(35);
  await expect(menu.getByRole("button", { name: "More" })).toBeHidden();
  await menu.locator(".main-menu-shared-search").fill("drill 1");
  await menu.locator(".main-menu-shared-browse").getByRole("button", { name: "Search" }).click();
  await expect(rows).toHaveCount(10);
  await menu.getByRole("radio", { name: "Most Downloaded" }).click();
  await expect.poll(() => fake.calls.filter((c) => c.path === "/api/packs").at(-1)?.query).toBe("?sort=downloads&search=drill+1");
  // (Report signed out: says to sign in, nothing sent)
  await rows.first().getByRole("button", { name: "Report" }).click();
  const modal = page.locator("#modal");
  await expect(modal).toContainText("Sign in to report packs.");
  await modal.getByRole("button", { name: /^ok$/i }).click();
  // (Save: a copy among My Packs, editable)
  await rows.nth(1).getByRole("button", { name: "Save" }).click();
  await expect(rows.nth(1).getByRole("button", { name: "Saved" })).toBeVisible();
  // Enter Code: a bad one, an unknown one, one found (typed in lower case without its dashes)
  await tabs.getByRole("tab", { name: "Enter Code" }).click();
  const code = menu.locator(".main-menu-shared-code-input");
  const state = menu.locator(".main-menu-shared-code .main-menu-shared-state");
  await code.fill("not a code");
  await code.press("Enter");
  await expect(state).toHaveText(/16 letters and digits/);
  await code.fill("0000-0000-0000-0000");
  await code.press("Enter");
  await expect(state).toHaveText("No shared pack has that code.");
  await code.fill("0a1b2c3d4e5f6003");
  await code.press("Enter");
  await expect(menu.locator(".main-menu-shared-code .main-menu-pack-name")).toHaveText("Drill 03");
  await expect(code).toHaveValue("0A1B-2C3D-4E5F-6003");
  await tabs.getByRole("tab", { name: "My Packs" }).click();
  await expect(menu.locator('[data-training-panel="mine"] .main-menu-pack-name', { hasText: "Drill 11" })).toBeVisible();
  // Play: read through the API, the training started
  await tabs.getByRole("tab", { name: "Enter Code" }).click();
  await menu.locator(".main-menu-shared-code").getByRole("button", { name: "Play" }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".training-shot")).toHaveText(/^shot 1 \/ 1$/i);
  expect(fake.calls.some((c) => c.method === "GET" && c.path === "/api/packs/0A1B-2C3D-4E5F-6003")).toBe(true);
  expect(fake.calls.filter((c) => c.method !== "GET")).toEqual([]);
  expect(errors).toEqual([]);
});

test("signed in: My Shared Packs (a hidden one says why) and Delete; a report sent; the editor's Share shows its code, a refusal in words", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fake: Fake = {
    signedIn: true,
    shareRefusals: [{ status: 400, body: { error: "pack-name-not-allowed", detail: "the word filter" } }],
    calls: [],
  };
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-share")) {
      localStorage.removeItem("carball.training.mine");
      sessionStorage.setItem("e2e-share", "1");
    }
  });
  await fakeDeployment(page, fake);
  await customTraining(page);
  const menu = page.locator("#main-menu");
  const own = menu.locator(".main-menu-shared-mine .main-menu-shared-row");
  await expect(own).toHaveCount(2);
  await expect(own.nth(1).locator(".main-menu-shared-hidden")).toHaveText("Hidden by a moderator: made-up reason");
  await own.first().getByRole("button", { name: "Delete" }).click();
  const modal = page.locator("#modal");
  await expect(modal).toContainText("My Shared One");
  await modal.getByRole("button", { name: /^yes$/i }).click();
  await expect(own).toHaveCount(1);
  expect(fake.calls.some((c) => c.method === "DELETE" && c.path === "/api/packs/0A1B-2C3D-4E5F-6090")).toBe(true);
  // (a report: asked first, then sent)
  await menu.locator(".main-menu-training-tabs").getByRole("tab", { name: "Browse" }).click();
  await menu.locator(".main-menu-shared-browse .main-menu-shared-row").first().getByRole("button", { name: "Report" }).click();
  await modal.getByRole("button", { name: /^yes$/i }).click();
  await expect(modal).toContainText("the moderators will look at it");
  await modal.getByRole("button", { name: /^ok$/i }).click();
  expect(fake.calls.some((c) => c.method === "POST" && c.path === "/api/packs/0A1B-2C3D-4E5F-6001/report")).toBe(true);
  // The editor's Share: a refusal in words, then its code
  await menu.locator(".main-menu-training-tabs").getByRole("tab", { name: "My Packs" }).click();
  await menu.getByRole("button", { name: /^create training$/i }).click();
  const editor = page.locator("#training-editor");
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: /^share$/i }).click();
  await expect(modal).toContainText("NOT SHARED");
  await expect(modal).toContainText("That pack name isn't allowed. Rename the pack to share it.");
  await modal.getByRole("button", { name: /^ok$/i }).click();
  await editor.getByRole("button", { name: /^share$/i }).click();
  await expect(modal).toContainText("PACK SHARED");
  await expect(modal).toContainText("9F8E-7D6C-5B4A-3928");
  const shared = fake.calls.filter((c) => c.method === "POST" && c.path === "/api/packs");
  expect(shared).toHaveLength(2);
  expect(JSON.parse(shared[1]?.body ?? "{}")).toMatchObject({ format: 1, name: "My Training", type: "striker" });
  expect(errors).toEqual([]);
});

test("a development page has no shared packs: My Packs alone, no tabs", async ({ page }) => {
  await customTraining(page);
  const menu = page.locator("#main-menu");
  await expect(menu.locator(".main-menu-pack-name").first()).toBeVisible();
  await expect(menu.locator(".main-menu-training-tabs")).toBeHidden();
});

test("with a pad: the bumpers step Custom Training's tabs, stopping at the ends (the leaderboard's beside it, hidden, never taken)", async ({
  page,
  context,
}) => {
  const [LB, RB] = [4, 5];
  await fakeGamepad(context);
  const fake: Fake = { signedIn: false, shareRefusals: [], calls: [] };
  await fakeDeployment(page, fake);
  await customTraining(page);
  const tabs = page.locator("#main-menu .main-menu-training-tabs");
  const selected = tabs.locator('[aria-selected="true"]');
  await expect(selected).toHaveText("My Packs");
  await padTap(page, [RB]);
  await expect(selected).toHaveText("Browse");
  await expect(page.locator("#main-menu .main-menu-shared-browse .main-menu-shared-row")).toHaveCount(30);
  await padTap(page, [RB]);
  await padTap(page, [RB]);
  await expect(selected).toHaveText("Enter Code");
  await padTap(page, [LB]);
  await expect(selected).toHaveText("Browse");
});
