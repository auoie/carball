import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/** What ships carries no game data (RV-99, RV-114, RV-131): no mesh's vertices or UVs, no traced shapes, no tables of
 *  the meshes' per-azimuth extents, in any module under src/ or the JSON they import, nor in the built bundle (the
 *  arena's and its surroundings' shapes are rules, named measures, statistics and fits). Comments outside strings don't
 *  ship and are left out; text in strings and template literals (the shaders, their comments too) does, and is kept. */
const SRC = new URL("..", import.meta.url).pathname;
const ROOT = new URL("../../..", import.meta.url).pathname;
const ASSETS = join(ROOT, "out/bsim/assets_local/arena");
const PLAN = join(ASSETS, "field_plan.json");
/** scripts/reference_vertices.py's local export: the surroundings meshes' vertices and UVs, their statistics */
const REFERENCE = join(ROOT, "out/arena_local/reference");
/** The surroundings' per-azimuth statistics and crowd tiers (local: the static session's SUR-1 exports) */
const SUR1 = join(ROOT, "out/bsim/agents/SUR1");
const DIST = join(SRC, "../dist");
/** The cars' Blender models (src/render/carGlb.ts: client/cars/*.glb, bundled where they are) */
const CARS = join(SRC, "../cars");
/** The bot packages, tracked (vite.config.ts copies their runtime files into a build with bots) */
const BOTS = join(SRC, "../bots");
/** The build's output files and the modules in each (vite.config.ts's chunkModules) */
const CHUNK_MODULES = join(SRC, "../node_modules/.cache/rl-chunk-modules.json");
/** Files the build copies into dist as they are (none today) */
const PUBLIC = join(SRC, "../public");
/** Our generated arena (scripts/arena_gen.py): the collision meshes that ship */
const ARENA = join(ROOT, "out/arena");
/** The game's own meshes, cooked and exported (local only) */
const ARENA_LOCAL = join(ROOT, "out/arena_local");

