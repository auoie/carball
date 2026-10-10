// DFH Stadium's field (notes/arena-visuals.md AV-5..AV-9): its regions where the game has them and within the floor,
// the markings' and frame lines' strips, only with the game's materials. Both plans: the one builds draw (from
// measurements: src/render/stadiumFieldRules.ts) and, where it's here, the one traced from the game's meshes (local:
// out/bsim/assets_local/arena/field_plan.json, scripts/field_plan.py).
import { existsSync, readFileSync } from "node:fs";
import { type BufferAttribute, Color, type Material, Mesh, type Object3D, ShaderMaterial, type Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ArenaView } from "./arena";
import { floorOutline } from "./arenaSurface";
import { GrassCube } from "./grassCube";
import { FrameMaterial, GRASS_LIGHT, GrassMaterial, HexFloorMaterial, MarkingMaterial, TIRE_MARKS, buildStadiumField, grassBin, grassReflection } from "./stadiumField";
import { FIELD_LIGHT, FIELD_MEASURES, type FieldPlan, shippableFieldPlan } from "./stadiumFieldRules";
import { nightTheme } from "./themes/night";
import { stadiumTheme } from "./themes/stadium";

type Tri = readonly [number, number, number, number, number, number];

const LOCAL = new URL("../../../out/bsim/assets_local/arena/field_plan.json", import.meta.url);
const local = existsSync(LOCAL) ? (JSON.parse(readFileSync(LOCAL, "utf8")) as FieldPlan) : null;
const plans: [string, FieldPlan][] = [["built from measurements", shippableFieldPlan()], ...(local ? [["traced (local)", local] as [string, FieldPlan]] : [])];

/** A mesh's triangles in the game's plan (Three's x and z) */
function triangles(mesh: Mesh): Tri[] {
  const position = mesh.geometry.getAttribute("position") as BufferAttribute;
  const out: Tri[] = [];
  for (let i = 0; i + 2 < position.count; i += 3) {
    out.push([position.getX(i), position.getZ(i), position.getX(i + 1), position.getZ(i + 1), position.getX(i + 2), position.getZ(i + 2)]);
  }
  return out;
}

function inTriangle(x: number, y: number, [ax, ay, bx, by, cx, cy]: Tri): boolean {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function materials(root: Object3D): Material[] {
  const out: Material[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o.material as Material);
  });
  return out;
}

const insideFloor = (x: number, y: number): boolean => {
  const outline = floorOutline();
  let odd = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, ay] = outline[i] ?? [0, 0];
    const [bx, by] = outline[j] ?? [0, 0];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) odd = !odd;
  }
  return odd;
};

const HEX = ["hex floor: side bays", "hex floor: pad bases", "hex floor: goal ends", "hex floor: goal mouths", "hex floor: centre disc"];
/** The pieces from the bottom up (each drawn over the ones before) */
const LAYERS = ["grass", "seams", ...HEX, "centre strips", "halfway strip", "vent grate"];

