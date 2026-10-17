// The arena: the map's walls and floor (its theme's custom arena: src/render/themes/night.ts, the glasshouse of
// src/render/greenhouse.ts) on the arena's swept surface (src/render/arenaSurface.ts: floor fillet, wall and ceiling fillet
// round the whole field and the ceiling inside it, from the collision mesh's rules); the goals' insides
// (src/render/goalSurface.ts) with the game's hex glass as their nets, the map's glows round each mouth. Around it all,
// the theme's scenery.
import { freeze } from "./freeze";
import { BufferAttribute, BufferGeometry, Color, FrontSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Shape, ShapeGeometry, Vector3 } from "three";
import { buildArenaSurface, floorOutline } from "./arenaSurface";
import { addBallReticle } from "./ballShadow";
import { shockWave } from "./cageBeams";
import type { BoostPadState } from "../engine/world";
import { type GoalSurface, buildGoalSurface, goalProfileU } from "./goalSurface";
import { GlowStripMaterial, HexGlassMaterial } from "./gameSurfaces";
import { fullBright, linear } from "./teamColors";
import type { PadsView } from "./tokenPads";
import type { ArenaStyle, GlowRibbon, Theme } from "./themes/theme";
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

export class ArenaView {
  readonly root = new Group();
  /** The ball's centre (Three's frame): the walls lit round it, its reticle on the posts */
  readonly #ball = new Vector3();
  readonly #net: HexGlassMaterial; // the goals' nets: the game's hex glass
  readonly #style: ArenaStyle;
  readonly #theme: Theme;
  #seconds = 0;
  /** The clock the walls light by (their seconds' fraction, the shockwave) */
  readonly #clock = { time: { value: 0 }, shockWave: { value: shockWave(null) } };
  /** World seconds since the ball exploded (a goal), null with a ball in play: the walls' shockwave (AV-15) */
  #sinceExplosion: number | null = null;

  constructor(theme: Theme) {
    this.#theme = theme;
    this.#style = theme.style;
    const surface = buildArenaSurface();
    const goals = buildGoalSurface(GOAL_NET_HEX);
    const { walls, arena } = theme.style;
    this.#net = new HexGlassMaterial({ net: true });
    this.root.add(arena.walls(surface, this.#ball, walls.blue, walls.orange, this.#clock), this.#buildGoals(goals), this.#buildFloor(), theme.root);
    // (the arena's own pieces never move: their matrices made once, not every frame; the theme's scenery keeps its own)
    this.root.matrixAutoUpdate = false;
    for (const piece of this.root.children) if (piece !== theme.root) freeze(piece);
  }

  /** Once per frame: lights the walls around the ball (Three.js frame) and animates the theme's scenery. */
  update(ballPosition: Vector3, frameSeconds: number): void {
    this.#ball.copy(ballPosition);
    this.#seconds += frameSeconds;
    if (this.#sinceExplosion !== null) this.#sinceExplosion += Math.max(0, frameSeconds);
    this.#clock.time.value = this.#seconds - Math.floor(this.#seconds);
    this.#clock.shockWave.value = shockWave(this.#sinceExplosion);
    this.#theme.update(this.#seconds, ballPosition);
  }

  /** The boost pads' view for this arena: the map's own (its tokens) */
  createPads(pads: readonly BoostPadState[]): PadsView {
    return this.#style.arena.pads(pads);
  }

  /** The ball exploded (a goal): the walls' shockwave starts */
  explode(): void {
    this.#sinceExplosion = 0;
  }

  /** The walls' shockwave now (AV-15) */
  get shockWave(): number {
    return shockWave(this.#sinceExplosion);
  }

  /** A new ball: the shockwave is over */
  newBall(): void {
    this.#sinceExplosion = null;
  }

  /** The goals: their insides (floors opaque in the team's colour, the net see-through, the mouth's lip lit in the
   *  team's colour, the post bases grey) and the map's glows round each mouth. */
  #buildGoals(goals: GoalSurface): Group {
    const { positions, uvs } = goals;
    const threePositions = new Float32Array(positions.length);
    const colors = new Float32Array(positions.length);
    const color = new Color();
    for (let i = 0; i < positions.length; i += 3) {
      threePositions.set([positions[i] ?? 0, positions[i + 2] ?? 0, positions[i + 1] ?? 0], i);
      color.copy(TEAM_COLORS[(positions[i + 1] ?? 0) < 0 ? 0 : 1]);
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
    floorMaterial.color.setScalar(0.4); // (the team's colour, dimmed)
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
    addBallReticle(postMaterial, this.#ball);
    const floors = perGoal(goals.floor).map((t) => {
      const floor = new Mesh(fitIndexedBounds(geometry(t)), floorMaterial);
      floor.renderOrder = ARENA_PRIORITY.base; // (Goal_STD_Glass: TRN1)
      return floor;
    });
    const group = new Group();
    group.add(
      ...floors,
      ...nets,
      new Mesh(geometry(goals.lip), new MeshBasicMaterial({ vertexColors: true, side: FrontSide })),
      new Mesh(geometry(goals.postBase), postMaterial),
      ...goalGlows(this.#style, this.#style.arena.goalGlows()),
    );
    return group;
  }

  #buildFloor(): Group {
    const group = new Group();
    // Floor, out to the wall's foot. The shape faces +z; rotate it to face up (+y in Three)
    const floor = new Mesh(new ShapeGeometry(floorShape()), this.#style.arena.floor());
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
/** The posts' bases' grey (a light, slightly metallic grey) */
const TRIM_COLOR = 0x9aa0a8;
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
