// The offline match against bots (src/local/): the server's own match in the page's worker (the WebAssembly host), the
// online client talking to it; a 1v1 against the built-in chaser (no bot package needed), its setup handed over as the
// menu would (sessionStorage), through the match's start into play. The menu's Play vs Bots lists the shipped packages (a
// build has them unless CARBALL_BOTS=0). Nothing of the 3D drawn.
import { expect, test } from "./fixtures";

interface Online {
  readonly phases: readonly { readonly phase: string }[];
  readonly cars: readonly { readonly id: number }[];
  readonly localCar: number;
}

test("a 1v1 against the chaser in the page's own host: welcomed, the warm-up and countdown, then play", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addInitScript(() => {
    sessionStorage.setItem("carball.botMatch", JSON.stringify({ teamSize: 1, seed: 3, bots: [{ team: 1, name: "Chaser", brain: "chaser" }] }));
  });
  await page.goto("/?bots&render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  const online = (): Promise<Online | null> => page.evaluate(() => (window as unknown as { carballOnline?: () => Online }).carballOnline?.() ?? null);
  await expect.poll(async () => (await online())?.cars.length, { timeout: 20_000 }).toBe(2);
  // (the online match's own start: waiting with its warm-up, the countdown, then play)
  await expect.poll(async () => (await online())?.phases.map((p) => p.phase).includes("active"), { timeout: 40_000 }).toBe(true);
  // (the match's scoreboard: its digits and clock; #score itself the board's 0 x 0 anchor)
  await expect(page.locator("#score-blue")).toBeVisible();
  await expect(page.locator("#clock")).toBeVisible();
  await expect(page.locator("#boost")).toBeVisible();
  // (the menu's player list: the bot by name, nothing to mute or block, RV-539)
  await page.keyboard.press("Escape");
  await page.locator(".players-toggle").click();
  await expect(page.locator(".player-row", { hasText: "Chaser" })).toBeVisible();
  await expect(page.locator(".player-row button")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Play vs Bots: the shipped bots by name and credit, Nexto's own easier level offered and Necto's not", async ({ page }) => {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click({ timeout: 30_000 });
  await menu.getByRole("button", { name: "Play vs Bots" }).click({ timeout: 15_000 });
  const slot = menu.locator(".main-menu-bot-slot").first();
  await expect(slot.getByRole("radio")).toHaveText(["Nexto", "Necto"]);
  await expect(menu.locator(".main-menu-bot-credits")).toContainText("CC BY-NC-SA 4.0");
  // (the source's address a link, and the licence's text beside the bot's files: RV-544)
  await expect(menu.locator('.main-menu-bot-credits a[href="https://github.com/Rolv-Arild/Necto"]').first()).toBeVisible();
  await expect(menu.locator(".main-menu-bot-credits a", { hasText: "Licence text" }).first()).toHaveAttribute("href", /\/bots\/(nexto|necto)\/LICENSE\.txt$/);
  // (Nexto: Full and EZ; Necto: full only, no choice)
  await slot.getByRole("radio", { name: "Nexto" }).click();
  await expect(menu.locator(".main-menu-bot-levels").first().getByRole("radio")).toHaveText(["Full", "EZ"]);
  await menu.locator(".main-menu-bot-slot").first().getByRole("radio", { name: "Necto" }).click();
  await expect(menu.locator(".main-menu-bot-levels")).toHaveCount(0);
});

test("a bots' page that fails to start says why, and Back goes to the menu (RV-546)", async ({ page, context }) => {
  // (a package that isn't there: its start fails)
  await context.addInitScript(() => {
    sessionStorage.setItem("carball.botMatch", JSON.stringify({ teamSize: 1, seed: 3, bots: [{ team: 1, name: "Gone", brain: "gone" }] }));
  });
  await page.goto("/?bots&render=off");
  await expect(page.locator("#loading .loading-step")).toContainText("Failed to start", { timeout: 60_000 });
  await page.locator("#loading .loading-back").click();
  await expect(page).toHaveURL(/\/(\?render=off)?$/, { timeout: 30_000 });
});

test("the bots' page without a setup goes back to the menu", async ({ page }) => {
  await page.goto("/?bots&render=off");
  await expect(page).toHaveURL(/\/(\?render=off)?$/, { timeout: 30_000 });
});
