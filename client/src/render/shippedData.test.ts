import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

function files(dir: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, keep) : keep(name) ? [path] : [];
  });
}
const modules = (): string[] => files(SRC, (n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && !n.endsWith(".d.ts"));

/** The build's import aliases (tsconfig.app.json's paths, as vite.config.ts's): "@scripts/" -> its directory */
function aliases(): [string, string][] {
  const config = readFileSync(join(SRC, "../tsconfig.app.json"), "utf8");
  return [...config.matchAll(/"(@[\w-]+\/)\*"\s*:\s*\[\s*"([^"]+)\/\*"/g)].map((m) => [m[1] ?? "", join(SRC, "..", m[2] ?? "")]);
}

/** The JSON the modules import (it ships in the bundle), through the aliases too (RV-140) */
function importedJson(): string[] {
  const found = new Set<string>();
  const alias = aliases();
  for (const path of modules()) {
    for (const m of readFileSync(path, "utf8").matchAll(/from\s+["']([^"']+\.json)["']/g)) {
      const spec = m[1] ?? "";
      const [prefix, dir] = alias.find(([a]) => spec.startsWith(a)) ?? ["", ""];
      found.add(prefix ? join(dir, spec.slice(prefix.length)) : resolve(dirname(path), spec));
    }
  }
  return [...found].filter((p) => existsSync(p));
}

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
  /** its decimals as written, trailing zeros aside ("0.65580" has 4: RV-139) */
  readonly decimals: number;
  /** written as an integer: no point, no exponent ("164.00" isn't) */
  readonly integer: boolean;
  readonly at: number;
}

/** The numeric literals in a text (leading dots, exponents and separators too: 1_234.5, RV-140) */
function numbers(text: string): Num[] {
  return [...text.matchAll(/(?<![A-Za-z_$\d.])-?(?:\d[\d_]*(\.[\d_]*)?|(\.\d[\d_]*))(?:[eE][-+]?\d+)?/g)].map((m) => ({
    value: Number(m[0].replace(/_/g, "")),
    decimals: (m[1] ?? m[2] ?? ".").replace(/_/g, "").replace(/0+$/, "").length - 1,
    integer: m[1] === undefined && m[2] === undefined && !/[eE]/.test(m[0]),
    at: m.index,
  }));
}

/** scripts/cage_topology.json: the cage's topology, derived and shipped (its lattice, edges, cells and boundary as
 *  indices into its own nodes) */
const TOPOLOGY = join(ROOT, "scripts/cage_topology.json");
interface Topology {
  nodes: { q: number[] }[];
  edges: number[][];
  cells: { nodes: number[] }[];
  defects: { cell: number; wall_rows: number[] }[];
  boundary: number[][];
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

const FIELD_AND_GOAL = [
  "render/stadiumFieldRules.ts",
  "render/stadiumField.ts",
  "render/goalInterior.ts",
  "render/gameSurfaces.ts",
  "render/themes/stadiumSurroundings.ts",
  "render/themes/stadiumCrowd.ts",
  "render/themes/stadiumProps.ts",
];

describe("what ships carries no game data (RV-99)", () => {
  it("the field's, goals' and surroundings' modules hold rules, not traced shapes: each under a thousand numbers", () => {
    for (const path of FIELD_AND_GOAL) {
      let source = stripComments(readFileSync(join(SRC, path), "utf8"));
      // (FIELD_LIGHT's and GRASS_LIGHT's lightmap statistics aside: numbers, not shapes)
      source = source.replace(/export const (FIELD_LIGHT|GRASS_LIGHT)[\s\S]*?\n}( as const)?;\n/g, "");
      expect(numbers(source).length, path).toBeLessThan(1000);
    }
  });

  it("the comment stripper keeps strings and shaders, the number reader every form (RV-114, RV-139, RV-140)", () => {
    expect(stripComments('const u = "http://x"; // gone\nconst s = `// kept in a shader`;')).toBe('const u = "http://x";        \nconst s = `// kept in a shader`;');
    expect(numbers("a(.6558, 6.558E-1, -12, 0.5, 1_234.5, 0.65580)").map((n) => n.value)).toEqual([0.6558, 0.6558, -12, 0.5, 1234.5, 0.6558]);
    expect(numbers("0.65580, 1_234.50, 2.").map((n) => n.decimals)).toEqual([4, 1, 0]);
  });

  it("the JSON imported through the build's aliases is scanned too (RV-140)", () => {
    expect(importedJson().map((p) => p.slice(ROOT.length))).toContain("scripts/cage_topology.json");
  });

  it("the cage's topology is topology: integer indices into its own nodes, its lattice integers; only its parameters and row marks otherwise", () => {
    const t = JSON.parse(readFileSync(TOPOLOGY, "utf8")) as Topology & { params: Record<string, unknown>; rows: Record<string, { corner_marks: number[] }> };
    const count = t.nodes.length;
    const index = (k: number): boolean => Number.isInteger(k) && k >= 0 && k < count;
    // (an edge a chain of nodes, a beam)
    expect(t.edges.every((e) => e.length >= 2 && e.every(index))).toBe(true);
    expect(t.cells.every((c) => c.nodes.every(index))).toBe(true);
    expect(t.boundary.every((b) => b.every(index))).toBe(true);
    expect(t.nodes.every((n) => n.q.length === 2 && n.q.every(Number.isInteger))).toBe(true);
    expect(t.defects.every((d) => Number.isInteger(d.cell) && d.cell < t.cells.length && d.wall_rows.every(Number.isInteger))).toBe(true);
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
 *  of the game's data written out in its order (RV-138) */
class Sequences {
  readonly #index = new Map<number, number[]>();
  readonly #values: Float64Array;
  constructor(
    values: readonly number[] | Float32Array,
    readonly cell: number,
  ) {
    this.#values = Float64Array.from(values);
    const v = this.#values;
    for (let i = 0; i + 2 < v.length; i++) {
      const [a = NaN, b = NaN, c = NaN] = [v[i], v[i + 1], v[i + 2]];
      if (Number.isNaN(a + b + c)) continue;
      const key = this.#key(Math.floor(a / cell), Math.floor(b / cell), Math.floor(c / cell));
      const at = this.#index.get(key);
      if (at) at.push(i);
      else this.#index.set(key, [i]);
    }
  }
  #key(i: number, j: number, k: number): number {
    return (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791)) >>> 0;
  }
  /** Whether a, b, c lie each within `tolerance` (at most half a cell) of three consecutive values */
  near(a: number, b: number, c: number, tolerance: number): boolean {
    const [ca, cb, cc] = [a, b, c].map((x) => Math.floor(x / this.cell)) as [number, number, number];
    const v = this.#values;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          for (const at of this.#index.get(this.#key(ca + i, cb + j, cc + k)) ?? []) {
            if (Math.abs((v[at] ?? 0) - a) <= tolerance && Math.abs((v[at + 1] ?? 0) - b) <= tolerance && Math.abs((v[at + 2] ?? 0) - c) <= tolerance) return true;
          }
        }
      }
    }
    return false;
  }
}

