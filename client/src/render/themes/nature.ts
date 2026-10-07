// Countryside around the arena: rolling hills with a dirt path and a pond, puffy trees, patches of tall grass that
// sway in the wind, flowers, rocks, and snowy mountains on the horizon. The land's shape, its colours and where things
// grow are options, so themes can share these. Three.js frame: ground in x/z, y up.
import {
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  type InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
} from "three";
import { fractalNoise, seededRandom, valueNoise } from "./random";
import { type Placement, animate, combine, instances, part } from "./shapes";

/** The land, as scenery sees it: the flat ground around the arena, a pond, a path, and its height. */
export interface Land {
  /** Distance outside the flat ground around the stadium (negative inside) */
  readonly flatDistance: (x: number, z: number) => number;
  readonly pond: { readonly x: number; readonly z: number; readonly radius: number };
  /** Distance from the path's centre line */
  readonly pathDistance: (x: number, z: number) => number;
  readonly height: (x: number, z: number) => number;
}

/** The shape of the land: flat ground around the arena (a rounded rectangle), a pond, a path, and the hills beyond. */
export interface LandShape {
  readonly flat: { readonly halfX: number; readonly halfZ: number; readonly radius: number };
  readonly pond: { readonly x: number; readonly z: number; readonly radius: number };
  /** Distance from the path's centre line (Infinity away from it) */
  readonly path: (x: number, z: number) => number;
  /** The hills' height (lowest to highest), the distance over which they rise from the flat ground, and the extra
   *  rise towards the horizon */
  readonly hills: { readonly low: number; readonly high: number; readonly rise: number; readonly horizon: number };
}

export const GROUND_LEVEL = -6; // just under the field, which covers it inside the arena
const WATER_LEVEL = -40;
export const PATH_HALF_WIDTH = 240;

export function meadowLand(seed: number): Land {
  const flat = { halfX: 7400, halfZ: 9400, radius: 2200 };
  return landscape(seed, {
    flat,
    pond: { x: -10800, z: 2600, radius: 1700 },
    // From the stadium's orange end out to the horizon, winding
    path: (x, z) => (z < flat.halfZ - 600 ? Infinity : Math.abs(x - 1800 * Math.sin((z - flat.halfZ) / 4200))),
    hills: { low: 380, high: 1480, rise: 5000, horizon: 1400 },
  });
}

