// A pastel candy land (original designs): lollipop and cotton-candy trees, gumdrop bushes, cupcake houses, gift boxes,
// candy canes, a rainbow, giant plush teddy bears, and hearts, stars and balloons floating about. Everything moves
// gently, if at all. Three.js frame: ground in x/z, y up.
import {
  type BufferGeometry,
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  type InstancedMesh,
  LatheGeometry,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { type Area, type Land, scatter } from "./nature";
import { seededRandom } from "./random";
import { type Placement, animate, combine, instances, part } from "./shapes";

/** Pastel candy colours: pink, butter, sky, lavender, mint, peach. */
export const CANDY = [0xff8fc4, 0xffd36e, 0x9be7ff, 0xb9a6ff, 0x8ff0c0, 0xffa8a8].map((c) => new Color(c));
const pick = (random: () => number): Color => CANDY[Math.floor(random() * CANDY.length)] ?? new Color(0xffffff);

type Tinted = Placement & { tint: Color };

/** Placements on the ground over an area, each turned and sized at random (`size`: smallest, largest scale). */
function grounded(land: Land, random: () => number, area: Area, size: [number, number]): Tinted[] {
  return scatter(random, land, area).map(([x, z]) => {
    const s = size[0] + random() * (size[1] - size[0]);
    return { position: [x, land.height(x, z) - 8, z], rotation: [0, random() * Math.PI * 2, 0], scale: [s, s, s], tint: pick(random) };
  });
}

/** Two meshes sharing placements: one tinted per placement (the candy), one not (sticks, ribbons, cake). */
function pair(tinted: BufferGeometry, plain: BufferGeometry, material: Material, placements: readonly Tinted[]): Group {
  const group = new Group();
  group.add(instances(tinted, material, placements), instances(plain, material, placements, false));
  return group;
}

/** Lollipop trees: a swirl on a stick, two tones of the tree's candy colour. */
export function buildLollipops(land: Land, seed: number, area: Area): InstancedMesh {
  const random = seededRandom(seed);
  // The swirl: a tube coiled flat from the centre out, stood upright
  const points: Vector3[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    const a = t * Math.PI * 2 * 4;
    const r = 30 + t * 300;
    points.push(new Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  const swirl = part(new TubeGeometry(new CatmullRomCurve3(points), 140, 42, 5, false), 0xffffff, { position: [0, 1150, 0] });
  // Stripes along the coil (twenty): full colour and a paler one
  const colors = swirl.getAttribute("color");
  for (let v = 0; v < colors.count; v++) {
    const ring = Math.floor(v / 6);
    const shade = Math.floor(ring / 7) % 2 === 0 ? 1 : 0.62;
    colors.setXYZ(v, shade, shade, shade);
  }
  const tree = combine([
    swirl,
    part(new SphereGeometry(40, 8, 6), 0xffffff, { position: [0, 1150, 0] }),
    part(new CylinderGeometry(22, 26, 900, 8), 0xffffff, { position: [0, 450, 0] }),
  ]);
  return instances(tree, new MeshLambertMaterial({ vertexColors: true }), grounded(land, random, area, [0.8, 1.6]));
}

/** Cotton-candy trees: puffy tufts in candy colours on white sticks. */
export function buildCottonCandy(land: Land, seed: number, area: Area): Group {
  const random = seededRandom(seed);
  const tufts = combine([
    part(new SphereGeometry(300, 10, 8), 0xffffff, { position: [0, 1050, 0] }),
    part(new SphereGeometry(230, 10, 8), 0xffffff, { position: [200, 1180, 90] }),
    part(new SphereGeometry(220, 10, 8), 0xffffff, { position: [-190, 1150, -120] }),
    part(new SphereGeometry(200, 10, 8), 0xffffff, { position: [40, 1320, -60] }),
  ]);
  const stick = part(new CylinderGeometry(24, 30, 900, 8), 0xfff8ee, { position: [0, 450, 0] });
  return pair(tufts, stick, new MeshLambertMaterial({ vertexColors: true }), grounded(land, random, area, [0.8, 1.5]));
}

/** Gumdrops: glossy domes in every candy colour. */
export function buildGumdrops(land: Land, seed: number, area: Area): InstancedMesh {
  const random = seededRandom(seed);
  const profile: Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    profile.push(new Vector2(Math.max(2, 200 * Math.cos(t * Math.PI * 0.5) ** 0.6 * (1 - 0.15 * t)), t * 260));
  }
  const drop = part(new LatheGeometry(profile, 16), 0xffffff);
  return instances(drop, new MeshLambertMaterial({ vertexColors: true }), grounded(land, random, area, [0.6, 1.4]));
}

/** Cupcake houses: a fluted wrapper with a door and windows, frosting in the house's colour, a cherry on top. */
export function buildCupcakeHouses(land: Land, seed: number, area: Area): Group {
  const random = seededRandom(seed);
  const wrapper = part(new CylinderGeometry(560, 440, 560, 24), 0xffffff, { position: [0, 280, 0] });
  // Fluting: alternate light and pale stripes round the wrapper
  const colors = wrapper.getAttribute("color");
  const pos = wrapper.getAttribute("position");
  for (let v = 0; v < colors.count; v++) {
    const angle = Math.atan2(pos.getZ(v), pos.getX(v));
    const shade = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 24) % 2 === 0 ? 1 : 0.86;
    colors.setXYZ(v, shade, shade * 0.97, shade * 0.93);
  }
  const frosting = combine([
    part(new TorusGeometry(470, 150, 10, 24), 0xffffff, { position: [0, 600, 0], rotation: [Math.PI / 2, 0, 0] }),
    part(new TorusGeometry(330, 130, 10, 20), 0xffffff, { position: [0, 760, 0], rotation: [Math.PI / 2, 0, 0] }),
    part(new TorusGeometry(180, 110, 10, 16), 0xffffff, { position: [0, 900, 0], rotation: [Math.PI / 2, 0, 0] }),
    part(new ConeGeometry(160, 260, 12), 0xffffff, { position: [0, 1040, 0] }),
  ]);
  const plain = combine([
    wrapper,
    part(new SphereGeometry(110, 10, 8), 0xe8314f, { position: [0, 1240, 0] }), // the cherry
    part(new CylinderGeometry(8, 8, 160, 4), 0x5a8a3a, { position: [40, 1370, 0], rotation: [0, 0, -0.4] }),
    part(new BoxGeometry(200, 300, 30), 0xb56a7d, { position: [0, 150, 500] }), // the door
    part(new CylinderGeometry(70, 70, 20, 16), 0xfff6d8, { position: [-280, 360, 440], rotation: [Math.PI / 2, 0, -0.5] }),
    part(new CylinderGeometry(70, 70, 20, 16), 0xfff6d8, { position: [280, 360, 440], rotation: [Math.PI / 2, 0, 0.5] }),
  ]);
  return pair(frosting, plain, new MeshLambertMaterial({ vertexColors: true }), grounded(land, random, area, [0.9, 1.5]));
}

/** Gift boxes tied with white ribbon and a bow. */
export function buildGifts(land: Land, seed: number, area: Area): Group {
  const random = seededRandom(seed);
  const box = part(new BoxGeometry(400, 360, 400), 0xffffff, { position: [0, 180, 0] });
  const ribbon = combine([
    part(new BoxGeometry(410, 366, 70), 0xffffff, { position: [0, 180, 0] }),
    part(new BoxGeometry(70, 366, 410), 0xffffff, { position: [0, 180, 0] }),
    part(new TorusGeometry(70, 22, 8, 16), 0xffffff, { position: [-70, 400, 0], rotation: [0, 0, 0.5], scale: [1, 0.7, 1] }),
    part(new TorusGeometry(70, 22, 8, 16), 0xffffff, { position: [70, 400, 0], rotation: [0, 0, -0.5], scale: [1, 0.7, 1] }),
    part(new SphereGeometry(32, 8, 6), 0xffffff, { position: [0, 382, 0] }),
  ]);
  return pair(box, ribbon, new MeshLambertMaterial({ vertexColors: true }), grounded(land, random, area, [0.7, 1.6]));
}

/** Candy canes, red and white, planted in the ground. */
export function buildCandyCanes(land: Land, seed: number, area: Area): InstancedMesh {
  const random = seededRandom(seed);
  const points: Vector3[] = [new Vector3(0, 0, 0), new Vector3(0, 600, 0), new Vector3(0, 1100, 0)];
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    points.push(new Vector3(160 - Math.cos(a) * 160, 1100 + Math.sin(a) * 160, 0));
  }
  const rings = 64;
  const tube = part(new TubeGeometry(new CatmullRomCurve3(points), rings, 45, 8, false), 0xffffff);
  const colors = tube.getAttribute("color");
  const red = new Color(0xe8394f);
  for (let ring = 0; ring <= rings; ring++) {
    for (let j = 0; j <= 8; j++) {
      // Diagonal stripes: by distance along the cane plus the angle round it
      const stripe = Math.floor(ring / 1.6 + j / 4) % 2 === 0;
      const c = stripe ? red : new Color(0xffffff);
      colors.setXYZ(ring * 9 + j, c.r, c.g, c.b);
    }
  }
  return instances(tube, new MeshLambertMaterial({ vertexColors: true }), grounded(land, random, area, [0.8, 1.4]), false);
}

