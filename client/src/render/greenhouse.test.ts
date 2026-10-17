// Night's greenhouse (ours): its pitch inside the floor, the glass's chart and bars, and the arena it makes in few
// draws (the user's budget: one translucent glass layer, one floor shader, ~10-20 draws)
import { AdditiveBlending, Mesh, type Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ArenaView } from "./arena";
import { ForceFieldMaterial } from "./gameSurfaces";
import { fullBright, linear } from "./teamColors";
import { applyShaderQuality } from "./shaderQuality";
import { H, floorOutline } from "./arenaSurface";
import { GREENHOUSE, GreenhouseGlassMaterial, WALL_CHART_TOP, glassChart, goalOutline, pitchLayout, wallChart } from "./greenhouse";
import { greenhouseTheme } from "./themes/greenhouse";
import { nightTheme } from "./themes/night";
import { wallParam } from "./wallFoot";

/** The distance from (x, y) to the polygon's edges, negative outside it */
function inside(outline: readonly (readonly [number, number])[], x: number, y: number): number {
  let best = Infinity;
  outline.forEach(([ax, ay], i) => {
    const [bx, by] = outline[(i + 1) % outline.length] ?? [ax, ay];
    const [dx, dy] = [bx - ax, by - ay];
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  });
  return pointIn(outline, x, y) ? best : -best;
}

function pointIn(outline: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let hit = false;
  outline.forEach(([ax, ay], i) => {
    const [bx, by] = outline[(i + 1) % outline.length] ?? [ax, ay];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
  });
  return hit;
}

describe("the greenhouse's pitch", () => {
  const outline = floorOutline();
  const p = pitchLayout(outline);

  it("its boundary (a rounded box) inside the floor's edge all round, 50 uu or more to spare", () => {
    const [bx, by] = p.half;
    const r = p.cornerRadius;
    const points: [number, number][] = [];
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * (Math.PI / 2);
      points.push([bx - r + r * Math.cos(a), by - r + r * Math.sin(a)]);
    }
    for (let x = 0; x <= bx - r; x += 100) points.push([x, by]);
    for (let y = 0; y <= by - r; y += 100) points.push([bx, y]);
    for (const [x, y] of points) for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) expect(inside(outline, sx * x, sy * y), `${String(x)}, ${String(y)}`).toBeGreaterThan(50);
  });

  it("a football pitch's lines in their order: the goal area inside the penalty area, the spot inside it, its arc out past it; the centre circle clear of both; the stripes whole across the length", () => {
    const [, by] = p.half;
    expect(p.goalArea[0]).toBeLessThan(p.penalty[0]);
    expect(p.goalArea[1]).toBeLessThan(p.penaltySpot);
    expect(p.penaltySpot).toBeLessThan(p.penalty[1]);
    expect(p.penaltySpot + p.arcRadius).toBeGreaterThan(p.penalty[1]);
    expect(by - p.penaltySpot - p.arcRadius).toBeGreaterThan(p.centreRadius);
    expect(p.penalty[0]).toBeLessThan(p.half[0] - p.cornerRadius / 2);
    // (the goal area 550 past each post)
    expect(p.goalArea[0] - 893).toBe(550);
    expect(Number.isInteger((2 * 5120) / p.stripe)).toBe(true);
  });
});

