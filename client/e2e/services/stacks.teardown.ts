// The services project's teardown (playwright.config.ts): each stack's logs kept, the stacks down (stacks.ts)
import { test as teardown } from "@playwright/test";
import { downStacks } from "./stacks";

teardown("the services' stacks down", async () => {
  teardown.setTimeout(120_000);
  await downStacks();
});
