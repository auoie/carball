import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { NOISE_QUANTILES } from "./themes/stadiumSky";

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

/** three.js's installed package, its real path: where Node resolves "three" from client/ (hoisted, a workspace's, pnpm's
 *  store: RV-240), so a folder of ours named node_modules/three isn't it (RV-261) */
function installedThree(): string {
  let dir = dirname(createRequire(join(SRC, "../package.json")).resolve("three"));
  const named = (d: string): boolean => existsSync(join(d, "package.json")) && (JSON.parse(readFileSync(join(d, "package.json"), "utf8")) as { name?: string }).name === "three";
  while (!named(dir)) {
    if (dirname(dir) === dir) throw new Error("three's package.json not found");
    dir = dirname(dir);
  }
  return realpathSync(dir);
}

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
const TEXT = /\.(json|css|js|mjs|html|txt|glsl|svg|csv|map|webmanifest)$/;
type Kind = "text" | "cmf" | "wasm" | "unknown";
/** cmf: the arena's collision meshes (pinned to our generated ones); wasm: the engine, our build (engine/build-wasm) */
const kind = (path: string): Kind => (TEXT.test(path) ? "text" : path.endsWith(".cmf") ? "cmf" : path.endsWith(".wasm") ? "wasm" : "unknown");

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
    if (m[1] !== undefined) return { value: parseInt(m[1].replace(/_/g, ""), 16) * (m[0].startsWith("-") ? -1 : 1), decimals: 0, written: 0, integer: true, at: m.index, end: m.index + m[0].length };
    const mantissa = m[0].replace(/_/g, "").replace(/^-/, "").replace(/[eE].*$/, "");
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

/** scripts/cage_topology.json: the cage's topology, derived and shipped (its lattice, edges, cells and boundary as
 *  indices into its own nodes) */
const TOPOLOGY = join(ROOT, "scripts/cage_topology.json");
interface Topology {
  params: Record<string, unknown>;
  rows: Record<string, { corner_marks: number[] }>;
  nodes: { q: number[]; a: (string | number)[] }[];
  edges: number[][];
  cells: { nodes: number[]; sides: number }[];
  defects: { cell: number; sides: number; wall_rows: number[] }[];
  boundary: number[][];
}

/** The topology's free numbers, its parameters and its rows' marks: the rest is indices and labels, proven so by the
 *  structural test below, and is left out of the scan (a field read across its cells meets some texture's row) */
function topologyFree(text: string): string {
  const t = JSON.parse(text) as Topology;
  return JSON.stringify({ params: t.params, rows: t.rows });
}

/** Its index arrays, each as "a,b,c" */
function topologyArrays(): Set<string> {
  const t = JSON.parse(readFileSync(TOPOLOGY, "utf8")) as Topology;
  return new Set([...t.nodes.map((n) => n.q), ...t.edges, ...t.cells.map((c) => c.nodes), ...t.defects.map((d) => d.wall_rows), ...t.boundary].map((a) => a.join(",")));
}

/** A text with the cage topology's own index arrays blanked wherever they are (the JSON, the bundle's inlined copy):
 *  indices into its nodes, which the checks would read as coordinates; the rest of the text is checked as any */
function withoutTopology(text: string, arrays: ReadonlySet<string>): string {
  return text.replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, (m) => (arrays.has(m.replace(/[\s[\]]/g, "")) ? " ".repeat(m.length) : m));
}

/** The bundle's binaries: its asset files by kind, and the data URLs inlined in its text (small assets, under the
 *  build's inline limit), as base64; inlined data a collision mesh when it is one of ours by content */
