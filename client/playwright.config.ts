// Browser end-to-end tests against the production build (`npm run build` first) and a local game server.
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
  webServer: [
    {
      command: "npx vite preview --port 4173 --strictPort",
      url: "http://localhost:4173",
      reuseExistingServer: true,
    },
    {
      // The game server for the online tests (the first run builds it)
      command: "cargo run --quiet --manifest-path ../server/Cargo.toml -- --port 14433 --info-port 14434",
      url: "http://127.0.0.1:14434/info",
      reuseExistingServer: false,
      timeout: 600_000,
    },
    {
      // One whose rounds end in a goal 1 s after go (the goal sequence's test)
      command: "cargo run --quiet --manifest-path ../server/Cargo.toml -- --port 14435 --info-port 14436 --test-goal-after 1",
      url: "http://127.0.0.1:14436/info",
      reuseExistingServer: false,
      timeout: 600_000,
    },
  ],
  outputDir: "test-results",
});