export function landscape(seed: number, { flat, pond, path: pathDistance, hills }: LandShape): Land {
  const noise = valueNoise(seed);
  const flatDistance = (x: number, z: number): number => {
    const qx = Math.abs(x) - (flat.halfX - flat.radius);
    const qz = Math.abs(z) - (flat.halfZ - flat.radius);
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - flat.radius;
  };
  const height = (x: number, z: number): number => {
    const d = flatDistance(x, z);
    let h = 0;
    if (d > 0) {
      const rolling = hills.low + (hills.high - hills.low) * (fractalNoise(noise, x / 7000, z / 7000, 3) * 0.5 + 0.5);
      h = smoothstep(0, hills.rise, d) * rolling + smoothstep(9000, 22000, d) * hills.horizon;
    }
    // A bowl for the pond, in gently levelled ground
    const toPond = Math.hypot(x - pond.x, z - pond.z);
    h *= smoothstep(pond.radius, pond.radius + 3200, toPond);
    h -= 90 * (1 - smoothstep(pond.radius - 400, pond.radius + 150, toPond));
    // The path is worn a little into the ground
    h -= 25 * (1 - smoothstep(PATH_HALF_WIDTH * 0.5, PATH_HALF_WIDTH * 1.5, pathDistance(x, z)));
    return GROUND_LEVEL + h;
  };
  return { flatDistance, pond, pathDistance, height };
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface GroundPalette {
  readonly grassDark: number; // the ground varies between these
  readonly grassLight: number;
  readonly field: number; // the flat ground around the arena
  readonly dirt: number; // the path
  readonly sand: number; // around the pond
  readonly water: number;
}

export const MEADOW_GROUND: GroundPalette = {
  grassDark: 0x4c9a38,
  grassLight: 0x7cc456,
  field: 0x58a843,
  dirt: 0xc8a26a,
  sand: 0xe9dca4,
  water: 0x3d9fe6,
};

/** Ground out to the horizon (70 km across), coloured: grass, the path, sand around the pond; and the pond. */
export function buildGround(land: Land, seed: number, palette: GroundPalette = MEADOW_GROUND): Group {
  const noise = valueNoise(seed + 1);
  const geometry = new PlaneGeometry(70000, 70000, 220, 220);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const grassDark = new Color(palette.grassDark);
  const grassLight = new Color(palette.grassLight);
  const field = new Color(palette.field);
  const dirt = new Color(palette.dirt);
  const sand = new Color(palette.sand);
  const color = new Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, land.height(x, z));
    color.copy(grassDark).lerp(grassLight, fractalNoise(noise, x / 2500, z / 2500, 3) * 0.5 + 0.5);
    color.lerp(field, 1 - smoothstep(-800, 600, land.flatDistance(x, z)));
    const toPond = Math.hypot(x - land.pond.x, z - land.pond.z);
    color.lerp(sand, 1 - smoothstep(land.pond.radius + 150, land.pond.radius + 450, toPond));
    color.lerp(dirt, 1 - smoothstep(PATH_HALF_WIDTH * 0.8, PATH_HALF_WIDTH * 1.2, land.pathDistance(x, z)));
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const ground = new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true }));

  const water = new Mesh(
    new CircleGeometry(land.pond.radius + 120, 48).rotateX(-Math.PI / 2),
    new MeshStandardMaterial({ color: palette.water, roughness: 0.12, metalness: 0.1 }),
  );
  water.position.set(land.pond.x, WATER_LEVEL, land.pond.z);
  const group = new Group();
  group.add(ground, water);
  return group;
}

/** Where scenery may stand: on the land outside the stadium's flat ground, off the path, out of the pond. */
export function free(land: Land, x: number, z: number, clearance: number): boolean {
  return (
    land.flatDistance(x, z) > clearance &&
    land.pathDistance(x, z) > PATH_HALF_WIDTH + clearance &&
    Math.hypot(x - land.pond.x, z - land.pond.z) > land.pond.radius + 200 + clearance
  );
}

/** Where a kind of scenery grows: `clusters` clusters of `perCluster` things within `spread` of their centres, which
 *  are between `minRadius` and `maxRadius` from the arena; each thing at least `clearance` from the flat ground, the
 *  path and the pond. */
export interface Area {
  readonly clusters: number;
  readonly perCluster: readonly [number, number];
  readonly spread: number;
  readonly minRadius: number;
  readonly maxRadius: number;
  readonly clearance: number;
}

/** Points scattered in clusters over an area. */
export function scatter(random: () => number, land: Land, options: Area): [number, number][] {
  const points: [number, number][] = [];
  for (let c = 0; c < options.clusters; c++) {
    const angle = random() * Math.PI * 2;
    const radius = options.minRadius + random() * (options.maxRadius - options.minRadius);
    const cx = Math.cos(angle) * radius * 0.8; // (the stadium is longer along z)
    const cz = Math.sin(angle) * radius;
    const count = Math.round(options.perCluster[0] + random() * (options.perCluster[1] - options.perCluster[0]));
    for (let i = 0; i < count; i++) {
      // Denser towards the middle of the cluster
      const r = options.spread * Math.sqrt(random()) * (0.4 + 0.6 * random());
      const a = random() * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (free(land, x, z, options.clearance)) points.push([x, z]);
    }
  }
  return points;
}

