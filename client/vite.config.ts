/// <reference types="vitest/config" />
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, type ViteDevServer, defineConfig } from "vite";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** A folder's files under a URL prefix (none outside it), by their extension's type */
function serveFolder(server: ViteDevServer, prefix: string, root: string, types: Record<string, string>): void {
  const isFile = (path: string): boolean => {
    try {
      return path.startsWith(root + sep) && statSync(path).isFile();
    } catch {
      return false;
    }
  };
  server.middlewares.use(prefix, (req, res) => {
    const path = normalize(join(root, decodeURIComponent((req.url ?? "").split("?")[0] ?? "")));
    if (!isFile(path)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("Content-Type", types[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream");
    createReadStream(path).pipe(res);
  });
}

/** The dev server only: /local-assets/ serves out/bsim/assets_local/ (the game's own models, exported locally for
 *  testing: Psyonix assets, never part of a build; src/render/fennec.ts; the user's training packs, other creators'
 *  work converted locally: src/training/packs.ts). */
function localAssets(): Plugin {
  const root = here("../out/bsim/assets_local");
  return {
    name: "local-assets",
    apply: "serve",
    configureServer(server) {
      serveFolder(server, "/local-assets", root, { ".glb": "model/gltf-binary", ".png": "image/png", ".json": "application/json" });
    },
  };
}

/** The bot packages (the offline match against bots: src/bots/; Nexto's and Necto's, CC BY-NC-SA 4.0), tracked in
 *  client/bots/ (their derived specs stay local: out/bsim/assets_local/bots/packages): the dev server serves them at
 *  /bots/; a build has them, onnxruntime's WebAssembly and the match host unless CARBALL_BOTS=0 (then none of the three:
 *  __CARBALL_BOTS__ false, the bots' mode hidden). A build with them: their runtime files in dist/bots/ (not their test
 *  vectors), their notices after the page's (bots/NOTICES.txt) and onnxruntime's third-party notices beside them */
const BOT_PACKAGES = here("bots");
const BOTS = process.env.CARBALL_BOTS !== "0";

function botPackages(): Plugin {
  let outDir = "";
  return {
    name: "bot-packages",
    configureServer(server) {
      serveFolder(server, "/bots", BOT_PACKAGES, { ".json": "application/json", ".onnx": "application/octet-stream", ".txt": "text/plain; charset=utf-8" });
    },
    configResolved(config) {
      // (a build's alone: vitest's server closes its bundle too, and would write into whatever dist is there, RV-534)
      outDir = config.command === "build" ? resolve(config.root, config.build.outDir) : "";
    },
    closeBundle() {
      if (!BOTS || !outDir) return;
      const shipped = (path: string): boolean => !/(vectors\.json|NOTICES\.txt|ThirdPartyNotices\.txt)$/.test(path);
      cpSync(BOT_PACKAGES, join(outDir, "bots"), { recursive: true, filter: shipped });
      const notices = join(outDir, "THIRD_PARTY_NOTICES.txt");
      const bots = readFileSync(join(BOT_PACKAGES, "NOTICES.txt"), "utf8");
      // (once, whatever ran before)
      const page = existsSync(notices) ? readFileSync(notices, "utf8") : null;
      if (page !== null && !page.includes(bots.trim())) writeFileSync(notices, `${page.trimEnd()}\n\n${bots}`);
      cpSync(join(BOT_PACKAGES, "onnxruntime-ThirdPartyNotices.txt"), join(outDir, "THIRD_PARTY_NOTICES-onnxruntime.txt"));
    },
  };
}

/** Where a build records each output file's modules: the shipped-data guard exempts three.js's chunk by what's in it,
 *  not its name (RV-225). Outside dist: it doesn't ship */
const CHUNK_MODULES = here("node_modules/.cache/rl-chunk-modules.json");

/** A build: each file it writes and the modules in it (client-relative paths, "/" separated; a bundler's own virtual
 *  modules as they are, "\0..."); an asset, the files it came from (none: emitted by the build itself) */
/** A worker's build's record (the bots' match host: its files go into the page's build as they are, without their
 *  modules or sources), merged into the page's */
const workerFiles: Record<string, string[]> = {};

function chunkModules(worker = false): Plugin {
  return {
    name: "rl-chunk-modules",
    apply: "build",
    generateBundle(_options, bundle) {
      const files: Record<string, string[]> = {};
      for (const [name, output] of Object.entries(bundle)) {
        const ids = output.type === "chunk" ? output.moduleIds : output.originalFileNames.map((f) => resolve(here("."), f));
        files[name] = ids.map((id) => (id.startsWith("\0") ? id : relative(here("."), id).split(sep).join("/")));
      }
      if (worker) {
        Object.assign(workerFiles, files);
        return;
      }
      mkdirSync(dirname(CHUNK_MODULES), { recursive: true });
      writeFileSync(CHUNK_MODULES, JSON.stringify({ ...files, ...workerFiles }, null, 1));
    },
  };
}

export default defineConfig({
  plugins: [localAssets(), botPackages(), chunkModules()],
  // (the worker's build recorded too: its files' modules and sources for the shipped-data guard)
  worker: { format: "es", plugins: () => [chunkModules(true)] },
  // (whether this build has the bots: dead code without them, their worker, host and runtime never bundled)
  define: { __CARBALL_BOTS__: JSON.stringify(BOTS) },
  resolve: {
    alias: {
      // The WebAssembly engine (build it first: see engine/README.md) and our generated arena
      "@engine": here("../engine/build-wasm"),
      // The local host: the server's match built to WebAssembly (scripts/build_host.sh; the offline match against bots)
      "@host": here("../engine/build-wasm-host"),
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
    // (three.js in a chunk of its own: the shipped-data guard exempts the library's chunk, by its modules: RV-225)
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: "three", test: /node_modules[\\/]three[\\/]/ }] } } },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
