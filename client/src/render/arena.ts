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
  type Vector3,
} from "three";
import { toThreeVector } from "./coords";
import { BALL_RADIUS } from "./entities";
import { type ArenaSurface, buildArenaSurface, floorOutline, mouthOutline, trimTop } from "./arenaSurface";
import { addBallShadow } from "./ballShadow";
import { cageGraph } from "./cage";
import { CageBeams, shockWave } from "./cageBeams";
import { type GoalSurface, buildGoalSurface } from "./goalSurface";
import { ForceFieldMaterial, GlowStripMaterial, HexGlassMaterial } from "./gameSurfaces";
import { HexWallMaterial } from "./hexWalls";
import { fullBright, linear } from "./teamColors";
import { mergeByMaterial } from "./merge";
import type { ArenaStyle, Theme } from "./themes/theme";
import { vec3 } from "../math/vec";

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
const TEAM_COLORS = [new Color(0x2a7fff), new Color(0xff8a1f)] as const; // blue (-y goal), orange (+y goal)
/** Width of the mown stripes across the field (uu) */
const STRIPE_WIDTH = 512;

export class ArenaView {
  readonly root = new Group();
  readonly #cage: HexWallMaterial | ForceFieldMaterial; // the walls' and ceiling's see-through fill (or the game's overlay)
  readonly #beams: CageBeams; // the cage on them
  readonly #net: HexWallMaterial | HexGlassMaterial; // the goals' insides (a finer pattern, as a net; or the game's glass)
  readonly #style: ArenaStyle;
  readonly #theme: Theme;
  #seconds = 0;
  /** World seconds since the ball exploded (a goal), null with a ball in play: the cage's shockwave (AV-15) */
  #sinceExplosion: number | null = null;

