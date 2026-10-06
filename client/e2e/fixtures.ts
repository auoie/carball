// Shared test fixture: the page never sees real gamepads. The system Chrome running the tests reads any
// controller plugged into the machine, and someone playing with it would press buttons in the test.
import { test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "getGamepads", { value: () => [] });
    });
    await use(page);
  },
});

export { expect } from "@playwright/test";
