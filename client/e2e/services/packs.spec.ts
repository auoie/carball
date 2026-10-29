// Shared training packs end to end against the services (stacks.ts' "flows" stack: the accounts service with its
// database, migration 00006 run): a pack shared from the editor (its code shown), found by that code in another browser
// (signed out) and played, then deleted by its owner and gone. Nothing drawn (`?render=off`).
import { randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, hideGamepads } from "../fixtures";
import { STACKS, signIn, test } from "./fixtures";

test.use({ baseURL: STACKS.flows.origin });

const opened: BrowserContext[] = [];
test.afterEach(async () => {
  for (const context of opened.splice(0)) await context.close();
});

async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  opened.push(context);
  await hideGamepads(context);
  return context;
}

/** Custom Training's page, its errors collected */
async function customTraining(context: BrowserContext, errors: string[]): Promise<Page> {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^custom training$/i }).click();
  await expect(menu.locator(".main-menu-training-tabs")).toBeVisible();
  return page;
}

test("a pack shared from the editor: its code found and played in another browser, then deleted by its owner and gone", async ({ browser }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const owner = await newContext(browser);
  await signIn(owner, "Pack Owner");
  const page = await customTraining(owner, errors);
  const menu = page.locator("#main-menu");
  // (a new pack, its own name, shared)
  const name = `Shared ${randomBytes(3).toString("hex")}`;
  await menu.getByRole("button", { name: /^create training$/i }).click();
  const editor = page.locator("#training-editor");
  await expect(editor).toBeVisible();
  await editor.locator(".editor-name").fill(name);
  await editor.locator(".editor-name").press("Enter");
  await editor.locator(".editor-name").blur();
  await editor.getByRole("button", { name: /^share$/i }).click();
  const modal = page.locator("#modal");
  await expect(modal).toContainText("DOWNLOAD CODE", { timeout: 30_000 });
  const code = /[0-9A-F]{4}(?:-[0-9A-F]{4}){3}/.exec((await modal.textContent()) ?? "")?.[0];
  expect(code).toBeDefined();
  await modal.getByRole("button", { name: /^ok$/i }).click();

  // Another browser, signed out: the code found, its pack played
  const other = await newContext(browser);
  const found = await customTraining(other, errors);
  const otherMenu = found.locator("#main-menu");
  await otherMenu.locator(".main-menu-training-tabs").getByRole("tab", { name: "Enter Code" }).click();
  await otherMenu.locator(".main-menu-shared-code-input").fill(code ?? "");
  await otherMenu.locator(".main-menu-shared-code-input").press("Enter");
  const row = otherMenu.locator(".main-menu-shared-code .main-menu-shared-row");
  await expect(row.locator(".main-menu-pack-name")).toHaveText(name, { timeout: 30_000 });
  await expect(row.locator(".main-menu-pack-about")).toContainText("by Pack_Owner_");
  await row.getByRole("button", { name: "Play" }).click();
  await expect(otherMenu).toBeHidden();
  await expect(found.locator(".training-shot")).toHaveText(/^shot 1 \/ 1$/i);

  // The owner deletes it: My Shared Packs lists it, Delete, and its code finds nothing
  await editor.getByRole("button", { name: /^exit$/i }).click();
  const own = menu.locator(".main-menu-shared-mine .main-menu-shared-row", { hasText: name });
  await expect(own).toBeVisible({ timeout: 30_000 });
  await own.getByRole("button", { name: "Delete" }).click();
  await modal.getByRole("button", { name: /^yes$/i }).click();
  await expect(own).toBeHidden();
  const again = await customTraining(other, errors);
  const againMenu = again.locator("#main-menu");
  await againMenu.locator(".main-menu-training-tabs").getByRole("tab", { name: "Enter Code" }).click();
  await againMenu.locator(".main-menu-shared-code-input").fill(code ?? "");
  await againMenu.locator(".main-menu-shared-code-input").press("Enter");
  await expect(againMenu.locator(".main-menu-shared-code .main-menu-shared-state")).toHaveText(
    "The training mode could not be found. Ensure the code is correct and try again.",
    {
      timeout: 30_000,
    },
  );
  expect(errors).toEqual([]);
});
