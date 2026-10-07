// A crystal crater (original designs): stratified crater walls; giant glowing crystal formations jutting from the walls
// and floor; a colossal crystal at the heart of the impact; a glowing pool; a research station on the rim with domes,
// lit windows, a turning radar dish and a blinking mast; stars. And its creatures: crystal-shelled tortoises, a
// colossal one resting on a ledge. Three.js frame: y up.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { type Land, smoothstep } from "./nature";
import { fractalNoise, seededRandom, valueNoise } from "./random";
import { animate, combine, part } from "./shapes";

/** The crystals' colours: violet, cyan, rose, mint, pale gold. */
export const CRYSTAL_COLORS = [0xb47cff, 0x5fe8ff, 0xff7ac8, 0x7cffc4, 0xffe9a0].map((c) => new Color(c));

/** The crater: its floor, the walls' strata (bands by height, darker where steep), a dust of glints; and the pool. */
export function buildCraterGround(land: Land, seed: number, pool: { x: number; z: number; radius: number }): Group {
  const noise = valueNoise(seed);
  const geometry = new PlaneGeometry(66000, 66000, 330, 330);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) position.setY(i, land.height(position.getX(i), position.getZ(i)));
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute("normal");
  const colors = new Float32Array(position.count * 3);
  const floor = new Color(0x302a40);
  const strata = [0x2a2438, 0x3e3552, 0x2f2a42, 0x4a3f62, 0x352e4a].map((c) => new Color(c));
  const steep = new Color(0x1e1a2a);
  const rim = new Color(0x5a5070);
  const color = new Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = position.getY(i);
    // Bands by height, wavering a little
    const band = Math.floor((y + 300 * fractalNoise(noise, x / 4000, z / 4000, 2)) / 520);
    color.copy(strata[((band % strata.length) + strata.length) % strata.length] ?? floor);
    color.lerp(steep, smoothstep(0.85, 0.55, normal.getY(i)) * 0.6);
    color.lerp(floor, 1 - smoothstep(-600, 800, land.flatDistance(x, z)));
    color.lerp(rim, smoothstep(3800, 4600, y) * 0.6);
    // Glowing veins of crystal dust in the floor and the walls
    const vein = 1 - Math.abs(fractalNoise(noise, x / 1600 + 11, z / 1600 - 4, 2));
    color.lerp(new Color(0x7a5ac8), smoothstep(0.93, 0.99, vein) * 0.45);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const ground = new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true }));
  // The pool: glowing water, a brighter rim
  const water = new Mesh(new CircleGeometry(pool.radius + 120, 48).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x3fb8e8 }));
  water.position.set(pool.x, land.height(pool.x, pool.z) - 30, pool.z);
  const group = new Group();
  group.add(ground, water);
  return group;
}

/** A crystal cluster: a tall shard and smaller ones leaning out round it; base at y = 0 (sunk a little), ~1000 tall. */
function cluster(seed: number): BufferGeometry {
  const random = seededRandom(seed);
  const shards: BufferGeometry[] = [part(new OctahedronGeometry(170, 0), 0xffffff, { position: [0, 380, 0], scale: [1, 3.1, 1] })];
  const count = 4 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + random() * 0.5;
    const size = 70 + random() * 70;
    const out = 120 + random() * 90;
    shards.push(
      part(new OctahedronGeometry(size, 0), 0xffffff, {
        position: [Math.cos(a) * out, size * 1.6, Math.sin(a) * out],
        rotation: [Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55],
        scale: [1, 2.6, 1],
      }),
    );
  }
  return combine(shards).translate(0, -80, 0);
}

export interface Formation {
  readonly at: Vector3;
  /** The way it grows (unit): up, leaning out of the slope it's on */
  readonly up: Vector3;
  readonly size: number;
  readonly color: Color;
}

/** Crystal formations: glowing (unlit) clusters, each grown along its own `up` (two shapes, two draw calls). */
export function buildCrystals(formations: readonly Formation[]): Group {
  const shapes = [cluster(1), cluster(2)];
  const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 });
  const group = new Group();
  shapes.forEach((shape, k) => {
    const mine = formations.filter((_, i) => i % shapes.length === k);
    const mesh = new InstancedMesh(shape, material, mine.length);
    const q = new Quaternion();
    const spin = new Quaternion();
    mine.forEach((f, i) => {
      q.setFromUnitVectors(new Vector3(0, 1, 0), f.up).multiply(spin.setFromAxisAngle(new Vector3(0, 1, 0), i * 2.4));
      mesh.setMatrixAt(i, new Matrix4().compose(f.at, q, new Vector3().setScalar(f.size)));
      mesh.setColorAt(i, f.color);
    });
    mesh.frustumCulled = false;
    mesh.name = "crystals";
    group.add(mesh);
  });
  return group;
}

