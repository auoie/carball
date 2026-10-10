// The arena with the game's materials (the stadium theme: notes/arena-visuals.md H-5, H-6, H-8, H-9, AV-15).
import { AdditiveBlending, type BufferGeometry, Color, type Material, Mesh, type Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ArenaView, glowContour } from "./arena";
import { wallLine } from "./arenaSurface";
import type { CageGraph } from "./cage";
import { CageBeams, shockRing, shockWave } from "./cageBeams";
import { existsSync, readFileSync } from "node:fs";
import { ENV_GLSL, ENV_RADIAL, ENV_SPREAD, GOAL_SIDE_CHART, GlowStripMaterial, HexGlassMaterial, ForceFieldMaterial, envG, goalSideV } from "./gameSurfaces";
import { GOAL_BASE_LIGHT, GoalFloorMaterial, goalBaseZ, goalFloorZone } from "./goalInterior";
import { GOAL_PROFILE_CHART, goalPath, goalProfileU } from "./goalSurface";
import { HexFloorMaterial } from "./stadiumField";
import { HexWallMaterial } from "./hexWalls";
import { nightTheme } from "./themes/night";
import { stadiumTheme } from "./themes/stadium";

/** The materials drawn in the main view (not the reflection capture's own hotspots, hidden but while it captures) */
function materials(root: Object3D): Material[] {
  const out: Material[] = [];
  root.traverseVisible((o) => {
    if (o instanceof Mesh) out.push(...(Array.isArray(o.material) ? (o.material as Material[]) : [o.material as Material]));
  });
  return out;
}

describe("the game's arena materials", () => {
  const stadium = new ArenaView(stadiumTheme());
  const night = new ArenaView(nightTheme());

  it("the stadium: the game's overlay on the walls, glass beside the goals and in them, glow sheets, additive beams", () => {
    const all = materials(stadium.root);
    expect(all.filter((m) => m instanceof ForceFieldMaterial)).toHaveLength(1);
    // (beside each goal, and the nets)
    expect(all.filter((m) => m instanceof HexGlassMaterial)).toHaveLength(3);
    // (each side wall, each team's half; each goal's glows: RV-77)
    expect(all.filter((m) => m instanceof GlowStripMaterial)).toHaveLength(6);
    expect(all.filter((m) => m instanceof HexWallMaterial)).toHaveLength(0);
    expect(all.filter((m) => m.blending === AdditiveBlending)).toHaveLength(1);
  });

  it("the stadium's goals carry none of our old team hexes: metal floors, the game's primaries on the mouth (RV-63)", () => {
    const old = [0x2a7fff, 0xff8a1f];
    const colours: number[] = [];
    stadium.root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const material = o.material as Material & { color?: Color };
      if (material.color) colours.push(material.color.getHex());
      const geometry = o.geometry as BufferGeometry;
      if (geometry.hasAttribute("color")) {
        const vertex = geometry.getAttribute("color");
        for (let i = 0; i < vertex.count; i += 97) colours.push(new Color(vertex.getX(i), vertex.getY(i), vertex.getZ(i)).getHex());
      }
    });
    for (const hex of old) expect(colours).not.toContain(hex);
  });

  it("the glow sheets run 16 uu behind the wall, round the corners, from |y| 128 to |x| 2048 on the back wall (RV-59)", () => {
    const contour = glowContour();
    const line = wallLine();
    // (distance to the wall's line: the nearest segment)
    const distance = ([x, y]: readonly [number, number]): number => {
      let best = Infinity;
      for (let k = 0; k + 1 < line.length; k++) {
        const a = line[k]?.p;
        const b = line[k + 1]?.p;
        if (!a || !b) continue;
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t)));
      }
      return best;
    };
    for (const p of contour) expect(Math.abs(distance(p) - 16)).toBeLessThan(1);
    const [first] = contour;
    const last = contour.at(-1);
    expect(first?.[0]).toBeCloseTo(4112, 3);
    expect(first?.[1]).toBeCloseTo(128, 3);
    expect(last?.[0]).toBeCloseTo(2048, 3);
    expect(last?.[1]).toBeCloseTo(5136, 0);
  });

  it("other themes keep our own look", () => {
    const all = materials(night.root);
    expect(all.filter((m) => m instanceof HexWallMaterial)).toHaveLength(2);
    expect(all.filter((m) => m instanceof GlowStripMaterial || m instanceof HexGlassMaterial || m instanceof ForceFieldMaterial)).toHaveLength(0);
    expect(all.filter((m) => m.blending === AdditiveBlending)).toHaveLength(0);
  });

  it("the shockwave: -0.25 at rest, to 1 over 2.5 s of world time after the explosion, back at rest for a new ball", () => {
    const ball = new Vector3();
    expect(stadium.shockWave).toBe(-0.25);
    stadium.explode();
    stadium.update(ball, 1.25);
    expect(stadium.shockWave).toBeCloseTo(0.375);
    stadium.update(ball, 5);
    expect(stadium.shockWave).toBe(1);
    stadium.newBall();
    expect(stadium.shockWave).toBe(-0.25);
    expect(shockWave(null)).toBe(-0.25);
  });

  it("its ring passes 4096 uu from the ball half a second after the explosion (H-8b)", () => {
    const d2 = (d: number): number => (d / 16384) ** 2;
    const wave = shockWave(0.5);
    expect(shockRing(d2(4096), wave)).toBeCloseTo(1);
    // (a ring over d2 in (SW, SW + 0.125): then 0-5793 uu, faint near the ball, none beyond; it appears at the ball
    // 0.25 s after the explosion, brightest there at 0.375 s)
    expect(shockRing(d2(1000), wave)).toBeLessThan(0.1);
    expect(shockRing(d2(5900), wave)).toBe(0);
    expect(shockRing(0, shockWave(0.24))).toBe(0);
    expect(shockRing(0, shockWave(0.375))).toBeCloseTo(1);
  });
});

