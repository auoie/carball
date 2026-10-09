/// <reference types="vitest/config" />
import { createReadStream, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, defineConfig } from "vite";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** The dev server only: /local-assets/ serves out/bsim/assets_local/ (the game's own models, exported locally for
 *  testing: Psyonix assets, never part of a build; src/render/fennec.ts). */
function localAssets(): Plugin {
  const root = here("../out/bsim/assets_local");
  const types: Record<string, string> = { ".glb": "model/gltf-binary", ".png": "image/png" };
  return {
    name: "local-assets",
    apply: "serve",
    configureServer(server) {
      const isFile = (path: string): boolean => {
        try {
          return path.startsWith(root + sep) && statSync(path).isFile();
        } catch {
          return false;
        }
      };
      server.middlewares.use("/local-assets", (req, res) => {
        const path = normalize(join(root, decodeURIComponent((req.url ?? "").split("?")[0] ?? "")));
        if (!isFile(path)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", types[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream");
        createReadStream(path).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [localAssets()],
  resolve: {
    alias: {
      // The WebAssembly engine (build it first: see engine/README.md) and our generated arena
      "@engine": here("../engine/build-wasm"),
      "@arena": here("../out/arena"),
      // Derived game data that ships (the cage's topology: scripts/cage_topology.json)
      "@scripts": here("../scripts"),
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
