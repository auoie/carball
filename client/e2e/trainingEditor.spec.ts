// Carball's training editor (src/ui/trainingEditor.ts): Create Training opens it on a new pack of one default shot; a
// shot added, the pack named and a speed changed; saved, then listed as the player's own with Edit; edited again;
// playtested in training, and back to the editor from the pause menu. Nothing of the 3D drawn (`?render=off`).
import { expect, fakeGamepad, padTap, test } from "./fixtures";

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
  // (the ball's x spans its clamps, its steps from 0: at 0 it reads 0, a step right 10: RV-594, RV-601)
  const ballX = editor.locator('[data-editor="ballX"]');
  await expect(ballX).toHaveAttribute("aria-valuemin", "-4003.25");
  await expect(ballX).toHaveAttribute("aria-valuemax", "4003.25");
  await expect(ballX).toHaveAttribute("aria-valuenow", "0");
  await ballX.focus();
  await page.keyboard.press("ArrowRight");
  await expect(ballX).toHaveAttribute("aria-valuenow", "10");
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
  await page
    .locator("#pause-menu")
    .getByRole("button", { name: /^back to editor$/i })
    .click();
  await expect(editor).toBeVisible();
  await expect(page.locator("#training")).toBeHidden();
  // Escape leaves the editor for the packs' page
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(menu).toBeVisible();
  expect(errors).toEqual([]);
});

