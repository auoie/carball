// The arena with the game's materials (notes/arena-visuals.md H-5, H-6, H-8, H-9, AV-15): its net, trim and cage on every
// map (the user's decision, 2026-10-16), the stadium's field and goals the stadium theme's alone.
import { AdditiveBlending, type BufferGeometry, Color, LinearMipmapNearestFilter, type Material, Mesh, type Object3D, type ShaderMaterial, type Texture, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ArenaView, glowContour } from "./arena";
import { wallLine } from "./arenaSurface";
import type { CageGraph } from "./cage";
import { CageBeams, FIRE_CURVE, curveMips, resampleCurve, shockRing, shockWave } from "./cageBeams";
import { existsSync, readFileSync } from "node:fs";
import { ENV_GLSL, ENV_RADIAL, ENV_SPREAD, GOAL_SIDE_CHART, GlowStripMaterial, HexGlassMaterial, ForceFieldMaterial, envG, goalSideV, netSideUv, overlayUv } from "./gameSurfaces";
import { GOAL_BASE_LIGHT, GoalFloorMaterial, goalBaseZ, goalFloorZone, underGlassV } from "./goalInterior";
import { GOAL_PROFILE_CHART, goalPath, goalProfileU } from "./goalSurface";
import { HexFloorMaterial, SIDE_TRIM, SideTrimMaterial } from "./stadiumField";
import type { MergedPiece } from "./freeze";
import { meadowTheme } from "./themes/meadow";
import { nightTheme } from "./themes/night";
import { stadiumTheme } from "./themes/stadium";
import { ARENA_PRIORITY } from "./translucentSort";
import { FIELD_MEASURES } from "./stadiumFieldRules";

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
    // (beside each goal, the side glass (AV-10: each quadrant's), and the nets: each goal's own mesh, TRN1)
    expect(all.filter((m) => m instanceof HexGlassMaterial)).toHaveLength(8);
    // (each side wall, each team's half; each goal's glows: RV-77; the far glow's quarters, AV-10b)
    expect(all.filter((m) => m instanceof GlowStripMaterial)).toHaveLength(10);
    // (additive: the cage's beams and the floodlights' flare sheets, SUR-13)
    expect(all.filter((m) => m.blending === AdditiveBlending)).toHaveLength(2);
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

  it("the arena's translucents at the game's TranslucencySortPriority (TRN1): the under glass -3, the centre lines -2, the field glows -1, the rest 0 (the cage's lines right after its fill); each goal's pieces their own", () => {
    const orders = new Map<string, Set<number>>();
    stadium.root.traverseVisible((o) => {
      if (!(o instanceof Mesh) || !(o.material as Material).transparent) return;
      const key = o.name || (o.material as Material).constructor.name;
      orders.set(key, (orders.get(key) ?? new Set()).add(o.renderOrder));
    });
    const of = (key: string): number[] => [...(orders.get(key) ?? [])];
    expect(of("goal under glass")).toEqual([ARENA_PRIORITY.goalGlassOuter]);
    expect(of("markings: centre")).toEqual([ARENA_PRIORITY.centreLines]);
    expect(of("markings: goal")).toEqual([ARENA_PRIORITY.base]);
    expect(of("ForceFieldMaterial")).toEqual([ARENA_PRIORITY.base]);
    expect(of("GoalFloorMaterial")).toEqual([ARENA_PRIORITY.base]);
    expect(of("HexGlassMaterial")).toEqual([ARENA_PRIORITY.base]);
    expect(of("GlowStripMaterial").sort((a, b) => a - b)).toEqual([ARENA_PRIORITY.fieldGlow]);
    expect(of("goal glow 0")).toEqual([ARENA_PRIORITY.base]);
    // (each goal its own net and floor: their bounds on their own side; the wall foot's side glass, its own tiles, not a
    // net)
    const nets: Mesh[] = [];
    stadium.root.traverseVisible((o) => {
      if (o instanceof Mesh && o.material instanceof HexGlassMaterial && o.name !== "side glass" && "glassTile" in (o.geometry as BufferGeometry).attributes) nets.push(o as Mesh);
    });
    expect(nets).toHaveLength(2);
    expect(nets.map((n) => Math.sign(n.geometry.boundingSphere?.center.z ?? 0)).sort()).toEqual([-1, 1]);
  });

  it("the wall foot as the game's frame on every map (AV-10, H-4: Side_Trim, its tire marks 0.904, its baked light, the capture along its own reflection)", () => {
    // (three materials: the fillet's; the cap's drawn a little nearer, which the goal frame, the lip, the bar, the posts,
    // the arches and the far glow's trough share; Sideline_A's, its baked light darker, AV-10b)
    const trims = [...new Set(materials(stadium.root).filter((m): m is SideTrimMaterial => m instanceof SideTrimMaterial))];
    expect(trims).toHaveLength(3);
    const fragment = trims[0]?.fragmentShader ?? "";
    expect(fragment).toContain("reflect(-toCamera, normalize(vNormal))");
    expect(fragment).toContain(`vec3(${SIDE_TRIM.light.map((v) => v.toFixed(3)).join(", ")})`);
    expect(SIDE_TRIM.m).toBe(0.904);
    expect(new Set(materials(night.root).filter((m) => m instanceof SideTrimMaterial)).size).toBe(3);
  });

  it("the cap all round (AV-10): z 256-272 from midfield round the corners along the back wall, then up the wing's 45 degree edge (its top 0.8 under the stepped glow's foot) to the goal frame's edge at |x| 969", () => {
    // (one piece of the frame metal's merged mesh: its vertices' range, userData.pieces)
    const caps: { mesh: Mesh; piece: MergedPiece }[] = [];
    night.root.traverse((o) => {
      const piece = ((o.userData["pieces"] ?? []) as MergedPiece[]).find((p) => p.name === "trim cap");
      if (o instanceof Mesh && piece) caps.push({ mesh: o as Mesh, piece });
    });
    expect(caps).toHaveLength(1);
    const cap = caps[0]?.mesh;
    const range = caps[0]?.piece ?? { start: 0, count: 0 };
    const position = cap?.geometry.getAttribute("position");
    expect(range.count).toBeGreaterThan(0);
    let top = 0;
    let minAbsY = Infinity;
    let minAbsX = Infinity;
    for (let i = range.start; i < range.start + range.count; i++) {
      const [x, z, y] = [position?.getX(i) ?? 0, position?.getY(i) ?? 0, position?.getZ(i) ?? 0]; // (Three's frame: x, z up, y)
      minAbsY = Math.min(minAbsY, Math.abs(y));
      minAbsX = Math.min(minAbsX, Math.abs(x));
      // (along the side walls, corners and the back wall out of the goal's reach: the band; on the side walls the front
      // on the wall, x 4096, the deck back to 28 behind)
      expect(z).toBeGreaterThanOrEqual(256 - 1e-3);
      if (Math.abs(x) >= 2048 || Math.abs(y) < 5000) expect(z).toBeLessThanOrEqual(272 + 1e-3);
      if (Math.abs(y) < 3500) {
        expect(Math.abs(x)).toBeGreaterThanOrEqual(4096 - 1e-3);
        expect(Math.abs(x)).toBeLessThanOrEqual(4096 + 28 + 1e-3);
      }
      // (up the wing's edge: under the stepped outline 0.8 below the glow's foot, low then the 45 degree line, its r 96
      // bend rising at most r (sec 22.5 - 1) above where they meet)
      if (Math.abs(x) < 2048) expect(z).toBeLessThanOrEqual(Math.max(272, 1591.5 - 0.8 - Math.abs(x)) + 96 * (1 / Math.cos(Math.PI / 8) - 1) + 1e-3);
      top = Math.max(top, z);
    }
    // (from |y| 128, its end inside the midfield arch: AV-10b; to the frame's edge, its top there on the 45 degree line)
    expect(minAbsY).toBeCloseTo(128, 3);
    expect(minAbsX).toBeCloseTo(969, 3);
    expect(top).toBeCloseTo(1591.5 - 0.8 - 969, 3);
    // (drawn a little nearer than the overlay that lies on the wall with its front face)
    const material = cap?.material as SideTrimMaterial;
    expect(material).toBeInstanceOf(SideTrimMaterial);
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBeLessThan(0);
    expect(material.polygonOffsetUnits).toBeLessThan(0);
  });

  it("every map wears the game's net, trim and cage, in its own team colours; the stadium's field and goals stay its own", () => {
    const all = materials(night.root);
    // (the cage's overlay; the glass beside each goal, the side glass (per quadrant) and the nets; the glow sheets behind
    // the walls, the goals' and the far glow's quarters; the beams additive)
    const overlays = all.filter((m): m is ForceFieldMaterial => m instanceof ForceFieldMaterial);
    expect(overlays).toHaveLength(1);
    expect(all.filter((m) => m instanceof HexGlassMaterial)).toHaveLength(8);
    expect(all.filter((m) => m instanceof GlowStripMaterial)).toHaveLength(10);
    expect(all.filter((m) => m.blending === AdditiveBlending)).toHaveLength(1);
    // (the night theme's own team colours, not the stadium's primaries)
    const { blue, orange } = nightTheme().style.walls;
    const uniforms = overlays[0]?.uniforms as Record<string, { value: unknown }> | undefined;
    const tints = Object.values(uniforms ?? {}).map((u) => u.value).filter((v): v is Color => v instanceof Color).map((c) => c.getHex());
    expect(tints).toEqual(expect.arrayContaining([blue.getHex(), orange.getHex()]));
    // (its goals' floors its own: none of the stadium's goal metal; the game's field for its floor, below)
    expect(all.filter((m) => m instanceof GoalFloorMaterial)).toHaveLength(0);
    // (its five hex floors: four drawn as one, merged, the goal mouths' Reflective_Floor_B its own)
    expect(all.filter((m) => m instanceof HexFloorMaterial)).toHaveLength(2);
  });

  it("Night's floor is the game's field in its team colours (grass, hex floors, frame, boost paths, markings); other maps their own floors (the user's decisions, 2026-10-16)", () => {
    const names = (root: Object3D): Set<string> => {
      const out = new Set<string>();
      root.traverseVisible((o) => {
        if (o instanceof Mesh && o.name !== "") out.add(o.name);
        // (a merged mesh's pieces by their own names)
        for (const piece of (o.userData["pieces"] ?? []) as MergedPiece[]) out.add(piece.name);
      });
      return out;
    };
    const nightNames = names(night.root);
    const field = ["grass", "seams", "hex floor: side bays", "hex floor: pad bases", "hex floor: goal ends", "hex floor: goal mouths", "hex floor: centre disc", "vent grate", "vent ring", "centre strips", "halfway strip", "centre trim", "trim lines E", "centreStrip lines D", "markings: goal", "markings: side", "markings: centre"];
    for (const piece of field) expect(nightNames, piece).toContain(piece);
    // (the stadium's as it was; another map none of it)
    const stadiumNames = names(stadium.root);
    for (const piece of field) expect(stadiumNames, piece).toContain(piece);
    const meadow = names(new ArenaView(meadowTheme()).root);
    for (const piece of field) expect(meadow, piece).not.toContain(piece);
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

describe("the cage beams' scan stripes (H-8, BR1: a far beam's average out, as the game's mips have them)", () => {
  it("Curve_Fire_01 at its 512 texels, 10 mips, each its level above's box average, the last its mean (the game's 0.481-0.487)", () => {
    const levels = curveMips(resampleCurve(FIRE_CURVE, 512));
    expect(levels.map((l) => l.length)).toEqual([512, 256, 128, 64, 32, 16, 8, 4, 2, 1]);
    const last = levels.at(-1)?.[0] ?? 0;
    expect(last).toBeGreaterThan(0.479);
    expect(last).toBeLessThan(0.489);
    const [a, b] = [levels[3] ?? [], levels[4] ?? []];
    b.forEach((v, i) => {
      expect(v).toBeCloseTo(((a[2 * i] ?? 0) + (a[2 * i + 1] ?? 0)) / 2, 9);
    });
    // (resampled as a linear filter reads it: its texels' mean kept)
    expect(levels[0]?.reduce((sum, v) => sum + v, 0) ?? 0).toBeCloseTo((FIRE_CURVE.reduce((sum, v) => sum + v, 0) / FIRE_CURVE.length) * 512, 6);
  });

  it("sampled at a continuous coordinate (no per-pixel frac: the mip as the game's picks it), its time wrapped on the CPU", () => {
    const beams = new CageBeams({ vertices: [], edges: [], beams: [] }, stadiumTheme().style.walls);
    const material = beams.mesh.material as ShaderMaterial;
    expect(material.fragmentShader).toContain("texture2D(table, vec2(v, 0.5))");
    expect(material.fragmentShader).not.toMatch(/fract\(v\)/);
    const fire = material.uniforms["fire"]?.value as Texture;
    expect([fire.mipmaps.length, fire.minFilter, fire.generateMipmaps]).toEqual([10, LinearMipmapNearestFilter, false]);
    beams.time = 3725.25;
    expect(material.uniforms["time"]?.value).toBeCloseTo(0.25, 9);
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
  const beams = new CageBeams(graph, stadiumTheme().style.walls);
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
    expect(meshes.filter((m) => m.name === "goal under glass")).toHaveLength(2);
    expect(meshes.filter((m) => m.name === "goal base bevels")).toHaveLength(2);
    expect(meshes.filter((m) => m.material instanceof GoalFloorMaterial)).toHaveLength(4);
    // (the frame's tire marks inside its saturate, as H-4's: sat((R + 4 (0.125 + 0.625 G) cube) m) x its light, both
    // places: RV-168d)
    const frame = new GoalFloorMaterial({ value: null as never }).fragmentShader;
    const inside = /clamp\(\(vec3\([\d.]+\) \+ 4\.0 \* \(0\.125 \+ 0\.625 \* [\d.]+\) \* cube\) \* 0\.931, 0\.0, 1\.0\) \* frameLight/g;
    expect(frame.match(inside)).toHaveLength(2);
    expect(frame).not.toMatch(/frameLight \* 0\.931/);
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
    // (RV-142: the advert strip's second bar across the ramp, its bars along to 5808; the lower glass's V 3 -> 2 inside
    // to out in every 256 strip)
    expect(goalFloorZone(300, 5760)).toBe("frame");
    expect(goalFloorZone(640, 5790)).toBe("frame");
    expect(underGlassV(64)).toBeCloseTo(2.75, 9);
    expect(underGlassV(320)).toBeCloseTo(2.75, 9);
    // (RV-168b: Goal_STD_Trim's up-facing strip along the sides)
    expect(goalFloorZone(750, 5600)).toBe("frame");
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

  it("each goal's glows in its team's colour, its ribbons glowing at the attached edge (1; the beside ribbon its 0.969), 0 at the free (RV-77)", () => {
    const glows = meshes.filter((m) => m.name.startsWith("goal glow "));
    expect(glows).toHaveLength(2);
    for (const [team, glow] of glows.entries()) {
      expect(glow.material).toBeInstanceOf(GlowStripMaterial);
      const values = glow.geometry.getAttribute("glow");
      const set = new Set<number>();
      for (let i = 0; i < values.count; i++) set.add(values.getX(i));
      expect([...set].sort()).toEqual([0, Math.fround(FIELD_MEASURES.glow.beside.glow), 1]);
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
    // (the tables in the shared texture, row 2: means, spreads)
    const tables = glass.uniforms["constTables"]?.value as { image: { data: Float32Array } } | undefined;
    expect(ENV_SPREAD.map((_, i) => tables?.image.data[(2 * 32 + i) * 4 + 1])).toEqual(ENV_SPREAD.map((v) => Math.fround(v)));
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

  /** A local mesh's triangles: each corner's position and UV, and the face's normal */
  const meshFaces = (url: URL): { p: number[][]; uv: number[][]; n: [number, number, number] }[] => {
    const lines = readFileSync(url, "utf8").split("\n");
    const v = lines.filter((l) => l.startsWith("v ")).map((l) => l.split(/\s+/).slice(1, 4).map(Number));
    const vt = lines.filter((l) => l.startsWith("vt ")).map((l) => l.split(/\s+/).slice(1, 3).map(Number));
    return lines
      .filter((l) => l.startsWith("f "))
      .map((f) => {
        const corners = f.split(/\s+/).slice(1, 4).map((c) => c.split("/").map(Number));
        const p = corners.map(([vi = 0]) => v[vi - 1] ?? [0, 0, 0]);
        const uv = corners.map(([, ti = 0]) => vt[ti - 1] ?? [0, 0]);
        const [a, b, c] = p.map((q) => new Vector3(q[0], q[1], q[2])) as [Vector3, Vector3, Vector3];
        const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        return { p, uv, n: [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)] as [number, number, number] };
      })
      .filter((f) => f.n.every(Number.isFinite));
  };
  const meshes = new URL("../../../out/bsim/assets_local/arena/meshes/", import.meta.url);

  // The overlays' charts against the FF meshes' own UVs (local; RV-74, RV-109: the vertical corners either side of their
  // seam, the fillets, the roof)
  it.skipIf(!existsSync(new URL("FF_Goal.obj", meshes)))("the overlays' charts within 0.04 of FF_Goal's, FF_Side's and FF_Roof's UVs at every corner (local)", () => {
    for (const name of ["FF_Goal", "FF_Side", "FF_Roof"]) {
      let checked = 0;
      for (const f of meshFaces(new URL(`${name}.obj`, meshes))) {
        f.p.forEach(([x = 0, y = 0, z = 0], k) => {
          const [u, v] = overlayUv([x, y, z], f.n);
          const [mu = 0, mv = 0] = f.uv[k] ?? [];
          expect(Math.max(Math.abs(u - mu), Math.abs(v - mv)), `${name} at (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}), n ${f.n.map((c) => c.toFixed(3)).join(", ")}`).toBeLessThan(0.04);
          checked++;
        });
      }
      expect(checked, name).toBeGreaterThan(100);
    }
  });

  // The net's flat side walls' chart against Goal_STD_Glass_Outer's UVs (local; RV-110)
  it.skipIf(!existsSync(new URL("Goal_STD_Glass_Outer.obj", meshes)))("the net side walls' chart within 0.01 of Goal_STD_Glass_Outer's UVs (local)", () => {
    let checked = 0;
    for (const f of meshFaces(new URL("Goal_STD_Glass_Outer.obj", meshes))) {
      if (f.n[0] < 0.97 || f.p.some(([, y = 0]) => Math.abs(y) < 5150)) continue;
      f.p.forEach(([, y = 0, z = 0], k) => {
        const [u, v] = netSideUv(Math.abs(y), z);
        const [mu = 0, mv = 0] = f.uv[k] ?? [];
        expect(Math.max(Math.abs(u - mu), Math.abs(v - mv))).toBeLessThan(0.01);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(100);
  });
});