/** A heart, about 400 across, facing +z. */
function heartShape(): Shape {
  const s = new Shape();
  s.moveTo(0, -200);
  s.bezierCurveTo(-60, -140, -260, -10, -200, 120);
  s.bezierCurveTo(-150, 220, -20, 210, 0, 110);
  s.bezierCurveTo(20, 210, 150, 220, 200, 120);
  s.bezierCurveTo(260, -10, 60, -140, 0, -200);
  return s;
}

/** A five-pointed star, about 400 across. */
function starShape(): Shape {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? 210 : 95;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

// Shared GLSL: turn about y, the same for positions and normals
const TURN = "vec2 turn(vec2 xz, float a) { float c = cos(a), s = sin(a); return vec2(c * xz.x + s * xz.y, -s * xz.x + c * xz.y); }";
const OWN = "float own() { vec3 h = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; return fract(sin(dot(h.xz, vec2(12.9898, 78.233))) * 43758.5453); }";

/** Hearts and stars floating high around the arena, turning slowly and bobbing. `homes`: where each floats. */
export function buildFloaters(homes: readonly Tinted[]): { root: Group; time: { value: number } } {
  const time = { value: 0 };
  const extrude = (shape: Shape): BufferGeometry =>
    part(
      new ExtrudeGeometry(shape, { depth: 90, bevelEnabled: true, bevelThickness: 30, bevelSize: 30, bevelSegments: 3, curveSegments: 12 }).translate(0, 0, -45),
      0xffffff,
    );
  const material = new MeshLambertMaterial({ vertexColors: true });
  animate(
    material,
    /* glsl */ `
      float o = own();
      float spin = time * (0.25 + 0.3 * o) + o * 6.2832;
      transformed.xz = turn(transformed.xz, spin);
      transformed.y += sin(time * 0.7 + o * 6.2832) * 60.0;`,
    `${TURN}\n${OWN}`,
    { time },
    "objectNormal.xz = turn(objectNormal.xz, time * (0.25 + 0.3 * own()) + own() * 6.2832);",
  );
  const hearts = homes.filter((_, i) => i % 3 !== 2);
  const stars = homes.filter((_, i) => i % 3 === 2).map((h) => ({ ...h, tint: new Color(0xffe27a) }));
  const root = new Group();
  root.add(instances(extrude(heartShape()), material, hearts), instances(extrude(starShape()), material, stars));
  return { root, time };
}

/** Balloons rising from the ground and drifting up out of sight, round and round. `homes`: where each sets off. */
export function buildBalloons(homes: readonly Tinted[]): { mesh: InstancedMesh; time: { value: number } } {
  const balloon = combine([
    part(new SphereGeometry(120, 12, 10), 0xffffff, { position: [0, 520, 0], scale: [1, 1.18, 1] }),
    part(new ConeGeometry(22, 40, 8), 0xffffff, { position: [0, 380, 0], rotation: [Math.PI, 0, 0] }),
    part(new CylinderGeometry(2.5, 2.5, 360, 3), 0xffffff, { position: [0, 180, 0] }),
  ]);
  const material = new MeshLambertMaterial({ vertexColors: true });
  const uniforms = animate(
    material,
    /* glsl */ `
      float o = own();
      float span = 7000.0;
      transformed.y += mod(time * (55.0 + 45.0 * o) + o * span, span);
      transformed.x += sin(time * 0.45 + o * 9.0) * 120.0 * (position.y / 520.0);`,
    OWN,
    {},
  );
  return { mesh: instances(balloon, material, homes), time: uniforms.time };
}

/** A pastel rainbow arching over the far end, `radius` across from its centre (unlit, fades into the haze). */
export function buildRainbow(centre: Vector3, radius: number, facing: number): Mesh {
  const bands = [0xff9aa2, 0xffc89a, 0xfff19a, 0xa8f0b0, 0x9ad6ff, 0xb9a8ff, 0xe3a8ff];
  const width = radius * 0.04;
  const parts = bands.map((c, i) =>
    part(new TorusGeometry(radius - i * width, width / 2, 6, 64, Math.PI), c, { position: [centre.x, centre.y, centre.z], rotation: [0, facing, 0] }),
  );
  return new Mesh(combine(parts), new MeshBasicMaterial({ vertexColors: true }));
}

/** A giant plush teddy bear, sitting (about 1800 tall), facing +z, in one colour with a cream muzzle and paws. */
function bear(color: number): BufferGeometry {
  const cream = 0xfff3e2;
  const dark = 0x3a2a35;
  const parts: BufferGeometry[] = [
    part(new SphereGeometry(520, 16, 12), color, { position: [0, 520, 0], scale: [1, 1.05, 0.9] }), // body
    part(new SphereGeometry(330, 14, 10), cream, { position: [0, 520, 220], scale: [1, 1.1, 0.6] }), // tummy
    part(new SphereGeometry(450, 16, 12), color, { position: [0, 1300, 40] }), // head
    part(new SphereGeometry(170, 12, 10), cream, { position: [0, 1220, 430], scale: [1.2, 0.85, 0.8] }), // muzzle
    part(new SphereGeometry(55, 8, 6), dark, { position: [0, 1290, 540], scale: [1.2, 0.8, 0.8] }), // nose
  ];
  for (const s of [-1, 1]) {
    parts.push(part(new SphereGeometry(150, 12, 10), color, { position: [s * 330, 1650, 0] })); // ears
    parts.push(part(new SphereGeometry(85, 10, 8), cream, { position: [s * 335, 1655, 70], scale: [1, 1, 0.5] }));
    parts.push(part(new SphereGeometry(45, 8, 6), dark, { position: [s * 160, 1400, 400] })); // eyes
    parts.push(part(new SphereGeometry(16, 6, 4), 0xffffff, { position: [s * 150, 1418, 440] }));
    parts.push(part(new SphereGeometry(70, 10, 8), 0xff9ec0, { position: [s * 270, 1230, 360], scale: [1, 0.6, 0.4] })); // blush
    parts.push(part(new SphereGeometry(190, 12, 10), color, { position: [s * 560, 650, 120], scale: [0.8, 1.3, 0.8], rotation: [0, 0, s * 0.5] })); // arms
    parts.push(part(new SphereGeometry(230, 12, 10), color, { position: [s * 300, 180, 380], scale: [0.9, 0.75, 1.3] })); // legs
    parts.push(part(new SphereGeometry(120, 10, 8), cream, { position: [s * 300, 180, 650], scale: [1, 1, 0.3] })); // paw pads
  }
  return combine(parts);
}

/** The bears sitting round the arena (one draw call), breathing slowly. */
export function buildBears(seats: readonly { x: number; y: number; z: number; facing: number; color: number; scale: number }[]): {
  mesh: Mesh;
  time: { value: number };
} {
  const geometry = combine(
    seats.map((s) => {
      const g = bear(s.color);
      g.scale(s.scale, s.scale, s.scale);
      g.rotateY(s.facing);
      return g.translate(s.x, s.y, s.z);
    }),
  );
  const material = new MeshLambertMaterial({ vertexColors: true });
  const time = animate(material, "transformed += objectNormal * sin(time * 0.9 + position.x * 0.0005) * 6.0;", "", {}).time;
  return { mesh: new Mesh(geometry, material), time };
}
