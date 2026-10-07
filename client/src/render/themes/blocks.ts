// A bright, blocky platformer world (original designs): brick and golden blocks with pixel-art faces, grass-topped
// floating platforms, pipes, spinning coins, big striped bump-hills, chunky clouds and a little castle with a flag.
// Textures are pixel art made here (no downloads). Three.js frame: ground in x/z, y up.
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  Group,
  type InstancedMesh,
  LinearMipmapNearestFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
} from "three";
import { type Placement, animate, combine, instances, part } from "./shapes";

/** Block size (uu). */
export const BLOCK = 220;

/** A pixel-art texture, `width` by `height`, from a colour per pixel (x right, y up from the bottom row). */
function pixels(width: number, height: number, color: (x: number, y: number) => number): DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = color(x, y);
      data.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255], (y * width + x) * 4);
    }
  }
  const texture = new DataTexture(data, width, height);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter; // crisp pixels up close
  texture.minFilter = LinearMipmapNearestFilter;
  texture.generateMipmaps = true;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

const hash = (x: number, y: number): number => {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

/** Bricks: offset rows, dark mortar, a highlight along each brick's top. */
const brickTexture = (): DataTexture =>
  pixels(16, 16, (x, y) => {
    const row = Math.floor(y / 4);
    if (y % 4 === 3 || (x + (row % 2) * 4) % 8 === 0) return 0x3a1a0a;
    return y % 4 === 2 ? 0xe08a50 : 0xc4632e;
  });

/** A golden block: a dark rim, rivets in the corners, a shining diamond in the middle. */
const goldTexture = (): DataTexture =>
  pixels(16, 16, (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return 0x8a5a10;
    if ((x === 2 || x === 13) && (y === 2 || y === 13)) return 0x8a5a10;
    const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
    if (d < 3) return 0xfff3b0;
    if (d < 4.2) return 0xd18b1a;
    return x + y < 8 ? 0xffd25c : 0xf2ae2e;
  });

/** A grassy platform block: the top half of the texture is grass, the bottom half the sides (dirt, a grass fringe). */
const platformTexture = (): DataTexture =>
  pixels(16, 32, (x, y) => {
    if (y >= 16) return hash(x, y) > 0.8 ? 0x8ae86a : 0x5cc84a; // the top
    const fringe = 12 + (hash(x, 0) > 0.5 ? 1 : 0); // grass hanging over the side, jagged
    if (y >= fringe) return y === fringe ? 0x3f9a34 : 0x5cc84a;
    return hash(x, y) > 0.82 ? 0x8c5426 : 0xb8763c;
  });

/** A block with its top face mapped to the texture's upper half and its other faces to the lower half. */
function platformBlock(): BufferGeometry {
  const box = new BoxGeometry(BLOCK, BLOCK, BLOCK);
  const uv = box.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    const top = i >= 8 && i < 12; // (faces: +x, -x, +y, -y, +z, -z; four vertices each)
    uv.setY(i, top ? 0.5 + uv.getY(i) * 0.5 : uv.getY(i) * 0.5);
  }
  return box;
}

export type BlockKind = "brick" | "gold" | "platform";

/** Blocks of each kind (three draw calls, pixel-art textures). `placed`: where each block's centre is. */
export function buildBlocks(placed: Readonly<Record<BlockKind, readonly [number, number, number][]>>): Group {
  const material = (map: DataTexture): MeshLambertMaterial => new MeshLambertMaterial({ map });
  const at = (list: readonly [number, number, number][]): Placement[] => list.map((p) => ({ position: p }));
  const group = new Group();
  group.add(
    instances(new BoxGeometry(BLOCK, BLOCK, BLOCK), material(brickTexture()), at(placed.brick)),
    instances(new BoxGeometry(BLOCK, BLOCK, BLOCK), material(goldTexture()), at(placed.gold)),
    instances(platformBlock(), material(platformTexture()), at(placed.platform)),
  );
  return group;
}

/** Pipes standing up, each in its colour: a body, a wider lip, a dark mouth (one draw call). */
export function buildPipes(pipes: readonly { x: number; y: number; z: number; height: number; color: number; radius: number }[]): Mesh {
  const parts: BufferGeometry[] = [];
  for (const p of pipes) {
    const c = new Color(p.color);
    parts.push(part(new CylinderGeometry(p.radius, p.radius, p.height, 20), c, { position: [p.x, p.y + p.height / 2, p.z] }));
    parts.push(part(new CylinderGeometry(p.radius * 1.18, p.radius * 1.18, 130, 20), c.clone().multiplyScalar(1.12), {
      position: [p.x, p.y + p.height + 65, p.z],
    }));
    parts.push(part(new CylinderGeometry(p.radius * 0.88, p.radius * 0.88, 6, 20), 0x10240f, { position: [p.x, p.y + p.height + 131, p.z] }));
  }
  return new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true }));
}