function files(dir: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, keep) : keep(name) ? [path] : [];
  });
}
const modules = (): string[] => files(SRC, (n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && !n.endsWith(".d.ts"));

/** A library's installed package, its real path: where Node resolves it from client/ (hoisted, a workspace's, pnpm's
 *  store: RV-240), so a folder of ours named node_modules/three isn't it (RV-261) */
function installedPackage(name: string, entry = name): string {
  let dir = dirname(createRequire(join(SRC, "../package.json")).resolve(entry));
  const named = (d: string): boolean =>
    existsSync(join(d, "package.json")) && (JSON.parse(readFileSync(join(d, "package.json"), "utf8")) as { name?: string }).name === name;
  while (!named(dir)) {
    if (dirname(dir) === dir) throw new Error(`${name}'s package.json not found`);
    dir = dirname(dir);
  }
  return realpathSync(dir);
}

const installedThree = (): string => installedPackage("three");

/** The output files that are three.js's alone: every module in them (the bundler's own virtual ones aside) inside the
 *  library's installed package (`packageDir`, its real path; the module ids are client-relative), not told by a file's
 *  name, which one of our modules or a public file can take (RV-225), nor by a path that only looks like it (RV-261) */
function libraryFiles(built: Readonly<Record<string, readonly string[]>>, packageDir = installedThree()): Set<string> {
  const client = join(SRC, "..");
  const inPackage = (id: string): boolean => {
    const path = resolve(client, id.split("\\").join("/"));
    return (existsSync(path) ? realpathSync(path) : path).startsWith(`${packageDir}${sep}`);
  };
  const library = (ids: readonly string[]): boolean => {
    const real = ids.filter((id) => !id.startsWith("\0"));
    return real.length > 0 && real.every(inPackage);
  };
  return new Set(Object.entries(built).flatMap(([file, ids]) => (library(ids) ? [file] : [])));
}

/** The build's import aliases (tsconfig.app.json's paths, as vite.config.ts's): "@scripts/" -> its directory */
function aliases(): [string, string][] {
  const config = readFileSync(join(SRC, "../tsconfig.app.json"), "utf8");
  return [...config.matchAll(/"(@[\w-]+\/)\*"\s*:\s*\[\s*"([^"]+)\/\*"/g)].map((m) => [m[1] ?? "", join(SRC, "..", m[2] ?? "")]);
}

/** The specifiers a module's text imports, in every form the build follows (RV-167f): static and side-effect imports,
 *  import(), import.meta.glob's patterns, new URL(..., import.meta.url); queries (?raw, ?url) kept; template literals
 *  too, each ${...} a wildcard, as Vite globs them (RV-174) */
function importSpecifiers(text: string): string[] {
  const out: string[] = [];
  const quoted = "[\"'`]([^\"'`]+)[\"'`]";
  const wild = (s: string): string => s.replace(/\$\{[^}]*\}/g, "*");
  for (const re of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    new RegExp(`\\bimport\\s*\\(\\s*${quoted}`, "g"),
    new RegExp(`\\bnew\\s+URL\\s*\\(\\s*${quoted}\\s*,\\s*import\\.meta\\.url`, "g"),
  ]) {
    for (const m of text.matchAll(re)) out.push(wild(m[1] ?? ""));
  }
  for (const m of text.matchAll(/import\.meta\.glob\s*(?:<[^>]*>)?\s*\(\s*(\[[^\]]*\]|["'`][^"'`]+["'`])/g)) {
    for (const s of (m[1] ?? "").matchAll(/["'`]([^"'`]+)["'`]/g)) out.push(wild(s[1] ?? ""));
  }
  return out;
}

/** The files a glob pattern (an absolute path with * and ** in it) matches */
function globFiles(pattern: string): string[] {
  const parts = pattern.split("/");
  const fixed = parts.findIndex((s) => s.includes("*"));
  const base = parts.slice(0, fixed).join("/");
  const rest = parts
    .slice(fixed)
    .join("/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .split("**/")
    .map((piece) => piece.replace(/\*/g, "[^/]*"))
    .join("(?:.*/)?");
  const re = new RegExp(`^${rest}$`);
  return files(base, () => true).filter((f) => re.test(relative(base, f)));
}

/** A specifier from a module to the files it ships (none for a package's, or for our own modules: scanned as modules) */
function resolveSpecifier(spec: string, from: string): string[] {
  const bare = spec.replace(/\?.*$/, "");
  const [prefix, dir] = aliases().find(([a]) => bare.startsWith(a)) ?? ["", ""];
  if (!prefix && !bare.startsWith(".") && !bare.startsWith("/")) return [];
  const path = prefix ? join(dir, bare.slice(prefix.length)) : resolve(dirname(from), bare);
  const found = path.includes("*") ? globFiles(path) : existsSync(path) && statSync(path).isFile() ? [path] : [];
  return found.filter((f) => !f.endsWith(".ts"));
}

/** Every file the modules import that isn't a module of ours (it ships in the bundle, inlined or as an asset): JSON,
 *  styles, raw text, the engine's glue and binary, the arena's meshes; through the aliases too (RV-140, RV-167f) */
function shippedImports(): string[] {
  const found = new Set<string>();
  for (const path of modules()) {
    for (const spec of importSpecifiers(stripComments(readFileSync(path, "utf8")))) for (const f of resolveSpecifier(spec, path)) found.add(f);
  }
  return [...found].sort();
}
/** What ships as text (scanned as the modules are), and what as binary (each kind pinned or allowed by name) */
const TEXT = /\.(json|css|js|mjs|html|txt|markdown|glsl|svg|csv|map|webmanifest)$/;
type Kind = "text" | "cmf" | "wasm" | "font" | "onnx" | "glb" | "unknown";
/** cmf: the arena's collision meshes (pinned to our generated ones); wasm: the engine, our build (engine/build-wasm);
 *  font: the HUD's bundled fonts (pinned: FONTS); glb: the cars' models (client/cars' alone, checked by
 *  src/render/carGlb.test.ts) */
const kind = (path: string): Kind =>
  TEXT.test(path)
    ? "text"
    : path.endsWith(".cmf")
      ? "cmf"
      : path.endsWith(".wasm")
        ? "wasm"
        : /\.(woff2?|ttf|otf)$/.test(path)
          ? "font"
          : path.endsWith(".onnx")
            ? "onnx"
            : path.endsWith(".glb")
              ? "glb"
              : "unknown";
/** The fonts that ship (style.css, public/fonts/; the user's pick, 2026-10-14), by their path under public/ and their
 *  content: the files as they were taken, SIL OFL each, its licence beside it (LICENCES). Orbitron's is the font
 *  project's own static Medium as published (github.com/theleagueof/orbitron, 2011-05-25: the user's decision, RV-489),
 *  unchanged with its own licence file (it reserves the name: no subset or conversion may ship under it) */
/** A font's licence beside it: OFL.txt, or the file its project publishes it with (Orbitron's) */
const LICENCES = ["OFL.txt", "Open Font License.markdown"] as const;
const FONTS: Readonly<Record<string, string>> = {
  "fonts/orbitron/Orbitron Medium.otf": "6d466e1c0478e93cbe24d3f069c61c654ebb3d7d384581379cadac2c77794104",
  "fonts/rajdhani/Rajdhani-SemiBold-latin.woff2": "433a7007e4747a02a790167a6efa2625855f013970ba49b9b739a5d3db8b2601",
  "fonts/rajdhani/Rajdhani-Light-latin.woff2": "828d4d537471ba0717fec6f6aa717aa6b96dd7aeb35f7e7b6d206775b438982c",
};

/** A module's text with its comments blanked: strings and template literals kept whole (a shader's comments ship) */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i] ?? "";
    const next = source[i + 1] ?? "";
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? source.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      // (to the closing quote, escapes skipped)
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

interface Num {
  readonly value: number;
  /** its decimal places, trailing zeros aside ("0.65580" has 4: RV-139; "6.5580e-1" 4 too: RV-167c) */
  readonly decimals: number;
  /** its decimal places as written ("0.65580" has 5): what makes it eligible as a UV's (RV-167a) */
  readonly written: number;
  /** written as an integer: no point, no exponent ("164.00" isn't) */
  readonly integer: boolean;
  readonly at: number;
  /** where it ends in the text */
  readonly end: number;
}

/** The numeric literals in a text (leading dots, exponents and separators too: 1_234.5, RV-140); their places counted
 *  with the exponent's shift (RV-167c) */
function numbers(text: string): Num[] {
  return [...text.matchAll(/(?<![A-Za-z_$\d.])-?(?:0[xX]([\da-fA-F_]+)|\d[\d_]*(\.[\d_]*)?|(\.\d[\d_]*))(?:[eE]([-+]?\d+))?/g)].map((m) => {
    // (a hex literal an integer: RV-183)
    if (m[1] !== undefined)
      return {
        value: parseInt(m[1].replace(/_/g, ""), 16) * (m[0].startsWith("-") ? -1 : 1),
        decimals: 0,
        written: 0,
        integer: true,
        at: m.index,
        end: m.index + m[0].length,
      };
    const mantissa = m[0]
      .replace(/_/g, "")
      .replace(/^-/, "")
      .replace(/[eE].*$/, "");
    const point = mantissa.indexOf(".");
    const digits = mantissa.replace(".", "");
    const before = point < 0 ? digits.length : point;
    const places = (d: string): number => Math.max(0, d.length - before - Number(m[4] ?? 0));
    return {
      value: Number(m[0].replace(/_/g, "")),
      decimals: places(digits.replace(/0+$/, "")),
      written: places(digits),
      integer: m[2] === undefined && m[3] === undefined && m[4] === undefined,
      at: m.index,
      end: m.index + m[0].length,
    };
  });
}

/** The bundle's binaries: its asset files by kind, and the data URLs inlined in its text (small assets, under the
 *  build's inline limit), as base64; inlined data a collision mesh when it is one of ours by content */
function bundleBinaries(): { kind: Kind; base64: string; where: string }[] {
  const out: { kind: Kind; base64: string; where: string }[] = [];
  const ours = new Set(globFiles(join(ARENA, "**/*.cmf")).map((p) => readFileSync(p).toString("base64")));
  for (const path of files(DIST, () => true)) {
    const k = kind(path);
    if (k === "cmf" || k === "wasm" || k === "unknown") out.push({ kind: k, base64: readFileSync(path).toString("base64"), where: path.slice(ROOT.length) });
    else if (k === "onnx" || k === "glb")
      continue; // (the bots' policies, the cars' models: each checked on its own)
    else {
      for (const m of readFileSync(path, "utf8").matchAll(/data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/g)) {
        const base64 = m[1] ?? "";
        out.push({ kind: ours.has(base64) ? "cmf" : "unknown", base64, where: `${path.slice(ROOT.length)} (inlined)` });
      }
    }
  }
  return out;
}

/** The arena's and its surroundings' modules, by name (a new one can't be left out: RV-229) */
const FIELD_AND_GOAL = files(join(SRC, "render"), (n) => /^(greenhouse|gameSurfaces|wallFoot|goalSurface|arenaSurface|tokenPads)\.ts$/.test(n)).map((p) =>
  p.slice(SRC.length),
);

describe("what ships carries no game data (RV-99)", () => {
  it("the arena's modules (the glasshouse, its wall foot, surfaces, materials and pads) hold rules, not traced shapes: each under a thousand numbers", () => {
    expect(FIELD_AND_GOAL.length).toBe(6);
    for (const path of FIELD_AND_GOAL) {
      let source = stripComments(readFileSync(join(SRC, path), "utf8"));
      // (FIELD_LIGHT's and GRASS_LIGHT's lightmap statistics aside: numbers, not shapes)
      source = source.replace(/export const (FIELD_LIGHT|GRASS_LIGHT)[\s\S]*?\n}( as const)?;\n/g, "");
      expect(numbers(source).length, path).toBeLessThan(1000);
    }
  });

  it("the comment stripper keeps strings and shaders, the number reader every form (RV-114, RV-139, RV-140, RV-167a, c)", () => {
    expect(stripComments('const u = "http://x"; // gone\nconst s = `// kept in a shader`;')).toBe(
      'const u = "http://x";        \nconst s = `// kept in a shader`;',
    );
    expect(numbers("a(.6558, 6.558E-1, -12, 0.5, 1_234.5, 0.65580, 6.5580e-1, 6558e-4)").map((n) => n.value)).toEqual([
      0.6558, 0.6558, -12, 0.5, 1234.5, 0.6558, 0.6558, 0.6558,
    ]);
    expect(numbers("0.65580, 1_234.50, 2., 6.5580e-1, 6558e-4, 1200, 1e3").map((n) => n.decimals)).toEqual([4, 1, 0, 4, 4, 0, 0]);
    expect(numbers("0.65580, 1_234.50, 2., 6.5580e-1, 0.6500").map((n) => n.written)).toEqual([5, 2, 0, 5, 4]);
    expect(numbers("12, 1.0, 1e3").map((n) => n.integer)).toEqual([true, false, false]);
  });

  it("the files imported in every form are scanned too: JSON through the aliases, the arena's meshes through a glob (RV-140, RV-167f)", () => {
    const sample = [
      'import a from "./a.json";',
      'import "./style.css";',
      'import b from "./shader.glsl?raw";',
      'const c = await import("./lazy");',
      'const d = import.meta.glob<string>("@arena/x/*.cmf", { query: "?url", eager: true });',
      'const e = import.meta.glob(["./p/*.json", "./q/**/*.txt"]);',
      'const f = new URL("./data.bin", import.meta.url);',
      'import type { G } from "three";',
      "const g = await import(`./p/${n}.json`);",
      "const h = new URL(`./d/${n}.bin`, import.meta.url);",
      "const k = import.meta.glob(`./t/*.glsl`);",
    ].join("\n");
    expect(importSpecifiers(sample)).toEqual([
      "./a.json",
      "./shader.glsl?raw",
      "three",
      "./style.css",
      "./lazy",
      "./p/*.json",
      "./data.bin",
      "./d/*.bin",
      "@arena/x/*.cmf",
      "./p/*.json",
      "./q/**/*.txt",
      "./t/*.glsl",
    ]);
    const shipped = shippedImports().map((p) => p.slice(ROOT.length));
    expect(shipped).toContain("client/src/style.css");
    expect(shipped.filter((p) => p.startsWith("out/arena/collision_meshes/arena/") && p.endsWith(".cmf")).length).toBe(16);
    // (every shipped file a kind this guard knows: text it scans, binary it pins or allows)
    expect(shipped.filter((p) => kind(p) === "unknown")).toEqual([]);
  });

  it("the fonts that ship are the pinned ones, byte for byte, each with its licence beside it (public/ and the bundle)", () => {
    const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const dir of [PUBLIC, DIST]) {
      for (const path of files(dir, (n) => kind(n) === "font")) {
        const at = relative(dir, path).split("\\").join("/");
        expect(FONTS[at], `${at}: not a font we ship`).toBeDefined();
        expect(sha(path), at).toBe(FONTS[at]);
        expect(
          LICENCES.some((name) => existsSync(join(dirname(path), name))),
          `${at}: its licence`,
        ).toBe(true);
      }
    }
    for (const at of Object.keys(FONTS)) expect(existsSync(join(PUBLIC, at)), at).toBe(true);
    // (Orbitron's licence names its Reserved Font Name: the file is the one it covers, its own as published)
    expect(readFileSync(join(PUBLIC, "fonts/orbitron/Open Font License.markdown"), "utf8")).toContain('with Reserved Font Name: "Orbitron"');
  });

  it("the bots' policies that ship are their tracked packages' own (client/bots/): the same bytes, the sha256 each bot.json pins", () => {
    const shipped = files(DIST, (n) => kind(n) === "onnx");
    for (const path of shipped) {
      const at = relative(join(DIST, "bots"), path).split("\\").join("/");
      const [bot = "", file = ""] = at.split("/");
      const manifest = JSON.parse(readFileSync(join(BOTS, bot, "bot.json"), "utf8")) as { policy: { files: Record<string, { file: string; sha256: string }> } };
      const pinned = Object.values(manifest.policy.files).find((f) => f.file === file);
      const bytes = readFileSync(path);
      expect(bytes.equals(readFileSync(join(BOTS, at))), at).toBe(true);
      expect(createHash("sha256").update(bytes).digest("hex"), at).toBe(pinned?.sha256);
    }
  });

  it("the bots, their notices once and onnxruntime's ship in a build with them alone (its match host's worker): never after a test run (RV-534)", () => {
    const withBots = files(join(DIST, "assets"), (n) => /^hostWorker-.*\.js$/.test(n)).length > 0;
    const notices = join(DIST, "THIRD_PARTY_NOTICES.txt");
    const page = existsSync(notices) ? readFileSync(notices, "utf8") : "";
    const section = readFileSync(join(BOTS, "NOTICES.txt"), "utf8").trim();
    expect(existsSync(join(DIST, "bots"))).toBe(withBots);
    expect(page.split(section).length - 1).toBe(withBots ? 1 : 0);
    expect(existsSync(join(DIST, "THIRD_PARTY_NOTICES-onnxruntime.txt"))).toBe(withBots);
  });

  it("the cars' models that ship are client/cars' own, byte for byte (never the game's, nor a model converted locally)", () => {
    const ours = new Set(existsSync(CARS) ? files(CARS, (n) => n.endsWith(".glb")).map((p) => readFileSync(p).toString("base64")) : []);
    const shipped = existsSync(DIST) ? files(DIST, (n) => n.endsWith(".glb")) : [];
    for (const path of shipped) expect(ours.has(readFileSync(path).toString("base64")), relative(DIST, path)).toBe(true);
    for (const p of shippedImports().filter((i) => kind(i) === "glb")) expect(p.startsWith(`${CARS}/`), p).toBe(true);
  });

  it("no dev-only local asset ships: the bundle names no /local-assets/ path (the game's models, the user's training packs)", () => {
    const local = files(DIST, (n) => /\.(js|html|css|json)$/.test(n)).filter((path) => readFileSync(path, "utf8").includes("/local-assets/"));
    expect(local.map((path) => relative(DIST, path))).toEqual([]);
  });

  it("the arena's collision meshes that ship are our generated ones: imported from out/arena, the bundle's (files or inlined) the same bytes (RV-167f)", () => {
    const cmf = shippedImports().filter((p) => kind(p) === "cmf");
    expect(cmf.length).toBeGreaterThan(0);
    for (const p of cmf) expect(p.startsWith(`${ARENA}/`), p).toBe(true);
    const ours = new Set(cmf.map((p) => readFileSync(p).toString("base64")));
    const bundled = bundleBinaries();
    // (every binary the bundle carries a kind it knows: inlined data a mesh of ours)
    expect(bundled.filter((b) => b.kind === "unknown").map((b) => b.where)).toEqual([]);
    const meshes = bundled.filter((b) => b.kind === "cmf");
    if (bundled.length === 0) return; // (no build)
    for (const b of meshes) expect(ours.has(b.base64), b.where).toBe(true);
    expect(new Set(meshes.map((b) => b.base64)).size).toBe(ours.size);
  });

  // (no local data needed: CI runs it, RV-276)
  it("three.js's chunk is told by its modules, not its name: our module or a public file named three-* is checked (RV-225)", () => {
    const three = ["node_modules/three/build/three.core.js", "node_modules/three/build/three.module.js"];
    const exempt = libraryFiles({
      "assets/three-B1.js": [...three, "\0rolldown/runtime.js"], // (the library, the bundler's runtime with it)
      "assets/three-toy-C2.js": ["src/lib/three-toy.ts"], // (our module, named like it)
      "assets/three-D3.js": [...three, "src/lib/extra.ts"], // (one of ours in the library's group)
      "assets/index-E4.js": ["src/main.ts", "../out/arena/data.ts"], // (a module outside src/, imported)
      "three-data.json": [], // (copied from public/: no modules)
      "assets/three-F5.js": ["\0rolldown/runtime.js"], // (only the bundler's)
      "assets/three-I8.js": ["src/node_modules_three/x.ts"], // (a name like it, not the package)
      "assets/three-J9.js": ["lib/node_modules/three/toy.ts"], // (a folder of ours with the package's path: RV-261)
    });
    expect([...exempt]).toEqual(["assets/three-B1.js"]);
    // (the library where other installs put it: hoisted above client/, pnpm's store: RV-240)
    const client = join(SRC, "..");
    const hoisted = { "assets/three-G6.js": ["../../repo/node_modules/three/build/three.module.js"] };
    expect([...libraryFiles(hoisted, resolve(client, "../../repo/node_modules/three"))]).toEqual(["assets/three-G6.js"]);
    const pnpm = { "assets/three-H7.js": ["node_modules/.pnpm/three@0.180.0/node_modules/three/build/three.core.js"] };
    expect([...libraryFiles(pnpm, resolve(client, "node_modules/.pnpm/three@0.180.0/node_modules/three"))]).toEqual(["assets/three-H7.js"]);
    expect([...libraryFiles(pnpm)]).toEqual([]); // (not where this install has it)
  });
});

/** A 2D lookup of points by cells of `cell` */
class Grid {
  readonly #cells = new Map<number, number[]>();
  constructor(readonly cell = 1) {}
  add(a: number, b: number): void {
    const key = Math.floor(a / this.cell) * 4194304 + Math.floor(b / this.cell);
    const cell = this.#cells.get(key);
    if (cell) cell.push(a, b);
    else this.#cells.set(key, [a, b]);
  }
  /** (as many cells round as the tolerance spans: RV-139) */
  near(a: number, b: number, tolerance: number): boolean {
    const [ca, cb] = [Math.floor(a / this.cell), Math.floor(b / this.cell)];
    const r = Math.max(1, Math.ceil(tolerance / this.cell));
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const cell = this.#cells.get((ca + i) * 4194304 + cb + j) ?? [];
        for (let k = 0; k < cell.length; k += 2) if (Math.hypot((cell[k] ?? 0) - a, (cell[k + 1] ?? 0) - b) <= tolerance) return true;
      }
    }
    return false;
  }
}