describe("the greenhouse's glass", () => {
  it("its chart: the ceiling its x and y; the walls the wall line's length and the height, on round the ceiling's fillet by its arc", () => {
    expect(glassChart(100, -200, H)).toEqual([100, -200, 1]);
    const [u0, v0, c0] = glassChart(4096, 0, 800);
    expect([u0, v0, c0]).toEqual([0, 800, 0]);
    expect(glassChart(4096, 1000, 800)[0]).toBeCloseTo(1000, 0);
    expect(glassChart(-4096, -1000, 800)[0]).toBeCloseTo(wallParam(4096, 1000), 6);
    // (the fillet's top: the chart's, its edge on the walls' chart for the wall's triangles)
    expect(wallChart(4096 - 512, 0, H)[1]).toBeCloseTo(WALL_CHART_TOP, 6);
    expect(glassChart(4096 - 30, 0, H - 400)[1]).toBeGreaterThan(H - 512);
  });

  it("over the backboard (above and beside the goal mouth, past the wall line's end at the post) u goes on to the back wall's middle, a mirror line of the triangles", () => {
    const end = wallParam(904, 5120);
    expect(wallChart(903.9, 5120, 900)[0]).toBeCloseTo(end, 0);
    const us = [800, 600, 300, 0].map((x) => wallChart(x, 5120, 900)[0]);
    us.reduce((a, b) => {
      expect(b).toBeGreaterThan(a);
      return b;
    }, end);
    const middle = wallChart(0, 5120, 900)[0];
    expect(middle / (GREENHOUSE.pane / 2)).toBeCloseTo(Math.round(middle / (GREENHOUSE.pane / 2)), 6);
    // (both halves the same u at the middle: mirrored, no seam; the back ceiling fillet above it too)
    expect(wallChart(-0.001, 5120, 900)[0]).toBeCloseTo(middle, 2);
    expect(wallChart(0, 4900, 1900)[0]).toBeCloseTo(middle, 3);
  });

  it("its bars the user's pick, equilateral triangles 560 uu a side: three families of lines a triangle's height apart", () => {
    expect(GREENHOUSE.pane).toBe(560);
    const { blue, orange } = nightTheme().style.walls;
    const shader = new GreenhouseGlassMaterial(new Vector3(), blue, orange).fragmentShader;
    expect(shader).toContain(`${GREENHOUSE.pane.toFixed(1)} * 0.8660254`);
    expect(shader).not.toMatch(/FRAMING_/);
  });

  it("its bars lit as Night's beams (the user's): additive, towards the team on that side at full brightness, by the height on the wall", () => {
    const { blue, orange } = nightTheme().style.walls;
    const m = new GreenhouseGlassMaterial(new Vector3(), blue, orange);
    expect(m.blending).toBe(AdditiveBlending);
    expect(m.uniforms["bright1"]?.value).toEqual(linear(fullBright([orange.r, orange.g, orange.b])));
    expect(m.fragmentShader).toContain("(2068.6 - vWorld.y) / 1816.0");
    expect(m.fragmentShader).toContain("vWorld.z / 256.0 + 0.5");
  });

  it("High Quality Shaders off (the user's settings): its low-quality branch, as Night's beams and fill (flat beams, the faint net)", () => {
    const { blue, orange } = nightTheme().style.walls;
    const m = new GreenhouseGlassMaterial(new Vector3(), blue, orange);
    const mesh = new Mesh(undefined, m);
    expect(applyShaderQuality(mesh, false)).toBe(1);
    expect(m.defines).toHaveProperty("CARBALL_LQ");
    expect(m.fragmentShader).toContain("#ifdef CARBALL_LQ");
    expect(m.fragmentShader).toContain("vWorld.z / 128.0 + 0.5");
    expect(applyShaderQuality(mesh, true)).toBe(1);
    expect(m.defines).not.toHaveProperty("CARBALL_LQ");
  });
});

describe("the greenhouse arena", () => {
  const draws = (root: Object3D, skip: Object3D): Mesh[] => {
    const out: Mesh[] = [];
    root.traverse((o) => {
      let up: Object3D | null = o;
      while (up) {
        if (up === skip) return;
        up = up.parent;
      }
      if (o instanceof Mesh && o.visible) out.push(o as Mesh);
    });
    return out;
  };

  it("in the budget: one translucent glass layer, no cage beams, the pitch one material; 20 draws at most, fewer than Night's", () => {
    const theme = greenhouseTheme();
    const arena = new ArenaView(theme);
    const meshes = draws(arena.root, theme.root);
    const night = nightTheme();
    const nightMeshes = draws(new ArenaView(night).root, night.root);
    expect(meshes.length).toBeLessThanOrEqual(20);
    expect(meshes.length).toBeLessThan(nightMeshes.length);
    expect(meshes.filter((m) => m.material instanceof GreenhouseGlassMaterial)).toHaveLength(1);
    expect(meshes.some((m) => m.name === "greenhouse boards")).toBe(true);
    expect(meshes.some((m) => m.name === "greenhouse posts")).toBe(true);
    // (the game's cage, overlay and wall foot not built)
    expect(meshes.filter((m) => m.material instanceof ForceFieldMaterial)).toHaveLength(0);
  });
});

describe("the greenhouse's goal light (the user's \"just a normal light wrapper\")", () => {
  it("one ribbon round the mouth's frame: from the floor up a post, over the bar, down the other to the floor; outward of the frame, no side runs", () => {
    const { attached, free } = goalOutline();
    const point = (a: readonly number[], i: number): [number, number, number] => [a[3 * i] ?? 0, a[3 * i + 1] ?? 0, a[3 * i + 2] ?? 0];
    const n = attached.length / 3;
    expect(free.length).toBe(attached.length);
    // (ends at the floor at either post's outer edge, the top the frame's band)
    expect(point(attached, 0)[2]).toBe(0);
    expect(point(attached, n - 1)[2]).toBe(0);
    expect([point(attached, 0)[0], point(attached, n - 1)[0]]).toEqual([-969, 969]);
    expect(Math.max(...Array.from({ length: n }, (_, i) => point(attached, i)[2]))).toBeCloseTo(720.8, 6);
    // (never wider than the frame: no run along the base or the back wall)
    for (let i = 0; i < n; i++) {
      const [x, y, z] = point(attached, i);
      const [fx, , fz] = point(free, i);
      expect(Math.abs(x)).toBeLessThanOrEqual(969);
      expect(Math.abs(fx)).toBeLessThanOrEqual(969 + 56 + 1e-6);
      expect(Math.hypot(fx - x, fz - z)).toBeGreaterThan(30);
      expect(y).toBeLessThan(5120);
    }
  });
});

