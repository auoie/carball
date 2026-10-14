// Browser end-to-end tests against the production build (`npm run build` first) and local game servers (e2e/servers.ts).
// Uses the installed Google Chrome, with software WebGL so it also runs headless without a GPU.
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
  // The preview of the production build and the game servers (e2e/servers.ts)
  globalSetup: "./e2e/servers.ts",
  outputDir: "test-results",
});