/** A 3D lookup of points by 1 uu cells */
class Grid3 {
  readonly #cells = new Map<string, number[]>();
  add(x: number, y: number, z: number): void {
    const key = `${String(Math.floor(x))},${String(Math.floor(y))},${String(Math.floor(z))}`;
    const cell = this.#cells.get(key);
    if (cell) cell.push(x, y, z);
    else this.#cells.set(key, [x, y, z]);
  }
  near(x: number, y: number, z: number, tolerance: number): boolean {
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          const cell = this.#cells.get(`${String(Math.floor(x) + i)},${String(Math.floor(y) + j)},${String(Math.floor(z) + k)}`) ?? [];
          for (let m = 0; m < cell.length; m += 3) if (Math.hypot((cell[m] ?? 0) - x, (cell[m + 1] ?? 0) - y, (cell[m + 2] ?? 0) - z) <= tolerance) return true;
        }
      }
    }
    return false;
  }
}

/** Every three consecutive values of a set of streams (NaN between streams), looked up by their cells: a column or a row
 *  of the game's data written out in its order (RV-138). Typed buckets (the textures' streams are ten million values) */
class Sequences {
  readonly #values: Float32Array;
  /** each bucket's first place in `#order` (and the end) */
  readonly #start: Uint32Array;
  /** the streams' positions by bucket */
  readonly #order: Uint32Array;
  readonly #mask: number;
  constructor(
    values: readonly number[] | Float32Array,
    readonly cell: number,
  ) {
    // (a Float32Array shared, not copied: the textures' streams indexed twice)
    const v = (this.#values = values instanceof Float32Array ? values : Float32Array.from(values));
    let size = 1024;
    while (size < v.length) size *= 2;
    this.#mask = size - 1;
    const bucket = new Int32Array(v.length).fill(-1);
    const start = (this.#start = new Uint32Array(size + 1));
    for (let i = 0; i + 2 < v.length; i++) {
      const [a = NaN, b = NaN, c = NaN] = [v[i], v[i + 1], v[i + 2]];
      if (Number.isNaN(a + b + c)) continue;
      const k = this.#key(Math.floor(a / cell), Math.floor(b / cell), Math.floor(c / cell));
      bucket[i] = k;
      start[k + 1] = (start[k + 1] ?? 0) + 1;
    }
    for (let k = 0; k < size; k++) start[k + 1] = (start[k + 1] ?? 0) + (start[k] ?? 0);
    const fill = start.slice(0, size);
    const order = (this.#order = new Uint32Array(start[size] ?? 0));
    for (let i = 0; i < bucket.length; i++) {
      const k = bucket[i] ?? -1;
      if (k < 0) continue;
      order[fill[k] ?? 0] = i;
      fill[k] = (fill[k] ?? 0) + 1;
    }
  }
  #key(i: number, j: number, k: number): number {
    return ((Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791)) >>> 0) & this.#mask;
  }
  /** Whether a, b, c lie each within `tolerance` (at most half a cell) of three consecutive values */
  near(a: number, b: number, c: number, tolerance: number): boolean {
    return this.along([a, b, c], tolerance);
  }
  /** Whether the values (three or more) lie each within `tolerance` (at most half a cell) of consecutive values from one
   *  place in a stream */
  along(w: readonly number[], tolerance: number): boolean {
    const [ca, cb, cc] = w.slice(0, 3).map((x) => Math.floor(x / this.cell)) as [number, number, number];
    const v = this.#values;
    // (as many cells round as the tolerance spans: coarse levels, RV-183)
    const r = Math.max(1, Math.ceil(tolerance / this.cell));
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        for (let k = -r; k <= r; k++) {
          const key = this.#key(ca + i, cb + j, cc + k);
          for (let m = this.#start[key] ?? 0, end = this.#start[key + 1] ?? 0; m < end; m++) {
            const at = this.#order[m] ?? 0;
            if (w.every((x, q) => Math.abs((v[at + q] ?? NaN) - x) <= tolerance)) return true;
          }
        }
      }
    }
    return false;
  }
}

const OBJS = files(join(ASSETS, "meshes"), (n) => n.endsWith(".obj"));
/** The run a check needs from integer pairs and triples all under 300 (RV-167e) */
const SMALL_RUN = 4;
/** A texture's row as the guard looks for it (RV-157): this many values along one place of its streams, bending
 *  somewhere by this much (|a - 2b + c|: a picture's row, not a ramp; smooth curves meet some texture's gradient
 *  anywhere, and a ramp is a profile) */
const TEXTURE_WINDOW = 6;
const TEXTURE_BEND = 0.02;
/** As 8-bit levels, a whole 8 px row, spanning this much too: code's integers (offsets, indices, coefficients), dense
 *  in a 256-level space, meet a row of six somewhere */
const TEXTURE_LEVELS_WINDOW = 8;
const TEXTURE_LEVELS_SPAN = 0.1;
/** Written to 4 decimals or more, a gentler bend will do (a low-contrast texture's row: RV-183) */
const TEXTURE_BEND_FINE = 0.002;

/** A form a texture's row might be written in: how many values in a row, each number's value (0 to 1; null: not this
 *  form's), the tolerance (decimals: from the places written), the span it needs, and how many of its values must be
 *  off black and white (a mask touching 0 and 255 has some between: RV-183) */
interface TextureForm {
  readonly window: number;
  readonly value: (x: Num) => number | null;
  readonly decimals: boolean;
  readonly tolerance: number;
  readonly span: number;
  readonly interior?: number;
  /** a coarse form: its windows must wiggle (wiggles) */
  readonly wiggle?: boolean;
}
/** A coarse form's tolerance a hair wider than half its step: a writer rounding a half-level tie (the box's means keep
 *  their .5) lands just past it (RV-213) */
const TIE = 1.01;
const TEXTURE_FORMS: readonly TextureForm[] = [
  // (0 to 1, 3 decimals or more, as stored or decoded)
  {
    window: TEXTURE_WINDOW,
    value: (x) => (!x.integer && x.written >= 3 && x.value >= 0 && x.value <= 1 ? x.value : null),
    decimals: true,
    tolerance: 0,
    span: 0,
  },
  // (8-bit levels: four or more of them off black and white)
  {
    window: TEXTURE_LEVELS_WINDOW,
    value: (x) => (x.integer && x.value >= 0 && x.value <= 255 ? x.value / 255 : null),
    decimals: false,
    tolerance: (TIE * 0.5) / 255,
    span: TEXTURE_LEVELS_SPAN,
    interior: 4,
  },
  // (percent)
  {
    window: 8,
    value: (x) => (x.integer && x.value >= 0 && x.value <= 100 ? x.value / 100 : null),
    decimals: false,
    tolerance: (TIE * 0.5) / 100,
    span: 0.25,
    interior: 3,
    wiggle: true,
  },
  // (fractions to 2 decimals, percent's twin: RV-213)
  {
    window: 8,
    value: (x) => (!x.integer && x.written === 2 && x.value >= 0 && x.value <= 1 ? x.value : null),
    decimals: false,
    tolerance: TIE * 0.005,
    span: 0.25,
    interior: 3,
    wiggle: true,
  },
  // (the box's means unrounded, 0-255 with a decimal or two: the 8-bit levels' twin, RV-213)
  {
    window: 8,
    value: (x) => (!x.integer && x.written >= 1 && x.written <= 2 && x.value >= 0 && x.value <= 255 ? x.value / 255 : null),
    decimals: false,
    tolerance: (TIE * 0.05) / 255,
    span: TEXTURE_LEVELS_SPAN,
    interior: 4,
    wiggle: true,
  },
  // (4-bit levels: a longer run, a 16-level space being denser still)
  {
    window: 12,
    value: (x) => (x.integer && x.value >= 0 && x.value <= 15 ? x.value / 15 : null),
    decimals: false,
    tolerance: (TIE * 0.5) / 15,
    span: 0.2,
    interior: 3,
    wiggle: true,
  },
];

/** Whether a window's values are spread: half of them distinct or more, none taking more than 40 % (a tiled row
 *  repeats its period, code a few counts over and over) */
function spread(w: readonly number[]): boolean {
  const counts = new Map<number, number>();
  for (const x of w) counts.set(x, (counts.get(x) ?? 0) + 1);
  return counts.size >= Math.ceil(w.length / 2) && Math.max(...counts.values()) <= Math.floor(0.4 * w.length);
}

/** Whether a window turns (its steps change sign somewhere) and its values are spread */
function wiggles(w: readonly number[]): boolean {
  const steps = w
    .slice(1)
    .map((x, j) => x - (w[j] ?? 0))
    .filter((d) => d !== 0);
  const turns = steps.some((d, j) => j > 0 && Math.sign(d) !== Math.sign(steps[j - 1] ?? 0));
  return turns && spread(w);
}