const OBJS = files(join(ASSETS, "meshes"), (n) => n.endsWith(".obj"));
const floats = (path: string): Float32Array => {
  if (!existsSync(path)) return new Float32Array(0);
  const b = readFileSync(path);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

/** The longest run of hits among a text's numbers, a hit every `stride` numbers from 1 to `strides` (8), from any start
 *  (RV-138: a record's fields interleaved with others' repeat at its stride); `hit(i, stride)`. With `key`, a hit with
 *  its predecessor's key starts the run over: a table's rows are distinct (one vertex's edges in an index list, [315,
 *  320], [315, 318], are no per-azimuth table) */
function longestRun(
  text: string,
  n: readonly Num[],
  hit: (i: number, stride: number) => boolean,
  { strides = 8, key }: { strides?: number; key?: (i: number) => string } = {},
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
        if (run > best.length) {
          const at = n[first]?.at ?? 0;
          best = { length: run, at: `${text.slice(at, at + 80).replace(/\s+/g, " ")} (every ${String(stride)})` };
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
    const needed = ["vertices.f32", "uvs.f32", "rz.f32", "az.f32", "columns.f32", "index.json"].map((n) => join(REFERENCE, n));
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

  // (a pair or triple counts when it could be a traced point: its coordinates 10 uu or more, one 100 or more (RV-139),
  // or 300 for integers (small ones are indices as often as not: the cage's topology's edges); one off the 16 uu grid
  // the arena's design measures share with our rules, 128, 256, 512 ...)
  const traced = (integers: boolean, ...v: readonly number[]): boolean => {
    const a = v.map(Math.abs);
    return Math.max(...a) >= (integers ? 300 : 100) && Math.min(...a) >= 10 && a.some((x) => x % 16 !== 0);
  };
  // (UV values: written to `places` decimals or more, and not the small ones under 0.05, as dense among the UVs as in a
  // measured profile's tail, Curve_Smoke's)
  const large = (x: Num | undefined, places: number): boolean => !!x && x.decimals >= places && Math.abs(x.value) >= 0.05;
  /** Half the last written decimal of the least precise */
  const tolerance = (...x: readonly (Num | undefined)[]): number => 0.5 * 10 ** -Math.min(...x.map((m) => m?.decimals ?? 0));

  /** Every check on one text: what it found (none for a clean text) */
  function findings(text: string): string[] {
    const n = numbers(withoutTopology(text, topology));
    const value = (k: number): number => Math.abs(n[k]?.value ?? 0);
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
    const pair = once((i) => i + 1 < n.length && traced(integers(i, 2), value(i), value(i + 1)) && coords.near(value(i), value(i + 1), 0.6));
    report("coordinate pairs", longestRun(text, n, pair), 3);
    const triple = once((i) => i + 2 < n.length && traced(integers(i, 3), value(i), value(i + 1), value(i + 2)) && points.near(value(i), value(i + 1), value(i + 2), 0.6));
    report("(x, y, z) triples", longestRun(text, n, triple), 3);
    // (UV pairs written to 3 decimals or more, each within half its last decimal (RV-139), u and v apart: a run of the
    // same pair is one point)
    const uvPair = once((i) => {
      const t = tolerance(n[i], n[i + 1]);
      return large(n[i], 3) && large(n[i + 1], 3) && Math.abs(value(i) - value(i + 1)) > 2 * t && uvPairs.near(value(i) * 10000, value(i + 1) * 10000, 10000 * t);
    });
    report("UV pairs", longestRun(text, n, uvPair, { key: (i) => `${String(value(i))},${String(value(i + 1))}` }), 3);
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
    if (rzValues.length > 0) {
      // (the tables and profiles carry a radius of 11k or more: a pair 2000 or more out, not the small ones the 25 uu
      // tolerance would find among indices; any adjacent pair, 4 of any 8, so a table's azimuth column between its
      // rows' pairs doesn't hide it)
      const hits = n.map((a, i) => {
        const [x, y] = [Math.abs(a.value), value(i + 1)];
        return i + 1 < n.length && traced(integers(i, 2), x, y) && Math.max(x, y) >= 2000 && rz.near(x, y, 25);
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
    const controls: [string, string][] = [
      ["vertices as Vector3s", v.map((p) => `new Vector3(${xyz(p)})`).join(", ")],
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
    const missed = controls.filter(([, text]) => findings(text).length === 0).map(([what]) => what);
    expect(missed).toEqual([]);
  }, 60000);

  /** Every check on one text, `name` for the failures */
  function check(name: string, text: string): void {
    expect(findings(text), name).toEqual([]);
  }

  it.each(modules().map((p) => p.slice(SRC.length)))("%s: no run of the game's vertices, UVs or traced points", (path) => {
    check(path, stripComments(readFileSync(join(SRC, path), "utf8")));
  });

  it.each(importedJson().map((p) => p.slice(ROOT.length)))("%s (imported): no run of the game's vertices, UVs or traced points", (path) => {
    check(path, readFileSync(join(ROOT, path), "utf8"));
  });

  // (our own chunks, its page and its styles (RV-140): three.js's is the library's, its lookup tables meeting the
  // statistics by chance)
  const bundle = files(DIST, (n) => (n.endsWith(".js") && !n.startsWith("three.")) || n.endsWith(".css") || n.endsWith(".html"));
  it.skipIf(bundle.length === 0)(
    "the built bundle (dist, as it ships: its shaders' comments too)",
    () => {
      for (const path of bundle) check(path.slice(ROOT.length), readFileSync(path, "utf8"));
    },
    300000,
  );
});