/** Round, puffy trees in groves. */
export function buildTrees(land: Land, seed: number): InstancedMesh {
  const random = seededRandom(seed);
  const tree = combine([
    part(new CylinderGeometry(30, 44, 320, 7), 0x7a5233, { position: [0, 160, 0] }),
    part(new IcosahedronGeometry(230, 1), 0x3f9a3a, { position: [0, 450, 0] }),
    part(new IcosahedronGeometry(175, 1), 0x4caf45, { position: [95, 580, 45] }),
    part(new IcosahedronGeometry(160, 1), 0x45a33f, { position: [-105, 540, -70] }),
  ]);
  const placements = scatter(random, land, {
    clusters: 34,
    perCluster: [5, 16],
    spread: 1700,
    minRadius: 10500,
    maxRadius: 21000,
    clearance: 500,
  }).map(([x, z]): Placement & { tint: Color } => {
    const s = 0.8 + random() * 1.0;
    return {
      position: [x, land.height(x, z) - 10, z],
      rotation: [0, random() * Math.PI * 2, 0],
      scale: [s, s * (0.85 + random() * 0.3), s],
      tint: new Color().setScalar(0.85 + random() * 0.25),
    };
  });
  return instances(tree, new MeshLambertMaterial({ vertexColors: true, flatShading: true }), placements);
}

/** Patches of tall grass, swaying in the wind. Returns the mesh and its animation clock. */
export function buildTallGrass(
  land: Land,
  seed: number,
  area: Area = { clusters: 46, perCluster: [140, 280], spread: 1100, minRadius: 8200, maxRadius: 15000, clearance: 150 },
): { mesh: InstancedMesh; time: { value: number } } {
  const random = seededRandom(seed);
  const blades: BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const h = 90 + random() * 70;
    const blade = new BufferGeometry();
    // A tapering blade, leaning out a little
    blade.setAttribute("position", new Float32BufferAttribute([-7, 0, 0, 7, 0, 0, 3, h, 14], 3));
    blade.computeVertexNormals();
    const tufted = part(blade, 0xffffff, { rotation: [0, (i / 7) * Math.PI * 2 + random() * 0.6, 0] });
    // Dark at the root, light at the tip
    const colors = tufted.getAttribute("color");
    const pos = tufted.getAttribute("position");
    for (let v = 0; v < colors.count; v++) {
      const c = new Color(0x3b7d2c).lerp(new Color(0x9ad86e), pos.getY(v) / h);
      colors.setXYZ(v, c.r, c.g, c.b);
    }
    blades.push(tufted);
  }
  const tuft = combine(blades);
  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const uniforms = animate(
    material,
    /* glsl */ `
      // Sway with the wind: more at the tips, in waves rolling across the land
      vec3 rooted = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float wave = sin(time * 1.6 + rooted.x * 0.0011 + rooted.z * 0.0007) + 0.4 * sin(time * 3.1 + rooted.z * 0.002);
      transformed.x += wave * position.y * 0.16;
      transformed.z += wave * position.y * 0.07;`,
    "",
    {},
  );
  const placements = scatter(random, land, area).map(([x, z]): Placement => {
    const s = 1.1 + random() * 1.0;
    return { position: [x, land.height(x, z) - 4, z], rotation: [0, random() * Math.PI * 2, 0], scale: [s, s, s] };
  });
  return { mesh: instances(tuft, material, placements), time: uniforms.time };
}