/** The byte strings a text writes as hex or base64 string literals (16 bytes or more) */
function stringBytes(text: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const m of text.matchAll(/["'`]([A-Za-z0-9+/=]{24,})["'`]/g)) {
    const s = m[1] ?? "";
    if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) out.push(Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16)));
    else if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0) out.push(Uint8Array.from(Buffer.from(s, "base64")));
  }
  return out;
}
const floats = (path: string): Float32Array => {
  if (!existsSync(path)) return new Float32Array(0);
  const b = readFileSync(path);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

/** The longest run of hits among a text's numbers, a hit every `stride` numbers from 1 to `strides` (16: a vertex's
 *  record of 9, 12 or 16 floats, RV-167d), from any start (RV-138: a record's fields interleaved with others' repeat at
 *  its stride); `hit(i, stride)`. With `key`, a hit with
 *  its predecessor's key starts the run over: a table's rows are distinct (one vertex's edges in an index list, [315,
 *  320], [315, 318], are no per-azimuth table) */
function longestRun(
  text: string,
  n: readonly Num[],
  hit: (i: number, stride: number) => boolean,
  { strides = 16, key }: { strides?: number; key?: (i: number) => string } = {},
): { length: number; at: string } {
  let best = { length: 0, at: "" };
  for (let stride = 1; stride <= strides; stride++) {
    for (let phase = 0; phase < stride; phase++) {
      let run = 0;
      let first = 0;
      let last = "";
      for (let i = phase; i < n.length; i += stride) {
        if (!hit(i, stride)) {
          run = 0;
          continue;
        }
        const k = key?.(i) ?? String(i);
        if (run > 0 && k === last) run = 0;
        last = k;
        if (run === 0) first = i;
        run++;
        // (past 8, a run one hit longer: a wide stride meets its hits among more numbers, RV-167d)
        const length = stride > 8 ? run - 1 : run;
        if (length > best.length) {
          const at = n[first]?.at ?? 0;
          best = { length, at: `${text.slice(at, at + 80).replace(/\s+/g, " ")} (every ${String(stride)})` };
        }
      }
    }
  }
  return best;
}

describe.skipIf(OBJS.length === 0)("against the game's meshes, the traced plan and the surroundings' statistics (local)", () => {
  // (where the game's meshes are, the rest of the local reference must be too: a guard that skips its own data is no
  // guard, RV-140)
  it("has its local reference (scripts/reference_vertices.py; the static session's SUR-1 exports)", () => {
    const needed = ["vertices.f32", "uvs.f32", "rz.f32", "az.f32", "columns.f32", "index.json", "textures.f32", "texture_controls.json"].map((n) =>
      join(REFERENCE, n),
    );
    for (const path of [...needed, join(SUR1, "outline_az.json"), join(SUR1, "surroundings_geometry.json"), PLAN])
      expect(existsSync(path), path.slice(ROOT.length)).toBe(true);
  });

  // Every vertex as its axis pairs, both ways round, and as itself; every UV, as a pair and its components
  const coords = new Grid();
  const points = new Grid3();
  const uvPairs = new Grid();
  const uvValues: number[] = [];
  const uvRows: number[] = [];
  // (the surroundings' meshes as stored hold small mesh-local numbers that any hand-made geometry meets: from them only
  // the points 300 uu or more out, RV-139)
  const vertex = (x: number, y: number, z: number, reference = false): void => {
    const [ax, ay, az] = [Math.abs(x), Math.abs(y), Math.abs(z)];
    if (reference && Math.max(ax, ay, az) < 300) return;
    coords.add(ax, ay);
    coords.add(ay, ax);
    coords.add(ax, az);
    coords.add(az, ax);
    coords.add(ay, az);
    coords.add(az, ay);
    points.add(ax, ay, az);
  };
  // (UV pairs at 10000x; the single values against the arena's own meshes' only, the surroundings' UVs too dense for a
  // lone match to mean anything: theirs as rows, three in their order)
  const uv = (u: number, v: number, reference = false): void => {
    uvPairs.add(u * 10000, v * 10000);
    if (!reference) uvValues.push(u, v);
  };
  for (const path of OBJS) {
    const us: number[] = [];
    const vs: number[] = [];
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (line.startsWith("v ")) {
        const [x = 0, y = 0, z = 0] = line.split(/\s+/).slice(1, 4).map(Number);
        vertex(x, y, z);
      } else if (line.startsWith("vt ")) {
        const [u = 0, v = 0] = line.split(/\s+/).slice(1, 3).map(Number);
        uv(u, v);
        us.push(Math.abs(u));
        vs.push(Math.abs(v));
      }
    }
    for (const x of [...us, NaN, ...vs, NaN]) uvRows.push(x);
  }
  const reference = floats(join(REFERENCE, "vertices.f32"));
  for (let i = 0; i + 2 < reference.length; i += 3) vertex(reference[i] ?? 0, reference[i + 1] ?? 0, reference[i + 2] ?? 0, true);
  const referenceUv = floats(join(REFERENCE, "uvs.f32"));
  for (let i = 0; i + 1 < referenceUv.length; i += 2) uv(referenceUv[i] ?? 0, referenceUv[i + 1] ?? 0, true);
  for (const k of [0, 1]) {
    for (let i = k; i < referenceUv.length; i += 2) uvRows.push(Math.abs(referenceUv[i] ?? 0));
    uvRows.push(NaN);
  }
  const rows = new Sequences(uvRows, 0.001);
  // The traced plan's points too (local: generated by scripts/field_plan.py)
  if (existsSync(PLAN)) {
    const walk = (o: unknown): void => {
      if (Array.isArray(o) && o.length > 1 && o.every((c) => typeof c === "number")) {
        const q = o.length % 2 === 1 ? o.slice(1) : o;
        for (let i = 0; i + 1 < q.length; i += 2) {
          coords.add(Math.abs(q[i] ?? 0), Math.abs(q[i + 1] ?? 0));
          coords.add(Math.abs(q[i + 1] ?? 0), Math.abs(q[i] ?? 0));
        }
      } else if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") Object.values(o).forEach(walk);
    };
    walk(JSON.parse(readFileSync(PLAN, "utf8")));
  }
  // The surroundings' statistics: (r, z) pairs (per-azimuth percentiles, visible profiles, crowd tiers' rows: RV-131,
  // within 25 uu), (az, value) pairs and the per-azimuth columns (RV-138)
  const rz = new Grid(25);
  const rzValues = floats(join(REFERENCE, "rz.f32"));
  for (let i = 0; i + 1 < rzValues.length; i += 2) rz.add(rzValues[i] ?? 0, rzValues[i + 1] ?? 0);
  const azValues = new Map<number, number[]>();
  const azPairs = floats(join(REFERENCE, "az.f32"));
  for (let i = 0; i + 1 < azPairs.length; i += 2) {
    const key = Math.round((azPairs[i] ?? 0) * 100);
    azValues.set(key, [...(azValues.get(key) ?? []), azPairs[i + 1] ?? 0]);
  }
  const columns = new Sequences(floats(join(REFERENCE, "columns.f32")), 50);
  // The game's textures box-downsampled to 8-64 px, their rows and columns, as stored and decoded (RV-157:
  // scripts/reference_textures.py); cells of 1/250, for 8-bit levels' half-level tolerance
  const textureStreams = floats(join(REFERENCE, "textures.f32"));
  const textures = new Sequences(textureStreams, 0.004);
  // (and coarsely, for the coarse forms' wide tolerances: 4-bit levels, percent)
  const texturesCoarse = new Sequences(textureStreams, 0.07);
  /** The last texture window found and its form (for the report) */
  let textureMatch = "";
  const sorted = Float64Array.from(uvValues).sort();
  const nearUv = (x: number, tolerance: number): boolean => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((sorted[mid] ?? 0) < x) lo = mid + 1;
      else hi = mid;
    }
    return Math.abs((sorted[lo] ?? Infinity) - x) <= tolerance || Math.abs((sorted[lo - 1] ?? Infinity) - x) <= tolerance;
  };

  // (a pair or triple counts when it could be a traced point: its coordinates 10 uu or more, one 100 or more (RV-139);
  // one off the 16 uu grid the arena's design measures share with our rules, 128, 256, 512 ...)
  const traced = (...v: readonly number[]): boolean => {
    const a = v.map(Math.abs);
    return Math.max(...a) >= 100 && Math.min(...a) >= 10 && a.some((x) => x % 16 !== 0);
  };
  // (integers all under 300: small ones are indices as often as not (the cage's topology's edges), so their runs must be
  // longer, RV-167e)
  const small = (integers: boolean, ...v: readonly number[]): boolean => integers && Math.max(...v.map(Math.abs)) < 300;
  // (UV values: written to `places` decimals or more (as written, trailing zeros too: RV-167a), and not the small ones
  // under 0.05, as dense among the UVs as in a measured profile's tail, Curve_Smoke's)
  const large = (x: Num | undefined, places: number): boolean => !!x && x.written >= places && Math.abs(x.value) >= 0.05;
  /** Half the last decimal of the least precise, its trailing zeros aside, at most 0.0005 (RV-167a) */
  const tolerance = (...x: readonly (Num | undefined)[]): number => 0.5 * 10 ** -Math.max(3, Math.min(...x.map((m) => m?.decimals ?? 0)));

  /** A window of values (0 to 1) along one place of the textures' streams, either way round (RV-183), if it bends and
   *  spans as its form needs */
  function textureWindow(w: readonly number[], form: TextureForm, tol: number, written: number): boolean {
    const fine = form.decimals && written >= 4;
    const bendsBy = (bend: number): boolean => w.some((x, j) => j >= 2 && Math.abs((w[j - 2] ?? 0) - 2 * (w[j - 1] ?? 0) + x) >= bend);
    if (!bendsBy(TEXTURE_BEND) && !(fine && bendsBy(TEXTURE_BEND_FINE))) return false;
    if (Math.max(...w) - Math.min(...w) < form.span) return false;
    if (form.interior && w.filter((x) => x * 255 >= 2 && x * 255 <= 253).length < form.interior) return false;
    // (an integer form's values not one count over and over (a topology's sides): a tiled row repeats, but evenly)
    if (!form.decimals && !spread(w)) return false;
    // (the riskier forms (coarse levels, black and white, a gentle bend) a picture's row: turning somewhere, its values
    // mostly apart; a ramp or a curve is a profile, a run of one value code's)
    const risky = form.wiggle === true || (fine && !bendsBy(TEXTURE_BEND)) || (!form.decimals && w.some((x) => x * 255 < 2 || x * 255 > 253));
    if (risky && !wiggles(w)) return false;
    const index = tol * 2 > textures.cell ? texturesCoarse : textures;
    const hit = index.along(w, tol) || index.along([...w].reverse(), tol);
    if (hit) textureMatch = `form ${String(TEXTURE_FORMS.indexOf(form))}: ${w.map((x) => x.toFixed(3)).join(" ")}`;
    return hit;
  }

  /** Every check on one text: what it found (none for a clean text) */
  function findings(text: string): string[] {
    const n = numbers(text);
    const value = (k: number): number => Math.abs(n[k]?.value ?? 0);
    const signed = (k: number): number => n[k]?.value ?? 0;
    const integers = (i: number, count: number): boolean => n.slice(i, i + count).every((m) => m.integer);
    const found: string[] = [];
    const report = (what: string, run: { length: number; at: string }, limit: number): void => {
      if (run.length >= limit) found.push(`${what} (${String(run.length)}): ${run.at}`);
    };
    // (a check per position, once, whatever the stride)
    const once = (hit: (i: number) => boolean): ((i: number) => boolean) => {
      const memo = new Map<number, boolean>();
      return (i) => {
        let h = memo.get(i);
        if (h === undefined) memo.set(i, (h = i < n.length && hit(i)));
        return h;
      };
    };
    const pairAt = once((i) => i + 1 < n.length && traced(value(i), value(i + 1)) && coords.near(value(i), value(i + 1), 0.6));
    const pairSmall = (i: number): boolean => small(integers(i, 2), value(i), value(i + 1));
    report(
      "coordinate pairs",
      longestRun(text, n, (i) => pairAt(i) && !pairSmall(i)),
      3,
    );
    report(
      "small integer coordinate pairs",
      longestRun(text, n, (i) => pairAt(i) && pairSmall(i)),
      SMALL_RUN,
    );
    const tripleAt = once((i) => i + 2 < n.length && traced(value(i), value(i + 1), value(i + 2)) && points.near(value(i), value(i + 1), value(i + 2), 0.6));
    const tripleSmall = (i: number): boolean => small(integers(i, 3), value(i), value(i + 1), value(i + 2));
    report(
      "(x, y, z) triples",
      longestRun(text, n, (i) => tripleAt(i) && !tripleSmall(i)),
      3,
    );
    report(
      "small integer (x, y, z) triples",
      longestRun(text, n, (i) => tripleAt(i) && tripleSmall(i)),
      SMALL_RUN,
    );
    // (UV pairs written to 3 decimals or more, each within half its last decimal (RV-139), u and v apart, signed as the
    // meshes' (RV-167b): a run of the same pair is one point)
    const uvPair = once((i) => {
      const t = tolerance(n[i], n[i + 1]);
      return (
        large(n[i], 3) && large(n[i + 1], 3) && Math.abs(signed(i) - signed(i + 1)) > 2 * t && uvPairs.near(signed(i) * 10000, signed(i + 1) * 10000, 10000 * t)
      );
    });
    report("UV pairs", longestRun(text, n, uvPair, { key: (i) => `${String(signed(i))},${String(signed(i + 1))}` }), 3);
    // (each within half its last written decimal of a UV component: the old goal-side glass chart's V row, RV-99; in a
    // row only, the arena's UV components too dense for a strided one to mean anything, which the rows below catch)
    const uvValue = once((i) => large(n[i], 4) && nearUv(n[i]?.value ?? 0, tolerance(n[i])));
    report("UV values", longestRun(text, n, uvValue, { strides: 1 }), 4);
    // (a mesh's UVs as a row in its order, a value every `stride`: three in a row twice over (RV-138, RV-139), varying by
    // 0.01 or more, as near-constant runs meet some mesh's anywhere)
    const uvRow = (i: number, s: number): boolean => {
      if (i + 2 * s >= n.length || !large(n[i], 3) || !large(n[i + s], 3) || !large(n[i + 2 * s], 3)) return false;
      const [a, b, c] = [value(i), value(i + s), value(i + 2 * s)];
      return Math.max(a, b, c) - Math.min(a, b, c) >= 0.01 && rows.near(a, b, c, tolerance(n[i], n[i + s], n[i + 2 * s]));
    };
    report("UV rows", longestRun(text, n, uvRow), 2);
    if (azValues.size > 0) {
      // (a per-azimuth row's azimuth and one of its values (1000 or more: past any azimuth), within 25 uu, either way
      // round; a table's rows at distinct azimuths)
      const azOf = (i: number): number | undefined => {
        const hit = (az: number, v: number): boolean => v >= 1000 && (azValues.get(Math.round(az * 100)) ?? []).some((w) => Math.abs(w - v) <= 25);
        return hit(value(i), value(i + 1)) ? value(i) : hit(value(i + 1), value(i)) ? value(i + 1) : undefined;
      };
      const azPair = once((i) => i + 1 < n.length && azOf(i) !== undefined);
      report("(az, value) pairs", longestRun(text, n, azPair, { key: (i) => String(azOf(i)) }), 3);
      // (a piece's percentile down its rows, a value every `stride`: within 25 uu, or an 80th of the value below 2000,
      // varying by 50 or more, as a near-constant run meets some column anywhere)
      const column = (i: number, s: number): boolean => {
        if (i + 2 * s >= n.length) return false;
        const [a, b, c] = [value(i), value(i + s), value(i + 2 * s)];
        const low = Math.min(a, b, c);
        return low >= 300 && Math.max(a, b, c) - low >= 50 && columns.near(a, b, c, Math.min(25, low / 80));
      };
      report("per-azimuth columns", longestRun(text, n, column), 2);
    }
    // (a downsampled texture's row or column, a value every `stride`: TEXTURE_WINDOW values along one place of the
    // textures' streams, 0 to 1 to 3 decimals or more (as stored or decoded) or 8-bit levels 2 to 253, bending somewhere;
    // RV-157)
    // (numbers k to l written as a list: only commas, spaces and brackets between them)
    const listed = (k: number, l: number): boolean => {
      for (let j = k; j < l; j++) {
        if (!/^[\s,[\]]*$/.test(text.slice(n[j]?.end ?? 0, n[j + 1]?.at ?? 0))) return false;
      }
      return true;
    };
    const textureRow = (i: number, s: number): boolean =>
      TEXTURE_FORMS.some((form) => {
        // (a coarse form's rows written row by row, channels interleaved at most four: wider strides pick code's
        // integers apart; and as a list, data: small integers run through code's expressions everywhere)
        if (form.wiggle === true && s > 4) return false;
        if (i + (form.window - 1) * s >= n.length) return false;
        if (form.wiggle === true && !listed(i, i + (form.window - 1) * s)) return false;
        const m = Array.from({ length: form.window }, (_, j) => n[i + j * s]);
        const w = m.map((x) => (x ? form.value(x) : null));
        if (w.some((x) => x === null)) return false;
        // (levels touching black or white: as risky, so rows and four channels at most)
        if (!form.decimals && s > 4 && (w as number[]).some((x) => x * 255 < 2 || x * 255 > 253)) return false;
        return textureWindow(w as number[], form, form.decimals ? tolerance(...m) : form.tolerance, Math.min(...m.map((x) => x?.written ?? 0)));
      });
    if (textureStreams.length > 0) {
      const run = longestRun(text, n, textureRow);
      report("texture rows", { ...run, at: `${run.at} [${textureMatch}]` }, 1);
      // (bytes written as hex or base64 strings: their levels, RV-183)
      for (const bytes of stringBytes(text)) {
        const levels = TEXTURE_FORMS[1];
        for (let s = 1; s <= 4 && levels; s++) {
          for (let i = 0; i + (levels.window - 1) * s < bytes.length; i++) {
            const w = Array.from({ length: levels.window }, (_, j) => (bytes[i + j * s] ?? 0) / 255);
            if (textureWindow(w, levels, levels.tolerance, 0)) {
              found.push(`texture rows in a string (every ${String(s)}): ${bytes.slice(i, i + 8).join(", ")}`);
              s = 5;
              break;
            }
          }
        }
      }
    }
    if (rzValues.length > 0) {
      // (the tables and profiles carry a radius of 11k or more: a pair 2000 or more out, not the small ones the 25 uu
      // tolerance would find among indices; any adjacent pair, 4 of any 8, so a table's azimuth column between its
      // rows' pairs doesn't hide it)
      const hits = n.map((a, i) => {
        const [x, y] = [Math.abs(a.value), value(i + 1)];
        return i + 1 < n.length && traced(x, y) && Math.max(x, y) >= 2000 && rz.near(x, y, 25);
      });
      for (let i = 0; i < hits.length; i++) {
        const window = hits.slice(i, i + 8).filter(Boolean).length;
        if (window >= 4) {
          found.push(`(r, z) statistics (${String(window)} of 8): ${text.slice(n[i]?.at ?? 0, (n[i]?.at ?? 0) + 80).replace(/\s+/g, " ")}`);
          break;
        }
      }
    }
    return found;
  }

  it("catches the game's data in the forms it might take (controls built here from the local data: RV-114, RV-131, RV-138, RV-139)", () => {
    const obj = (name: string): { v: number[][]; vt: number[][] } => {
      const lines = readFileSync(OBJS.find((p) => p.endsWith(`/${name}.obj`)) ?? "", "utf8").split("\n");
      return {
        v: lines.filter((l) => l.startsWith("v ")).map((l) => l.split(/\s+/).slice(1, 4).map(Number)),
        vt: lines.filter((l) => l.startsWith("vt ")).map((l) => l.split(/\s+/).slice(1, 3).map(Number)),
      };
    };
    const glass = obj("Goal_STD_Glass");
    const v = glass.v.slice(100, 108);
    const vt = glass.vt.slice(100, 108);
    const f2 = (x: number): string => x.toFixed(2);
    const xyz = ([x = 0, y = 0, z = 0]: readonly number[]): string => `${f2(x)}, ${f2(y)}, ${f2(z)}`;
    const uvAt = (k: number, c: number, places = 4): string => (vt[k]?.[c] ?? 0).toFixed(places);
    // (Field_CenterVent's (x, y) pairs, all under 300 uu: caught at 02cf5c4, RV-139)
    const vent = obj("Field_CenterVent").v.filter((q) => {
      const a = q.map(Math.abs);
      return Math.max(...a) < 300 && Math.max(...a) >= 100 && Math.min(a[0] ?? 0, a[1] ?? 0) >= 10;
    });
    // (UVs with a negative component, every 7th of a mesh's (out of its order, so only the pairs' check can see them):
    // RV-167b; V values whose 4 places end in a zero: RV-167a)
    const allUvs = OBJS.flatMap((path) => obj(path.replace(/^.*\//, "").replace(/\.obj$/, "")).vt);
    const sparse = allUvs.filter((_, k) => k % 7 === 0);
    const negative = sparse.filter((q) => Math.min(q[0] ?? 0, q[1] ?? 0) <= -0.05 && Math.abs((q[0] ?? 0) - (q[1] ?? 0)) > 0.01).slice(0, 8);
    expect(negative.length).toBe(8);
    // (V values 0.1 to 1 in exponent form, their mantissa to 3 places: 4 decimal places in all, RV-167c)
    const exponents = [...new Set(sparse.map((q) => (q[1] ?? 0).toFixed(4)))]
      .map(Number)
      .filter((x) => x >= 0.1 && x < 1)
      .slice(0, 8);
    expect(exponents.length).toBe(8);
    const zeros = OBJS.flatMap((path) => obj(path.replace(/^.*\//, "").replace(/\.obj$/, "")).vt.map((q) => q[1] ?? 0))
      .filter((x) => Math.abs(x) >= 0.05 && x.toFixed(4).endsWith("0") && !x.toFixed(4).endsWith("00"))
      .slice(0, 8);
    expect(zeros.length).toBe(8);
    // (a vertex record of 9, 12 and 16 floats: its position, then the rest: RV-167d)
    const record = (extra: number): string =>
      `[${v.map((p) => `${xyz(p)}, ${Array.from({ length: extra }, (_, k) => (k % 3 === 2 ? "1" : "0")).join(", ")}`).join(", ")}]`;
    // (a downsampled texture's row, the first 8 values of its streams varying by 0.1 and stepping by 0.005 or more:
    // RV-157)
    const textureRow = ((): number[] => {
      for (let k = 0; k + 8 < textureStreams.length; k++) {
        const w = Array.from(textureStreams.subarray(k, k + 8));
        if (w.some(Number.isNaN)) continue;
        // (off black and white, each step two levels or more, turning: a plain picture's row, not a ramp)
        const turns = w.some((x, j) => j >= 2 && Math.abs((w[j - 2] ?? 0) - 2 * (w[j - 1] ?? 0) + x) >= 0.03);
        if (turns && Math.max(...w) - Math.min(...w) >= 0.1 && w.every((x, j) => x > 0.01 && x < 0.99 && (j === 0 || Math.abs(x - (w[j - 1] ?? 0)) >= 0.008)))
          return w;
      }
      return [];
    })();
    expect(textureRow.length).toBe(8);
    const controls: [string, string][] = [
      ["vertices as Vector3s", v.map((p) => `new Vector3(${xyz(p)})`).join(", ")],
      ["vertices in records of 9", record(6)],
      ["vertices in records of 12", record(9)],
      ["vertices in records of 16", record(13)],
      [
        "the vent's (x, y) pairs as integers",
        `[${vent
          .slice(0, 8)
          .map(([x = 0, y = 0]) => `[${String(Math.round(x))}, ${String(Math.round(y))}]`)
          .join(", ")}]`,
      ],
      ["UV pairs with a negative component", `[${negative.map(([a = 0, b = 0]) => `${a.toFixed(3)}, ${b.toFixed(3)}`).join(", ")}]`],
      ["UV values with a trailing zero", `[${zeros.map((x) => x.toFixed(4)).join(", ")}]`],
      ["UV values in exponent form", `[${exponents.map((x) => x.toExponential(3)).join(", ")}]`],
      ["a texture's row to 3 decimals", `[${textureRow.map((x) => x.toFixed(3)).join(", ")}]`],
      ["a texture's row as 8-bit levels", `[${textureRow.map((x) => String(Math.round(x * 255))).join(", ")}]`],
      ["a texture's row interleaved", `[${textureRow.map((x) => `${x.toFixed(4)}, 0.5, 1`).join(", ")}]`],
      ["vertices' (y, x) pairs", v.map(([x = 0, y = 0]) => `[${y.toFixed(1)}, ${x.toFixed(1)}]`).join(", ")],
      ["vertices as [x, y, z, 1]", `[${v.map((p) => `${xyz(p)}, 1`).join(", ")}]`],
      ["vertices with normals", `[${v.map((p) => `${xyz(p)}, 0, 0, 1`).join(", ")}]`],
      ["vertices with their UVs", `[${v.map((p, k) => `${xyz(p)}, ${uvAt(k, 0)}, ${uvAt(k, 1)}`).join(", ")}]`],
      ["vertices as {i, x, y, z}", v.map(([x = 0, y = 0, z = 0], i) => `{ i: ${String(i)}, x: ${f2(x)}, y: ${f2(y)}, z: ${f2(z)} }`).join(", ")],
      ["vertices rounded", `[${v.map((p) => p.map(Math.round).join(", ")).join(", ")}]`],
      ["vertices with separators", `[${v.map((p) => p.map((c) => f2(c).replace(/^(-?\d)(\d{3})/, "$1_$2")).join(", ")).join(", ")}]`],
      [
        "the vent's (x, y) pairs",
        `[${vent
          .slice(0, 8)
          .map(([x = 0, y = 0]) => `[${f2(x)}, ${f2(y)}]`)
          .join(", ")}]`,
      ],
      ["a UV row with leading dots", vt.map((_, k) => uvAt(k, 1).replace(/^0/, "")).join(", ")],
      ["UV pairs", `[${vt.map((_, k) => `${uvAt(k, 0)}, ${uvAt(k, 1)}`).join(", ")}]`],
      ["UV pairs to 3 decimals", `[${vt.map((_, k) => `${uvAt(k, 0, 3)}, ${uvAt(k, 1, 3)}`).join(", ")}]`],
      ["a UV row to 3 decimals", `[${vt.map((_, k) => uvAt(k, 1, 3)).join(", ")}]`],
      ["UVs as [x, v]", `[${vt.map((_, k) => `[${f2(Math.abs(v[k]?.[0] ?? 0))}, ${uvAt(k, 1)}]`).join(", ")}]`],
      ["UVs as {at, v}", vt.map((_, k) => `{ at: ${String(k * 64)}, v: ${uvAt(k, 1)} }`).join(", ")],
    ];
    // The textures' named rows (the reference's picks: the logo's, its alpha as a mask, a 12 px row, a low-contrast one;
    // RV-182, RV-183), each in the forms a row might be written in, and each found as a texture's (not by another check
    // by chance: a low-contrast row's 4 decimals meet the UVs)
    const textureControls: [string, string][] = [];
    const picks = JSON.parse(readFileSync(join(REFERENCE, "texture_controls.json"), "utf8")) as Record<
      "logo" | "mask" | "lightmap" | "twelve" | "low" | "ties",
      number[] | null
    >;
    const { logo, mask, lightmap, twelve, low, ties } = picks;
    expect([logo, mask, lightmap, twelve, low, ties].every((row) => row !== null)).toBe(true);
    if (logo && mask && lightmap && twelve && low && ties) {
      const row = logo.slice(0, 16);
      const start = logo[16] ?? 0;
      const [eight, window] = [row.slice(start, start + 8), row.slice(start, start + 12)];
      const levels = (w: readonly number[]): number[] => w.map((x) => Math.round(x * 255));
      const bytes = Uint8Array.from(levels(row));
      const list = (w: readonly (number | string)[]): string => `[${w.map(String).join(", ")}]`;
      textureControls.push(
        ["the logo's row to 3 decimals", list(eight.map((x) => x.toFixed(3)))],
        ["the logo's row as 8-bit levels", list(levels(eight))],
        ["the logo's row reversed", list(levels(eight).reverse())],
        ["the logo's row reversed to 3 decimals", list(eight.map((x) => x.toFixed(3)).reverse())],
        ["the logo's row as hex literals", list(levels(eight).map((x) => `0x${x.toString(16).padStart(2, "0")}`))],
        ["the logo's row as a hex string", `"${Buffer.from(bytes).toString("hex")}"`],
        ["the logo's row as a base64 string", `"${Buffer.from(bytes).toString("base64")}"`],
        ["the logo's row as percent", list(eight.map((x) => Math.round(x * 100)))],
        ["the logo's row as 4-bit levels", list(window.map((x) => Math.round(x * 15)))],
        ["the logo's row as 2-decimal fractions", list(eight.map((x) => x.toFixed(2)))],
        ["the logo's row as its unrounded means", list(eight.map((x) => (x * 255).toFixed(1)))],
        ["a 12 px row to 3 decimals", list(twelve.slice(0, 8).map((x) => x.toFixed(3)))],
        ["a lightmap's row as 8-bit levels", list(levels(lightmap.slice(0, 8)))],
        ["a mask's row touching 0 as levels", list(levels(mask.slice(0, 8)))],
        ["a low-contrast row to 4 decimals", list(low.slice(0, 8).map((x) => x.toFixed(4)))],
        // (box means at exact .5 levels, rounded half up: 0.5/255 off, and past it by a float's step where the stored
        // value lies just below the tie; found only with the tie factor, RV-213, RV-228)
        ["a row of .5 box means rounded half up", list(ties.slice(0, 8).map((x) => Math.floor(x * 255 + 0.5 + 1e-4)))],
      );
    }
    // The surroundings' meshes (index.json: each one's place in the reference)
    const index = JSON.parse(readFileSync(join(REFERENCE, "index.json"), "utf8")) as Record<string, { vertices: [number, number]; uvs: [number, number] }>;
    for (const name of ["City_OOB_A", "Loft_Quad_01", "Statue_SM", "Stadium_Top"]) {
      const at = index[name];
      expect(at, name).toBeDefined();
      const [v0 = 0, vn = 0] = at?.vertices ?? [];
      const [u0 = 0, un = 0] = at?.uvs ?? [];
      // (from 1000 in, as the static session's battery, or the start of a small mesh; the vertices 300 uu or more out)
      const far: number[][] = [];
      for (let k = vn > 1008 ? v0 + 1000 : v0; k < v0 + vn && far.length < 8; k++) {
        const p = [reference[3 * k] ?? 0, reference[3 * k + 1] ?? 0, reference[3 * k + 2] ?? 0];
        if (Math.max(...p) >= 300) far.push(p);
      }
      if (far.length === 8) controls.push([`${name}'s vertices as stored`, `[${far.map(xyz).join(", ")}]`]);
      const s = un > 1008 ? u0 + 1000 : u0;
      // (its V row from there, the first 8 that vary and carry 3 decimals or more at 4: a constant row is one number,
      // City_OOB_A's tiling halves and eighths none)
      const rowAt = (from: number): number[] => Array.from({ length: 8 }, (_, k) => referenceUv[2 * (from + k) + 1] ?? 0);
      const plain = (x: number): boolean =>
        Math.abs(x) < 0.05 ||
        (x.toFixed(4).replace(/0+$/, "").split(".")[1]?.length !== undefined && (x.toFixed(4).replace(/0+$/, "").split(".")[1]?.length ?? 0) < 3);
      let from = s;
      while (from + 8 < u0 + un && rowAt(from).some((x, k, r) => plain(x) || (k > 0 && Math.abs(x - (r[k - 1] ?? 0)) < 0.01))) from++;
      controls.push([
        `${name}'s UV row`,
        `[${rowAt(from)
          .map((x) => x.toFixed(4))
          .join(", ")}]`,
      ]);
      const pairs = Array.from({ length: 8 }, (_, k) => `${(referenceUv[2 * (s + k)] ?? 0).toFixed(4)}, ${(referenceUv[2 * (s + k) + 1] ?? 0).toFixed(4)}`);
      controls.push([`${name}'s UV pairs`, `[${pairs.join(", ")}]`]);
    }
    // The per-azimuth statistics and the crowd's tiers
    const outline = JSON.parse(readFileSync(join(SUR1, "outline_az.json"), "utf8")) as Record<string, { az: number; r: number[]; z: number[] }[]>;
    for (const piece of ["Stadium_Top", "Stadium_Base_Seats", "Stadium_Glass", "Stadium_Supports"]) {
      const top = outline[piece] ?? [];
      expect(top.length, piece).toBeGreaterThan(8);
      controls.push(
        [
          `${piece}: a per-azimuth table`,
          top.map((row) => `[${String(row.az)}, ${String(row.r[0])}, ${String(row.r[2])}, ${String(row.z[0])}, ${String(row.z[2])}]`).join(", "),
        ],
        [`${piece}: [az, r] pairs`, top.map((row) => `[${String(row.az)}, ${String(row.r[1])}]`).join(", ")],
        [`${piece}: its r50 column`, `[${top.map((row) => String(row.r[1])).join(", ")}]`],
        [`${piece}: its z99 column`, `[${top.map((row) => String(row.z[2])).join(", ")}]`],
        [`${piece}: {az, r, z} rows`, top.map((row) => `{ az: ${String(row.az)}, r: ${String(row.r[1])}, z: ${String(row.z[1])} }`).join(", ")],
      );
    }
    const geometry = JSON.parse(readFileSync(join(SUR1, "surroundings_geometry.json"), "utf8")) as {
      crowd_tiers: Record<string, { sections: { r_first_row: number; z_first_row: number; r_last_row: number; z_last_row: number }[] }>;
    };
    for (const [tier, t] of Object.entries(geometry.crowd_tiers)) {
      if (t.sections.length < 2) continue;
      controls.push([
        `crowd tier ${tier}'s rows`,
        t.sections.map((s) => `[${s.r_first_row.toFixed(0)}, ${s.z_first_row.toFixed(0)}, ${s.r_last_row.toFixed(0)}, ${s.z_last_row.toFixed(0)}]`).join(", "),
      ]);
    }
    const missed = [
      ...controls.filter(([, text]) => findings(text).length === 0),
      ...textureControls.filter(([, text]) => !findings(text).some((f) => f.startsWith("texture rows"))),
    ].map(([what]) => what);
    expect(missed).toEqual([]);
  }, 60000);

  /** Every check on one text, `name` for the failures */
  function check(name: string, text: string): void {
    expect(findings(text), name).toEqual([]);
  }

  it.each(modules().map((p) => p.slice(SRC.length)))(
    "%s: no run of the game's vertices, UVs or traced points",
    (path) => {
      check(path, stripComments(readFileSync(join(SRC, path), "utf8")));
    },
    60000,
  );

  it.each(
    shippedImports()
      .filter((p) => kind(p) === "text")
      .map((p) => p.slice(ROOT.length)),
  )(
    "%s (imported): no run of the game's vertices, UVs or traced points",
    (path) => {
      const text = readFileSync(join(ROOT, path), "utf8");
      check(path, text);
    },
    60000,
  );

  it("our generated arena's collision meshes are none of the game's cooked ones (RV-167f)", () => {
    const game = new Set(files(ARENA_LOCAL, (n) => n.endsWith(".cmf")).map((p) => readFileSync(p).toString("base64")));
    for (const p of globFiles(join(ARENA, "**/*.cmf"))) expect(game.has(readFileSync(p).toString("base64")), p.slice(ROOT.length)).toBe(false);
  });

  // (every text file it ships: our chunks, its page and its styles, any JSON or SVG, anything copied from public/
  // (RV-140, RV-167f); three.js's chunk is the library's, its lookup tables meeting the statistics by chance: told by
  // its modules, RV-225)
  const built = existsSync(CHUNK_MODULES) ? (JSON.parse(readFileSync(CHUNK_MODULES, "utf8")) as Record<string, string[]>) : {};
  const library = libraryFiles(built);
  const bundle = files(DIST, (n) => kind(n) === "text").filter((p) => !library.has(relative(DIST, p).split("\\").join("/")));
  it.skipIf(!existsSync(DIST))("the build recorded every file it wrote (a stale record would hide a chunk: RV-225)", () => {
    const written = files(DIST, (n) => n.endsWith(".js")).map((p) => relative(DIST, p).split("\\").join("/"));
    expect(written.filter((p) => !(p in built))).toEqual([]);
    expect(library.size, "three.js's chunk").toBe(1);
  });
  it.each(files(PUBLIC, (n) => kind(n) === "text").map((p) => p.slice(ROOT.length)))(
    "%s (public/, shipped as it is): no run of the game's data (RV-225)",
    (path) => {
      check(path, readFileSync(join(ROOT, path), "utf8"));
    },
  );
  it.skipIf(bundle.length === 0)(
    "the built bundle (dist, as it ships: its shaders' comments too)",
    () => {
      for (const path of bundle) check(path.slice(ROOT.length), readFileSync(path, "utf8"));
    },
    300000,
  );
});

/** The static session's local references for the HUD's own drawings (RV-293; out/bsim/assets_local/hud, git-ignored):
 *  the game's Ball Arrow mesh and its lathe profile, and the boost meter's four bitmaps. What ships draws both from
 *  named measures (HUD-17, HUD-18): none of these in any form */
const HUD_REFS = join(ROOT, "out/bsim/assets_local/hud");
const ARROW_MESH = join(HUD_REFS, "ball_arrow/ball_arrow_mesh.json");
const METER_PNGS = ["Background", "Fill", "FillTintablePortion", "Glow"].map((n) => join(HUD_REFS, `boost_meter/BoostMeter_${n}.png`));
/** The profile's numbers no named measure has (the README's list): three among a dozen numbers in a row is a copy */
const ARROW_PROFILE = [-6.813, -6.733, -6.687, 1.184, 1.88, 2.606, 4.144, 4.307, 0.0576, 0.0915, 0.1223, 0.4583, 0.5454, 0.5708, 0.9775];
/** A run this long of the mesh's arrays, in their order, is a copy of them */
const MESH_RUN = 8;
/** The profile's numbers within this many numbers of each other */
const PROFILE_WINDOW = 12;
/** A bitmap's row as a copy would write it: this many values */
const ROW_WINDOW = 8;

/** A PNG's pixels as RGBA (8-bit, not interlaced: gray, RGB, gray and alpha, RGBA); null if it isn't one of those */
function decodePngBytes(b: Buffer): { width: number; height: number; rgba: Uint8Array } | null {
  if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47) return null;
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  while (at + 8 <= b.length) {
    const length = b.readUInt32BE(at);
    const type = b.toString("ascii", at + 4, at + 8);
    const chunk = b.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[chunk[9] ?? -1] ?? 0;
      if (chunk[8] !== 8 || channels === 0 || chunk[12] !== 0) return null;
    }
    if (type === "IDAT") data.push(chunk);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] ?? 0;
      const a = x >= channels ? (px[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (px[(y - 1) * stride + x] ?? 0) : 0;
      const c = x >= channels && y > 0 ? (px[(y - 1) * stride + x - channels] ?? 0) : 0;
      const paeth = (): number => {
        const p = a + up - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - up), Math.abs(p - c)];
        return pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      };
      const predicted = filter === 1 ? a : filter === 2 ? up : filter === 3 ? Math.floor((a + up) / 2) : filter === 4 ? paeth() : 0;
      px[y * stride + x] = (v + predicted) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const q = px.subarray(i * channels, i * channels + channels);
    const [r, g, bl, al] =
      channels === 1
        ? [q[0], q[0], q[0], 255]
        : channels === 2
          ? [q[0], q[0], q[0], q[1]]
          : channels === 3
            ? [q[0], q[1], q[2], 255]
            : [q[0], q[1], q[2], q[3]];
    rgba.set([r ?? 0, g ?? 0, bl ?? 0, al ?? 0], i * 4);
  }
  return { width, height, rgba };
}

/** A reference PNG's pixels */
function decodePng(path: string): { width: number; height: number; rgba: Uint8Array } {
  const decoded = decodePngBytes(readFileSync(path));
  if (!decoded) throw new Error(`${path}: not an 8-bit PNG`);
  return decoded;
}

/** An RGBA image as a PNG (filter 0): the controls' re-encoded copies */
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "ascii");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), body])) >>> 0, 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A window's key (exact values, as integers) */
const windowKey = (w: readonly number[]): string => w.join(",");

