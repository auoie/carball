// The arena as the game draws it: the walls and ceiling one continuous swept surface (src/render/arenaSurface.ts: floor
// fillet, wall and ceiling fillet round the whole field and the ceiling inside it, from the collision mesh's rules but
// without its pieces' overlaps and hidden skirts), see-through, with the game's cage of beams on it (src/render/cage.ts,
// src/render/cageBeams.ts) lighting up around the ball; the wall's foot wrapped in the game's frame (its trim); the goals'
// insides (src/render/goalSurface.ts) behind a frame round each mouth; the floor. The cage shows from both sides (the
// game's is visible from outside the arena too); the trim and frames only from inside, so they never hide a car driving
// on the wall from the camera behind it. Around it all, the theme's scenery (src/render/themes/).
// Every map wears the game's net, trim and cage (the user's decision, 2026-10-16; notes/arena-visuals.md), in its theme's
// team colours: the game's overlay round the ball on the walls (H-9), its beams stopping at the wall's foot with hex glass
// (H-6) beside the goal mouths below them, the hex glass as the goals' nets, the frame's metal at the wall's foot
// reflecting the arena's capture (AV-10) and team glow sheets (H-5) behind the walls. The game's stadium itself (a
// theme's `walls.game`: its field, its goals' metal floors and glows) is the stadium theme's alone; every other theme
// keeps its own floor, markings and goals' floors.
import { freeze, mergedPieces } from "./freeze";
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
  type Texture,
  Vector2,
  type Vector3,
  type Scene,
  type WebGLRenderer,
} from "three";
import { toThreeVector } from "./coords";
import { type ArenaSurface, buildArenaSurface, floorOutline, wallLine } from "./arenaSurface";
import { addBallReticle } from "./ballShadow";
import { cageGraph } from "./cage";
import { CageBeams, shockWave } from "./cageBeams";
import { BoostPadsView, type PadsView } from "./boostPads";
import type { BoostPadState } from "../engine/world";
import { type GoalSurface, buildGoalSurface, goalProfileU } from "./goalSurface";
import { ForceFieldMaterial, GlowStripMaterial, GrateMaterial, HexGlassMaterial } from "./gameSurfaces";
import { TEAM_PRIMARY_LINEAR, fullBright, linear } from "./teamColors";
import { mergeByMaterial } from "./merge";
import { GoalFloorMaterial, goalUnderlayers } from "./goalInterior";
import { GrassCube } from "./grassCube";
import { buildStadiumField, frameFloorMaterial, mergeFieldPieces, SideTrimMaterial } from "./stadiumField";
import { fieldPlan, type GlowPart, type GlowRibbon, goalGlowRibbons } from "./stadiumFieldRules";
import type { ArenaStyle, Theme } from "./themes/theme";
import { vec3 } from "../math/vec";
import { ARENA_PRIORITY, fitIndexedBounds } from "./translucentSort";
import {
  OPENING,
  QUADRANTS,
  SIDE_TRIM_GLOW_ALPHA,
  STACK,
  WALL_FOOT,
  archHalo,
  capPieces,
  clip,
  farGlowRibbon,
  fourWays,
  frameTopAt,
  framePieces,
  merge,
  openingPieces,
  slantedRibbon,
  stackPieces,
  wallParam,
} from "./wallFoot";

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
  readonly #cage: ForceFieldMaterial; // the walls' and ceiling's see-through fill: the game's overlay round the ball
  readonly #beams: CageBeams | null; // the cage on them (none in a map's own arena)
  readonly #net: HexGlassMaterial; // the goals' nets: the game's hex glass
  readonly #style: ArenaStyle;
  readonly #theme: Theme;
  /** The teams' colours on the arena: the theme's (the game's: the linear primaries, AV-2), else ours */
  readonly #teamColors: readonly [Color, Color];
  /** The game's reflection capture: the trim reflects it (and the stadium's field, its banners) */
  readonly #grassCube = new GrassCube();
  #seconds = 0;
  /** The clock a map's own walls light by, as the beams (their seconds' fraction, the shockwave) */
  readonly #clock = { time: { value: 0 }, shockWave: { value: shockWave(null) } };
  /** World seconds since the ball exploded (a goal), null with a ball in play: the cage's shockwave (AV-15) */
  #sinceExplosion: number | null = null;

  constructor(theme: Theme) {
    this.#theme = theme;
    this.#style = theme.style;
    this.#teamColors = theme.style.walls.game ? [theme.style.walls.blue, theme.style.walls.orange] : TEAM_COLORS;
    const surface = buildArenaSurface();
    const goals = buildGoalSurface(GOAL_NET_HEX);
    const { walls } = theme.style;
    // (the game's net, trim and cage on every map, in its theme's team colours)
    this.#cage = new ForceFieldMaterial(walls.blue, walls.orange);
    this.#net = new HexGlassMaterial({ net: true });
    // (a map's own arena, the greenhouse's: its walls and floor for the cage, the wall's foot and the floor; the goals as
    // every map's)
    const custom = theme.style.arena ?? null;
    this.#beams = custom ? null : new CageBeams(cageGraph(false), walls);
    this.root.add(
      custom ? custom.walls(surface, this.#cage.ballPosition, walls.blue, walls.orange, this.#clock) : this.#buildWalls(surface),
      ...(this.#beams ? [this.#beams.mesh] : []),
      this.#buildGoals(goals),
      this.#buildFloor(),
      // (the game's field has its own markings: AV-7; a map's own arena its own)
      ...(walls.game || theme.style.gameField || custom ? [] : [buildFieldMarkings(theme.style.markings)]),
      theme.root,
    );
    // (the arena's own pieces never move: their matrices made once, not every frame; the theme's scenery keeps its own)
    this.root.matrixAutoUpdate = false;
    for (const piece of this.root.children) if (piece !== theme.root) freeze(piece);
    // (the theme's materials that sample the capture (a `grassCube` uniform: the banners', RV-178) share its uniform)
    const cube = this.#grassCube;
    theme.root.traverse((m) => {
      const material = (m as { material?: { uniforms?: Record<string, unknown> } }).material;
      if (material?.uniforms?.["grassCube"] !== undefined) material.uniforms["grassCube"] = cube.uniform;
    });
  }

  /** Once per frame: lights the walls around the ball (Three.js frame) and animates the theme's scenery. */
  update(ballPosition: Vector3, frameSeconds: number): void {
    this.#cage.ballPosition.copy(ballPosition);
    this.#beams?.ballPosition.copy(ballPosition);
    this.#seconds += frameSeconds;
    if (this.#sinceExplosion !== null) this.#sinceExplosion += Math.max(0, frameSeconds);
    if (this.#beams) {
      this.#beams.shockWave = shockWave(this.#sinceExplosion);
      this.#beams.time = this.#seconds;
    }
    this.#clock.time.value = this.#seconds - Math.floor(this.#seconds);
    this.#clock.shockWave.value = shockWave(this.#sinceExplosion);
    this.#theme.update(this.#seconds, ballPosition);
  }

  /** The arena's reflection capture (AV-3: at load, and again when the team colours change), with only the arena and
   *  its theme drawn. Run with the WebGL renderer before a frame (Renderer.beforeNextFrame) */
  capture(gl: WebGLRenderer, scene: Scene): void {
    // (three times, as the game re-captures over its first 2 s, each reading the last: the first with the reflective
    // surfaces seeing nothing, the others the last capture, blurred, in their own directions; it converges by the second
    // or third, SUR-32, AV-3)
    const cube = this.#grassCube;
    const captureOnly = this.#theme.captureOnly ?? null;
    cube.capture(gl, scene, this.root, captureOnly, [0, 0, 0]);
    cube.capture(gl, scene, this.root, captureOnly);
    cube.capture(gl, scene, this.root, captureOnly);
  }

  /** The boost pads' view for this arena: a map's own (the greenhouse's tokens), else every map's game-style pads (the
   *  capture reflected in their bases) */
  createPads(pads: readonly BoostPadState[]): PadsView {
    return this.#style.arena?.pads?.(pads) ?? new BoostPadsView(pads, this.reflection);
  }

  /** The arena's capture as the materials sample it (its uniform: the value turns to each new capture), for what's drawn
   *  outside the arena's root and reflects it (the boost pads' bases) */
  get reflection(): { value: Texture } {
    return this.#grassCube.uniform;
  }

  /** Reflection captures so far (for tests) */
  get captures(): number {
    return this.#grassCube.captures;
  }

  /** The last reflection capture's faces, linear floats, stored or as rendered (GrassCube.readCapture) */
  readCapture(gl: WebGLRenderer, raw = false): Float32Array[] | null {
    return this.#grassCube.readCapture(gl, raw);
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

  /** The swept walls: the cage's overlay from the cap up, the game's frame on the fillet (the trim) up to its top, the
   *  wall foot's pieces (src/render/wallFoot.ts), the glass beside the goal mouths, the team glow sheets behind the
   *  walls. */
  #buildWalls(surface: ArenaSurface): Group {
    const { positions, bands, indices } = surface;
    const trimTriangles: number[] = [];
    const cageTriangles: number[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      const tri = [indices[i] ?? 0, indices[i + 1] ?? 0, indices[i + 2] ?? 0] as const;
      if (tri.every((v) => (bands[v] ?? -1) >= 0)) trimTriangles.push(...tri);
      // (the cage from the cap up, as the game's (AV-14: from z 256); under it the stack, AV-10)
      else if (tri.some((v) => (positions[3 * v + 2] ?? 0) > STACK.top + 0.5)) cageTriangles.push(...tri);
    }
    // (game frame to Three's: swapping y and z mirrors the winding, two indices swapped per triangle keep it facing the
    // field)
    const toThree = (piece: { positions: ArrayLike<number>; indices: readonly number[] }): BufferGeometry => {
      const g = new BufferGeometry();
      const p = new Float32Array(piece.positions.length);
      for (let i = 0; i < p.length; i += 3) p.set([piece.positions[i] ?? 0, piece.positions[i + 2] ?? 0, piece.positions[i + 1] ?? 0], i);
      g.setAttribute("position", new BufferAttribute(p, 3));
      const idx: number[] = [];
      for (let i = 0; i < piece.indices.length; i += 3) idx.push(piece.indices[i] ?? 0, piece.indices[i + 2] ?? 0, piece.indices[i + 1] ?? 0);
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    // The frame only up to its top (AV-10: 140 along the side walls, falling round the back corners to 96, 57 by the
    // posts); between the midfield arches (AV-10b) to Field_Mid_A's top, z 75, the overlay on down the fillet to it
    const openingY = WALL_FOOT.arch.y0;
    const inOpening = clip(positions, trimTriangles, (_x, y) => Math.abs(y) - openingY);
    const beside = clip(positions, trimTriangles, (_x, y) => Math.abs(y) - openingY, true);
    const frameOnly = merge([
      clip(inOpening.positions, inOpening.indices, (_x, _y, z) => z - OPENING.trimTop),
      clip(beside.positions, beside.indices, (x, y, z) => z - frameTopAt(wallParam(x, y))),
    ]);
    const overlayDown = clip(inOpening.positions, inOpening.indices, (_x, _y, z) => z - OPENING.trimTop, true);
    const cage = new Mesh(toThree(merge([{ positions: Array.from(positions), indices: cageTriangles }, overlayDown])), this.#cage);
    cage.renderOrder = ARENA_PRIORITY.base; // (FFCage_Full: TRN1)
    // (the wall's foot the game's baked frame (Side_Trim: AV-10, H-4), reflecting the capture, the ball's shadow up it; its
    // cap up to the glow sheets' foot)
    const trim = new Mesh(toThree(frameOnly), new SideTrimMaterial(this.#grassCube.uniform, this.#cage.ballPosition));
    // (the cap's front face lies on the wall, as our overlay does (the game's 4 uu behind it): drawn a little nearer,
    // so the overlay never shows on it)
    const capMaterial = new SideTrimMaterial(this.#grassCube.uniform, this.#cage.ballPosition);
    capMaterial.polygonOffset = true;
    capMaterial.polygonOffsetFactor = -1;
    capMaterial.polygonOffsetUnits = -2;
    const capQuarter = capPieces();
    const capGeometry = fourWays(capQuarter.positions, capQuarter.indices);
    // (the goal-mouth frame: Goal_STD_Trim on every map, the cap's metal, no lit band, AV-13)
    const frameQuarter = framePieces();
    const frameGeometry = fourWays(frameQuarter.positions, frameQuarter.indices);
    // (the stack under the cap, AV-10: the frame's lip, the side glass, the boards, the grate behind the bar, the posts)
    const stack = stackPieces();
    const whole = (piece: { positions: number[]; indices: number[] }): BufferGeometry => fourWays(piece.positions, piece.indices);
    const opening = openingPieces();
    // (the frame metal's other pieces: the lip, the bar, the posts, the arches, the far glow's trough)
    const metalGeometry = whole(merge([stack.lip, stack.bar, stack.posts, opening.arch, opening.trough]));
    // (the cap, the frame and the metal: one material, one mesh, one draw; each piece's vertices named in userData)
    const metal = mergedPieces([["trim cap", capGeometry], ["goal frame", frameGeometry], ["wall metal", metalGeometry]], capMaterial);
    // (the translucent pieces one mesh per quadrant, so they sort among the others by where they are)
    const glassMaterial = new HexGlassMaterial();
    const sideGlass = QUADRANTS.map((q) => {
      const mesh = new Mesh(fourWays(stack.glass.positions, stack.glass.indices, [q], [{ name: "glassTile", size: 2, data: stack.glassTile }]), glassMaterial);
      mesh.name = "side glass";
      mesh.renderOrder = ARENA_PRIORITY.base; // (Field_STD_Glass: TRN1)
      return mesh;
    });
    // (not a surface the ball's reticle shows on: VT-30a)
    const boardMaterial = new MeshStandardMaterial({ color: BOARD_COLOR, roughness: 0.7, metalness: 0.1, side: FrontSide });
    const boards = new Mesh(whole(stack.boards), boardMaterial);
    boards.name = "boards";
    const grateMaterial = new GrateMaterial();
    const grate = QUADRANTS.map((q) => {
      const mesh = new Mesh(fourWays(stack.grate.positions, stack.grate.indices, [q]), grateMaterial);
      mesh.name = "grate";
      mesh.renderOrder = ARENA_PRIORITY.base; // (Goal_STD_Glass[1]: TRN1)
      return mesh;
    });
    // (the midfield opening, AV-10b: the arches, Sideline_A's dark steps between them, the far glow in its trough)
    const sideline = new Mesh(whole(opening.sideline), new SideTrimMaterial(this.#grassCube.uniform, this.#cage.ballPosition, OPENING.sidelineLight));
    sideline.name = "sideline";
    const group = new Group();
    group.add(cage, trim, metal, ...sideGlass, boards, ...grate, sideline, ...farGlows(this.#style));
    group.add(...glowSheets(this.#style), backGlass(0), backGlass(1));
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
    // (the ball's reticle in the goal: the floor's decal, src/render/entities.ts, as the game's hidden plane at z 0)
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
    addBallReticle(postMaterial, this.#cage.ballPosition);
    // The game's goal floors: see-through and layered (RV-76): the frame, the grate, the glass on the ramp, and under them
    // a second glass, the glows and dark metal
    const cube = this.#grassCube.uniform;
    const floorGeometries = perGoal(goals.floor).map((t) => fitIndexedBounds(geometry(t)));
    const goalFloor = game ? new GoalFloorMaterial(cube) : floorMaterial;
    const floors = floorGeometries.map((g) => {
      const floor = new Mesh(g, goalFloor);
      floor.renderOrder = ARENA_PRIORITY.base; // (Goal_STD_Glass: TRN1)
      return floor;
    });
    const group = new Group();
    group.add(
      ...floors,
      ...(game ? goalUnderlayers(floorGeometries, cube, this.#teamColors) : []),
      ...nets,
      new Mesh(geometry(goals.lip), new MeshBasicMaterial({ vertexColors: true, side: FrontSide })),
      new Mesh(geometry(goals.postBase), postMaterial),
      // (the goal's glows: the game's all; every map the stepped ribbon on from the walls' upright one, the beside ribbon on
      // from the slanted one, the mouth's outline and the field side's fin, AV-11, AV-13)
      ...goalGlows(
        this.#style,
        this.#style.arena?.goalGlows?.() ?? (game ? fieldPlan().goalGlow : goalGlowRibbons().filter((r) => r.part !== undefined && EVERY_MAP_GLOWS.has(r.part))),
      ),
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
    // reflecting the arena's capture; the stadium's, and a map that asks for it, in the stadium's team colours (Night: the
    // user's decisions, 2026-10-16; its cage and glows its own)
    const { walls } = this.#style;
    const cube = this.#grassCube.uniform;
    const custom = this.#style.arena ?? null;
    const field = !custom && (walls.game === true || this.#style.gameField === true);
    const [p0 = [0, 0, 1], p1 = [1, 0.5, 0]] = TEAM_PRIMARY_LINEAR;
    const [fieldBlue, fieldOrange] = walls.game ? [walls.blue, walls.orange] : [linear(p0), linear(p1)];
    if (field) {
      // (its pieces one shader draws merged: fewer draw calls, the same pixels)
      const pieces = buildStadiumField(fieldBlue, fieldOrange, cube);
      mergeFieldPieces(pieces);
      group.add(pieces);
    }

    // Floor, out to the trim's foot. The shape faces +z; rotate it to face up (+y in Three)
    const floor = new Mesh(new ShapeGeometry(floorShape()), custom ? custom.floor() : field ? frameFloorMaterial(cube, fieldBlue, fieldOrange) : floorMat);
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
/** The boards' plain panels (AdvertStrip_Field: opaque, lit; the game's adverts not carried: a plain dark grey, the
 *  user's to pick) */
const BOARD_COLOR = 0x2c3038;

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

/** The goal's glows every map wears (the user's decision, 2026-10-16: the game's wall foot everywhere) */
const EVERY_MAP_GLOWS: ReadonlySet<GlowPart> = new Set<GlowPart>(["stepped", "mouth", "crossbar", "fieldSide", "beside"]);

/** The goals' glows (Goal_STD_Glow, H-5, RV-77): ribbons round each mouth, on the back wall's stepped outline, along
 *  the floor panels' edges and under the goal's floor, glowing from the edge each is attached to (glow 1) to its free
 *  edge (0), in the team's colour (src/render/stadiumFieldRules.ts: the +y goal's; the -y goal's mirrored) */
function goalGlows(style: ArenaStyle, ribbons: readonly GlowRibbon[]): Mesh[] {
  const { blue, orange } = style.walls;
  return [blue, orange].map((primary, team) => {
    const sy = team === 0 ? -1 : 1;
    const pos: number[] = [];
    const glow: number[] = [];
    const idx: number[] = [];
    for (const ribbon of ribbons) {
      const n = Math.min(ribbon.attached.length, ribbon.free.length) / 3;
      const base = pos.length / 3;
      for (let i = 0; i < n; i++) {
        for (const [edge, value] of [[ribbon.attached, ribbon.glow ?? 1], [ribbon.free, 0]] as const) {
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
  const slanted = slantedRibbon();
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
      // (and the slanted one under the boards, the same mesh's: AV-11)
      pushRibbon({ pos, glow, idx }, slanted, sx, sy);
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

/** A ribbon (game frame, a quadrant's: its attached and free edges) mirrored into another quadrant, added to a strip's
 *  arrays (Three's frame) */
function pushRibbon(
  out: { pos: number[]; glow: number[]; idx: number[] },
  ribbon: { readonly attached: readonly number[]; readonly free: readonly number[] },
  sx: number,
  sy: number,
  attachedGlow = 1,
): void {
  const base = out.pos.length / 3;
  const n = Math.min(ribbon.attached.length, ribbon.free.length) / 3;
  for (let i = 0; i < n; i++) {
    for (const [edge, value] of [[ribbon.attached, attachedGlow], [ribbon.free, 0]] as const) {
      // (Three's frame: x, z up, y)
      out.pos.push(sx * (edge[3 * i] ?? 0), edge[3 * i + 2] ?? 0, sy * (edge[3 * i + 1] ?? 0));
      out.glow.push(value);
    }
    if (i > 0) {
      const k = base + 2 * i;
      out.idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
}

/** Side_Trim[1]'s glows (AV-10b, H-5): the far glow behind each side wall's middle and the arch halos, one mesh per
 *  quadrant in its half's team colour (a hard switch at y 0), its alpha Side_Trim's vertex colour's */
function farGlows(style: ArenaStyle): Mesh[] {
  const { blue, orange } = style.walls;
  const materials = [blue, orange].map((primary) => new GlowStripMaterial(primary, linear(fullBright([primary.r, primary.g, primary.b])), SIDE_TRIM_GLOW_ALPHA));
  const far = farGlowRibbon();
  const halo = archHalo();
  return QUADRANTS.map(([sx, sy]) => {
    const strip = { pos: [] as number[], glow: [] as number[], idx: [] as number[] };
    pushRibbon(strip, far, sx, sy);
    pushRibbon(strip, halo, sx, sy);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(strip.pos), 3));
    g.setAttribute("glow", new BufferAttribute(new Float32Array(strip.glow), 1));
    g.setIndex(strip.idx);
    const mesh = new Mesh(g, materials[sy < 0 ? 0 : 1]);
    mesh.name = "far glow";
    mesh.renderOrder = ARENA_PRIORITY.fieldGlow; // (Side_Trim[1]: TRN1, as Field_STD_Glow)
    return mesh;
  });
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