describe("the cage's crossed beam quads (RV-75)", () => {
  // A horizontal beam on the side wall (along y, the wall facing -x) and one on the ceiling (along x, facing down)
  const graph: CageGraph = {
    vertices: [],
    edges: [],
    beams: [
      { points: [[4096, 0, 1000], [4096, 500, 1000]], normals: [[-1, 0, 0], [-1, 0, 0]] },
      { points: [[0, 0, 2044], [500, 0, 2044]], normals: [[0, 0, -1], [0, 0, -1]] },
    ],
  };
  const beams = new CageBeams(graph, 92.75, stadiumTheme().style.walls);
  const geometry = beams.mesh.geometry;
  const normal = geometry.getAttribute("beamNormal");
  const side = geometry.getAttribute("side");
  // (per beam: the quad in the surface, 4 vertices, then the one along its normal, 4)
  const own = (vertex: number): Vector3 => new Vector3().fromBufferAttribute(normal, vertex);

  it("each quad's own normal: the surface's for the one in it, the in-surface side (across the beam) for the crossed one", () => {
    for (let v = 0; v < 16; v++) {
      const crossed = v % 8 >= 4;
      const surface = v < 8 ? new Vector3(-1, 0, 0) : new Vector3(0, -1, 0); // (Three's frame)
      if (crossed) {
        expect(Math.abs(own(v).dot(surface))).toBeLessThan(1e-6);
        expect(Math.abs(own(v).dot(new Vector3().fromBufferAttribute(side, v)))).toBeLessThan(1e-6);
      } else expect(own(v).dot(surface)).toBeCloseTo(1, 6);
    }
  });

  it("the stripes' blend sat(64 (|n.z| - 0.5)): 1 on the side wall's horizontal crossed quad, 0 on the ceiling's", () => {
    const blend = (n: Vector3): number => Math.min(1, Math.max(0, 64 * (Math.abs(n.y) - 0.5))); // (game z: Three's y)
    expect(blend(own(4))).toBe(1);
    expect(blend(own(12))).toBe(0);
  });
});