/** An image's rows and columns (alpha, luminance; at 1, 1/2 and 1/4 its size, box means), every wiggling window of
 *  ROW_WINDOW as 8-bit levels and as thousandths, into the sets */
function imageWindows(
  image: { width: number; height: number; rgba: Uint8Array },
  levels: Set<string>,
  thousandths: Set<string> | null,
  scales = [1, 2, 4],
): void {
  const { width, height, rgba } = image;
  for (const channel of ["alpha", "luma"] as const) {
    const at = (x: number, y: number): number => {
      const i = (y * width + x) * 4;
      return channel === "alpha" ? (rgba[i + 3] ?? 0) / 255 : (0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0)) / 255;
    };
    for (const scale of scales) {
      const w = Math.floor(width / scale);
      const h = Math.floor(height / scale);
      const cell = (x: number, y: number): number => {
        let sum = 0;
        for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) sum += at(x * scale + i, y * scale + j);
        return sum / (scale * scale);
      };
      const lines: number[][] = [];
      for (let y = 0; y < h; y++) lines.push(Array.from({ length: w }, (_, x) => cell(x, y)));
      for (let x = 0; x < w; x++) lines.push(Array.from({ length: h }, (_, y) => cell(x, y)));
      for (const line of lines) {
        for (let k = 0; k + ROW_WINDOW <= line.length; k++) {
          const win = line.slice(k, k + ROW_WINDOW);
          const asLevels = win.map((v) => Math.round(v * 255));
          if (wiggles(asLevels)) levels.add(windowKey(asLevels));
          if (thousandths) {
            const asThousandths = win.map((v) => Math.round(v * 1000));
            if (wiggles(asThousandths)) thousandths.add(windowKey(asThousandths));
          }
        }
      }
    }
  }
}

