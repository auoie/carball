// The menus' size (src/ui/menuScale.ts): one scale from the window for the main menu's pages, the settings, the pause
// menu and the popups, each box inside the window at every size; and a binding slot waiting for an input keeps its size.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { freePlay, openSettings } from "./players";

/** Each shown menu box's rectangle, and whether it leaves the window */
async function menuBoxes(page: Page): Promise<{ sel: string; width: number; inside: boolean }[]> {
  return page.evaluate(() =>
    [".main-menu-column:not([hidden])", "#settings", ".pause-menu", ".modal-box"].flatMap((sel) =>
      [...document.querySelectorAll(sel)]
        .filter((e) => e.getClientRects().length > 0)
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { sel, width: r.width, inside: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
        }),
    ),
  );
}

for (const [width, height, scale] of [
  [1280, 720, 1],
  [1920, 1080, 1.25],
  [2560, 1440, 5 / 3],
] as const) {
  test(`the menus at ${String(width)} x ${String(height)}: drawn at ${scale.toFixed(2)}, every box inside the window`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => {
      sessionStorage.setItem("carball.menuNotice", JSON.stringify({ modal: "lost" }));
    });
    await page.goto("/?render=off");
    await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
    // (a popup: the connection-lost notice over the menu)
    await expect(page.locator("#modal")).toBeVisible({ timeout: 10_000 });
    const withModal = await menuBoxes(page);
    expect(withModal.find((b) => b.sel === ".modal-box")?.width).toBeCloseTo(460 * scale, 0);
    expect(withModal.every((b) => b.inside)).toBe(true);
    await page.locator("#modal").getByRole("button").first().click();
    await expect(page.locator("#modal")).toBeHidden();
    const menu = page.locator("#main-menu");
    expect((await menuBoxes(page)).find((b) => b.sel === ".main-menu-column:not([hidden])")?.width).toBeCloseTo(360 * scale, 0);
    for (const open of [/^play$/i, /^garage$/i]) {
      await menu.getByRole("button", { name: open }).click();
      // (at its size from the first frame of its slide-in: never drawn at the old size, then jumping, the user's report)
      const first = await page.evaluate(() => {
        const column = document.querySelector<HTMLElement>(".main-menu-column:not([hidden])");
        return column ? column.getBoundingClientRect().width / column.offsetWidth : 0;
      });
      expect(first, String(open)).toBeCloseTo(scale, 2);
      expect(
        (await menuBoxes(page)).every((b) => b.inside),
        String(open),
      ).toBe(true);
      await page.keyboard.press("Escape");
    }
    await menu.getByRole("button", { name: /^settings$/i }).click();
    await expect(page.locator("#settings")).toBeVisible();
    const settings = await menuBoxes(page);
    expect(settings.find((b) => b.sel === "#settings")?.width).toBeCloseTo(Math.min(760 * scale, 0.94 * width), 0);
    expect(settings.every((b) => b.inside)).toBe(true);
    // (the button hints under it at the same scale, inside the window, RV-833)
    const panel = await page.locator("#settings").boundingBox();
    const hints = await page.locator("#menu-hints").boundingBox();
    expect(hints?.height).toBeCloseTo(48 * scale, 0);
    expect(panel && hints && panel.y + panel.height <= hints.y + 1 && hints.y + hints.height <= height + 1).toBe(true);
    await page.keyboard.press("Escape");
    await freePlay(page);
    await page.keyboard.press("Escape");
    await expect(page.locator("#pause-menu")).toBeVisible();
    const pause = await menuBoxes(page);
    expect(pause.find((b) => b.sel === ".pause-menu")?.width).toBeCloseTo(340 * scale, 0);
    expect(pause.every((b) => b.inside)).toBe(true);
  });
}

test("a binding slot waiting for an input keeps its size and the table its layout: narrow and wide, keyboard and gamepad", async ({ page }) => {
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await freePlay(page);
  await openSettings(page);
  // (every slot's and row's rectangle, from the table's corner)
  const layout = (): Promise<number[][]> =>
    page.evaluate(() => {
      const table = document.querySelector(".bindings")?.getBoundingClientRect();
      if (!table) return [];
      return [...document.querySelectorAll(".bindings tr, .binding-slot")].map((e) => {
        const r = e.getBoundingClientRect();
        return [r.x - table.x, r.y - table.y, r.width, r.height].map((v) => Math.round(v * 2) / 2);
      });
    });
  for (const size of [
    { width: 640, height: 360 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    for (const [action, device] of [
      ["throttleForward", "keyboard"],
      ["throttleForward", "gamepad"],
      ["jump", "gamepad"],
      ["defendShot", "keyboard"],
    ] as const) {
      const slot = page.locator(`.binding-slot[data-action="${action}"][data-device="${device}"]`);
      await slot.scrollIntoViewIfNeeded();
      const before = await layout();
      await slot.click();
      await expect(slot).toHaveClass(/capturing/);
      // (a short prompt that fits its slot, RV-830; the whole sentence its name)
      const prompt = slot.locator(".slot-prompt");
      await expect(prompt).toHaveText(device === "keyboard" ? "Press a key…" : "Press a button…");
      await expect(slot).toHaveAttribute("aria-label", device === "keyboard" ? "Press a key or mouse button…" : "Press or move a gamepad input…");
      // (shown whole, never cut short: where the slot is narrower than it, drawn past it, inside the panel)
      const fit = await prompt.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const panel = document.querySelector("#settings")?.getBoundingClientRect();
        return { whole: e.scrollWidth <= e.clientWidth + 1, inside: !!panel && r.left >= panel.left - 1 && r.right <= panel.right + 1 };
      });
      expect(fit, `the prompt at ${String(size.width)}`).toEqual({ whole: true, inside: true });
      expect(await layout(), `${action} ${device} at ${String(size.width)} x ${String(size.height)}`).toEqual(before);
      await page.keyboard.press("Escape");
      await expect(page.locator(".binding-slot.capturing")).toHaveCount(0);
    }
  }
});

test("a slider at 3840 x 2160 (the menus at 2.5): a click on its thumb's drawn ends gives its ends (RV-831)", async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto("/?render=off");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await page
    .locator("#main-menu")
    .getByRole("button", { name: /^settings$/i })
    .click();
  await page.locator(".settings-tab", { hasText: "Camera" }).click();
  const slider = page.locator("#settings .control-slider").first();
  const [min, max] = [Number(await slider.getAttribute("aria-valuemin")), Number(await slider.getAttribute("aria-valuemax"))];
  const box = await slider.boundingBox();
  if (!box) throw new Error("no slider");
  const thumb = 16 * 2.5;
  await page.mouse.click(box.x + thumb / 2, box.y + box.height / 2);
  await expect(slider).toHaveAttribute("aria-valuenow", String(min));
  await page.mouse.click(box.x + box.width - thumb / 2, box.y + box.height / 2);
  await expect(slider).toHaveAttribute("aria-valuenow", String(max));
});
