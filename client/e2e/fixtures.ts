// Shared test fixture: the page never sees real gamepads. The system Chrome running the tests reads any
// controller plugged into the machine, and someone playing with it would press buttons in the test.
import { type BrowserContext, test as base } from "@playwright/test";

export async function hideGamepads(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "getGamepads", { value: () => [] });
  });
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await hideGamepads(context);
    await use(context);
  },
});

export { expect } from "@playwright/test";
