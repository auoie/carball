// The services project's setup (playwright.config.ts): the stacks up (stacks.ts), the images built first
import { test as setup } from "@playwright/test";
import { upStacks } from "./stacks";

setup("the services' stacks up", async () => {
  // (the first image build compiles everything: later ones what changed)
  setup.setTimeout(60 * 60_000);
  await upStacks();
});