describe.each(plans)("the stadium's field, %s", (_name, plan) => {
  const cube = new GrassCube();
  const field = buildStadiumField(new Color(0.098, 0.451, 1), new Color(0.7647, 0.3922, 0.098), cube.uniform, plan);
  const meshes = new Map<string, Mesh>();
  field.traverse((o) => {
    if (o instanceof Mesh) meshes.set(o.name, o as Mesh);
  });
  const layers = LAYERS.map((name) => {
    const mesh = meshes.get(name);
    return { name, tris: mesh ? triangles(mesh) : [] };
  });
  /** The piece on top at a point */
  const top = (x: number, y: number): string | undefined => layers.filter((r) => r.tris.some((t) => inTriangle(x, y, t))).at(-1)?.name;

  it("takes no scene light: every piece baked-only, our shaders or unlit colours (RV-106)", () => {
    for (const mesh of meshes.values()) {
      const material = mesh.material as Material;
      expect(material instanceof ShaderMaterial || material.type === "MeshBasicMaterial", mesh.name).toBe(true);
    }
  });

  it("its regions where the game's are (AV-5): the vent, the disc, the strips, the grass, the bays, the goal ends", () => {
    // (the raised pieces over them, the centre's trim and the vent's ring, aren't regions here)
    expect(top(0, 0)).toBe("vent grate");
    expect(top(500, 0)).toBe("hex floor: centre disc");
    expect(top(0, 2000)).toBe("centre strips"); // (|x| <= 32 there)
    expect(top(2000, 20)).toBe("halfway strip"); // (|y| <= 32 there)
    expect(top(2000, 1500)).toBe("grass");
    expect(top(-3600, -1500)).toBe("hex floor: side bays");
    expect(top(1850, -2360)).toBe("hex floor: pad bases");
    expect(top(0, -4000)).toBe("hex floor: goal ends");
    expect(top(0, 4600)).toBe("hex floor: goal mouths");
    // (a seam between the grass pieces: the frame shows, a seam's or the floor's under the field)
    expect(["seams", undefined]).toContain(top(2500, 2064));
  });

  it("everything drawn within the floor's outline", () => {
    let covered = 0;
    for (let x = -4000; x <= 4000; x += 97) {
      for (let y = -5100; y <= 5100; y += 101) {
        const t = top(x, y);
        if (t === undefined || t === "seams") continue;
        covered++;
        expect.soft(insideFloor(x, y), `${String(x)},${String(y)}: ${t}`).toBe(true);
      }
    }
    expect(covered).toBeGreaterThan(5000);
  }, 30000); // (8,000 points through every zone: seconds under a full parallel run)

  it("the markings: the strips 16 uu wide (AV-7; the hatch bars, single segments: 16.3 in the built plan, RV-103c, the traced plan's estimator reading 19.7-22.1), `across` 0 to 1 across", () => {
    const all = Object.values(plan.markings).flat();
    // (a strip: more than one segment)
    const strips = all.filter((m) => m.length > 5);
    expect(strips.length).toBeGreaterThanOrEqual(3);
    for (const m of strips) expect(Math.abs((m[0] ?? 0) - 16)).toBeLessThanOrEqual(0.6);
    for (const m of all) expect(m[0]).toBeGreaterThan(15.5);
    for (const m of all) expect(m[0]).toBeLessThan(22.5);
    const across = meshes.get("markings: goal")?.geometry.getAttribute("across") as BufferAttribute | undefined;
    expect(across).toBeDefined();
    if (!across) return;
    const values = new Set<number>();
    for (let i = 0; i < across.count; i++) values.add(across.getX(i));
    expect([...values].sort()).toEqual([0, 1]);
  });

  it("the glowing team lines (E, H-4): round the panels on the edge trim and the centre's two rings, about 9 uu wide", () => {
    const glowing = plan.frameLines.filter((l) => l.kind === "E");
    expect(glowing.filter((l) => l.piece === "trim").length).toBeGreaterThan(0);
    expect(glowing.filter((l) => l.piece === "centreTrim")).toHaveLength(2);
    for (const l of glowing.filter((g) => g.piece === "trim" || g.piece === "centreTrim")) expect(Math.abs(l.width - 9.3)).toBeLessThan(0.5);
    // (the team-coloured D lines on the centre-field strips, about 31 uu, at |x| 50-85)
    const d = plan.frameLines.filter((l) => l.kind === "D" && l.piece === "centreStrip" && l.width > 25);
    expect(d.length).toBeGreaterThan(0);
    for (const l of d) for (let i = 0; i < l.points.length; i += 2) expect(Math.abs(l.points[i] ?? 0)).toBeLessThan(100);
  });

  it("every field material reads the one capture uniform (a new capture reaches all of them)", () => {
    const shaders: ShaderMaterial[] = [];
    field.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof ShaderMaterial && "grassCube" in o.material.uniforms) shaders.push(o.material);
    });
    expect(shaders.length).toBeGreaterThan(10);
    for (const m of shaders) expect(m.uniforms["grassCube"]).toBe(cube.uniform);
  });

  it("the goals' glows and the glass beside each goal: ribbons the same way round, the glass between post and corner", () => {
    expect(plan.goalGlow.length).toBeGreaterThanOrEqual(6);
    for (const r of plan.goalGlow) {
      expect(r.attached.length).toBe(r.free.length);
      expect(r.attached.length % 3).toBe(0);
      expect(r.attached.length).toBeGreaterThanOrEqual(6);
    }
    expect(plan.goalSideGlass.length).toBeGreaterThanOrEqual(6);
    // (between the goal's post and the corner, from the floor's fillet up to FF_Goal's line)
    for (const [x, z] of plan.goalSideGlass) {
      expect(x).toBeGreaterThanOrEqual(959);
      expect(x).toBeLessThanOrEqual(1537);
      expect(z).toBeGreaterThanOrEqual(126);
      expect(z).toBeLessThanOrEqual(625);
    }
  });
});

