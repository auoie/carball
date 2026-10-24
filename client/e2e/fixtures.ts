// Shared test fixture: the page never sees real gamepads. The system Chrome running the tests reads any
// controller plugged into the machine, and someone playing with it would press buttons in the test.
import { type BrowserContext, type Locator, type Page, expect, test as base } from "@playwright/test";

export async function hideGamepads(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // (configurable: a test may put its own scripted pad in: `fakeGamepad`)
    Object.defineProperty(navigator, "getGamepads", { value: () => [], configurable: true });
  });
}

/** The video settings' automatic default off (src/settings/video.ts): software WebGL reads as a weak GPU, and its frames
 *  are slow; the tests draw at the maximum unless one asks for the default (`videoAuto`) */
export async function videoAuto(context: BrowserContext, weak: boolean, guard: boolean): Promise<void> {
  await context.addInitScript(
    ([w, g]) => {
      (window as unknown as { carballVideoAuto: { weak: boolean; guard: boolean } }).carballVideoAuto = { weak: w, guard: g };
    },
    [weak, guard] as const,
  );
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await hideGamepads(context);
    await videoAuto(context, false, false);
    await use(context);
  },
});

export { expect } from "@playwright/test";

/** A scripted standard-layout pad for the page (after the fixture hid the real ones): `setPad(buttons down, axes)` from
 *  the test through `window.carballSetPad`; `mapping` "" a pad the browser doesn't map (never read: RV-1124) */
export async function fakeGamepad(context: BrowserContext, mapping: "standard" | "" = "standard"): Promise<void> {
  await context.addInitScript((padMapping) => {
    const pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] };
    const w = window as unknown as { carballSetPad: (down: number[], axes?: number[]) => void };
    w.carballSetPad = (down, axes = [0, 0, 0, 0]) => {
      pad.buttons.forEach((b, i) => {
        const on = down.includes(i);
        b.pressed = on;
        b.value = on ? 1 : 0;
      });
      pad.axes = axes;
    };
    const gamepad = (): unknown => ({
      id: "test pad",
      index: 0,
      connected: true,
      mapping: padMapping,
      timestamp: performance.now(),
      buttons: pad.buttons,
      axes: pad.axes,
    });
    Object.defineProperty(navigator, "getGamepads", { value: () => [gamepad()], configurable: true });
  }, mapping);
}

/** The pad held for one of the page's frames, then let go for two (as e2e/padmenus.spec.ts's tap: never a fixed time; the scripted pad's: fakeGamepad) */
export async function padTap(page: Page, buttons: number[]): Promise<void> {
  await page.evaluate(async (b) => {
    const w = window as unknown as { carballSetPad: (down: number[]) => void };
    const frames = (n: number): Promise<void> =>
      new Promise((resolve) => {
        const step = (k: number): void => {
          if (k === 0) resolve();
          else
            requestAnimationFrame(() => {
              step(k - 1);
            });
        };
        step(n);
      });
    w.carballSetPad(b);
    await frames(1);
    w.carballSetPad([]);
    await frames(2);
  }, buttons);
}

/** The Play page's playlists ticked as named, the others unticked (its boxes: one at least stays ticked, so the named
 *  ones are ticked first) */
export async function tickPlaylists(menu: Locator, names: readonly string[]): Promise<void> {
  for (const name of names) {
    const box = menu.getByRole("checkbox", { name, exact: true });
    if ((await box.getAttribute("aria-checked")) !== "true") await box.click();
  }
  for (const box of await menu.locator(".main-menu-playlist").all()) {
    const name = (await box.getAttribute("aria-label")) ?? "";
    if (!names.includes(name) && (await box.getAttribute("aria-checked")) === "true") await box.click();
  }
  for (const box of await menu.locator(".main-menu-playlist").all()) {
    const name = (await box.getAttribute("aria-label")) ?? "";
    await expect(box).toHaveAttribute("aria-checked", String(names.includes(name)));
  }
}
