// Carball's training editor (src/ui/trainingEditor.ts): Create Training opens it on a new pack of one default shot; a
// shot added, the pack named and a speed changed; saved, then listed as the player's own with Edit; edited again;
// playtested in training, and back to the editor from the pause menu. Nothing of the 3D drawn (`?render=off`).
import { expect, test } from "./fixtures";

test("the editor: a new pack made, saved and listed as the player's own, edited again, playtested, back to the editor", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-editor")) {
      localStorage.removeItem("carball.training.mine");
      sessionStorage.setItem("e2e-editor", "1");
    }
  });
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^custom training$/i }).click();
  await menu.getByRole("button", { name: /^create training$/i }).click();
  const editor = page.locator("#training-editor");
  await expect(editor).toBeVisible();
  await expect(menu).toBeHidden();
  await expect(editor.locator(".editor-shot")).toHaveCount(1);
  // A second shot, the pack named, the ball's speed a step up
  await editor.getByRole("button", { name: /^add$/i }).click();
  await expect(editor.locator(".editor-shot")).toHaveCount(2);
  await expect(editor.locator(".editor-shot").nth(1)).toHaveAttribute("aria-pressed", "true");
  await editor.locator(".editor-name").fill("E2E Mine");
  await editor.locator(".editor-name").press("Enter");
  await editor.locator(".editor-name").blur();
  const speed = editor.locator('[data-editor="speed"]');
  await speed.focus();
  await page.keyboard.press("ArrowRight");
  await expect(speed).toHaveAttribute("aria-valuenow", "1550");
  await editor.getByRole("button", { name: /^save$/i }).click();
  await expect(editor.locator(".editor-status")).toHaveText(/saved/i);
  // Exit: the packs' page, the pack listed with Edit; edited again
  await editor.getByRole("button", { name: /^exit$/i }).click();
  await expect(editor).toBeHidden();
  await expect(menu.locator(".main-menu-pack-name").first()).toHaveText("E2E Mine");
  await menu.locator(".main-menu-pack-edit").first().click();
  await expect(editor).toBeVisible();
  await expect(editor.locator(".editor-name")).toHaveValue("E2E Mine");
  await expect(editor.locator(".editor-shot")).toHaveCount(2);
  // Playtest: training from the shot, Back to Editor in the pause menu
  await editor.getByRole("button", { name: /^playtest$/i }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator(".training-shot")).toHaveText(/^shot 1 \/ 2$/i);
  await page.keyboard.press("Escape");
  await page.locator("#pause-menu").getByRole("button", { name: /^back to editor$/i }).click();
  await expect(editor).toBeVisible();
  await expect(page.locator("#training")).toBeHidden();
  // Escape leaves the editor for the packs' page
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(menu).toBeVisible();
  expect(errors).toEqual([]);
});

test("the editor's rules as the game's (notes/training-editor.md): 4 tags at most, a name of 3+ characters, unsaved changes asked about on leaving, Delete Sequence confirmed", async ({ page, context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-editor-rules")) {
      localStorage.removeItem("carball.training.mine");
      sessionStorage.setItem("e2e-editor-rules", "1");
    }
  });
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^custom training$/i }).click();
  await menu.getByRole("button", { name: /^create training$/i }).click();
  const editor = page.locator("#training-editor");
  await expect(editor).toBeVisible();
  // (4 tags on: the rest can't be)
  const tags = editor.locator(".editor-tag");
  for (let i = 0; i < 4; i++) await tags.nth(i).click();
  await expect(tags.nth(4)).toBeDisabled();
  await expect(editor.locator(".editor-status")).toHaveText(/unsaved changes/i);
  // (a name under 3 characters: the game's refusal)
  const modal = page.locator("#modal");
  await editor.locator(".editor-name").fill("ab");
  await editor.locator(".editor-name").press("Enter");
  await editor.getByRole("button", { name: /^save$/i }).click();
  await expect(modal).toBeVisible();
  await expect(modal.locator(".modal-title")).toHaveText("INVALID NAME");
  await expect(modal).toContainText("Please enter a valid name.");
  await modal.getByRole("button", { name: /^ok$/i }).click();
  // (leaving unsaved: SAVE AND EXIT, YES / NO / CANCEL; CANCEL stays, YES saves and leaves)
  await editor.locator(".editor-name").fill("Rules Pack");
  await editor.locator(".editor-name").press("Enter");
  await editor.getByRole("button", { name: /^exit$/i }).click();
  await expect(modal.locator(".modal-title")).toHaveText("SAVE AND EXIT");
  await expect(modal).toContainText("Save changes to this sequence before exiting?");
  await expect(modal.locator(".modal-choices button")).toHaveText(["YES", "NO", "CANCEL"]);
  await modal.getByRole("button", { name: /^cancel$/i }).click();
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: /^exit$/i }).click();
  await modal.getByRole("button", { name: /^yes$/i }).click();
  await expect(editor).toBeHidden();
  await expect(menu.locator(".main-menu-pack-name").first()).toHaveText("Rules Pack");
  // (Delete Sequence: the game's confirmation; DELETE removes it from the list)
  await menu.locator(".main-menu-pack-edit").first().click();
  await editor.getByRole("button", { name: /^delete sequence$/i }).click();
  await expect(modal.locator(".modal-title")).toHaveText("DELETE SEQUENCE");
  await expect(modal).toContainText("Are you sure you want to delete this sequence?");
  await modal.getByRole("button", { name: /^delete$/i }).click();
  await expect(editor).toBeHidden();
  await expect(menu.locator(".main-menu-pack-name", { hasText: "Rules Pack" })).toHaveCount(0);
});