function bundleBinaries(): { kind: Kind; base64: string; where: string }[] {
  const out: { kind: Kind; base64: string; where: string }[] = [];
  const ours = new Set(globFiles(join(ARENA, "**/*.cmf")).map((p) => readFileSync(p).toString("base64")));
  for (const path of files(DIST, () => true)) {
    const k = kind(path);
    if (k === "cmf" || k === "wasm" || k === "unknown") out.push({ kind: k, base64: readFileSync(path).toString("base64"), where: path.slice(ROOT.length) });
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
const FIELD_AND_GOAL = files(join(SRC, "render"), (n) => /^(stadium\w*|goalInterior|gameSurfaces)\.ts$/.test(n)).map((p) => p.slice(SRC.length));

describe("what ships carries no game data (RV-99)", () => {
  it("the field's, goals' and surroundings' modules hold rules, not traced shapes: each under a thousand numbers", () => {
    // (the canopy, the flags and the far layer among them)
    expect(FIELD_AND_GOAL.length).toBeGreaterThanOrEqual(13);
    for (const path of ["render/themes/stadiumCanopy.ts", "render/themes/stadiumFlags.ts", "render/themes/stadiumFarLayer.ts"]) expect(FIELD_AND_GOAL).toContain(path);
    for (const path of FIELD_AND_GOAL) {
      let source = stripComments(readFileSync(join(SRC, path), "utf8"));
      // (FIELD_LIGHT's and GRASS_LIGHT's lightmap statistics aside: numbers, not shapes)
      source = source.replace(/export const (FIELD_LIGHT|GRASS_LIGHT)[\s\S]*?\n}( as const)?;\n/g, "");
      expect(numbers(source).length, path).toBeLessThan(1000);
    }
  });

  it("the comment stripper keeps strings and shaders, the number reader every form (RV-114, RV-139, RV-140, RV-167a, c)", () => {
    expect(stripComments('const u = "http://x"; // gone\nconst s = `// kept in a shader`;')).toBe('const u = "http://x";        \nconst s = `// kept in a shader`;');
    expect(numbers("a(.6558, 6.558E-1, -12, 0.5, 1_234.5, 0.65580, 6.5580e-1, 6558e-4)").map((n) => n.value)).toEqual([0.6558, 0.6558, -12, 0.5, 1234.5, 0.6558, 0.6558, 0.6558]);
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
    expect(shipped).toContain("scripts/cage_topology.json");
    expect(shipped).toContain("client/src/style.css");
    expect(shipped.filter((p) => p.startsWith("out/arena/collision_meshes/soccar/") && p.endsWith(".cmf")).length).toBe(16);
    // (every shipped file a kind this guard knows: text it scans, binary it pins or allows)
    expect(shipped.filter((p) => kind(p) === "unknown")).toEqual([]);
    expect(globFiles(join(SRC, "render/themes/stadium*.ts")).map((f) => f.slice(SRC.length))).toContain("render/themes/stadiumSky.ts");
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

  it("the noise's quantile tables are distributions, not a texture's rows: 24 levels each, never decreasing (RV-157)", () => {
    for (const [channel, levels] of Object.entries(NOISE_QUANTILES)) {
      expect(levels.length, channel).toBe(24);
      expect(levels.every((v, k) => k === 0 || v >= (levels[k - 1] ?? 0)), channel).toBe(true);
    }
  });

  it("the cage's topology is topology: integer indices into its own nodes, its lattice integers; only its parameters and row marks otherwise", () => {
    const t = JSON.parse(readFileSync(TOPOLOGY, "utf8")) as Topology;
    const count = t.nodes.length;
    const index = (k: number): boolean => Number.isInteger(k) && k >= 0 && k < count;
    // (an edge a chain of nodes, a beam)
    expect(t.edges.every((e) => e.length >= 2 && e.every(index))).toBe(true);
    expect(t.cells.every((c) => c.nodes.every(index))).toBe(true);
    expect(t.boundary.every((b) => b.every(index))).toBe(true);
    expect(t.nodes.every((n) => n.q.length === 2 && n.q.every(Number.isInteger))).toBe(true);
    expect(t.defects.every((d) => Number.isInteger(d.cell) && d.cell < t.cells.length && d.wall_rows.every(Number.isInteger))).toBe(true);
    // (a cell's corners, 3 to its nodes (some on its edges); a defect's its cell's; a node's label its surface and
    // integer lattice rows and columns)
    expect(t.cells.every((c) => Number.isInteger(c.sides) && c.sides >= 3 && c.sides <= c.nodes.length)).toBe(true);
    expect(t.defects.every((d) => d.sides === t.cells[d.cell]?.sides)).toBe(true);
    expect(t.nodes.every((nd) => ["free", "clip", "wall", "seam", "ceil"].includes(String(nd.a[0])) && nd.a.slice(1).every((x) => Number.isInteger(x)))).toBe(true);
    // (its numbers otherwise: a handful of parameters and the rows' corner marks)
    const rest = Object.keys(t.params).length + Object.values(t.rows).reduce((s, r) => s + r.corner_marks.length + 2, 0);
    expect(rest).toBeLessThan(100);
    expect(withoutTopology("[672, 676], [99999, 1]", new Set(["672,676"]))).toBe("          , [99999, 1]");
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
  { window: TEXTURE_WINDOW, value: (x) => (!x.integer && x.written >= 3 && x.value >= 0 && x.value <= 1 ? x.value : null), decimals: true, tolerance: 0, span: 0 },
  // (8-bit levels: four or more of them off black and white)
  { window: TEXTURE_LEVELS_WINDOW, value: (x) => (x.integer && x.value >= 0 && x.value <= 255 ? x.value / 255 : null), decimals: false, tolerance: (TIE * 0.5) / 255, span: TEXTURE_LEVELS_SPAN, interior: 4 },
  // (percent)
  { window: 8, value: (x) => (x.integer && x.value >= 0 && x.value <= 100 ? x.value / 100 : null), decimals: false, tolerance: (TIE * 0.5) / 100, span: 0.25, interior: 3, wiggle: true },
  // (fractions to 2 decimals, percent's twin: RV-213)
  { window: 8, value: (x) => (!x.integer && x.written === 2 && x.value >= 0 && x.value <= 1 ? x.value : null), decimals: false, tolerance: TIE * 0.005, span: 0.25, interior: 3, wiggle: true },
  // (the box's means unrounded, 0-255 with a decimal or two: the 8-bit levels' twin, RV-213)
  { window: 8, value: (x) => (!x.integer && x.written >= 1 && x.written <= 2 && x.value >= 0 && x.value <= 255 ? x.value / 255 : null), decimals: false, tolerance: (TIE * 0.05) / 255, span: TEXTURE_LEVELS_SPAN, interior: 4, wiggle: true },
  // (4-bit levels: a longer run, a 16-level space being denser still)
  { window: 12, value: (x) => (x.integer && x.value >= 0 && x.value <= 15 ? x.value / 15 : null), decimals: false, tolerance: (TIE * 0.5) / 15, span: 0.2, interior: 3, wiggle: true },
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
  const steps = w.slice(1).map((x, j) => x - (w[j] ?? 0)).filter((d) => d !== 0);
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
    const needed = ["vertices.f32", "uvs.f32", "rz.f32", "az.f32", "columns.f32", "index.json", "textures.f32", "texture_controls.json"].map((n) => join(REFERENCE, n));
    for (const path of [...needed, join(SUR1, "outline_az.json"), join(SUR1, "surroundings_geometry.json"), PLAN]) expect(existsSync(path), path.slice(ROOT.length)).toBe(true);
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
  const topology = topologyArrays();
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
    const n = numbers(withoutTopology(text, topology));
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
    report("coordinate pairs", longestRun(text, n, (i) => pairAt(i) && !pairSmall(i)), 3);
    report("small integer coordinate pairs", longestRun(text, n, (i) => pairAt(i) && pairSmall(i)), SMALL_RUN);
    const tripleAt = once((i) => i + 2 < n.length && traced(value(i), value(i + 1), value(i + 2)) && points.near(value(i), value(i + 1), value(i + 2), 0.6));
    const tripleSmall = (i: number): boolean => small(integers(i, 3), value(i), value(i + 1), value(i + 2));
    report("(x, y, z) triples", longestRun(text, n, (i) => tripleAt(i) && !tripleSmall(i)), 3);
    report("small integer (x, y, z) triples", longestRun(text, n, (i) => tripleAt(i) && tripleSmall(i)), SMALL_RUN);
    // (UV pairs written to 3 decimals or more, each within half its last decimal (RV-139), u and v apart, signed as the
    // meshes' (RV-167b): a run of the same pair is one point)
    const uvPair = once((i) => {
      const t = tolerance(n[i], n[i + 1]);
      return large(n[i], 3) && large(n[i + 1], 3) && Math.abs(signed(i) - signed(i + 1)) > 2 * t && uvPairs.near(signed(i) * 10000, signed(i + 1) * 10000, 10000 * t);
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
    const textureRow = (i: number, s: number): boolean => TEXTURE_FORMS.some((form) => {
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
    const exponents = [...new Set(sparse.map((q) => (q[1] ?? 0).toFixed(4)))].map(Number).filter((x) => x >= 0.1 && x < 1).slice(0, 8);
    expect(exponents.length).toBe(8);
    const zeros = OBJS.flatMap((path) => obj(path.replace(/^.*\//, "").replace(/\.obj$/, "")).vt.map((q) => q[1] ?? 0))
      .filter((x) => Math.abs(x) >= 0.05 && x.toFixed(4).endsWith("0") && !x.toFixed(4).endsWith("00"))
      .slice(0, 8);
    expect(zeros.length).toBe(8);
    // (a vertex record of 9, 12 and 16 floats: its position, then the rest: RV-167d)
    const record = (extra: number): string => `[${v.map((p) => `${xyz(p)}, ${Array.from({ length: extra }, (_, k) => (k % 3 === 2 ? "1" : "0")).join(", ")}`).join(", ")}]`;
    // (a downsampled texture's row, the first 8 values of its streams varying by 0.1 and stepping by 0.005 or more:
    // RV-157)
    const textureRow = ((): number[] => {
      for (let k = 0; k + 8 < textureStreams.length; k++) {
        const w = Array.from(textureStreams.subarray(k, k + 8));
        if (w.some(Number.isNaN)) continue;
        // (off black and white, each step two levels or more, turning: a plain picture's row, not a ramp)
        const turns = w.some((x, j) => j >= 2 && Math.abs((w[j - 2] ?? 0) - 2 * (w[j - 1] ?? 0) + x) >= 0.03);
        if (turns && Math.max(...w) - Math.min(...w) >= 0.1 && w.every((x, j) => x > 0.01 && x < 0.99 && (j === 0 || Math.abs(x - (w[j - 1] ?? 0)) >= 0.008))) return w;
      }
      return [];
    })();
    expect(textureRow.length).toBe(8);
    const controls: [string, string][] = [
      ["vertices as Vector3s", v.map((p) => `new Vector3(${xyz(p)})`).join(", ")],
      ["vertices in records of 9", record(6)],
      ["vertices in records of 12", record(9)],
      ["vertices in records of 16", record(13)],
      ["the vent's (x, y) pairs as integers", `[${vent.slice(0, 8).map(([x = 0, y = 0]) => `[${String(Math.round(x))}, ${String(Math.round(y))}]`).join(", ")}]`],
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
      ["the vent's (x, y) pairs", `[${vent.slice(0, 8).map(([x = 0, y = 0]) => `[${f2(x)}, ${f2(y)}]`).join(", ")}]`],
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
    const picks = JSON.parse(readFileSync(join(REFERENCE, "texture_controls.json"), "utf8")) as Record<"logo" | "mask" | "lightmap" | "twelve" | "low" | "ties", number[] | null>;
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
      const plain = (x: number): boolean => Math.abs(x) < 0.05 || x.toFixed(4).replace(/0+$/, "").split(".")[1]?.length !== undefined && (x.toFixed(4).replace(/0+$/, "").split(".")[1]?.length ?? 0) < 3;
      let from = s;
      while (from + 8 < u0 + un && rowAt(from).some((x, k, r) => plain(x) || (k > 0 && Math.abs(x - (r[k - 1] ?? 0)) < 0.01))) from++;
      controls.push([`${name}'s UV row`, `[${rowAt(from).map((x) => x.toFixed(4)).join(", ")}]`]);
      const pairs = Array.from({ length: 8 }, (_, k) => `${(referenceUv[2 * (s + k)] ?? 0).toFixed(4)}, ${(referenceUv[2 * (s + k) + 1] ?? 0).toFixed(4)}`);
      controls.push([`${name}'s UV pairs`, `[${pairs.join(", ")}]`]);
    }
    // The per-azimuth statistics and the crowd's tiers
    const outline = JSON.parse(readFileSync(join(SUR1, "outline_az.json"), "utf8")) as Record<string, { az: number; r: number[]; z: number[] }[]>;
    for (const piece of ["Stadium_Top", "Stadium_Base_Seats", "Stadium_Glass", "Stadium_Supports"]) {
      const top = outline[piece] ?? [];
      expect(top.length, piece).toBeGreaterThan(8);
      controls.push(
        [`${piece}: a per-azimuth table`, top.map((row) => `[${String(row.az)}, ${String(row.r[0])}, ${String(row.r[2])}, ${String(row.z[0])}, ${String(row.z[2])}]`).join(", ")],
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
      controls.push([`crowd tier ${tier}'s rows`, t.sections.map((s) => `[${s.r_first_row.toFixed(0)}, ${s.z_first_row.toFixed(0)}, ${s.r_last_row.toFixed(0)}, ${s.z_last_row.toFixed(0)}]`).join(", ")]);
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

  it.each(shippedImports().filter((p) => kind(p) === "text").map((p) => p.slice(ROOT.length)))("%s (imported): no run of the game's vertices, UVs or traced points", (path) => {
    const text = readFileSync(join(ROOT, path), "utf8");
    check(path, join(ROOT, path) === TOPOLOGY ? topologyFree(text) : text);
  }, 60000);

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
  it.skipIf(!existsSync(DIST))("the build recorded every file it wrote (a stale record would hide a chunk: RV-225)", () => {
    const written = files(DIST, (n) => n.endsWith(".js")).map((p) => relative(DIST, p).split("\\").join("/"));
    expect(written.filter((p) => !(p in built))).toEqual([]);
    expect(library.size, "three.js's chunk").toBe(1);
  });
  it.each(files(PUBLIC, (n) => kind(n) === "text").map((p) => p.slice(ROOT.length)))("%s (public/, shipped as it is): no run of the game's data (RV-225)", (path) => {
    check(path, readFileSync(join(ROOT, path), "utf8"));
  });
  it.skipIf(bundle.length === 0)(
    "the built bundle (dist, as it ships: its shaders' comments too)",
    () => {
      for (const path of bundle) check(path.slice(ROOT.length), readFileSync(path, "utf8"));
    },
    300000,
  );
});