/** A byte window's hash (FNV-1a, two of them, into 53 bits) */
function windowHash(b: Uint8Array, at: number, n: number): number {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = at; i < at + n; i++) {
    const v = b[i] ?? 0;
    h1 = Math.imul(h1 ^ v, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (v + 0x9e), 0x85ebca6b) >>> 0;
  }
  return h1 * 0x200000 + (h2 & 0x1fffff);
}
/** A stretch of a bitmap's pixels as a copy would hold it: this many bytes */
const BYTE_WINDOW = 32;

/** float32 and float16 values a byte string holds (little-endian, every alignment) */
function floatsIn(bytes: Uint8Array): number[][] {
  const out: number[][] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const half = (h: number): number => {
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const f = h & 0x3ff;
    return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? NaN : s * 2 ** (e - 15) * (1 + f / 1024);
  };
  for (let align = 0; align < 4; align++) {
    const f32: number[] = [];
    for (let i = align; i + 4 <= bytes.byteLength; i += 4) f32.push(view.getFloat32(i, true));
    out.push(f32);
  }
  for (let align = 0; align < 2; align++) {
    const f16: number[] = [];
    for (let i = align; i + 2 <= bytes.byteLength; i += 2) f16.push(half(view.getUint16(i, true)));
    out.push(f16);
  }
  return out;
}

