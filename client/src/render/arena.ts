// The arena as the game draws it: the walls and ceiling one continuous swept surface (src/render/arenaSurface.ts: floor
// fillet, wall and ceiling fillet round the whole field and the ceiling inside it, from the collision mesh's rules but
// without its pieces' overlaps and hidden skirts), see-through, with the game's cage of beams on it (src/render/cage.ts,
// src/render/cageBeams.ts) lighting up around the ball; the wall's foot wrapped in a grey trim with a team-coloured
// light along its top; the goals' insides (src/render/goalSurface.ts: a finer pattern, as a net) behind a
// team-coloured frame round each mouth; the floor. The cage shows from both sides (the game's is visible from outside
// the arena too); the trim and frames only from inside, so they never hide a car driving on the wall from the camera
// behind it. Around it all, the theme's scenery (src/render/themes/).
// With the game's materials (a theme's `walls.game`, notes/arena-visuals.md): the walls carry the game's overlay round
// the ball (H-9) instead of our fill, the beams stop at the wall's foot, hex glass (H-6) beside the goal mouths and as
// the goals' nets, and team glow sheets (H-5) behind the side walls instead of the light along the trim.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  FrontSide,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  ShapeUtils,
  Vector2,
  type Vector3,
  type Scene,
  type WebGLRenderer,
} from "three";
import { toThreeVector } from "./coords";
import { BALL_RADIUS } from "./entities";
import { type ArenaSurface, buildArenaSurface, floorOutline, mouthOutline, wallLine } from "./arenaSurface";
import { addBallShadow } from "./ballShadow";
import { cageGraph } from "./cage";
import { CageBeams, shockWave } from "./cageBeams";
import { type GoalSurface, buildGoalSurface, goalProfileU } from "./goalSurface";
import { ForceFieldMaterial, GlowStripMaterial, HexGlassMaterial } from "./gameSurfaces";
import { HexWallMaterial } from "./hexWalls";
import { fullBright, linear } from "./teamColors";
import { mergeByMaterial } from "./merge";
import { GoalFloorMaterial, goalUnderlayers } from "./goalInterior";
import { GrassCube } from "./grassCube";
import { buildStadiumField, frameFloorMaterial, SideTrimMaterial } from "./stadiumField";
import { fieldPlan } from "./stadiumFieldRules";
import type { ArenaStyle, Theme } from "./themes/theme";
import { vec3 } from "../math/vec";
import { ARENA_PRIORITY, fitIndexedBounds } from "./translucentSort";

/** The arena's dimensions (uu, the game's frame). The side walls are flat up to |y| = cornerTangentY, where the
 *  corner curves of the mesh begin (the game's Bézier corners: tested against the mesh); the corners meet the back
 *  walls at |x| = cornerTangentX. */
export const ARENA = {
  sideX: 4096,
  backY: 5120,
  height: 2048,
  /** The goal posts; the goals' own floors (the mesh's: the ramp up to the back) start this far behind the goal line */
  goalHalfWidth: 893,
  goalFloorStart: 234.67,
  cornerTangentY: 3584,
  cornerTangentX: 2560,
};
const TEAM_COLORS: readonly [Color, Color] = [new Color(0x2a7fff), new Color(0xff8a1f)]; // blue (-y goal), orange (+y goal)
/** The game's goal floors (Reflective_Floor_V2: plain metal) and lip (the frame's grey), before the light */
const GOAL_METAL = new Color(0x5a5f66);
/** Width of the mown stripes across the field (uu) */
const STRIPE_WIDTH = 512;

export class ArenaView {
  readonly root = new Group();
  readonly #cage: HexWallMaterial | ForceFieldMaterial; // the walls' and ceiling's see-through fill (or the game's overlay)
  readonly #beams: CageBeams; // the cage on them
  readonly #net: HexWallMaterial | HexGlassMaterial; // the goals' insides (a finer pattern, as a net; or the game's glass)
  readonly #style: ArenaStyle;
  readonly #theme: Theme;
  /** The teams' colours on the arena: the theme's (the game's: the linear primaries, AV-2), else ours */
  readonly #teamColors: readonly [Color, Color];
  /** The game's reflection capture (with the game's materials: the field reflects it) */
  readonly #grassCube: GrassCube | null;
  #seconds = 0;
  /** World seconds since the ball exploded (a goal), null with a ball in play: the cage's shockwave (AV-15) */
  #sinceExplosion: number | null = null;