describe("the overlay's surfaces (RV-74)", () => {
  it("pushed out along their normals (the walls 4 uu, the roof 8): the vertex shader carries the offset", () => {
    const overlay = new ForceFieldMaterial(new Color(0, 0, 1), new Color(1, 0.5, 0));
    expect(overlay.vertexShader).toContain("world.xyz += outward");
    expect(new HexGlassMaterial().vertexShader).not.toContain("outward");
  });
});

describe("the goals' insides (RV-76, RV-77)", () => {
  const stadium = new ArenaView(stadiumTheme());
  stadium.root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  stadium.root.traverse((o) => {
    if (o instanceof Mesh) meshes.push(o as Mesh);
  });

  it("no opaque surface over the goal floor's open part (|x| <= 768, |y| 5152-5990, z about 0): see-through and layered", () => {
    const v = new Vector3();
    let checked = 0;
    for (const mesh of meshes) {
      const material = mesh.material as Material;
      const position = mesh.geometry.getAttribute("position");
      // (the vertices its triangles use: the goal's pieces share one position buffer)
      const index = mesh.geometry.getIndex();
      const used = index ? new Set(Array.from({ length: index.count }, (_, k) => index.getX(k))) : null;
      for (let i = 0; i < position.count; i++) {
        if (used && !used.has(i)) continue;
        v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        // (Three's frame: x, up, the game's y)
        const inside = Math.abs(v.x) <= 768 && Math.abs(v.z) > 5152 && Math.abs(v.z) < 5990 && Math.abs(v.y) < 1;
        if (!inside) continue;
        checked++;
        expect.soft(material.transparent, `${mesh.name || material.type} at ${v.toArray().map(Math.round).join(", ")}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(10);
    // (under it: the lower glass, the glows, OOBFloor)
    expect(meshes.filter((m) => m.name === "goal under glass")).toHaveLength(1);
    expect(meshes.filter((m) => m.name === "goal base bevels")).toHaveLength(1);
    expect(meshes.filter((m) => m.material instanceof GoalFloorMaterial)).toHaveLength(2);
  });

  it("the net's glass chart along the profile is the game's (RV-110): 193.4 uu a unit on the floor, 195.8 round the back, 203.1 on the roof, 5.5 at the back's middle", () => {
    const P = goalPath();
    const along = [0];
    for (let i = 1; i < P.length; i++) along.push((along[i - 1] ?? 0) + Math.hypot((P[i]?.[0] ?? 0) - (P[i - 1]?.[0] ?? 0), (P[i]?.[1] ?? 0) - (P[i - 1]?.[1] ?? 0)));
    const half = (along.at(-1) ?? 0) / 2;
    const v = (s: number): number => s - half;
    const c = GOAL_PROFILE_CHART;
    // (continuous, its slope each section's, rising floor to roof)
    expect(goalProfileU(v(10) + 1) - goalProfileU(v(10))).toBeCloseTo(1 / c.floor, 9);
    expect(goalProfileU(v((along.at(-1) ?? 0) - 10) + 1) - goalProfileU(v((along.at(-1) ?? 0) - 10))).toBeCloseTo(1 / c.roof, 9);
    const floorEnd = along[2] ?? 0;
    expect(goalProfileU(v(floorEnd) + 1e-6) - goalProfileU(v(floorEnd) - 1e-6)).toBeCloseTo(0, 5);
    expect(goalProfileU(v(floorEnd) + 2) - goalProfileU(v(floorEnd) + 1)).toBeCloseTo(1 / c.back, 9);
    expect(Math.min(...along.map((s) => Math.abs(goalProfileU(v(s)) - c.atBack)))).toBeLessThan(1e-9);
  });

  it("the goal floor's opaque strips where the game's are (RV-111): the frame and trim, the advert strip's bars", () => {
    // (the frame across the front, the trim to 5280, the frame beside to 5344)
    expect(goalFloorZone(0, 5200)).toBe("frame");
    expect(goalFloorZone(300, 5270)).toBe("frame");
    expect(goalFloorZone(700, 5300)).toBe("frame");
    expect(goalFloorZone(700, 5290)).toBe("frame");
    expect(goalFloorZone(600, 5300)).toBe("grate");
    // (the bars: across at 5338-5350, along |x| 634-646)
    expect(goalFloorZone(300, 5344)).toBe("frame");
    expect(goalFloorZone(640, 5500)).toBe("frame");
    // (the glass and the grate between them)
    expect(goalFloorZone(300, 5500)).toBe("glass");
    expect(goalFloorZone(700, 5500)).toBe("grate");
    expect(goalFloorZone(300, 5900)).toBe("frame");
  });

  it("under each goal OOBFloor, a hex metal slope (RV-104): z -105.5 at |y| 5300, -30.5 at 5900, in its goal's light", () => {
    expect(goalBaseZ(5300)).toBeCloseTo(-105.5, 6);
    expect(goalBaseZ(-5900)).toBeCloseTo(-30.5, 6);
    for (const team of [0, 1]) {
      const base = meshes.find((m) => m.name === `goal base ${String(team)}`);
      expect(base?.material).toBeInstanceOf(HexFloorMaterial);
      expect((base?.material as HexFloorMaterial).piece).toBe(GOAL_BASE_LIGHT[team]);
      // (its vertices on the slope, on its goal's side)
      const position = base?.geometry.getAttribute("position");
      for (let i = 0; position && i < position.count; i++) {
        expect(position.getY(i)).toBeCloseTo(goalBaseZ(position.getZ(i)), 3);
        expect(Math.sign(position.getZ(i))).toBe(team === 0 ? -1 : 1);
      }
    }
  });

  it("each goal's glows in its team's colour, its ribbons glowing 1 at the attached edge, 0 at the free (RV-77)", () => {
    const glows = meshes.filter((m) => m.name.startsWith("goal glow "));
    expect(glows).toHaveLength(2);
    for (const [team, glow] of glows.entries()) {
      expect(glow.material).toBeInstanceOf(GlowStripMaterial);
      const values = glow.geometry.getAttribute("glow");
      const set = new Set<number>();
      for (let i = 0; i < values.count; i++) set.add(values.getX(i));
      expect([...set].sort()).toEqual([0, 1]);
      // (the -y goal's blue, the +y goal's orange)
      const position = glow.geometry.getAttribute("position");
      for (let i = 0; i < position.count; i += 7) expect(Math.sign(position.getZ(i))).toBe(team === 0 ? -1 : 1);
    }
  });
});

describe("ENVPack.G's stand-in (RV-71: our own smooth environment)", () => {
  it("each ring's mean and spread (statistics), one smooth cosine round it; used by the glass, the hex cells, the goal floors", () => {
    expect(ENV_RADIAL).toHaveLength(9);
    expect(ENV_SPREAD).toHaveLength(9);
    expect(ENV_SPREAD[0]).toBe(0); // (the head-on texel: one value)
    expect(ENV_GLSL).toContain("cos(atan(uv.y, uv.x)");
    const glass = new HexGlassMaterial();
    expect(glass.uniforms["envSpread"]?.value).toBe(ENV_SPREAD);
    expect(glass.fragmentShader).toContain("envG(");
    const stadium = new ArenaView(stadiumTheme());
    const shaders: string[] = [];
    stadium.root.traverse((o) => {
      if (o instanceof Mesh && "fragmentShader" in (o.material as object)) shaders.push((o.material as { fragmentShader: string }).fragmentShader);
    });
    // (the floor's hex cells and the goal floors' glass take it too)
    expect(shaders.filter((s) => s.includes("envG(")).length).toBeGreaterThanOrEqual(3);
  });

  it("the goal-side glass's chart is its fitted rules (RV-72, RV-99): V continuous up the face, the bottom row rising with |x|", () => {
    const { face, bottom } = GOAL_SIDE_CHART;
    // (continuous where the bottom's blend meets the face's line)
    expect(goalSideV(1100, face.from - 1e-6)).toBeCloseTo(goalSideV(1100, face.from), 5);
    // (the face's line: falling 0.004873 a uu)
    expect(goalSideV(1100, 600) - goalSideV(1100, 400)).toBeCloseTo(200 * face.perZ, 6);
    // (the bottom row: its smoothstep from v0 at |x| 960 to v0 + rise from 1344, flat beyond)
    expect(goalSideV(bottom.from, bottom.z)).toBeCloseTo(bottom.v0, 6);
    expect(goalSideV(bottom.from + bottom.span / 2, bottom.z)).toBeCloseTo(bottom.v0 + bottom.rise / 2, 6);
    expect(goalSideV(bottom.from + bottom.span + 200, bottom.z)).toBeCloseTo(bottom.v0 + bottom.rise, 6);
  });

  it("envG's rings have ENVPack.G's means and spreads (RV-71, RV-113: our smooth stand-in, one period round each)", () => {
    // (each table entry's ring: s = 0, then 0.0625 + 0.125 (k - 1))
    ENV_RADIAL.forEach((mean, k) => {
      const s = k === 0 ? 0 : 0.0625 + 0.125 * (k - 1);
      const values = Array.from({ length: 720 }, (_, i) => envG(s * Math.cos((i / 720) * 2 * Math.PI), s * Math.sin((i / 720) * 2 * Math.PI)));
      const m = values.reduce((a, b) => a + b, 0) / values.length;
      const sd = Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
      // (the clamp to 0..1 trims a ring whose mean +- sqrt 2 spread leaves it)
      const clamped = mean - Math.SQRT2 * (ENV_SPREAD[k] ?? 0) < 0 || mean + Math.SQRT2 * (ENV_SPREAD[k] ?? 0) > 1;
      if (!clamped) {
        expect(m, `ring ${String(k)} mean`).toBeCloseTo(mean, 3);
        expect(sd, `ring ${String(k)} spread`).toBeCloseTo(ENV_SPREAD[k] ?? 0, 3);
      }
    });
  });

  // The goal-side glass's fitted chart against the mesh's own UVs (local: the game's mesh, never shipped; RV-72, RV-115)
  const glassObj = new URL("../../../out/bsim/assets_local/arena/meshes/Goal_STD_Glass.obj", import.meta.url);
  it.skipIf(!existsSync(glassObj))("the goal-side glass's fitted V within 0.05 of the mesh's UVs (local)", () => {
    const lines = readFileSync(glassObj, "utf8").split("\n");
    const v = lines.filter((l) => l.startsWith("v ")).map((l) => l.split(/\s+/).slice(1, 4).map(Number));
    const vt = lines.filter((l) => l.startsWith("vt ")).map((l) => l.split(/\s+/).slice(1, 3).map(Number));
    let checked = 0;
    for (const f of lines.filter((l) => l.startsWith("f "))) {
      for (const corner of f.split(/\s+/).slice(1)) {
        const [vi = 0, ti = 0] = corner.split("/").map(Number);
        const [x = 0, y = 0, z = 0] = v[vi - 1] ?? [];
        const [, tv = 0] = vt[ti - 1] ?? [];
        // (the panel beside the mouth: y +-5124, |x| 960-1344, from its bottom row up)
        if (Math.abs(Math.abs(y) - 5124) > 2 || Math.abs(x) < 960 || Math.abs(x) > 1344 || z < 126) continue;
        expect(Math.abs(goalSideV(Math.abs(x), z) - tv), `at |x| ${x.toFixed(0)}, z ${z.toFixed(0)}`).toBeLessThan(0.05);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});
