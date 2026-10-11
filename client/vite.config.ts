/// <reference types="vitest/config" />
import { createReadStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
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

/** Where a build records each output file's modules: the shipped-data guard exempts three.js's chunk by what's in it,
 *  not its name (RV-225). Outside dist: it doesn't ship */
const CHUNK_MODULES = here("node_modules/.cache/rl-chunk-modules.json");

/** A build: each file it writes and the modules in it (client-relative paths, "/" separated; a bundler's own virtual
 *  modules as they are, "\0..."; none for an asset) */
function chunkModules(): Plugin {
  return {
    name: "rl-chunk-modules",
    apply: "build",
    generateBundle(_options, bundle) {
      const files: Record<string, string[]> = {};
      for (const [name, output] of Object.entries(bundle)) {
        files[name] = output.type === "chunk" ? output.moduleIds.map((id) => (id.startsWith("\0") ? id : relative(here("."), id).split(sep).join("/"))) : [];
      }
      mkdirSync(dirname(CHUNK_MODULES), { recursive: true });
      writeFileSync(CHUNK_MODULES, JSON.stringify(files, null, 1));
    },
  };
}

export default defineConfig({
  plugins: [localAssets(), chunkModules()],
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
    // (three.js in a chunk of its own: the shipped-data guard exempts the library's chunk, by its modules: RV-225)
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: "three", test: /node_modules[\\/]three[\\/]/ }] } } },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