  constructor(theme: Theme) {
    this.#theme = theme;
    this.#grassCube = theme.style.walls.game ? new GrassCube() : null;
    this.#style = theme.style;
    this.#teamColors = theme.style.walls.game ? [theme.style.walls.blue, theme.style.walls.orange] : TEAM_COLORS;
    const surface = buildArenaSurface();
    const goals = buildGoalSurface(GOAL_NET_HEX);
    const { walls } = theme.style;
    if (walls.game) {
      this.#cage = new ForceFieldMaterial(walls.blue, walls.orange);
      this.#net = new HexGlassMaterial({ net: true });
    } else {
      this.#cage = new HexWallMaterial(BALL_RADIUS, walls, { lines: false });
      this.#net = new HexWallMaterial(BALL_RADIUS, walls, { scale: 1 / goals.hexSize });
    }
    this.#beams = new CageBeams(cageGraph(!walls.game), BALL_RADIUS, walls);
    this.root.add(
      this.#buildWalls(surface),
      this.#beams.mesh,
      this.#buildGoals(goals),
      this.#buildFloor(),
      // (the game's field has its own markings: AV-7)
      ...(walls.game ? [] : [buildFieldMarkings(theme.style.markings)]),
      theme.root,
    );
    // (the theme's materials that sample the capture (a `grassCube` uniform: the banners', RV-178) share its uniform)
    const cube = this.#grassCube;
    if (cube) {
      theme.root.traverse((m) => {
        const material = (m as { material?: { uniforms?: Record<string, unknown> } }).material;
        if (material?.uniforms?.["grassCube"] !== undefined) material.uniforms["grassCube"] = cube.uniform;
      });
    }
  }