test("the free-camera mode (notes/training-editor.md TE1): chosen and kept, a shot placed with the keys, Tab tests it and Tab comes back", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-fly")) {
      localStorage.removeItem("carball.training.mine");
      localStorage.removeItem("carball.training.editorMode");
      sessionStorage.setItem("e2e-fly", "1");
    }
  });
  interface Shot {
    timeLimit: number;
    ball: { location: { x: number; y: number; z: number }; speed: number };
  }
  interface EditorState {
    open: boolean;
    testing: boolean;
    mode: string;
    fly: { view: string; selection: string };
    pack: { name: string; shots: Shot[] };
  }
  const state = async (): Promise<EditorState> =>
    page.evaluate(() => (window as unknown as { carballFreeplay: { editor: () => EditorState } }).carballFreeplay.editor());
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^custom training$/i }).click();
  await menu.getByRole("button", { name: /^create training$/i }).click();
  const panel = page.locator("#training-editor");
  const fly = page.locator("#fly-editor");
  await expect(panel).toBeVisible();
  // The free camera chosen: the shot list (TE1 §4), the game's words
  await panel.getByRole("button", { name: /^free camera$/i }).click();
  await expect(panel).toBeHidden();
  const list = fly.locator(".fly-list");
  await expect(list).toBeVisible();
  await expect(list.locator(".fly-heading")).toHaveText("ROOKIE STRIKER");
  await expect(list.locator(".fly-shot-button")).toHaveCount(1);
  await expect(list.locator(".fly-shot-button").first()).toContainText("SHOT 1");
  await expect(list.locator(".fly-legend-item")).toHaveText([/SEQUENCE SETTINGS$/, /TEST SEQUENCE$/, /OPEN MENU$/]);
  // SEQUENCE SETTINGS: named, Pro
  await list.getByRole("button", { name: /SEQUENCE SETTINGS$/ }).click();
  const settings = fly.locator(".fly-settings");
  await expect(settings.locator(".fly-settings-name")).toBeFocused();
  await settings.locator(".fly-settings-name").fill("Fly Pack");
  await settings.getByRole("combobox", { name: "Difficulty" }).selectOption("medium");
  await settings.getByRole("button", { name: "ACCEPT" }).click();
  await expect(settings).toBeHidden();
  await expect(list.locator(".fly-heading")).toHaveText("PRO STRIKER");
  await expect(list.locator(".fly-pack-name")).toHaveText("Fly Pack");
  // CREATE NEW SHOT: a second shot, selected; edited
  await list.getByRole("button", { name: "CREATE NEW SHOT" }).click();
  await expect(list.locator(".fly-shot-row.selected")).toContainText("SHOT 2");
  await list.locator(".fly-shot-button").nth(1).click();
  const hud = fly.locator(".fly-hud");
  await expect(hud).toBeVisible();
  await expect(list).toBeHidden();
  await expect(hud.locator(".fly-shot-count")).toHaveText("2/2");
  await expect(hud.locator(".fly-time-value")).toHaveText("0:10");
  await expect(hud.locator(".fly-row")).toHaveText([/Test Shot$/, /Edit Ball$/, /Shot List$/, /Increase Timer$/, /Decrease Timer$/]);
  // The ball selected (a click on the field), flown forward with W, its speed 3 notches up, the time a second up
  const before = (await state()).pack.shots[1];
  await page.mouse.click(640, 400);
  await expect(hud.locator(".fly-row")).toHaveText([/Test Shot$/, /Edit Car$/, /Free Cam$/, /Shot List$/, /Increase Timer$/, /Decrease Timer$/]);
  expect((await state()).fly.selection).toBe("ball");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyW");
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(50);
  }
  await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await state()).pack.shots[1]?.timeLimit).toBe(11);
  await expect.poll(async () => (await state()).pack.shots[1]?.ball.speed).toBe(1650);
  const moved = (await state()).pack.shots[1];
  // (forward is the camera's look, behind the ball along its launch: a new striker shot's toward -y)
  expect(moved?.ball.location.y).toBeLessThan((before?.ball.location.y ?? 0) - 150);
  expect(moved?.ball.location.z).toBe(before?.ball.location.z);
  // Tab: the shot tested in training (no variance, nothing kept: TE1 §1.4), its HUD's Edit Shot; Tab again: back
  await page.keyboard.press("Tab");
  await expect(fly).toBeHidden();
  const training = page.locator("#training");
  await expect(training).toBeVisible();
  await expect(training.locator(".training-shot")).toHaveText(/^shot 2 \/ 2$/i);
  await expect(training.locator(".training-type")).toHaveText(/^fly pack$/i);
  await expect(training.locator(".training-controls")).toContainText(/edit shot/i);
  const run = await page.evaluate(() => (window as unknown as { carballFreeplay: { training: () => { test: string; shot: number; timeLeft: number } } }).carballFreeplay.training());
  expect(run).toMatchObject({ test: "shot", shot: 1, timeLeft: 11 });
  // (the pause menu's Restart Training in a test: the game's question first, NO keeps the test: §5.3)
  const modal = page.locator("#modal");
  await page.keyboard.press("Escape");
  await page.locator("#pause-menu").getByRole("button", { name: /^restart training$/i }).click();
  await expect(modal.locator(".modal-title")).toHaveText("RESTART TRAINING");
  await expect(modal).toContainText("Restarting a created sequence will also reset any training progress made.");
  await modal.getByRole("button", { name: /^no$/i }).click();
  await expect(modal).toBeHidden();
  await expect(training).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(training).toBeHidden();
  await expect(hud).toBeVisible();
  expect(await state()).toMatchObject({ open: true, testing: false, mode: "fly", fly: { view: "edit" } });
  // Shot List (Left Shift), OPEN MENU: unsaved, the game's question; YES saves and leaves
  await page.keyboard.press("ShiftLeft");
  await expect(list).toBeVisible();
  await expect(list.locator(".fly-shot-time").nth(1)).toHaveText("0:11");
  await list.getByRole("button", { name: /OPEN MENU$/ }).click();
  await expect(modal.locator(".modal-title")).toHaveText("SAVE AND EXIT");
  await modal.getByRole("button", { name: /^yes$/i }).click();
  await expect(fly).toBeHidden();
  await expect(menu.locator(".main-menu-pack-name").first()).toHaveText("Fly Pack");
  // The mode kept: Edit opens the free camera's shot list, the pack as saved
  await menu.locator(".main-menu-pack-edit").first().click();
  await expect(list).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(list.locator(".fly-shot-button")).toHaveCount(2);
  expect((await state()).pack.shots[1]?.ball.speed).toBe(1650);
  await page.keyboard.press("Escape");
  await expect(fly).toBeHidden();
  expect(errors).toEqual([]);
});

test("unsaved edits: closing or reloading the page asks first (beforeunload: RV-563, Ctrl+W among the free camera's keys)", async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.removeItem("carball.training.mine");
  });
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^custom training$/i }).click();
  await menu.getByRole("button", { name: /^create training$/i }).click();
  const editor = page.locator("#training-editor");
  await editor.getByRole("button", { name: /^add$/i }).click();
  await expect(editor.locator(".editor-status")).toHaveText(/unsaved changes/i);
  const asked = new Promise<string>((resolve) => {
    page.once("dialog", (dialog) => {
      resolve(dialog.type());
      void dialog.dismiss();
    });
  });
  await page.close({ runBeforeUnload: true });
  expect(await asked).toBe("beforeunload");
});
