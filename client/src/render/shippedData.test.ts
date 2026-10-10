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
/** scripts/reference_vertices.py's local export: the surroundings meshes' vertices and UVs, their (r, z) statistics */
const REFERENCE = join(ROOT, "out/arena_local/reference");
const DIST = join(SRC, "../dist/assets");

function files(dir: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, keep) : keep(name) ? [path] : [];
  });
}
const modules = (): string[] => files(SRC, (n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && !n.endsWith(".d.ts"));

/** The JSON the modules import (it ships in the bundle) */
function importedJson(): string[] {
  const found = new Set<string>();
  for (const path of modules()) {
    for (const m of readFileSync(path, "utf8").matchAll(/from\s+["']([^"']+\.json)["']/g)) found.add(resolve(dirname(path), m[1] ?? ""));
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
  readonly decimals: number;
  readonly at: number;
}

/** The numeric literals in a text (leading dots and exponents too), each with how many decimals it was written with */
function numbers(text: string): Num[] {
  return [...text.matchAll(/(?<![A-Za-z_$\d.])-?(?:\d+(\.\d*)?|(\.\d+))(?:[eE][-+]?\d+)?/g)].map((m) => ({
    value: Number(m[0]),
    decimals: (m[1] ?? m[2] ?? ".").length - 1,
    at: m.index,
  }));
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

  it("the comment stripper keeps strings and shaders, the number reader every form (RV-114)", () => {
    expect(stripComments('const u = "http://x"; // gone\nconst s = `// kept in a shader`;')).toBe('const u = "http://x";        \nconst s = `// kept in a shader`;');
    expect(numbers("a(.6558, 6.558E-1, -12, 0.5)").map((n) => n.value)).toEqual([0.6558, 0.6558, -12, 0.5]);
  });
});

/** A 2D lookup of points by cells of `cell` uu */
class Grid {
  readonly #cells = new Map<number, number[]>();
  constructor(readonly cell = 1) {}
  add(a: number, b: number): void {
    const key = Math.floor(a / this.cell) * 4194304 + Math.floor(b / this.cell);
    const cell = this.#cells.get(key);
    if (cell) cell.push(a, b);
    else this.#cells.set(key, [a, b]);
  }
  near(a: number, b: number, tolerance: number): boolean {
    const [ca, cb] = [Math.floor(a / this.cell), Math.floor(b / this.cell)];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
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

const OBJS = files(join(ASSETS, "meshes"), (n) => n.endsWith(".obj"));
const floats = (path: string): Float32Array => {
  if (!existsSync(path)) return new Float32Array(0);
  const b = readFileSync(path);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe.skipIf(OBJS.length === 0)("against the game's meshes, the traced plan and the surroundings' statistics (local)", () => {
  // Every vertex as its axis pairs, both ways round, and as itself; every UV, as a pair and its components
  const coords = new Grid();
  const points = new Grid3();
  const uvPairs = new Grid();
  const uvValues: number[] = [];
  // (the surroundings' meshes as stored hold small mesh-local numbers that any hand-made geometry meets: from them only
  // the points 1000 uu or more out)
  const vertex = (x: number, y: number, z: number, reference = false): void => {
    const [ax, ay, az] = [Math.abs(x), Math.abs(y), Math.abs(z)];
    if (reference && Math.max(ax, ay, az) < 1000) return;
    coords.add(ax, ay);
    coords.add(ay, ax);
    coords.add(ax, az);
    coords.add(az, ax);
    coords.add(ay, az);
    coords.add(az, ay);
    points.add(ax, ay, az);
  };
  // (UV pairs at 10000x: within half a fourth decimal, 0.5 of a cell; the single values against the arena's own
  // meshes' only, the surroundings' UVs too dense for a match to mean anything)
  const uv = (u: number, v: number, reference = false): void => {
    uvPairs.add(u * 10000, v * 10000);
    if (!reference) uvValues.push(u, v);
  };
  for (const path of OBJS) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (line.startsWith("v ")) {
        const [x = 0, y = 0, z = 0] = line.split(/\s+/).slice(1, 4).map(Number);
        vertex(x, y, z);
      } else if (line.startsWith("vt ")) {
        const [u = 0, v = 0] = line.split(/\s+/).slice(1, 3).map(Number);
        uv(u, v);
      }
    }
  }
  const reference = floats(join(REFERENCE, "vertices.f32"));
  for (let i = 0; i + 2 < reference.length; i += 3) vertex(reference[i] ?? 0, reference[i + 1] ?? 0, reference[i + 2] ?? 0, true);
  const referenceUv = floats(join(REFERENCE, "uvs.f32"));
  for (let i = 0; i + 1 < referenceUv.length; i += 2) uv(referenceUv[i] ?? 0, referenceUv[i + 1] ?? 0, true);
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
  // The surroundings' (r, z) statistics: per-azimuth percentiles, visible profiles (RV-131: within 25 uu)
  const rz = new Grid(25);
  const rzValues = floats(join(REFERENCE, "rz.f32"));
  for (let i = 0; i + 1 < rzValues.length; i += 2) rz.add(rzValues[i] ?? 0, rzValues[i + 1] ?? 0);
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

  /** The longest run of consecutive hits among a text's numbers, taken `step` at a time (every phase) */
  function longestRun(text: string, step: 1 | 2 | 3, hit: (n: readonly Num[]) => boolean): { length: number; at: string } {
    const n = numbers(text);
    let best = { length: 0, at: "" };
    for (let phase = 0; phase < step; phase++) {
      let run: number[] = [];
      for (let i = phase; i + step - 1 < n.length; i += step) {
        if (hit(n.slice(i, i + step))) run.push(i);
        else run = [];
        const first = n[run[0] ?? 0];
        if (run.length > best.length && first) best = { length: run.length, at: text.slice(first.at, first.at + 80).replace(/\s+/g, " ") };
      }
    }
    return best;
  }

  // (a pair or triple counts when it could be a traced point: its coordinates 10 uu or more, one 300 or more (small
  // integers are indices and the like as often as not), one off the 16 uu grid the arena's design measures share with
  // our rules, 128, 256, 512 ...)
  const traced = (...v: readonly number[]): boolean => {
    const a = v.map(Math.abs);
    return Math.max(...a) >= 300 && Math.min(...a) >= 10 && a.some((x) => x % 16 !== 0);
  };
  // (UV values: written to `places` decimals or more, and not the small ones under 0.05, as dense among the UVs as in a
  // measured profile's tail, Curve_Smoke's)
  const large = (x: Num | undefined, places: number): boolean => !!x && x.decimals >= places && Math.abs(x.value) >= 0.05;
  const value = (n: readonly Num[], k: number): number => Math.abs(n[k]?.value ?? 0);

  /** Every check on one text: what it found (none for a clean text) */
  function findings(text: string): string[] {
    const found: string[] = [];
    const report = (what: string, run: { length: number; at: string }, limit: number): void => {
      if (run.length >= limit) found.push(`${what} (${String(run.length)}): ${run.at}`);
    };
    report("coordinate pairs", longestRun(text, 2, (n) => traced(value(n, 0), value(n, 1)) && coords.near(value(n, 0), value(n, 1), 0.6)), 3);
    report("(x, y, z) triples", longestRun(text, 3, (n) => traced(value(n, 0), value(n, 1), value(n, 2)) && points.near(value(n, 0), value(n, 1), value(n, 2), 0.6)), 3);
    const uvs = longestRun(text, 2, (n) => {
      const places = Math.min(n[0]?.decimals ?? 0, n[1]?.decimals ?? 0);
      return large(n[0], 4) && large(n[1], 4) && uvPairs.near((n[0]?.value ?? 0) * 10000, (n[1]?.value ?? 0) * 10000, 0.5 * 10 ** (4 - places));
    });
    report("UV pairs", uvs, 3);
    // (each within half its last written decimal of a UV component: the old goal-side glass chart's V row, RV-99)
    report("UV values", longestRun(text, 1, (n) => large(n[0], 4) && nearUv(n[0]?.value ?? 0, 0.5 * 10 ** -(n[0]?.decimals ?? 0))), 4);
    if (rzValues.length > 0) {
      // (the tables and profiles carry a radius of 11k or more: a pair 2000 or more out, not the small ones the 25 uu
      // tolerance would find among indices; any adjacent pair, 4 of any 8, so a table's azimuth column between its
      // rows' pairs doesn't hide it)
      const n = numbers(text);
      const hits = n.map((a, i) => {
        const [x, y] = [Math.abs(a.value), Math.abs(n[i + 1]?.value ?? 0)];
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

  it("catches the game's data in the forms it might take (controls built here from the local data: RV-114, RV-131)", () => {
    const glass = OBJS.find((p) => p.endsWith("Goal_STD_Glass.obj"));
    const lines = glass ? readFileSync(glass, "utf8").split("\n") : [];
    const v = lines.filter((l) => l.startsWith("v ")).slice(100, 108).map((l) => l.split(/\s+/).slice(1, 4).map(Number));
    const vt = lines.filter((l) => l.startsWith("vt ")).slice(100, 108).map((l) => Number(l.split(/\s+/)[2]));
    const controls: [string, string][] = [
      ["vertices as Vector3s", v.map(([x = 0, y = 0, z = 0]) => `new Vector3(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`).join(", ")],
      ["vertices' (y, x) pairs", v.map(([x = 0, y = 0]) => `[${y.toFixed(1)}, ${x.toFixed(1)}]`).join(", ")],
      ["a UV row with leading dots", vt.map((t) => t.toFixed(4).replace(/^0/, "")).join(", ")],
    ];
    const outline = join(ROOT, "out/bsim/agents/SUR1/outline_az.json");
    if (existsSync(outline)) {
      const top = (JSON.parse(readFileSync(outline, "utf8")) as Record<string, { az: number; r: number[]; z: number[] }[]>)["Stadium_Top"] ?? [];
      controls.push(["a per-azimuth table", top.map((row) => `[${String(row.az)}, ${String(row.r[0])}, ${String(row.r[2])}, ${String(row.z[0])}, ${String(row.z[2])}]`).join(", ")]);
    }
    for (const [what, text] of controls) expect(findings(text), what).not.toEqual([]);
  });

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

  // (our own chunks: three.js's is the library's, its lookup tables meeting the (r, z) statistics by chance)
  const bundle = files(DIST, (n) => n.endsWith(".js") && !n.startsWith("three."));
  it.skipIf(bundle.length === 0)("the built bundle (dist/assets, as it ships: its shaders' comments too)", () => {
    for (const path of bundle) check(path.slice(ROOT.length), readFileSync(path, "utf8"));
  });
});