/** The heart of the impact: a colossal crystal, a cluster of huge shards, embedded in the crater wall. */
export function buildHeartCrystal(at: Vector3, size: number, color: Color): Mesh {
  const shards: BufferGeometry[] = [];
  const random = seededRandom(99);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const tilt = i === 0 ? 0 : 0.35 + random() * 0.45;
    const s = i === 0 ? 1 : 0.4 + random() * 0.35;
    shards.push(
      part(new OctahedronGeometry(size * 0.28 * s, 0), color, {
        position: [Math.sin(tilt) * Math.cos(a) * size * 0.35, size * 0.55 * s, Math.sin(tilt) * Math.sin(a) * size * 0.35],
        rotation: [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt],
        scale: [1, 3.2, 1],
      }),
    );
  }
  const mesh = new Mesh(combine(shards).translate(at.x, at.y - size * 0.15, at.z), new MeshBasicMaterial({ vertexColors: true }));
  mesh.name = "heart crystal";
  return mesh;
}

/** The research station on the rim, facing the crater: two domes, a lab joined by a tube, a mast with a blinking
 *  light, a radar dish turning. Returns its parts and a per-frame update (the dish, the light). */
export function buildStation(at: Vector3, facing: number): { root: Group; lights: Vector3[]; update(seconds: number): void } {
  const place = (dx: number, dy: number, dz: number): [number, number, number] => [
    at.x + dx * Math.cos(facing) + dz * Math.sin(facing),
    at.y + dy,
    at.z - dx * Math.sin(facing) + dz * Math.cos(facing),
  ];
  const white = 0xd8dde6;
  const grey = 0x8a909c;
  const body: BufferGeometry[] = [
    part(new SphereGeometry(900, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), white, { position: place(-1600, 0, 0) }),
    part(new SphereGeometry(650, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), white, { position: place(1500, 0, 300) }),
    part(new BoxGeometry(1500, 600, 900), grey, { position: place(0, 300, 200), rotation: [0, facing, 0] }),
    part(new CylinderGeometry(150, 150, 1200, 10), grey, { position: place(-950, 260, 100), rotation: [0, facing, Math.PI / 2] }),
    part(new CylinderGeometry(40, 60, 2800, 6), grey, { position: place(500, 1400, -400) }), // the mast
    part(new CylinderGeometry(30, 50, 600, 6), grey, { position: place(-300, 300, -700) }), // the dish's stand
  ];
  const windows: BufferGeometry[] = [];
  const lights: Vector3[] = [];
  for (let i = -2; i <= 2; i++) {
    const [x, y, z] = place(i * 260, 320, 660);
    windows.push(part(new BoxGeometry(150, 110, 10), 0x8ff0ff, { position: [x, y, z], rotation: [0, facing, 0] }));
    lights.push(new Vector3(...place(i * 260, 320, 760)));
  }
  for (const [dx, r] of [[-1600, 900], [1500, 650]] as const) {
    // A ring of lit portholes round each dome
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      windows.push(part(new SphereGeometry(55, 8, 6), 0xffe9b0, { position: place(dx + Math.cos(a) * r * 0.97, r * 0.28, Math.sin(a) * r * 0.97 + (dx > 0 ? 300 : 0)) }));
    }
  }
  const station = new Mesh(combine(body), new MeshLambertMaterial({ vertexColors: true }));
  const glass = new Mesh(combine(windows), new MeshBasicMaterial({ vertexColors: true }));
  // The beacon: a red light at the mast's top, blinking
  const beacon = new Mesh(new SphereGeometry(70, 10, 8), new MeshBasicMaterial({ color: 0xff3030 }));
  beacon.position.set(...place(500, 2850, -400));
  // The dish: a shallow bowl on a pivot, turning
  const dish = new Group();
  dish.position.set(...place(-300, 650, -700));
  const bowl = new Mesh(
    new SphereGeometry(420, 16, 6, 0, Math.PI * 2, 0, 0.6).rotateX(-Math.PI / 2 + 0.5),
    new MeshLambertMaterial({ color: white, side: DoubleSide }),
  );
  dish.add(bowl);
  const root = new Group();
  root.add(station, glass, beacon, dish);
  return {
    root,
    lights,
    update(seconds) {
      dish.rotation.y = seconds * 0.25;
      beacon.visible = seconds % 1.6 < 0.35;
    },
  };
}