describe.skipIf(!local)("the field traced from the game's meshes (local)", () => {
  it("no two of its regions overlap (their mirror images included)", () => {
    if (!local) return;
    const field = buildStadiumField(new Color(0, 0, 1), new Color(1, 0.5, 0), new GrassCube().uniform, local);
    const regions: { name: string; tris: Tri[] }[] = [];
    field.traverse((o) => {
      if (o instanceof Mesh && ["grass", ...HEX, "centre strips", "halfway strip", "vent grate"].includes(o.name)) regions.push({ name: o.name, tris: triangles(o as Mesh) });
    });
    for (let x = -4000; x <= 4000; x += 97) {
      for (let y = -5100; y <= 5100; y += 101) {
        const hits = regions.filter((r) => r.tris.some((t) => inTriangle(x, y, t))).map((r) => r.name);
        expect.soft(hits.length, `${String(x)},${String(y)}: ${hits.join(", ")}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("the field's materials and light", () => {
  it("the frames carry H-4's tire-mark factor, each piece's mean (RV-105b)", () => {
    for (const [piece, m] of Object.entries(TIRE_MARKS)) {
      const material = new FrameMaterial(new GrassCube().uniform, new Color(), new Color(), piece as keyof typeof TIRE_MARKS);
      expect(material.uniforms["tireMarks"]?.value, piece).toBe(m);
      expect(m).toBeGreaterThan(0.88);
      expect(m).toBeLessThan(0.94);
    }
  });

  it("the grass's reflection is H-1's (RV-100): weak from above, stronger grazing", () => {
    // (cube 0.5: 0.024 looking straight down, 0.098 at grazing; the old flat 0.75 (G0 + 1/3) 2/3 gave 0.130 at both)
    expect(grassReflection(1, 0.5)).toBeCloseTo(0.0243, 4);
    expect(grassReflection(0, 0.5)).toBeCloseTo(0.0981, 3);
  });

  it("the shipped plan's goal glows sit as the game's (RV-108)", () => {
    const { glow } = FIELD_MEASURES;
    const points = (flat: readonly number[]): [number, number, number][] =>
      Array.from({ length: flat.length / 3 }, (_, k) => [flat[3 * k] ?? 0, flat[3 * k + 1] ?? 0, flat[3 * k + 2] ?? 0]);
    const ribbons = shippableFieldPlan().goalGlow.map((r) => ({ attached: points(r.attached), free: points(r.free) }));
    const onWall = (p: [number, number, number][]): boolean => p.every(([, y]) => Math.abs(y - glow.wallY) < 1e-6);
    // The mouth ring: on the back wall's plane, up over the crossbar and along the floor (one loop: RV-143); its free
    // edge in toward the opening (nearer its middle, (0, 320)), 63 from the attached one or nearer at the fillets
    const ring = ribbons.find((r) => onWall(r.attached) && Math.max(...r.attached.map(([, , z]) => z)) > 600 && Math.max(...r.attached.map(([x]) => Math.abs(x))) < 950);
    expect(ring).toBeDefined();
    expect(Math.min(...(ring?.attached.map(([, , z]) => z) ?? [0]))).toBeCloseTo(1, 6);
    ring?.attached.forEach(([x, , z], k) => {
      const [fx, , fz] = ring.free[k] ?? [0, 0, 0];
      expect(Math.hypot(fx, fz - 320)).toBeLessThan(Math.hypot(x, z - 320));
      expect(Math.hypot(fx - x, fz - z)).toBeLessThanOrEqual(glow.width + 1e-6);
    });
    // The stepped outline: its free edge in the wall's plane, 128 above
    const stepped = ribbons.find((r) => onWall(r.attached) && Math.max(...r.attached.map(([x]) => Math.abs(x))) === glow.stepped.to);
    expect(stepped && onWall(stepped.free)).toBe(true);
    stepped?.attached.forEach(([, , z], k) => {
      expect((stepped.free[k]?.[2] ?? 0) - z).toBeCloseTo(glow.stepped.out, 6);
    });
    // Inside: the sides from y 5344, the front bands from 5281
    const sides = ribbons.filter((r) => r.attached.every(([x]) => Math.abs(Math.abs(x) - glow.inside.x) < 1e-6));
    expect(sides).toHaveLength(2);
    for (const side of sides) expect(Math.min(...side.attached.map(([, y]) => y))).toBeCloseTo(glow.inside.front + glow.width, 6);
    const fronts = ribbons.filter((r) => r.attached.every(([, , z]) => z === glow.inside.floorZ) || r.attached.every(([, , z]) => z === glow.inside.roofZ));
    expect(fronts).toHaveLength(2);
    for (const front of fronts) expect(Math.min(...front.attached.map(([, y]) => y))).toBeCloseTo(glow.inside.front, 6);
  });

  // (local: the game's meshes and the traced plan, never shipped)
  const centreLines = new URL("../../../out/bsim/assets_local/arena/meshes/Field_Center_Lines.obj", import.meta.url);
  it.skipIf(!existsSync(centreLines))("the shipped plan's centre markings cover Field_Center_Lines' (raster IoU 0.9 or more: RV-141, local)", () => {
    // (2 uu cells over the centre, |x| and |y| to 800; a cell counts where its centre is in a triangle)
    const cell = 2;
    const half = 800;
    const n = (2 * half) / cell;
    const raster = (tris: readonly Tri[]): Uint8Array => {
      const grid = new Uint8Array(n * n);
      for (const t of tris) {
        const xs = [t[0], t[2], t[4]];
        const ys = [t[1], t[3], t[5]];
        const [i0, i1] = [Math.max(0, Math.floor((Math.min(...xs) + half) / cell)), Math.min(n - 1, Math.ceil((Math.max(...xs) + half) / cell))];
        const [j0, j1] = [Math.max(0, Math.floor((Math.min(...ys) + half) / cell)), Math.min(n - 1, Math.ceil((Math.max(...ys) + half) / cell))];
        for (let i = i0; i <= i1; i++) {
          for (let j = j0; j <= j1; j++) if (inTriangle((i + 0.5) * cell - half, (j + 0.5) * cell - half, t)) grid[i * n + j] = 1;
        }
      }
      return grid;
    };
    const lines = readFileSync(centreLines, "utf8").split("\n");
    const v = lines.filter((l) => l.startsWith("v ")).map((l) => l.split(/\s+/).slice(1, 3).map(Number));
    const game: Tri[] = lines
      .filter((l) => l.startsWith("f "))
      .map((l) => l.split(/\s+/).slice(1, 4).flatMap((c) => v[Number(c.split("/")[0]) - 1] ?? [0, 0]) as unknown as Tri);
    let ours: Mesh | undefined;
    buildStadiumField(new Color(0, 0, 1), new Color(1, 0.5, 0), new GrassCube().uniform, shippableFieldPlan()).traverse((o) => {
      if (o instanceof Mesh && o.name === "markings: centre") ours = o as Mesh;
    });
    expect(ours).toBeDefined();
    const [a, b] = [raster(game), raster(ours ? triangles(ours) : [])];
    let both = 0;
    let either = 0;
    for (let k = 0; k < a.length; k++) {
      both += a[k] === 1 && b[k] === 1 ? 1 : 0;
      either += a[k] === 1 || b[k] === 1 ? 1 : 0;
    }
    expect(both / either).toBeGreaterThanOrEqual(0.9);
  });

  it.skipIf(!local)("the shipped plan's goal glows run where the traced ones do: every traced attached point within 10 uu of a shipped ribbon (RV-143, local)", () => {
    const points = (flat: readonly number[]): [number, number, number][] =>
      Array.from({ length: flat.length / 3 }, (_, k) => [flat[3 * k] ?? 0, flat[3 * k + 1] ?? 0, flat[3 * k + 2] ?? 0]);
    const shipped = shippableFieldPlan().goalGlow.map((r) => points(r.attached));
    // (the distance from a point to a polyline, segment by segment)
    const toSegment = (p: readonly number[], a: readonly number[], b: readonly number[]): number => {
      const d = [0, 1, 2].map((k) => (b[k] ?? 0) - (a[k] ?? 0));
      const len2 = d.reduce((s, c) => s + c * c, 0);
      const t = len2 > 0 ? Math.min(Math.max([0, 1, 2].reduce((s, k) => s + ((p[k] ?? 0) - (a[k] ?? 0)) * (d[k] ?? 0), 0) / len2, 0), 1) : 0;
      return Math.hypot(...[0, 1, 2].map((k) => (p[k] ?? 0) - (a[k] ?? 0) - t * (d[k] ?? 0)));
    };
    const far: string[] = [];
    for (const r of local?.goalGlow ?? []) {
      for (const p of points(r.attached)) {
        // (both goals: the shipped ribbons for +y, mirrored)
        const q = [p[0], Math.abs(p[1]), p[2]];
        const d = Math.min(...shipped.flatMap((s) => s.slice(1).map((b, k) => toSegment(q, s[k] ?? b, b))));
        if (d > 10) far.push(`(${p.map((c) => c.toFixed(0)).join(", ")}) ${d.toFixed(1)}`);
      }
    }
    expect(far).toEqual([]);
  });

  it("the centre's arcs lie on the disc, inside the raised trim, its E ring on the trim (RV-102)", () => {
    const { centre, marking, trimLine } = FIELD_MEASURES;
    expect(marking.arc.r + marking.width / 2).toBeLessThan(centre.disc);
    expect(centre.disc).toBeLessThanOrEqual(centre.trim[0]);
    expect(trimLine.rings[0]).toBeGreaterThan(centre.trim[0]);
    expect(trimLine.rings[0]).toBeLessThan(centre.trim[1]);
    expect(trimLine.rings[1]).toBeGreaterThan(centre.ventTrim[0]);
    expect(trimLine.rings[1]).toBeLessThan(centre.ventTrim[1]);
  });

  it("the grass's light bins where the game's are (RV-146): on 256's, half the partial end bins' widths in", () => {
    const x = (s: number): number => grassBin(s, GRASS_LIGHT.x0, GRASS_LIGHT.x1, GRASS_LIGHT.x.length);
    const y = (s: number): number => grassBin(s, GRASS_LIGHT.y0, GRASS_LIGHT.y1, GRASS_LIGHT.y.length);
    expect(x(-3695)).toBeCloseTo(0, 9);
    expect(x(-3456)).toBeCloseTo(1, 9);
    expect(x(-3584 + 128 + 256 * 13)).toBeCloseTo(14, 9);
    expect(x(3695)).toBeCloseTo(29, 9);
    expect(y(160)).toBeCloseTo(0, 9);
    expect(y(384)).toBeCloseTo(1, 9);
    expect(y(4719)).toBeCloseTo(18, 9);
  });

  it("the shipped plan's centre arcs, strips and hatches (RV-103c, d, RV-141): the hooks' legs on to x 96 and 590, the strip's end 96 wide, the hatch bars 16.3", () => {
    const { marking, centreStrip } = FIELD_MEASURES;
    expect(marking.hatch).toBe(16.3);
    expect(centreStrip.at(-1)).toEqual([3326, 96]);
    const arc = shippableFieldPlan().markings.centre[0] ?? [];
    const pts = Array.from({ length: (arc.length - 1) / 2 }, (_, k): [number, number] => [arc[1 + 2 * k] ?? 0, arc[2 + 2 * k] ?? 0]);
    // (one way along: no join's arc overshooting its side)
    pts.forEach(([x, y], k) => {
      const [px, py] = pts[k - 1] ?? [x, y];
      expect(Math.hypot(x - px, y - py)).toBeLessThan(200);
    });
    expect(pts.slice(-6).every(([x, y], k, a) => k === 0 || y <= (a[k - 1]?.[1] ?? Infinity) + 1e-9 || x !== 96)).toBe(true);
    // (the legs on |y - x| = 441, then down x 96 to y 504 and down x 590 (their joins rounded: RV-141))
    const on = (test: (x: number, y: number) => boolean): number => pts.filter(([x, y]) => test(x, y)).length;
    expect(on((x, y) => Math.abs(y - x - marking.arc.leg) < 0.5 && x > 96 && x < 233)).toBeGreaterThan(0);
    expect(on((x, y) => Math.abs(x - y - marking.arc.leg) < 0.5 && x > 590 && x < 674)).toBeGreaterThan(0);
    expect(pts.at(-1)).toEqual([96, 504]);
    expect(on((x, y) => Math.abs(x - 96) < 0.01 && y > 504 && y < 537)).toBeGreaterThan(0);
    expect(on((x, y) => Math.abs(x - 590) < 0.01 && y > 64 && y < 149)).toBeGreaterThan(0);
  });

  it("the grass's light tables cover the grass (RV-105a: |x| to 3806, |y| 64-4830)", () => {
    expect(GRASS_LIGHT.x0).toBeLessThanOrEqual(-3806);
    expect(GRASS_LIGHT.x0 + GRASS_LIGHT.x.length * GRASS_LIGHT.step).toBeGreaterThanOrEqual(3806);
    expect(GRASS_LIGHT.y0 + GRASS_LIGHT.y.length * GRASS_LIGHT.step).toBeGreaterThanOrEqual(4830);
    // (the +x half lighter than the -x: 0.595 vs 0.512)
    const half = (from: number, to: number): number => GRASS_LIGHT.x.slice(from, to).reduce((s, c) => s + c[0], 0) / (to - from);
    expect(half(15, 30)).toBeGreaterThan(half(0, 15) + 0.05);
  });

  it("only with the game's materials: the stadium has the field and not our old markings; other themes keep theirs", () => {
    const stadium = materials(new ArenaView(stadiumTheme()).root);
    expect(stadium.filter((m) => m instanceof GrassMaterial)).toHaveLength(1);
    // (each piece its own baked light; the goal mouths Reflective_Floor_B; the field's pieces by name, OOBFloor under
    // each goal by its own profile: RV-104)
    const hex = stadium.filter((m) => m instanceof HexFloorMaterial);
    expect(hex.map((m) => m.piece).filter((p) => typeof p === "string").sort()).toEqual(["disc", "goalEnd", "goalMouth", "hexPads", "hexSide"]);
    expect(hex.filter((m) => typeof m.piece !== "string")).toHaveLength(2);
    // (each marking mesh its own baked light: Goal_Lines brightest, Field_Side_Lines dimmest)
    const marks = stadium.filter((m): m is MarkingMaterial => m instanceof MarkingMaterial);
    expect(marks.map((m) => m.group).sort()).toEqual(["centre", "goal", "side"]);
    const light = (group: string): number => (marks.find((m) => m.group === group)?.uniforms["light"]?.value as Vector3).x;
    expect(light("goal")).toBeCloseTo(1.206, 3);
    expect(light("side")).toBeCloseTo(0.74, 3);
    expect(light("centre")).toBeCloseTo(0.898, 3);
    // (the floor under it all the frame's: its seams)
    expect(stadium.filter((m) => m instanceof FrameMaterial && m.piece === "trimB")).toHaveLength(1);
    const night = materials(new ArenaView(nightTheme()).root);
    expect(night.filter((m) => m instanceof GrassMaterial || m instanceof HexFloorMaterial || m instanceof MarkingMaterial || m instanceof FrameMaterial)).toHaveLength(0);
  });

  it("the baked light: every piece's table fits the shaders' 16 bins, its levels a lightmap's (0.3-1.6)", () => {
    for (const [piece, profile] of Object.entries(FIELD_LIGHT)) {
      expect(profile.rgb.length, piece).toBeLessThanOrEqual(16);
      for (const rgb of profile.rgb) for (const c of rgb) expect(c, piece).toBeGreaterThan(0.29);
      for (const rgb of profile.rgb) for (const c of rgb) expect(c, piece).toBeLessThan(1.6);
    }
    // (the halfway strip in the wall's baked shadow at -X: darker than at +X)
    const halfway = FIELD_LIGHT.halfway.rgb;
    expect((halfway[0]?.[0] ?? 0) + 0.2).toBeLessThan(halfway.at(-1)?.[0] ?? 0);
  });

  it("builds carry no traced shapes: the shippable plan is built from FIELD_MEASURES (under a thousand numbers)", () => {
    // (the plan module's numbers, outside FIELD_LIGHT's statistics: well under the traced plan's thousands)
    // (comments left out: they don't ship; the module has no strings holding "//")
    const source = readFileSync(new URL("./stadiumFieldRules.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const withoutLight = source.replace(/export const FIELD_LIGHT[\s\S]*?\n};\n/, "");
    const numbers = withoutLight.match(/-?\d+\.?\d*/g) ?? [];
    expect(numbers.length).toBeLessThan(1000);
  });
});