/** The references, read once and only when a test asks (a checkout without them: the block skipped, nothing read at
 *  collection: RV-294) */
interface HudRefs {
  readonly mesh: { positions: number[][]; normals: number[][]; uv0: number[][] };
  /** The mesh's arrays as a copy would lay them out: flat, an axis at a time, or as vertex records */
  readonly sequences: number[][];
  readonly pngs: Buffer[];
  readonly images: { width: number; height: number; rgba: Uint8Array }[];
  readonly windows: { levels: Set<string>; thousandths: Set<string> };
  /** Every BYTE_WINDOW stretch of the bitmaps' pixels as RGBA, as RGB and as alpha alone, from any pixel of a row (a
   *  crop's rows), by hash: where it is, to check */
  readonly bytes: Map<number, { readonly from: Uint8Array; readonly at: number }>;
}
let hudRefs: HudRefs | null = null;
function refs(): HudRefs {
  if (hudRefs) return hudRefs;
  const mesh = JSON.parse(readFileSync(ARROW_MESH, "utf8")) as HudRefs["mesh"];
  const records = (parts: readonly (readonly number[][])[]): number[] => mesh.positions.flatMap((_, i) => parts.flatMap((part) => part[i] ?? []));
  const axis = (part: readonly number[][], k: number): number[] => part.map((v) => v[k] ?? 0);
  const sequences = [
    mesh.positions.flat(),
    mesh.uv0.flat(),
    axis(mesh.positions, 0),
    axis(mesh.positions, 1),
    axis(mesh.positions, 2),
    axis(mesh.uv0, 0),
    axis(mesh.uv0, 1),
    records([mesh.positions, mesh.uv0]),
    records([mesh.positions, mesh.normals]),
    records([mesh.positions, mesh.normals, mesh.uv0]),
  ];
  const pngs = METER_PNGS.map((p) => readFileSync(p));
  const images = METER_PNGS.map((p) => decodePng(p));
  const levels = new Set<string>();
  const thousandths = new Set<string>();
  const bytes = new Map<number, { from: Uint8Array; at: number }>();
  for (const image of images) {
    imageWindows(image, levels, thousandths);
    const { width, height, rgba } = image;
    const rgb = new Uint8Array(width * height * 3);
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
      alpha[i] = rgba[i * 4 + 3] ?? 0;
    }
    for (const [plane, size] of [
      [rgba, 4],
      [rgb, 3],
      [alpha, 1],
    ] as const) {
      const stride = width * size;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x + BYTE_WINDOW <= stride; x += size) {
          const at = y * stride + x;
          if (new Set(plane.subarray(at, at + BYTE_WINDOW)).size < 8) continue;
          bytes.set(windowHash(plane, at, BYTE_WINDOW), { from: plane, at });
        }
      }
    }
  }
  hudRefs = { mesh, sequences, pngs, images, windows: { levels, thousandths }, bytes };
  return hudRefs;
}

/** Whether `values` (with their tolerances) run along one of the mesh's arrays, in order: values most of which are no
 *  round numbers (zeros, ones and tenths line up anywhere) */
function runsAlong(values: readonly number[], tolerance: (k: number) => number): boolean {
  if (values.filter((v) => Math.abs(v) >= 0.05 && Math.abs(v * 10 - Math.round(v * 10)) > 0.01).length < 5) return false;
  for (const seq of refs().sequences) {
    for (let j = 0; j + values.length <= seq.length; j++) {
      if (values.every((v, k) => Math.abs(v - (seq[j + k] ?? NaN)) <= tolerance(k))) return true;
    }
  }
  return false;
}

/** An image's rows that are a reference bitmap's, as decoded (a crop, a downscale, a re-encoding: RV-302) */
function findImageRows(image: { width: number; height: number; rgba: Uint8Array }): string | null {
  const levels = new Set<string>();
  imageWindows(image, levels, null, [1]);
  const { windows } = refs();
  let hits = 0;
  for (const key of levels) if (windows.levels.has(key)) hits++;
  return hits >= 3 ? `an image with ${String(hits)} of a boost meter bitmap's rows` : null;
}

/** What in a text is the game's: the profile's numbers, a run of the mesh's arrays, a bitmap's row; bytes in its
 *  strings and data URIs; null when nothing is */
function findHudText(text: string): string | null {
  const { windows } = refs();
  const n = numbers(text);
  // (the profile: three of its numbers among PROFILE_WINDOW in a row, written to 3 places or more, each at its
  // written precision)
  const profileHit = n.map((x) =>
    x.written < 3 ? null : (ARROW_PROFILE.find((p) => Math.abs(x.value - p) <= 0.5 * 10 ** -Math.min(x.written, 4) + 1e-9) ?? null),
  );
  for (let i = 0; i < n.length; i++) {
    const near = new Set(profileHit.slice(i, i + PROFILE_WINDOW).filter((p) => p !== null));
    if (near.size >= 3) return `the arrow's profile (${[...near].join(", ")}) at ${text.slice(n[i]?.at ?? 0, (n[i]?.at ?? 0) + 80).replace(/\s+/g, " ")}`;
  }
  // (the mesh: MESH_RUN of its arrays' values in their order, 3 places or more, each at its written precision)
  for (let i = 0; i + MESH_RUN <= n.length; i++) {
    const w = n.slice(i, i + MESH_RUN);
    if (w.some((x) => x.written < 3) || w.every((x) => x.value === w[0]?.value)) continue;
    if (
      runsAlong(
        w.map((x) => x.value),
        (k) => 0.5 * 10 ** -(w[k]?.written ?? 0) + 1e-6,
      )
    )
      return `a run of the arrow mesh's arrays at ${text.slice(w[0]?.at ?? 0, (w[0]?.at ?? 0) + 80).replace(/\s+/g, " ")}`;
  }
  // (a bitmap's row: 8-bit levels, or thousandths written to 3 places)
  for (let i = 0; i + ROW_WINDOW <= n.length; i++) {
    const w = n.slice(i, i + ROW_WINDOW);
    if (w.every((x) => x.integer && x.value >= 0 && x.value <= 255) && windows.levels.has(windowKey(w.map((x) => x.value))))
      return `a boost meter bitmap's row (levels) at ${String(w[0]?.at)}`;
    if (
      w.every((x) => !x.integer && x.written === 3 && x.value >= 0 && x.value <= 1) &&
      windows.thousandths.has(windowKey(w.map((x) => Math.round(x.value * 1000))))
    ) {
      return `a boost meter bitmap's row (thousandths) at ${String(w[0]?.at)}`;
    }
  }
  // (bytes written as base64 or hex strings, data URIs too: an image in one is decoded)
  for (const m of text.matchAll(/data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)/g)) {
    const bytes = Buffer.from(m[2] ?? "", "base64");
    if ((m[1] ?? "").startsWith("image/")) {
      const image = decodePngBytes(bytes);
      if (!image) return `an image this guard can't read (${m[1] ?? ""})`;
      const rows = findImageRows(image);
      if (rows) return rows;
    }
    const found = findHudBytes(bytes);
    if (found) return found;
  }
  for (const bytes of stringBytes(text)) {
    const found = findHudBytes(bytes);
    if (found) return found;
  }
  return null;
}

