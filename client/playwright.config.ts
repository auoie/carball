// Browser end-to-end tests. Uses the installed Google Chrome, with software WebGL so it also runs headless without a
// GPU. Two kinds: "local", against the production build (`npm run build` first) and local game servers (e2e/servers.ts);
// "services", the specs that search, against the deployment's services in Docker (e2e/services/stacks.ts: the images
// built from the working tree, one stack per group of specs), brought up by its setup and taken down after.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:4173",
    channel: "chrome",
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  projects: [
    { name: "local", testIgnore: "services/**" },
    { name: "services-setup", testMatch: "services/stacks.setup.ts", teardown: "services-teardown" },
    { name: "services-teardown", testMatch: "services/stacks.teardown.ts" },
    // (each spec's stack its baseURL: test.use in the spec)
    { name: "services", testMatch: "services/**/*.spec.ts", dependencies: ["services-setup"] },
  ],
  // The preview of the production build and the game servers (e2e/servers.ts)
  globalSetup: "./e2e/servers.ts",
  outputDir: "test-results",
});
