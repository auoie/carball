// Browser end-to-end tests against the production build (`npm run build` first).
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
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
  },
  outputDir: "test-results",
});