  /** Once per frame: lights the walls around the ball (Three.js frame) and animates the theme's scenery. */
  update(ballPosition: Vector3, frameSeconds: number): void {
    this.#cage.ballPosition.copy(ballPosition);
    this.#beams.ballPosition.copy(ballPosition);
    if (this.#net instanceof HexWallMaterial) this.#net.ballPosition.copy(ballPosition);
    this.#seconds += frameSeconds;
    if (this.#sinceExplosion !== null) this.#sinceExplosion += Math.max(0, frameSeconds);
    this.#beams.shockWave = shockWave(this.#sinceExplosion);
    this.#beams.time = this.#seconds;
    this.#theme.update(this.#seconds, ballPosition);
  }

  /** The arena's reflection capture (AV-3: at load, and again when the team colours change), with only the arena and
   *  its theme drawn; nothing without the game's materials. Run with the WebGL renderer before a frame
   *  (Renderer.beforeNextFrame) */
  capture(gl: WebGLRenderer, scene: Scene): void {
    // (three times, as the game re-captures over its first 2 s, each reading the last: the first with the reflective
    // surfaces seeing nothing, the others the last capture, blurred, in their own directions; it converges by the second
    // or third, SUR-32, AV-3)
    const cube = this.#grassCube;
    if (!cube) return;
    const captureOnly = this.#theme.captureOnly ?? null;
    cube.capture(gl, scene, this.root, captureOnly, [0, 0, 0]);
    cube.capture(gl, scene, this.root, captureOnly);
    cube.capture(gl, scene, this.root, captureOnly);
  }

  /** Reflection captures so far (for tests) */
  get captures(): number {
    return this.#grassCube?.captures ?? 0;
  }

  /** The last reflection capture's faces, linear floats, stored or as rendered (GrassCube.readCapture; none without one) */
  readCapture(gl: WebGLRenderer, raw = false): Float32Array[] | null {
    return this.#grassCube?.readCapture(gl, raw) ?? null;
  }

  /** The ball exploded (a goal): the cage's shockwave starts */
  explode(): void {
    this.#sinceExplosion = 0;
  }

  /** The cage's shockwave now (AV-15) */
  get shockWave(): number {
    return shockWave(this.#sinceExplosion);
  }

  /** A new ball: the shockwave is over */
  newBall(): void {
    this.#sinceExplosion = null;
  }

  /** The swept walls: the hexagon cage above the floor fillet, the grey trim on it, a light along the trim's top. */
  #buildWalls(surface: ArenaSurface): Group {
    const { positions, bands, indices } = surface;
    const threePositions = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      threePositions.set([positions[i] ?? 0, positions[i + 2] ?? 0, positions[i + 1] ?? 0], i);
    }
    const trimIndices: number[] = [];
    const cageIndices: number[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      const tri = [indices[i] ?? 0, indices[i + 1] ?? 0, indices[i + 2] ?? 0] as const;
      const onTrim = tri.every((v) => (bands[v] ?? -1) >= 0);
      // Swapping y and z mirrors the winding: two indices swapped per triangle keep it facing the field
      (onTrim ? trimIndices : cageIndices).push(tri[0], tri[2], tri[1]);
    }
    const geometry = (triangles: number[]): BufferGeometry => {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(threePositions, 3));
      g.setIndex(triangles);
      g.computeVertexNormals();
      return g;
    };
    const cage = new Mesh(geometry(cageIndices), this.#cage);
    cage.renderOrder = ARENA_PRIORITY.base; // (FFCage_Full: TRN1)
    // (the game's arena: the wall's foot its baked frame (Side_Trim: AV-10, H-4); ours lit, the ball's shadow up it)
    const capture = this.#grassCube?.uniform;
    const trimMaterial =
      this.#style.walls.game && capture
        ? new SideTrimMaterial(capture, this.#cage.ballPosition, BALL_RADIUS)
        : new MeshStandardMaterial({ color: TRIM_COLOR, roughness: 0.6, metalness: 0.3, side: FrontSide });
    if (trimMaterial instanceof MeshStandardMaterial) addBallShadow(trimMaterial, this.#cage.ballPosition, BALL_RADIUS);
    const trim = new Mesh(geometry(trimIndices), trimMaterial);
    const group = new Group();
    group.add(cage, trim);
    if (this.#style.walls.game) group.add(...glowSheets(this.#style), backGlass(0), backGlass(1));
    else group.add(trimLight(surface));
    return group;
  }

  /** The goals: their insides (floors opaque in the team's colour, the net see-through, the mouth's lip lit in the
   *  team's colour, the post bases grey like the trim they join) and a frame round each mouth. */
  #buildGoals(goals: GoalSurface): Group {
    const { positions, uvs } = goals;
    const game = this.#style.walls.game === true;
    const threePositions = new Float32Array(positions.length);
    const colors = new Float32Array(positions.length);
    const color = new Color();
    for (let i = 0; i < positions.length; i += 3) {
      threePositions.set([positions[i] ?? 0, positions[i + 2] ?? 0, positions[i + 1] ?? 0], i);
      // (the game's goals: no team colour on the floor or the lip, plain metal and the grey frame: AV-13, RV-63)
      color.copy(game ? GOAL_METAL : TEAM_COLORS[(positions[i + 1] ?? 0) < 0 ? 0 : 1]);
      colors.set([color.r, color.g, color.b], i);
    }
    // The game's glass on the net: its tiles at UV0 x (3, 7/3), its U along the profile (the game's chart: goalProfileU,
    // RV-110) and V across the goal, GOAL_GLASS_V uu a unit (HEX-1, HEX-4; RV-67: ours has u across, v along the profile)
    const glassTiles = new Float32Array(uvs.length);
    for (let i = 0; i < uvs.length; i += 2) {
      glassTiles[i] = 3 * goalProfileU(uvs[i + 1] ?? 0);
      glassTiles[i + 1] = ((7 / 3) * (uvs[i] ?? 0)) / GOAL_GLASS_V;
    }
    // Swapping y and z mirrors the winding: two indices swapped per triangle keep it facing into the goal
    const geometry = (triangles: Uint32Array): BufferGeometry => {
      const swapped = new Uint32Array(triangles.length);
      for (let i = 0; i < triangles.length; i += 3) {
        swapped.set([triangles[i] ?? 0, triangles[i + 2] ?? 0, triangles[i + 1] ?? 0], i);
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(threePositions, 3));
      g.setAttribute("surfaceUv", new BufferAttribute(uvs, 2));
      g.setAttribute("glassTile", new BufferAttribute(glassTiles, 2));
      g.setAttribute("color", new BufferAttribute(colors, 3));
      g.setIndex(new BufferAttribute(swapped, 1));
      g.computeVertexNormals();
      return g;
    };
    const floorMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: FrontSide });
    if (game) {
      floorMaterial.roughness = 0.45;
      floorMaterial.metalness = 0.6;
    } else floorMaterial.color.setScalar(0.4); // (the team's colour, dimmed)
    addBallShadow(floorMaterial, this.#cage.ballPosition, BALL_RADIUS);
    // (each goal's own pieces, sorted by their own bounds as the game's per-goal primitives: TRN1)
    const perGoal = (triangles: Uint32Array): Uint32Array[] =>
      ([-1, 1] as const).map((sy) => {
        const kept: number[] = [];
        for (let i = 0; i < triangles.length; i += 3) {
          if (Math.sign(positions[3 * (triangles[i] ?? 0) + 1] ?? 0) === sy) kept.push(triangles[i] ?? 0, triangles[i + 1] ?? 0, triangles[i + 2] ?? 0);
        }
        return Uint32Array.from(kept);
      });
    const nets = perGoal(goals.net).map((t) => {
      const net = new Mesh(fitIndexedBounds(geometry(t)), this.#net);
      net.renderOrder = ARENA_PRIORITY.base; // (the nets, Goal_STD_Glass: TRN1)
      return net;
    });
    const postMaterial = new MeshStandardMaterial({ color: TRIM_COLOR, roughness: 0.6, metalness: 0.3, side: FrontSide });
    addBallShadow(postMaterial, this.#cage.ballPosition, BALL_RADIUS);
    // The game's goal floors: see-through and layered (RV-76): the frame, the grate, the glass on the ramp, and under them
    // a second glass, the glows and dark metal
    const cube = this.#grassCube?.uniform;
    const floorGeometries = perGoal(goals.floor).map((t) => fitIndexedBounds(geometry(t)));
    const goalFloor = game && cube ? new GoalFloorMaterial(cube) : floorMaterial;
    const floors = floorGeometries.map((g) => {
      const floor = new Mesh(g, goalFloor);
      floor.renderOrder = ARENA_PRIORITY.base; // (Goal_STD_Glass: TRN1)
      return floor;
    });
    const group = new Group();
    group.add(
      ...floors,
      ...(game && cube ? goalUnderlayers(floorGeometries, cube, this.#teamColors) : []),
      ...nets,
      new Mesh(geometry(goals.lip), new MeshBasicMaterial({ vertexColors: true, side: FrontSide })),
      new Mesh(geometry(goals.postBase), postMaterial),
      // (the game's: its glows, not our lit band: RV-77)
      goalFrame(0, game ? null : this.#teamColors[0]),
      goalFrame(1, game ? null : this.#teamColors[1]),
      ...(game ? goalGlows(this.#style) : []),
    );
    return group;
  }

  #buildFloor(): Group {
    const group = new Group();
    // Pushed back in depth: the mesh's floor pieces lie in the same plane and draw over it
    const { floor: floorColor, floorStripe } = this.#style;
    const floorMat = new MeshStandardMaterial({
      color: floorStripe ? 0xffffff : floorColor,
      roughness: 0.95,
      side: FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 4,
    });
    // (the floor's texture coordinates are in uu: one pair of stripes per 2 STRIPE_WIDTH)
    if (floorStripe) floorMat.map = stripeTexture(floorColor, floorStripe, 1 / (STRIPE_WIDTH * 2));

    // The game's field (AV-5..9): the floor the frame's metal (its seams between the regions), the field above it,
    // reflecting the arena's capture
    const { walls } = this.#style;
    const cube = this.#grassCube?.uniform;
    if (walls.game && cube) group.add(buildStadiumField(walls.blue, walls.orange, cube));

    // Floor, out to the trim's foot. The shape faces +z; rotate it to face up (+y in Three)
    const floor = new Mesh(new ShapeGeometry(floorShape()), walls.game && cube ? frameFloorMaterial(cube, walls.blue, walls.orange) : floorMat);
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);
    return group;
  }
}

/** The hexagons inside the goals: smaller, like a net (uu across) */
const GOAL_NET_HEX = 180;
/** The game's goal glass: uu per UV0 unit across the goal (HEX-4: 204.2; U along the profile: goalSurface.ts
 *  goalProfileU; the side walls their own planar chart: HexGlassMaterial's `net`) */
const GOAL_GLASS_V = 204.2;
/** The game's glass panel beside each goal mouth (Goal_STD_Glass: y = +-5124; RV-66, RV-72): its outline the field
 *  plan's (src/render/stadiumFieldRules.ts), its chart in the glass shader (`goalSide`) */
const BACK_GLASS = { y: 5124 } as const;
/** The game's team glow sheets (AV-11, Field_STD_Glow): 16 uu behind the walls, from the trim's cap (z 272) to 400,
 *  from |y| 128 on the side walls round the corners and along the back walls to |x| 2048 */
const GLOW_SHEET = { behind: 16, z0: 272, z1: 400, y0: 128, x1: 2048 } as const;
/** The trim's grey (the game's: a light, slightly metallic grey round the wall's foot) */
const TRIM_COLOR = 0x9aa0a8;
/** The light along the trim's top: this tall on the wall (uu), in each team's colour on its half */
const TRIM_LIGHT_HEIGHT = 14;
/** The frame round a goal mouth: its width on the back wall, and the light along its inner edge (uu) */
const FRAME_WIDTH = 70;
const FRAME_LIGHT_WIDTH = 14;

/** A glowing strip along the top of the floor fillet, just in front of the wall: blue on blue's half, orange on
 *  orange's, blending over midfield. */
function trimLight(surface: ArenaSurface): Mesh {
  const { positions, bands, indices } = surface;
  // The trim's top edge: the fillet's last point (band 1) of each column; its triangles' top edges join them
  const top = new Set<number>();
  for (let i = 0; i < bands.length; i++) if (bands[i] === 1) top.add(i);
  const pos: number[] = [];
  const colors: number[] = [];
  const idx: number[] = [];
  const color = new Color();
  const vertexFor = new Map<number, [number, number]>();
  const add = (v: number): [number, number] => {
    const known = vertexFor.get(v);
    if (known) return known;
    const x = positions[v * 3] ?? 0;
    const y = positions[v * 3 + 1] ?? 0;
    const z = positions[v * 3 + 2] ?? 0;
    // (1 uu off the wall towards the field, along the wall's normal there: x or y inward)
    const nx = Math.abs(x) > ARENA.sideX - 1 ? -Math.sign(x) : 0;
    const ny = nx === 0 ? -Math.sign(y) : 0;
    color.copy(TEAM_COLORS[0]).lerp(TEAM_COLORS[1], Math.min(1, Math.max(0, (y + 200) / 400)));
    const base = pos.length / 3;
    for (const dz of [0, TRIM_LIGHT_HEIGHT]) {
      pos.push(x + nx, z + dz, y + ny); // (Three's frame)
      colors.push(color.r, color.g, color.b);
    }
    const pair: [number, number] = [base, base + 1];
    vertexFor.set(v, pair);
    return pair;
  };
  // The top edges of the trim's triangles, in their order there (the triangles face the field: a strip above an
  // edge faces the same way when it runs along the edge the other way round)
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i] ?? 0, indices[i + 1] ?? 0, indices[i + 2] ?? 0];
    if (!tri.every((v) => (bands[v] ?? -1) >= 0)) continue;
    for (let k = 0; k < 3; k++) {
      const a = tri[k] ?? 0;
      const b = tri[(k + 1) % 3] ?? 0;
      if (!top.has(a) || !top.has(b)) continue;
      const [a0, a1] = add(a);
      const [b0, b1] = add(b);
      // (b0, a0, a1, b0, a1, b1) in the game's frame; its y and z swapped in Three's mirror the winding
      idx.push(b0, a1, a0, b0, b1, a1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  g.setIndex(idx);
  return new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: FrontSide }));
}

/** The game's team glow sheets (H-5): one per quadrant, 16 uu behind the wall's line (wallLine: the side wall, the
 *  corner and the back wall), cut at |y| 128 and |x| 2048, attached at the bottom (RV-59) */
export function glowContour(): readonly (readonly [number, number])[] {
  const out: [number, number][] = [];
  const line = wallLine();
  const at = (k: number): [number, number] | null => {
    const s = line[k];
    return s ? [s.p[0] - s.n[0] * GLOW_SHEET.behind, s.p[1] - s.n[1] * GLOW_SHEET.behind] : null;
  };
  for (let k = 0; k < line.length; k++) {
    const q = at(k);
    const next = at(k + 1);
    if (!q) continue;
    if (q[1] >= GLOW_SHEET.y0 && q[0] >= GLOW_SHEET.x1) out.push(q);
    // (the cuts exactly where the line crosses them)
    if (next) {
      if (q[1] < GLOW_SHEET.y0 && next[1] > GLOW_SHEET.y0) {
        const f = (GLOW_SHEET.y0 - q[1]) / (next[1] - q[1]);
        out.push([q[0] + (next[0] - q[0]) * f, GLOW_SHEET.y0]);
      }
      if (q[0] > GLOW_SHEET.x1 && next[0] < GLOW_SHEET.x1) {
        const f = (q[0] - GLOW_SHEET.x1) / (q[0] - next[0]);
        out.push([GLOW_SHEET.x1, q[1] + (next[1] - q[1]) * f]);
      }
    }
  }
  return out;
}

/** The goals' glows (Goal_STD_Glow, H-5, RV-77): ribbons round each mouth, on the back wall's stepped outline, along
 *  the floor panels' edges and under the goal's floor, glowing from the edge each is attached to (glow 1) to its free
 *  edge (0), in the team's colour (src/render/stadiumFieldRules.ts: the +y goal's; the -y goal's mirrored) */
function goalGlows(style: ArenaStyle): Mesh[] {
  const { blue, orange } = style.walls;
  return [blue, orange].map((primary, team) => {
    const sy = team === 0 ? -1 : 1;
    const pos: number[] = [];
    const glow: number[] = [];
    const idx: number[] = [];
    for (const ribbon of fieldPlan().goalGlow) {
      const n = Math.min(ribbon.attached.length, ribbon.free.length) / 3;
      const base = pos.length / 3;
      for (let i = 0; i < n; i++) {
        for (const [edge, value] of [[ribbon.attached, 1], [ribbon.free, 0]] as const) {
          // (Three's frame: x, z up, y)
          pos.push(edge[3 * i] ?? 0, edge[3 * i + 2] ?? 0, sy * (edge[3 * i + 1] ?? 0));
          glow.push(value);
        }
        if (i > 0) {
          const k = base + 2 * i;
          idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("glow", new BufferAttribute(new Float32Array(glow), 1));
    g.setIndex(idx);
    const mesh = new Mesh(g, new GlowStripMaterial(primary, linear(fullBright([primary.r, primary.g, primary.b]))));
    mesh.renderOrder = ARENA_PRIORITY.base; // (Goal_STD_Glow: TRN1)
    mesh.name = `goal glow ${String(team)}`;
    return mesh;
  });
}

function glowSheets(style: ArenaStyle): Mesh[] {
  const { blue, orange } = style.walls;
  const contour = glowContour();
  const sheets: Mesh[] = [];
  for (const [team, primary] of [blue, orange].entries()) {
    const material = new GlowStripMaterial(primary, linear(fullBright([primary.r, primary.g, primary.b])));
    const sy = team === 0 ? -1 : 1;
    for (const sx of [-1, 1]) {
      const pos: number[] = [];
      const glow: number[] = [];
      const idx: number[] = [];
      contour.forEach(([x, y], k) => {
        // (Three's frame: x, z up, y)
        pos.push(sx * x, GLOW_SHEET.z0, sy * y, sx * x, GLOW_SHEET.z1, sy * y);
        glow.push(1, 0);
        if (k > 0) idx.push(2 * k - 2, 2 * k - 1, 2 * k, 2 * k - 1, 2 * k + 1, 2 * k);
      });
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute("glow", new BufferAttribute(new Float32Array(glow), 1));
      g.setIndex(idx);
      const mesh = new Mesh(g, material);
      mesh.renderOrder = ARENA_PRIORITY.fieldGlow; // (Field_STD_Glow: TRN1)
      sheets.push(mesh);
    }
  }
  return sheets;
}

/** The game's hex glass beside a goal's mouth on the back wall (team 0: blue, at -y), both sides, just behind the
 *  wall's surface (the goal's frame covers its inner corner) */
function backGlass(team: 0 | 1): Mesh {
  const side = team === 0 ? -1 : 1;
  const outline = fieldPlan().goalSideGlass;
  const contour = outline.map(([x, z]) => new Vector2(x, z));
  const triangles = ShapeUtils.triangulateShape(contour, []);
  const pos: number[] = [];
  const idx: number[] = [];
  for (const sx of [-1, 1]) {
    const base = pos.length / 3;
    for (const [ax, z] of outline) pos.push(sx * ax, z, side * BACK_GLASS.y);
    for (const [a = 0, b = 0, c = 0] of triangles) idx.push(base + a, base + b, base + c);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // (its glass tiles from the position: the shader's goal-side chart)
  const mesh = new Mesh(g, new HexGlassMaterial({ goalSide: true }));
  mesh.renderOrder = ARENA_PRIORITY.base; // (Goal_STD_Glass: TRN1)
  return mesh;
}

/** The frame round a goal's mouth on the back wall (team 0: blue, at -y): a light along the opening's edge in the
 *  team's colour and a grey band outside it, flat on the wall just in front of it (nothing the ball could hit). */
/** A goal mouth's frame on the back wall: our lit band along its inner edge in `light` (none: the game's glows draw
 *  there), the grey trim round it */
function goalFrame(team: 0 | 1, light: Color | null): Group {
  const side = team === 0 ? -1 : 1;
  const y = side * (ARENA.backY - 1.5);
  // The opening's edge (x, z) round from one post's foot to the other's, with its outward normal
  const half = mouthOutline(); // post top arc then the crossbar to the centre, x >= 0
  const edge: { x: number; z: number; nx: number; nz: number }[] = [];
  const [first] = half;
  if (first) edge.push({ x: first[0], z: 0, nx: 1, nz: 0 });
  for (let i = 0; i < half.length; i++) {
    const p = half[i];
    const a = half[Math.max(0, i - 1)];
    const b = half[Math.min(half.length - 1, i + 1)];
    if (!p || !a || !b) continue;
    // Outward: the edge's tangent (towards the centre line) turned up and out
    const tx = b[0] - a[0];
    const tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    edge.push({ x: p[0], z: p[1], nx: tz / l < 0 ? -tz / l : tz / l, nz: Math.abs(tx / l) });
  }
  const full = [...edge, ...edge.slice(0, -1).reverse().map((e) => ({ x: -e.x, z: e.z, nx: -e.nx, nz: e.nz }))];
  const band = (from: number, to: number, material: MeshBasicMaterial | MeshStandardMaterial): Mesh => {
    const pos: number[] = [];
    const idx: number[] = [];
    full.forEach((e, i) => {
      for (const d of [from, to]) pos.push(e.x + e.nx * d, Math.max(0, e.z + e.nz * d), y); // (Three's frame: x, up, y)
      if (i > 0) {
        const k = i * 2;
        // (facing the field: -y for orange's goal at +y, so +z in Three is +y here)
        idx.push(...(side > 0 ? [k - 2, k, k + 1, k - 2, k + 1, k - 1] : [k - 2, k + 1, k, k - 2, k - 1, k + 1]));
      }
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new Mesh(g, material);
  };
  const group = new Group();
  const trim = new MeshStandardMaterial({ color: TRIM_COLOR, roughness: 0.5, metalness: 0.4, side: FrontSide });
  group.add(
    light ? band(0, FRAME_LIGHT_WIDTH, new MeshBasicMaterial({ color: light, side: FrontSide })) : band(0, FRAME_LIGHT_WIDTH, trim),
    band(FRAME_LIGHT_WIDTH, FRAME_WIDTH, trim),
  );
  return group;
}

/** Centre line, centre circle and goal lines, just above the floor (merged: one draw call); glowing if `glow` is set. */
export function buildFieldMarkings(glow: Color | null): Group {
  const group = new Group();
  const line = glow
    ? new MeshBasicMaterial({ color: glow, side: DoubleSide })
    : new MeshStandardMaterial({ color: 0xd8e2d0, roughness: 0.9, side: DoubleSide });
  const strip = (lengthX: number, widthY: number, y: number, x = 0): Mesh => {
    const m = new Mesh(new PlaneGeometry(lengthX, widthY), line);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(toThreeVector(vec3(x, y, 0.5)));
    return m;
  };
  // On the flat floor only: the centre line out to the trim's foot, the goal lines between the posts' bases (their
  // feet reach 104 uu round the posts' axes at |x| 904: flat across the mouth to |x| 800)
  const trimFoot = floorOutline()[0]?.[0] ?? ARENA.sideX;
  group.add(strip(trimFoot * 2, 12, 0));
  for (const end of [-1, 1]) group.add(strip(1600, 12, end * ARENA.backY));
  // Centre circle as a ring of short strips
  const segments = 64;
  const radius = 1000;
  for (let i = 0; i < segments; i++) {
    const a = ((i + 0.5) / segments) * Math.PI * 2;
    const m = new Mesh(new PlaneGeometry(12, ((2 * Math.PI * radius) / segments) * 1.02), line);
    m.rotation.order = "YXZ";
    m.rotation.y = -a;
    m.rotation.x = -Math.PI / 2;
    m.position.copy(toThreeVector(vec3(Math.cos(a) * radius, Math.sin(a) * radius, 0.5)));
    group.add(m);
  }
  return mergeByMaterial(group);
}

/** The floor's shape (facing +z): out to the trim's foot, round the posts' bases and across the mouths to the goals'
 *  own floors (src/render/arenaSurface.ts), so none of it shows past the trim. */
function floorShape(): Shape {
  const [first, ...rest] = floorOutline();
  const s = new Shape();
  if (first) s.moveTo(first[0], first[1]);
  for (const [x, y] of rest) s.lineTo(x, y);
  s.closePath();
  return s;
}

/** Stripes across the field (along the game's y): two colours with soft edges, `repeat` pairs over the floor. */
function stripeTexture(a: Color, b: Color, repeat: number): DataTexture {
  const size = 64;
  const data = new Uint8Array(size * 4);
  const mixed = new Color();
  for (let i = 0; i < size; i++) {
    // Half the texture each colour, blended over a few texels at the edges
    const t = Math.min(1, Math.max(0, (Math.abs(i + 0.5 - size / 2) - size / 4) / 3 + 0.5));
    const hex = mixed.copy(a).lerp(b, t).getHex(); // (sRGB bytes)
    data.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], i * 4);
  }
  const texture = new DataTexture(data, 1, size);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(1, repeat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
