/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // The WebAssembly engine (build it first: see engine/README.md) and our generated arena
      "@engine": here("../engine/build-wasm"),
      "@arena": here("../out/arena"),
    },
  },
  server: {
    // The engine and arena live outside client/
    fs: { allow: [here("..")] },
  },
  build: {
    target: "es2023",
    chunkSizeWarningLimit: 700, // three.js alone is ~600 KB minified
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
