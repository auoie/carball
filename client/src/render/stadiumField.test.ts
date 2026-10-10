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
import { FrameMaterial, GrassMaterial, HexFloorMaterial, MarkingMaterial, buildStadiumField } from "./stadiumField";
import { FIELD_LIGHT, type FieldPlan, shippableFieldPlan } from "./stadiumFieldRules";
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
  });

  it("the markings: the strips 16 uu wide (AV-7; the hatch bars, single segments, 18-22), `across` 0 to 1 across", () => {
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
  it("only with the game's materials: the stadium has the field and not our old markings; other themes keep theirs", () => {
    const stadium = materials(new ArenaView(stadiumTheme()).root);
    expect(stadium.filter((m) => m instanceof GrassMaterial)).toHaveLength(1);
    // (each piece its own baked light; the goal mouths Reflective_Floor_B)
    expect(stadium.filter((m) => m instanceof HexFloorMaterial).map((m) => m.piece).sort()).toEqual(["disc", "goalEnd", "goalMouth", "hexPads", "hexSide"]);
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
    const source = readFileSync(new URL("./stadiumFieldRules.ts", import.meta.url), "utf8");
    const withoutLight = source.replace(/export const FIELD_LIGHT[\s\S]*?\n};\n/, "");
    const numbers = withoutLight.match(/-?\d+\.?\d*/g) ?? [];
    expect(numbers.length).toBeLessThan(1000);
  });
});