test("the editor's rules as the game's (notes/training-editor.md): 4 tags at most, a name of 3+ characters, unsaved changes asked about on leaving, Delete Sequence confirmed", async ({
  page,
  context,
}) => {
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

test("the free-camera mode (notes/training-editor.md TE1): chosen and kept, a shot placed with the keys, Tab tests it and Tab comes back", async ({
  page,
  context,
}) => {
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
  // (the difficulty a cycler: Right from Rookie, Pro)
  const difficulty = settings.getByRole("spinbutton", { name: "Difficulty" });
  await difficulty.focus();
  await page.keyboard.press("ArrowRight");
  await expect(difficulty).toHaveAttribute("data-value", "medium");
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
  const run = await page.evaluate(() =>
    (window as unknown as { carballFreeplay: { training: () => { test: string; shot: number; timeLeft: number } } }).carballFreeplay.training(),
  );
  expect(run).toMatchObject({ test: "shot", shot: 1, timeLeft: 11 });
  // (the pause menu's Restart Training in a test: the game's question first, NO keeps the test: §5.3)
  const modal = page.locator("#modal");
  await page.keyboard.press("Escape");
  await page
    .locator("#pause-menu")
    .getByRole("button", { name: /^restart training$/i })
    .click();
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

test("the free-camera editor with a pad (the user's report): the shot list's buttons in reach, SEQUENCE SETTINGS, the shot editor's own controls", async ({
  page,
  context,
}) => {
  const [A, B, X, UP, DOWN, RIGHT] = [0, 1, 2, 12, 13, 15];
  await fakeGamepad(context);
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-fly-pad")) {
      localStorage.removeItem("carball.training.mine");
      localStorage.setItem("carball.training.editorMode", "fly");
      sessionStorage.setItem("e2e-fly-pad", "1");
    }
  });
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const menu = page.locator("#main-menu");
  await menu.getByRole("button", { name: /^play$/i }).click();
  await menu.getByRole("button", { name: /^custom training$/i }).click();
  await menu.getByRole("button", { name: /^create training$/i }).click();
  const list = page.locator("#fly-editor .fly-list");
  await expect(list).toBeVisible();
  const focused = list.locator(":focus");
  // (opened afresh: the selected shot focused; down, CREATE NEW SHOT; A presses it)
  await padTap(page, [DOWN]);
  await padTap(page, [UP]);
  await expect(focused).toContainText("SHOT 1");
  await padTap(page, [DOWN]);
  await expect(focused).toHaveText("CREATE NEW SHOT");
  await padTap(page, [A]);
  await expect(list.locator(".fly-shot-button")).toHaveCount(2);
  // (down again: the legend's buttons, SEQUENCE SETTINGS first)
  await padTap(page, [DOWN]);
  await expect(focused).toContainText("SEQUENCE SETTINGS");
  // (X: SEQUENCE SETTINGS, the pad's menu, opened on its name whatever row the list had (RV-600); down to Type, right:
  // Goalie (a cycler: RV-599); B closes it)
  await padTap(page, [X]);
  const settings = page.locator("#fly-editor .fly-settings");
  await expect(settings).toBeVisible();
  await expect(settings.locator(".fly-settings-name")).toHaveClass(/pad-focus/);
  await padTap(page, [DOWN]);
  const type = settings.getByRole("spinbutton", { name: "Type" });
  await expect(type).toHaveClass(/pad-focus/);
  await padTap(page, [RIGHT]);
  await expect(type).toHaveAttribute("data-value", "goalie");
  await padTap(page, [B]);
  await expect(settings).toBeHidden();
  // (the list's focus back on the selected shot, the second; A edits it: the shot editor, its own controls: A the ball,
  // B the list again)
  await expect(focused).toContainText("SHOT 2");
  await padTap(page, [A]);
  const hud = page.locator("#fly-editor .fly-hud");
  await expect(hud).toBeVisible();
  await expect(hud.locator(".fly-shot-count")).toHaveText("2/2");
  await padTap(page, [A]);
  await expect(hud.locator(".fly-row").nth(1)).toHaveText(/Edit Car$/);
  await padTap(page, [B]);
  await expect(list).toBeVisible();
  // (B on the list: the editor left, its unsaved question first; B answers it for staying)
  await padTap(page, [B]);
  const modal = page.locator("#modal");
  await expect(modal.locator(".modal-title")).toHaveText("SAVE AND EXIT");
  await padTap(page, [B]);
  await expect(modal).toBeHidden();
  await expect(list).toBeVisible();
});

test("Exit to Main Menu over the editor with a pad (the user's report): the editor left as B leaves it, its unsaved question first; Free Play then free play, not the editor", async ({
  page,
  context,
}) => {
  test.setTimeout(480_000); // (eight editors left, each to free play and back, and a reload)
  const [A, B, START, VIEW, DOWN, LEFT] = [0, 1, 9, 8, 13, 14];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fakeGamepad(context);
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-editor-exit")) {
      localStorage.removeItem("carball.training.mine");
      localStorage.setItem("carball.training.editorMode", "fly");
      sessionStorage.setItem("e2e-editor-exit", "1");
    }
  });
  interface EditorState {
    open: boolean;
    testing: boolean;
  }
  const editorState = async (): Promise<EditorState | null> =>
    page.evaluate(() => (window as unknown as { carballFreeplay: { editor: () => EditorState | null } }).carballFreeplay.editor());
  const speed = async (): Promise<number> =>
    page.evaluate(() => (window as unknown as { carballFreeplay: { car: () => { speed: number } } }).carballFreeplay.car().speed);
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  const menu = page.locator("#main-menu");
  const pause = page.locator("#pause-menu");
  const modal = page.locator("#modal");
  const list = page.locator("#fly-editor .fly-list");
  const padFocused = async (button: ReturnType<typeof page.locator>): Promise<boolean> => button.evaluate((b) => b.classList.contains("pad-focus"));
  const createTraining = async (): Promise<void> => {
    await menu.getByRole("button", { name: /^play$/i }).click();
    await menu.getByRole("button", { name: /^custom training$/i }).click();
    await menu.getByRole("button", { name: /^create training$/i }).click();
    await expect(menu).toBeHidden();
  };
  // (Start, the focus down to Exit to Main Menu, A. Unsaved changes: the entry reads Save and Exit, the editor's SAVE AND
  // EXIT the one question (TE1 §6.3, RX28C); none: the pause's own EXIT TO MAIN MENU YES/NO, YES taken (TE1 §5.3, RX29C))
  const exitToMainMenu = async (saves = false): Promise<void> => {
    await padTap(page, [START]);
    await expect(pause).toBeVisible();
    const exit = pause.getByRole("button", { name: saves ? /^save and exit$/i : /^exit to main menu$/i });
    for (let i = 0; i < 8 && !(await padFocused(exit)); i++) await padTap(page, [DOWN]);
    await expect(exit).toHaveClass(/pad-focus/);
    await padTap(page, [A]);
    if (!saves) {
      const question = pause.locator(".pause-question");
      await expect(question).toBeVisible();
      await expect(question.getByRole("button", { name: /^no$/i })).toBeFocused(); // (NO the default, MENU-15)
      await question.getByRole("button", { name: /^yes$/i }).click();
    }
    await expect(pause).toBeHidden();
    await expect(pause.locator(".pause-question")).toBeHidden();
  };
  // (the main menu's Play, then Free Play: free play, the editor gone, the car driven by W; then back to the menu)
  const freePlayDrives = async (): Promise<void> => {
    await expect(menu).toBeVisible();
    // (no training run left going under the menu: RX28C's BM11)
    expect(await page.evaluate(() => (window as unknown as { carballFreeplay: { training: () => unknown } }).carballFreeplay.training())).toBeNull();
    await expect(page.locator("#training-editor")).toBeHidden();
    await expect(page.locator("#fly-editor")).toBeHidden();
    expect(await editorState()).toMatchObject({ open: false, testing: false });
    await expect(menu.getByRole("button", { name: /^play$/i })).toHaveClass(/pad-focus/);
    await padTap(page, [A]);
    const freePlay = menu.getByRole("button", { name: /^free play$/i });
    for (let i = 0; i < 4 && !(await padFocused(freePlay)); i++) await padTap(page, [DOWN]);
    await padTap(page, [A]);
    await expect(menu).toBeHidden();
    await expect(page.locator("#fly-editor")).toBeHidden();
    await expect(page.locator("#training-editor")).toBeHidden();
    await expect(page.locator("#training")).toBeHidden();
    await page.keyboard.down("KeyW");
    await expect.poll(speed, { timeout: 6_000 }).toBeGreaterThan(300);
    await page.keyboard.up("KeyW");
    // (the test's View pressed in free play: no editor back)
    await padTap(page, [VIEW]);
    await expect(page.locator("#fly-editor")).toBeHidden();
    await page.keyboard.press("Escape");
    await pause.getByRole("button", { name: /^exit to main menu$/i }).click();
    await pause.locator(".pause-question").getByRole("button", { name: /^yes$/i }).click();
    await expect(menu).toBeVisible();
  };

  // The free-camera editor, nothing changed: Exit to Main Menu asks the pause's EXIT TO MAIN MENU, YES leaves it
  await createTraining();
  await expect(list).toBeVisible();
  await exitToMainMenu();
  await expect(modal).toBeHidden();
  await freePlayDrives();

  // A shot added (unsaved): the entry reads Save and Exit, the editor's SAVE AND EXIT its one question; CANCEL (B) back to
  // the pause menu (TE1 §5.3), B again the editor; NO leaves it
  await createTraining();
  await expect(list).toBeVisible();
  await padTap(page, [DOWN]);
  await expect(list.locator(":focus")).toHaveText("CREATE NEW SHOT");
  await padTap(page, [A]);
  await expect(list.locator(".fly-shot-button")).toHaveCount(2);
  await exitToMainMenu(true);
  await expect(modal.locator(".modal-title")).toHaveText("SAVE AND EXIT");
  await padTap(page, [B]);
  await expect(modal).toBeHidden();
  await expect(pause).toBeVisible();
  await padTap(page, [B]);
  await expect(pause).toBeHidden();
  await expect(list).toBeVisible();
  expect(await editorState()).toMatchObject({ open: true });
  await exitToMainMenu(true);
  await expect(modal.locator(".modal-title")).toHaveText("SAVE AND EXIT");
  const no = modal.getByRole("button", { name: /^no$/i });
  for (let i = 0; i < 3 && !(await padFocused(no)); i++) await padTap(page, [LEFT]);
  await padTap(page, [A]);
  await expect(modal).toBeHidden();
  await freePlayDrives();

  // The free-camera editor's test (View): its pause menu's Exit to Main Menu leaves the test and the editor
  await createTraining();
  await expect(list).toBeVisible();
  await padTap(page, [VIEW]);
  await expect.poll(async () => (await editorState())?.testing).toBe(true);
  await exitToMainMenu();
  await freePlayDrives();

  // A shot added, then tested: Exit to Main Menu from the test asks SAVE AND EXIT first (RX28C's BM3); NO leaves
  await createTraining();
  await expect(list).toBeVisible();
  await padTap(page, [DOWN]);
  await padTap(page, [A]);
  await expect(list.locator(".fly-shot-button")).toHaveCount(2);
  await padTap(page, [VIEW]);
  await expect.poll(async () => (await editorState())?.testing).toBe(true);
  await exitToMainMenu(true);
  await expect(modal.locator(".modal-title")).toHaveText("SAVE AND EXIT");
  await modal.getByRole("button", { name: /^cancel$/i }).click();
  await expect(pause).toBeVisible(); // (CANCEL clicked: the pause menu again)
  await padTap(page, [B]);
  await exitToMainMenu(true);
  await modal.getByRole("button", { name: /^no$/i }).click();
  await freePlayDrives();

  // The pause menu over the free-camera editor's list, drawn on top: its Exit to Main Menu clicked with the mouse (RX28C)
  await createTraining();
  await expect(list).toBeVisible();
  await padTap(page, [START]);
  await expect(pause).toBeVisible();
  await pause.getByRole("button", { name: /^exit to main menu$/i }).click();
  await pause.locator(".pause-question").getByRole("button", { name: /^yes$/i }).click();
  await expect(pause).toBeHidden();
  await freePlayDrives();

  // The panel editor: the same
  await page.evaluate(() => {
    localStorage.setItem("carball.training.editorMode", "panel");
  });
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await createTraining();
  const panel = page.locator("#training-editor");
  await expect(panel).toBeVisible();
  await exitToMainMenu();
  await freePlayDrives();

  // A shot added (unsaved), playtested, Back to Editor: still unsaved, Exit to Main Menu asks (RX28C); NO leaves
  await createTraining();
  await panel.getByRole("button", { name: /^add$/i }).click();
  await panel.getByRole("button", { name: /^playtest$/i }).click();
  await expect(panel).toBeHidden();
  await page.keyboard.press("Escape");
  await pause.getByRole("button", { name: /^back to editor$/i }).click();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Unsaved changes");
  await exitToMainMenu(true);
  await expect(modal.locator(".modal-title")).toHaveText("SAVE AND EXIT");
  await modal.getByRole("button", { name: /^no$/i }).click();
  await freePlayDrives();

  // The same named, Exit to Main Menu from the playtest itself (RX28C's BM4: the playtest left too): YES saves the pack
  // and leaves
  await createTraining();
  await panel.locator(".editor-name").fill("Pause Pack");
  await panel.locator(".editor-name").press("Enter");
  await panel.getByRole("button", { name: /^add$/i }).click();
  await panel.getByRole("button", { name: /^playtest$/i }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator("#training")).toBeVisible();
  // (the page's leaving asked about mid-playtest too: RX28C's RV-645)
  const unloadAsks = async (): Promise<boolean> =>
    page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
  expect(await unloadAsks()).toBe(true);
  await exitToMainMenu(true);
  await expect(modal.locator(".modal-title")).toHaveText("SAVE AND EXIT");
  await modal.getByRole("button", { name: /^yes$/i }).click();
  await expect(page.locator("#training")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("carball.training.mine") ?? "")).toContain("Pause Pack");
  expect(await unloadAsks()).toBe(false);
  await freePlayDrives();
  expect(errors).toEqual([]);
});
