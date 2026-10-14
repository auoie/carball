// Shared test fixture: the page never sees real gamepads. The system Chrome running the tests reads any
// controller plugged into the machine, and someone playing with it would press buttons in the test.
import { type BrowserContext, test as base } from "@playwright/test";

export async function hideGamepads(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // (configurable: a test may put its own scripted pad in: `fakeGamepad`)
    Object.defineProperty(navigator, "getGamepads", { value: () => [], configurable: true });
  });
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await hideGamepads(context);
    await use(context);
  },
});

export { expect } from "@playwright/test";

/** A scripted standard-layout pad for the page (after the fixture hid the real ones): `setPad(buttons down, axes)` from
 *  the test through `window.rlSetPad` */
export async function fakeGamepad(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] };
    const w = window as unknown as { rlSetPad: (down: number[], axes?: number[]) => void };
    w.rlSetPad = (down, axes = [0, 0, 0, 0]) => {
      pad.buttons.forEach((b, i) => {
        const on = down.includes(i);
        b.pressed = on;
        b.value = on ? 1 : 0;
      });
      pad.axes = axes;
    };
    const gamepad = (): unknown => ({ id: "test pad", index: 0, connected: true, mapping: "standard", timestamp: performance.now(), buttons: pad.buttons, axes: pad.axes });
    Object.defineProperty(navigator, "getGamepads", { value: () => [gamepad()], configurable: true });
  });
}