/** Stars: points on a far sphere above the horizon, unaffected by fog. */
export function buildStars(seed: number, count: number, radius: number): Points {
  const random = seededRandom(seed);
  const positions: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2;
    const y = 0.08 + random() * 0.92; // (above the rim)
    const r = Math.sqrt(1 - y * y);
    positions.push(Math.cos(a) * r * radius, y * radius, Math.sin(a) * r * radius);
    const c = new Color().setHSL(0.6 + random() * 0.2, 0.4, 0.75 + random() * 0.25);
    colors.push(c.r, c.g, c.b);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const stars = new Points(
    geometry,
    new PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, blending: AdditiveBlending, depthWrite: false, transparent: true }),
  );
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  return stars;
}

/** A crystal tortoise (shell radius 1 unit, facing +z, feet at y = 0): its body, and the crystals on its shell
 *  (separately, so they can glow). */
function tortoise(shell: number, skin: number, crystal: number): { body: BufferGeometry; crystals: BufferGeometry } {
  const body: BufferGeometry[] = [
    part(new SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), shell, { position: [0, 0.32, 0], scale: [1, 0.72, 1.15] }),
    // The belly plate, closing the shell underneath: a shallow, pale dome
    part(new SphereGeometry(1, 20, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xb8ab84, { position: [0, 0.32, 0], scale: [0.97, 0.16, 1.12] }),
    part(new TorusGeometry(1, 0.09, 6, 24), new Color(shell).multiplyScalar(0.7), { position: [0, 0.32, 0], rotation: [Math.PI / 2, 0, 0], scale: [1, 1.15, 1] }),
    part(new SphereGeometry(0.36, 12, 8), skin, { position: [0, 0.48, 1.38], scale: [1, 0.85, 1.1] }), // head
    part(new CylinderGeometry(0.2, 0.24, 0.5, 8), skin, { position: [0, 0.38, 1.08], rotation: [1.1, 0, 0] }), // neck
    part(new SphereGeometry(0.07, 6, 5), 0x120e1a, { position: [-0.17, 0.58, 1.66] }), // eyes
    part(new SphereGeometry(0.07, 6, 5), 0x120e1a, { position: [0.17, 0.58, 1.66] }),
  ];
  for (const [x, z] of [[-0.7, 0.7], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7]] as const) {
    body.push(part(new CylinderGeometry(0.2, 0.24, 0.42, 8), skin, { position: [x, 0.2, z] }));
  }
  const crystals: BufferGeometry[] = [];
  const random = seededRandom(5);
  for (let i = 0; i < 7; i++) {
    const a = random() * Math.PI * 2;
    const r = i === 0 ? 0 : 0.3 + random() * 0.4;
    const tilt = r * 0.9;
    crystals.push(
      part(new OctahedronGeometry(0.14 + random() * 0.12, 0), crystal, {
        position: [Math.cos(a) * r, 0.32 + 0.72 * Math.sqrt(Math.max(0, 1 - r * r)) + 0.15, Math.sin(a) * r * 1.15],
        rotation: [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt],
        scale: [1, 2.6, 1],
      }),
    );
  }
  return { body: combine(body), crystals: combine(crystals) };
}

/** A little crystal tortoise for the walkers: body and crystals together, ~140 long. */
export function littleTortoise(): BufferGeometry {
  const { body, crystals } = tortoise(0x6a5a8a, 0x8a9a7a, 0x7cffe0);
  return combine([body, crystals]).scale(70, 70, 70);
}

/** The colossal tortoise, resting on a ledge of the crater wall, crystals glowing on its shell; it breathes slowly. */
export function buildColossus(at: Vector3, facing: number, size: number): { root: Group; time: { value: number } } {
  const { body, crystals } = tortoise(0x4a3f62, 0x6a7a5a, 0xc8a0ff);
  const placeIt = (g: BufferGeometry): BufferGeometry => g.scale(size, size, size).rotateY(facing).translate(at.x, at.y, at.z);
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const uniforms = animate(material, `transformed += objectNormal * (sin(time * 0.5) * 0.5 + 0.5) * ${(size * 0.012).toFixed(1)};`, "", {});
  const shell = new Mesh(placeIt(body), material);
  shell.name = "colossus";
  const glow = new Mesh(placeIt(crystals), new MeshBasicMaterial({ vertexColors: true }));
  const root = new Group();
  root.add(shell, glow);
  return { root, time: uniforms.time };
}