/** Spinning gold coins (one draw call): each turns about its upright axis at its own pace, bobbing a little. */
export function buildCoins(spots: readonly [number, number, number][]): { mesh: InstancedMesh; time: { value: number } } {
  const coin = combine([
    part(new CylinderGeometry(90, 90, 18, 24), 0xffd23a, { rotation: [Math.PI / 2, 0, 0] }),
    part(new CylinderGeometry(62, 62, 24, 20), 0xf0a81e, { rotation: [Math.PI / 2, 0, 0] }),
    part(new BoxGeometry(18, 80, 28), 0xffe98a), // the stamp
  ]);
  const material = new MeshLambertMaterial({ vertexColors: true, emissive: 0x3a2400 });
  const turn = "vec2 turn(vec2 xz, float a) { float c = cos(a), s = sin(a); return vec2(c * xz.x + s * xz.y, -s * xz.x + c * xz.y); }";
  const own = "float own() { vec3 h = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; return fract(sin(dot(h.xz, vec2(12.9898, 78.233)) + h.y) * 43758.5453); }";
  const uniforms = animate(
    material,
    /* glsl */ `
      transformed.xz = turn(transformed.xz, time * 1.6 + own() * 6.2832);
      transformed.y += sin(time * 1.3 + own() * 6.2832) * 20.0;`,
    `${turn}\n${own}`,
    {},
    "objectNormal.xz = turn(objectNormal.xz, time * 1.6 + own() * 6.2832);",
  );
  return { mesh: instances(coin, material, spots.map((p) => ({ position: p }))), time: uniforms.time };
}

/** Big bump-hills in the background: smooth domes with darker stripes running up them (one draw call). */
export function buildBumpHills(hills: readonly { x: number; y: number; z: number; radius: number; height: number; color: number }[]): Mesh {
  const parts = hills.map((h) => {
    const dome = part(new SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0xffffff, {
      position: [h.x, h.y - 30, h.z],
      scale: [h.radius, h.height, h.radius],
    });
    const colors = dome.getAttribute("color");
    const pos = dome.getAttribute("position");
    const base = new Color(h.color);
    const stripe = base.clone().multiplyScalar(0.8);
    for (let v = 0; v < colors.count; v++) {
      const angle = Math.atan2(pos.getZ(v) - h.z, pos.getX(v) - h.x);
      const c = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 16) % 2 === 0 ? base : stripe;
      colors.setXYZ(v, c.r, c.g, c.b);
    }
    return dome;
  });
  return new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

/** Chunky cartoon clouds drifting slowly to and fro across the sky (one draw call): unlit, white with pale-blue
 *  undersides, as in a cartoon (lit, the green light from the ground would tint them). */
export function buildClouds(placements: readonly Placement[]): { mesh: InstancedMesh; time: { value: number } } {
  const puff = combine([
    part(new SphereGeometry(420, 12, 8), 0xffffff, { position: [0, 0, 0] }),
    part(new SphereGeometry(330, 12, 8), 0xdfe9ff, { position: [-480, -80, 40] }),
    part(new SphereGeometry(360, 12, 8), 0xdfe9ff, { position: [470, -60, -30] }),
    part(new SphereGeometry(280, 12, 8), 0xffffff, { position: [180, 260, 20] }),
    part(new SphereGeometry(260, 12, 8), 0xffffff, { position: [-240, 220, -40] }),
  ]);
  const material = new MeshBasicMaterial({ vertexColors: true });
  const uniforms = animate(material, "transformed.x += sin(time * 0.03 + float(gl_InstanceID) * 1.7) * 1200.0;", "", {});
  return { mesh: instances(puff, material, placements), time: uniforms.time };
}

/** A little stone castle with crenellated towers, a dark doorway and a pennant on top; and a flagpole by it. */
export function buildCastle(x: number, y: number, z: number, facing: number): Mesh {
  const stone = 0xb9a58a;
  const dark = 0x6e5a48;
  const parts: BufferGeometry[] = [];
  const at = (dx: number, dy: number, dz: number): [number, number, number] => [
    x + dx * Math.cos(facing) + dz * Math.sin(facing),
    y + dy,
    z - dx * Math.sin(facing) + dz * Math.cos(facing),
  ];
  const box = (w: number, h: number, d: number, dx: number, dy: number, dz: number, color: number): void => {
    parts.push(part(new BoxGeometry(w, h, d), color, { position: at(dx, dy + h / 2, dz), rotation: [0, facing, 0] }));
  };
  box(2400, 1400, 1400, 0, 0, 0, stone); // the keep
  box(700, 900, 40, 0, 0, 715, 0x2a1e18); // the doorway
  for (let i = -5; i <= 5; i++) if (i % 2 === 0) box(180, 200, 1400, i * 200, 1400, 0, stone); // battlements
  for (const s of [-1, 1]) {
    box(800, 2400, 800, s * 1500, 0, 0, stone); // towers
    for (let i = -1; i <= 1; i++) box(200, 220, 800, s * 1500 + i * 280, 2400, 0, stone);
    box(260, 340, 40, s * 1500, 1500, 410, dark); // windows
  }
  parts.push(part(new CylinderGeometry(20, 20, 900, 6), 0x6b4a2e, { position: at(0, 1850, 0) }));
  parts.push(part(new BoxGeometry(320, 200, 12), 0xff5a4a, { position: at(170, 2180, 0), rotation: [0, facing, 0] }));
  // The flagpole, out in front: a white pole, a green flag, a gold ball on top, a block for a base
  parts.push(part(new CylinderGeometry(22, 22, 3400, 8), 0xf2f2f2, { position: at(-3200, 1700 + BLOCK, 2600) }));
  parts.push(part(new SphereGeometry(70, 10, 8), 0xffd23a, { position: at(-3200, 3480 + BLOCK, 2600) }));
  parts.push(part(new BoxGeometry(420, 300, 12), 0x3fbf4a, { position: at(-3000, 3150 + BLOCK, 2600), rotation: [0, facing, 0] }));
  parts.push(part(new BoxGeometry(BLOCK, BLOCK, BLOCK), 0x8a6a4a, { position: at(-3200, BLOCK / 2, 2600) }));
  return new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true }));
}