/** What in a byte string is the game's: a bitmap's file or a stretch of its pixels (RGBA, RGB, alpha), the profile's
 *  numbers or a run of the mesh's arrays as floats; null when nothing is */
function findHudBytes(bytes: Uint8Array): string | null {
  const { pngs, bytes: pixelWindows } = refs();
  const b = Buffer.from(bytes);
  for (const [k, png] of pngs.entries()) {
    if (b.includes(png.subarray(0, 64)) || (png.length > 512 && b.includes(png.subarray(256, 512)))) return `boost meter bitmap ${String(k)}'s file`;
  }
  for (let at = 0; at + BYTE_WINDOW <= b.length; at++) {
    const ref = pixelWindows.get(windowHash(b, at, BYTE_WINDOW));
    if (ref && Buffer.compare(b.subarray(at, at + BYTE_WINDOW), Buffer.from(ref.from.subarray(ref.at, ref.at + BYTE_WINDOW))) === 0)
      return `a boost meter bitmap's pixels at byte ${String(at)}`;
  }
  // (float arrays: five of the profile's numbers among 16, a run of the mesh's arrays; each to its format's precision:
  // float32's against the references' 5 places, float16's 11 bits)
  for (const [k, values] of floatsIn(bytes).entries()) {
    const tolerance = (v: number): number => (k < 4 ? 2e-5 + 1e-5 * Math.abs(v) : 1e-4 + 1e-3 * Math.abs(v));
    for (let i = 0; i < values.length; i++) {
      const near = new Set(values.slice(i, i + 16).flatMap((v) => ARROW_PROFILE.filter((p) => Math.abs(v - p) <= tolerance(p) + 5e-4)));
      if (near.size >= 5) return `the arrow's profile as floats (${[...near].join(", ")})`;
    }
    for (let i = 0; i + MESH_RUN <= values.length; i++) {
      const w = values.slice(i, i + MESH_RUN);
      if (!w.every((v) => Number.isFinite(v) && Math.abs(v) < 100) || w.every((v) => v === w[0])) continue;
      if (runsAlong(w, (j) => tolerance(w[j] ?? 0))) return "a run of the arrow mesh's arrays as floats";
    }
  }
  return null;
}

/** An image file's kind by its name (PNG decoded; any other kind fails the guard until it can read it) */
const IMAGE = /\.(png|jpe?g|webp|gif|avif|bmp|ktx2|basis)$/i;

describe.skipIf(!existsSync(ARROW_MESH))("against the game's Ball Arrow mesh and boost meter bitmaps (local, RV-293)", () => {
  it("has its local reference", () => {
    for (const path of [ARROW_MESH, ...METER_PNGS]) expect(existsSync(path), path.slice(ROOT.length)).toBe(true);
  });

  it("catches the game's arrow and meter in the forms they might take (controls built here from the local data)", () => {
    const { mesh, pngs, images } = refs();
    const fmt = (v: number, places: number): string => v.toFixed(places);
    // (the profile as a table; the mesh's positions and UVs as arrays; as float32 and float16 bytes)
    expect(findHudText(`const PROFILE = [[-6.813, 0], [-6.733, 1.184], [-6.687, 1.88], [-6.25, 2.25]];`)).toMatch(/profile/);
    expect(
      findHudText(
        `const P = [${mesh.positions
          .slice(200, 204)
          .flat()
          .map((v) => fmt(v, 3))
          .join(", ")}];`,
      ),
    ).toMatch(/mesh/);
    expect(
      findHudText(
        `const UV = [${mesh.uv0
          .slice(200, 206)
          .flat()
          .map((v) => fmt(v, 4))
          .join(", ")}];`,
      ),
    ).toMatch(/mesh/);
    const f32 = Buffer.from(new Float32Array(mesh.positions.slice(200, 206).flat()).buffer);
    expect(findHudText(`const B = "${f32.toString("base64")}";`)).toMatch(/mesh/);
    expect(findHudText(`const B = "${Buffer.from(new Float32Array(ARROW_PROFILE).buffer).toString("hex")}";`)).toMatch(/profile/);
    // (a bitmap as a data URI, its bytes as base64 from past its header)
    expect(findHudText(`url("data:image/png;base64,${(pngs[1] ?? Buffer.alloc(0)).toString("base64")}")`)).toMatch(/file|rows/);
    const piece = (pngs[0] ?? Buffer.alloc(0)).subarray(200, 800).toString("base64");
    expect(findHudText(`const X = "${piece.slice(0, piece.length - (piece.length % 4)).replace(/=+$/, "")}";`)).toMatch(/file|pixels/);
    // (RV-302: its pixels as hex from inside a row; a cropped region's rows as base64; its alpha alone; a crop re-encoded
    // as a PNG of its own)
    const fill = images[1] ?? { width: 0, height: 0, rgba: new Uint8Array(0) };
    const row = (y: number, x0: number, x1: number): Uint8Array => fill.rgba.subarray((y * fill.width + x0) * 4, (y * fill.width + x1) * 4);
    // (a busy spot: its first pixels' bytes and its alpha varied, as a copy worth catching is)
    const alphaAt = (y: number, x: number, n: number): Buffer =>
      Buffer.from(Array.from({ length: n }, (_, i) => fill.rgba[(y * fill.width + x + i) * 4 + 3] ?? 0));
    let spot: [number, number] | null = null;
    for (let y = 0; y < fill.height - 4 && !spot; y++) {
      for (let x = 1; x + 40 < fill.width && !spot; x++) {
        if (new Set(row(y, x, x + 8)).size >= 16 && new Set(alphaAt(y, x, BYTE_WINDOW)).size >= 12) spot = [y, x];
      }
    }
    expect(spot).not.toBeNull();
    const [sy, sx] = spot ?? [0, 0];
    expect(findHudText(`const H = "${Buffer.from(row(sy, sx, sx + 16)).toString("hex")}";`), "pixels as hex").toMatch(/pixels/);
    const crop = Buffer.concat([0, 1, 2, 3].map((j) => Buffer.from(row(sy + j, sx, sx + 40))));
    expect(findHudText(`const C = "${crop.toString("base64")}";`), "a cropped region").toMatch(/pixels/);
    expect(findHudText(`const A = "${alphaAt(sy, sx, 48).toString("base64")}";`), "its alpha alone").toMatch(/pixels/);
    const cw = 64;
    const cropRgba = new Uint8Array(cw * cw * 4);
    const [cy, cx] = [Math.min(sy, fill.height - cw), Math.min(Math.max(0, sx - 16), fill.width - cw)];
    for (let j = 0; j < cw; j++) cropRgba.set(fill.rgba.subarray(((j + cy) * fill.width + cx) * 4, ((j + cy) * fill.width + cx + cw) * 4), j * cw * 4);
    expect(findHudText(`url("data:image/png;base64,${encodePng(cw, cw, cropRgba).toString("base64")}")`), "a crop re-encoded").toMatch(/rows/);
    // (a row of the Fill's alpha, at half its size, as 8-bit levels and as thousandths)
    const half = (x: number, y: number): number => {
      let sum = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) sum += (fill.rgba[((y * 2 + j) * fill.width + x * 2 + i) * 4 + 3] ?? 0) / 255;
      return sum / 4;
    };
    let found: number[] | null = null;
    for (let y = 0; y < fill.width / 2 && !found; y++) {
      const line = Array.from({ length: fill.width / 2 }, (_, x) => half(x, y));
      for (let k = 0; k + ROW_WINDOW <= line.length && !found; k++) {
        const w = line.slice(k, k + ROW_WINDOW).map((v) => Math.round(v * 255));
        if (wiggles(w)) found = line.slice(k, k + ROW_WINDOW);
      }
    }
    expect(found).not.toBeNull();
    expect(findHudText(`const ROW = [${(found ?? []).map((v) => String(Math.round(v * 255))).join(", ")}];`)).toMatch(/row \(levels\)/);
    expect(findHudText(`const ROW = [${(found ?? []).map((v) => fmt(v, 3)).join(", ")}];`)).toMatch(/row \(thousandths\)/);
  }, 120000);

  // (what ships: our modules, the files they import, public/ and the bundle (named at collection, read in the test);
  // the bundle's and public/'s binaries, any image among them decoded)
  const texts = [
    ...modules().map((p) => ({ path: p, strip: true })),
    ...shippedImports()
      .filter((p) => kind(p) === "text")
      .map((p) => ({ path: p, strip: false })),
    ...files(PUBLIC, (n) => kind(n) === "text").map((p) => ({ path: p, strip: false })),
    ...files(DIST, (n) => kind(n) === "text").map((p) => ({ path: p, strip: false })),
  ];
  it.each(texts.map((t) => t.path.slice(ROOT.length)))(
    "%s: none of the arrow's or the meter's data",
    (where) => {
      const t = texts.find((x) => x.path.slice(ROOT.length) === where);
      const text = t ? readFileSync(t.path, "utf8") : "";
      expect(findHudText(t?.strip ? stripComments(text) : text)).toBeNull();
    },
    60000,
  );
  // (onnxruntime's WebAssembly, the bots' policies' runtime: the library's own binary, told by the file it came from as
  // three.js's chunk by its modules; 14 MB of compiled code meeting the bitmap rule by chance. The bots' policies too:
  // their packages' own weights, held to them byte for byte above)
  const recorded = existsSync(CHUNK_MODULES) ? (JSON.parse(readFileSync(CHUNK_MODULES, "utf8")) as Record<string, string[]>) : {};
  const runtime = libraryFiles(recorded, installedPackage("onnxruntime-web", "onnxruntime-web/wasm"));
  it("the binaries that ship: none of it (fonts, the engine, meshes; images decoded)", () => {
    const shipped = files(DIST, (n) => kind(n) !== "text" && kind(n) !== "onnx").filter((p) => !runtime.has(relative(DIST, p).split("\\").join("/")));
    for (const p of [...files(PUBLIC, (n) => kind(n) !== "text"), ...shipped]) {
      const b = readFileSync(p);
      if (IMAGE.test(p)) {
        const image = decodePngBytes(b);
        expect(image, `${p.slice(ROOT.length)}: an image this guard can't read`).not.toBeNull();
        if (image) expect(findImageRows(image), p.slice(ROOT.length)).toBeNull();
      }
      expect(findHudBytes(b), p.slice(ROOT.length)).toBeNull();
    }
  }, 300000);
});