  constructor(theme: Theme) {
    this.#theme = theme;
    this.#style = theme.style;
    const surface = buildArenaSurface();
    const goals = buildGoalSurface(GOAL_NET_HEX);
    const { walls } = theme.style;
    if (walls.game) {
      this.#cage = new ForceFieldMaterial(walls.blue, walls.orange);
      this.#net = new HexGlassMaterial();
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
      buildFieldMarkings(theme.style.markings),
      theme.root,
    );
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
    cage.renderOrder = 1;
    const trimMaterial = new MeshStandardMaterial({ color: TRIM_COLOR, roughness: 0.6, metalness: 0.3, side: FrontSide });
    addBallShadow(trimMaterial, this.#cage.ballPosition, BALL_RADIUS); // (the ball's shadow reaches up the trim)
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
    const threePositions = new Float32Array(positions.length);
    const colors = new Float32Array(positions.length);
    const color = new Color();
    for (let i = 0; i < positions.length; i += 3) {
      threePositions.set([positions[i] ?? 0, positions[i + 2] ?? 0, positions[i + 1] ?? 0], i);
      color.copy(TEAM_COLORS[(positions[i + 1] ?? 0) < 0 ? 0 : 1]);
      colors.set([color.r, color.g, color.b], i);
    }
    // The game's glass on the net: its tiles at UV0 x (3, 7/3), UV0 about GOAL_GLASS_UV uu a unit (HEX-1, HEX-4)
    const glassTiles = new Float32Array(uvs.length);
    for (let i = 0; i < uvs.length; i += 2) {
      glassTiles[i] = (3 * (uvs[i] ?? 0)) / GOAL_GLASS_UV[0];
      glassTiles[i + 1] = ((7 / 3) * (uvs[i + 1] ?? 0)) / GOAL_GLASS_UV[1];
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
    addBallShadow(floorMaterial, this.#cage.ballPosition, BALL_RADIUS);
    const net = new Mesh(geometry(goals.net), this.#net);
    net.renderOrder = 1;
    const postMaterial = new MeshStandardMaterial({ color: TRIM_COLOR, roughness: 0.6, metalness: 0.3, side: FrontSide });
    addBallShadow(postMaterial, this.#cage.ballPosition, BALL_RADIUS);
    const group = new Group();
    group.add(
      new Mesh(geometry(goals.floor), floorMaterial),
      net,
      new Mesh(geometry(goals.lip), new MeshBasicMaterial({ vertexColors: true, side: FrontSide })),
      new Mesh(geometry(goals.postBase), postMaterial),
      goalFrame(0),
      goalFrame(1),
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

    // Floor, out to the trim's foot. The shape faces +z; rotate it to face up (+y in Three)
    const floor = new Mesh(new ShapeGeometry(floorShape()), floorMat);
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);
    return group;
  }
}

/** The hexagons inside the goals: smaller, like a net (uu across) */
const GOAL_NET_HEX = 180;
/** The game's goal glass: uu per UV0 unit across the goal and along its profile (HEX-4: side walls (204.2, 211.3),
 *  back and roof (~198, 204.2)) */
const GOAL_GLASS_UV = [200, 207] as const;
/** The game's glass panel beside each goal mouth (HEX-3: y = +-5124, |x| 960-1536, up to z 624; UV0 U 6 at |x| 960
 *  to 3 at 1536, about 202.8 uu a V) from the trim's top */
const BACK_GLASS = { x0: 960, x1: 1536, top: 624, uPerUu: 3 / 576, vUu: 202.8 } as const;
/** The game's team glow sheets (AV-11): 16 uu behind the side walls, from the trim's cap (z 272) to 400, along
 *  |y| 128-5264 */
const GLOW_SHEET = { x: 4112, z0: 272, z1: 400, y0: 128, y1: 5264 } as const;
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

/** The game's team glow sheets (H-5): one each side of midfield along each side wall, attached at the bottom */
function glowSheets(style: ArenaStyle): Mesh[] {
  const { blue, orange } = style.walls;
  const sheets: Mesh[] = [];
  for (const [team, primary] of [blue, orange].entries()) {
    const material = new GlowStripMaterial(primary, linear(fullBright([primary.r, primary.g, primary.b])));
    const sy = team === 0 ? -1 : 1;
    for (const sx of [-1, 1]) {
      const { x, z0, z1, y0, y1 } = GLOW_SHEET;
      const g = new BufferGeometry();
      // (Three's frame: x, z up, y)
      g.setAttribute(
        "position",
        new BufferAttribute(new Float32Array([sx * x, z0, sy * y0, sx * x, z0, sy * y1, sx * x, z1, sy * y1, sx * x, z1, sy * y0]), 3),
      );
      g.setAttribute("glow", new BufferAttribute(new Float32Array([1, 1, 0, 0]), 1));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const mesh = new Mesh(g, material);
      mesh.renderOrder = 1;
      sheets.push(mesh);
    }
  }
  return sheets;
}

/** The game's hex glass beside a goal's mouth on the back wall (team 0: blue, at -y), both sides, just behind the
 *  wall's surface: from the trim's top up to z 624, |x| 960-1536 (the goal's frame covers its inner corner) */
function backGlass(team: 0 | 1): Mesh {
  const side = team === 0 ? -1 : 1;
  const y = side * (ARENA.backY + 1);
  const { x0, x1, top, uPerUu, vUu } = BACK_GLASS;
  const bottom = trimTop(1200, ARENA.backY);
  const pos: number[] = [];
  const tiles: number[] = [];
  const idx: number[] = [];
  for (const sx of [-1, 1]) {
    const base = pos.length / 3;
    for (const [ax, z] of [[x0, bottom], [x1, bottom], [x1, top], [x0, top]] as const) {
      pos.push(sx * ax, z, y);
      // (U 6 at |x| 960 down to 3 at 1536, mirrored about x = 0; tiles at UV0 x (3, 7/3))
      tiles.push(3 * (6 - (ax - x0) * uPerUu), ((7 / 3) * (z - 127)) / vUu);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("glassTile", new BufferAttribute(new Float32Array(tiles), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new Mesh(g, new HexGlassMaterial());
  mesh.renderOrder = 1;
  return mesh;
}

/** The frame round a goal's mouth on the back wall (team 0: blue, at -y): a light along the opening's edge in the
 *  team's colour and a grey band outside it, flat on the wall just in front of it (nothing the ball could hit). */
function goalFrame(team: 0 | 1): Group {
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
  group.add(
    band(0, FRAME_LIGHT_WIDTH, new MeshBasicMaterial({ color: TEAM_COLORS[team], side: FrontSide })),
    band(FRAME_LIGHT_WIDTH, FRAME_WIDTH, new MeshStandardMaterial({ color: TRIM_COLOR, roughness: 0.5, metalness: 0.4, side: FrontSide })),
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