/** Flowers in drifts of colour: green stems, and blossoms tinted from a palette (two draw calls). */
export function buildFlowers(
  land: Land,
  seed: number,
  area: Area = { clusters: 40, perCluster: [40, 110], spread: 900, minRadius: 8000, maxRadius: 15500, clearance: 100 },
): Group {
  const random = seededRandom(seed);
  const palette = [0xff5f6d, 0xffd23f, 0xffffff, 0xff9ad5, 0xb48cff].map((c) => new Color(c));
  const placements = scatter(random, land, area).map(([x, z]): { position: [number, number, number]; scale: [number, number, number]; tint: Color } => {
    const s = 1.2 + random() * 1.2;
    return {
      position: [x, land.height(x, z) - 2, z],
      scale: [s, s, s],
      tint: palette[Math.floor(random() * palette.length)] ?? new Color(0xffffff),
    };
  });
  const material = new MeshLambertMaterial({ vertexColors: true });
  const stems = part(new CylinderGeometry(2.5, 2.5, 40, 4), 0x3f8f32, { position: [0, 20, 0] });
  const blossoms = part(new IcosahedronGeometry(16, 0), 0xffffff, { position: [0, 44, 0] });
  const group = new Group();
  group.add(
    instances(stems, material, placements.map(({ position, scale }) => ({ position, scale }))),
    instances(blossoms, material, placements),
  );
  return group;
}

/** Boulders, half buried. */
export function buildRocks(
  land: Land,
  seed: number,
  area: Area = { clusters: 30, perCluster: [2, 7], spread: 900, minRadius: 8500, maxRadius: 20000, clearance: 250 },
): InstancedMesh {
  const random = seededRandom(seed);
  const rock = part(new DodecahedronGeometry(120, 0), 0xa3a39a);
  const placements = scatter(random, land, area).map(([x, z]): Placement & { tint: Color } => {
    const s = 0.8 + random() * 1.8;
    return {
      position: [x, land.height(x, z) - 30 * s, z],
      rotation: [random() * 0.6, random() * Math.PI * 2, random() * 0.6],
      scale: [s * (1 + random()), s * (0.6 + random() * 0.6), s * (1 + random())],
      tint: new Color().setScalar(0.8 + random() * 0.3),
    };
  });
  return instances(rock, new MeshLambertMaterial({ vertexColors: true, flatShading: true }), placements);
}

/** A ring of snowy, low-poly mountains on the horizon (one draw call). */
export function buildMountains(seed: number): Mesh {
  const random = seededRandom(seed);
  const noise = valueNoise(seed);
  const peaks: BufferGeometry[] = [];
  const forest = new Color(0x5d8c4c);
  const rock = new Color(0x8d929c);
  const snow = new Color(0xf5f8fc);
  const count = 20;
  for (let i = 0; i < count; i++) {
    const angle = ((i + random() * 0.6) / count) * Math.PI * 2;
    const distance = 24000 + random() * 5000;
    const height = 5000 + random() * 5000;
    const radius = 4500 + random() * 3500;
    const cone = new ConeGeometry(radius, height, 9, 5);
    // Craggy: push the inner vertices about (the same vertex is shared, so faces stay joined)
    const pos = cone.getAttribute("position");
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      if (y > -height / 2 + 1 && y < height / 2 - 1) {
        const n = noise(pos.getX(v) * 0.001 + i * 7, pos.getZ(v) * 0.001 + y * 0.0013);
        pos.setXYZ(v, pos.getX(v) * (1 + 0.18 * n), y + height * 0.05 * n, pos.getZ(v) * (1 + 0.18 * n));
      }
    }
    const flat = cone.toNonIndexed();
    flat.computeVertexNormals();
    const p = flat.getAttribute("position");
    const colors = new Float32Array(p.count * 3);
    const color = new Color();
    for (let v = 0; v < p.count; v += 3) {
      // One colour per face, by its height: forest, rock, snow
      const y = (p.getY(v) + p.getY(v + 1) + p.getY(v + 2)) / 3 / height + 0.5;
      color.copy(y < 0.3 ? forest : y < 0.62 + 0.08 * noise(i, v) ? rock : snow);
      for (let k = 0; k < 3; k++) colors.set([color.r, color.g, color.b], (v + k) * 3);
    }
    flat.setAttribute("color", new Float32BufferAttribute(colors, 3));
    flat.deleteAttribute("uv");
    flat.translate(Math.cos(angle) * distance, height / 2 - 600, Math.sin(angle) * distance);
    peaks.push(flat);
  }
  return new Mesh(combine(peaks), new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}
