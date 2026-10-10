// A cyberpunk megacity at night, for the arena on its rooftop deck: a canyon of skyscrapers with procedurally lit
// windows and neon trims, neon signs with glow, holographic billboards (abstract: a watching eye, an equaliser, a
// spinning logo), flying-car traffic along the street corridors, an elevated train, searchlights sweeping the smog, and
// rain. Three.js frame: ground in x/z, y up; the deck is at the field's level, the streets far below.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";
import { seededRandom } from "./random";
import { ADDITIVE_FOG, type Placement, animate, combine, instances, part } from "./shapes";
import { PLAYING_VOLUME } from "./theme";

/** The rooftop deck around the arena (its top is the field's level), and the streets far below. */
// (its top well below the field, which is pushed back in depth: see GROUND_LEVEL in nature.ts)
export const DECK = { halfX: PLAYING_VOLUME.halfX + 1800, halfZ: PLAYING_VOLUME.halfZ + 1800, top: -40 } as const;
export const STREET = -4000;
/** City blocks: one every PITCH uu, with streets STREET_WIDTH wide between them (centred on PITCH / 2 + k PITCH). */
const PITCH = 2600;
const STREET_WIDTH = 600;
const CITY_RADIUS = 26000;

export interface Tower {
  readonly x: number;
  readonly z: number;
  readonly width: number; // along x
  readonly depth: number; // along z
  readonly height: number; // from the street
}

/** Street centre lines (x or z), within the city. */
export function streetLines(): number[] {
  const lines: number[] = [];
  for (let k = -Math.ceil(CITY_RADIUS / PITCH); k * PITCH <= CITY_RADIUS; k++) lines.push(k * PITCH + PITCH / 2);
  return lines;
}

/** The towers: blocks of one to four, kept back from the deck; taller further out, with a few megatowers. */
export function layoutTowers(seed: number): Tower[] {
  const random = seededRandom(seed);
  const towers: Tower[] = [];
  const blocks = Math.ceil(CITY_RADIUS / PITCH);
  for (let i = -blocks; i <= blocks; i++) {
    for (let j = -blocks; j <= blocks; j++) {
      const cx = i * PITCH;
      const cz = j * PITCH;
      const half = (PITCH - STREET_WIDTH) / 2;
      // Clear of the deck (a canyon all round it), and inside the city's circle
      if (Math.abs(cx) - half < DECK.halfX + 900 && Math.abs(cz) - half < DECK.halfZ + 900) continue;
      const distance = Math.hypot(cx, cz);
      if (distance > CITY_RADIUS) continue;
      // Split the block into lots
      const lots: [number, number, number, number][] = [[cx - half, cz - half, cx + half, cz + half]];
      for (let split = 0; split < 2; split++) {
        if (random() < 0.45) continue;
        const next: [number, number, number, number][] = [];
        for (const [x0, z0, x1, z1] of lots) {
          const alongX = x1 - x0 > z1 - z0;
          const cut = 0.35 + random() * 0.3;
          if (alongX) next.push([x0, z0, x0 + (x1 - x0) * cut, z1], [x0 + (x1 - x0) * cut, z0, x1, z1]);
          else next.push([x0, z0, x1, z0 + (z1 - z0) * cut], [x0, z0 + (z1 - z0) * cut, x1, z1]);
        }
        lots.splice(0, lots.length, ...next);
      }
      for (const [x0, z0, x1, z1] of lots) {
        const setback = 60 + random() * 160;
        const tall = Math.min(1, distance / 18000);
        const height = 2800 + random() ** 1.5 * (9000 + 12000 * tall) + (random() < 0.04 ? 14000 : 0);
        towers.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, width: x1 - x0 - 2 * setback, depth: z1 - z0 - 2 * setback, height });
      }
    }
  }
  return towers;
}

const towerVertex = /* glsl */ `
varying vec3 vLocal; // in the tower: x/z from its axis, y up from the street (uu)
varying vec3 vSize;
// (flat: the same for the whole face or tower; interpolating them adds rounding that the window hash would amplify into
// per-pixel noise)
flat varying vec3 vFace; // the face's normal (the tower's own frame)
flat varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vLocal = position * vSize; // (a unit box with its base at y = 0)
  vFace = normal;
  vec3 at = instanceMatrix[3].xyz;
  vSeed = fract(sin(dot(at.xz, vec2(12.9898, 78.233))) * 43758.5453);
  vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const towerFragment = /* glsl */ `
uniform float time;
uniform vec3 facade;
varying vec3 vLocal;
varying vec3 vSize;
flat varying vec3 vFace;
flat varying float vSeed;
#include <fog_pars_fragment>

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 neonHue(float h) {
  // Cyan, magenta, violet, amber
  return h < 0.3 ? vec3(0.1, 0.9, 1.0) : h < 0.6 ? vec3(1.0, 0.15, 0.75) : h < 0.85 ? vec3(0.55, 0.3, 1.0) : vec3(1.0, 0.65, 0.1);
}

void main() {
  // Along the face, and up: window cells about a storey high
  vec2 face = abs(vFace.x) > 0.5 ? vec2(vLocal.z * sign(vFace.x), vLocal.y) : vec2(-vLocal.x * sign(vFace.z), vLocal.y);
  vec2 cellSize = vec2(150.0, 210.0) * (0.8 + 0.5 * vSeed);
  vec2 g = face / cellSize;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  // How much of a cell a pixel covers (derivatives taken here, outside any branch)
  float aa = max(fwidth(g.x), fwidth(g.y));
  // Distance to the face's own side edges (the tower's corners)
  float edge = abs(vFace.x) > 0.5 ? vSize.z * 0.5 - abs(vLocal.z) : vSize.x * 0.5 - abs(vLocal.x);
  float edgeAa = fwidth(edge);

  vec3 color = facade * (0.75 + 0.25 * abs(vFace.x)) * (0.85 + 0.3 * vSeed);
  if (vFace.y < 0.5) {
    float pane = smoothstep(0.2 - aa, 0.2 + aa, f.x) * (1.0 - smoothstep(0.8 - aa, 0.8 + aa, f.x))
      * smoothstep(0.28 - aa, 0.28 + aa, f.y) * (1.0 - smoothstep(0.78 - aa, 0.78 + aa, f.y));
    float r = hash(cell + vSeed * 97.0 + vFace.xz * 13.0);
    float lit = step(0.58, r);
    lit *= 1.0 - step(0.985, r) * step(0.5, fract(time * 2.0 + r * 10.0)); // a few flicker
    vec3 tone = r < 0.8 ? vec3(1.0, 0.72, 0.38) : r < 0.93 ? vec3(0.45, 0.8, 1.0) : vec3(1.0, 0.3, 0.8);
    // Far away the panes can't be resolved: their average glow instead
    vec3 near = tone * lit * pane;
    vec3 far = vec3(1.0, 0.72, 0.42) * 0.12;
    color += mix(near, far, smoothstep(0.2, 0.55, aa)) * 1.3;
    // Neon on some towers: up the corners, and a band round the crown
    float trimmed = step(0.62, vSeed);
    vec3 neon = neonHue(fract(vSeed * 7.3));
    float corner = 1.0 - smoothstep(8.0 - edgeAa, 8.0 + edgeAa, edge);
    float crown = step(vSize.y - 70.0, vLocal.y) * step(vLocal.y, vSize.y - 30.0);
    color = mix(color, neon * 1.4, trimmed * max(corner, crown));
  }
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The towers (one draw call): their windows lit at random, some flickering, some towers trimmed in neon. */
export function buildTowers(towers: readonly Tower[]): { mesh: InstancedMesh; time: { value: number } } {
  const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const time = { value: 0 };
  const material = new ShaderMaterial({
    vertexShader: towerVertex,
    fragmentShader: towerFragment,
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), facade: { value: new Color(0x1a1a2a) }, time },
    fog: true,
  });
  const mesh = instances(
    box,
    material,
    towers.map((t) => ({ position: [t.x, STREET, t.z], scale: [t.width, t.height, t.depth] })),
  );
  return { mesh, time };
}

/** Red aviation lights blinking on the tallest roofs. */
export function buildBeacons(towers: readonly Tower[]): { mesh: InstancedMesh; time: { value: number } } {
  const material = new MeshBasicMaterial({ color: 0xff2a2a });
  const uniforms = animate(
    material,
    "transformed *= step(0.55, fract(time * 0.7 + float(gl_InstanceID) * 0.37));",
    "",
    {},
  );
  const tall = towers.filter((t) => t.height > 9000);
  const placements = tall.map((t): Placement => ({ position: [t.x, STREET + t.height + 40, t.z], scale: [1, 1, 1] }));
  return { mesh: instances(new SphereGeometry(45, 8, 6), material, placements), time: uniforms.time };
}

/** The tower face nearest the arena: its centre line (x, z) and outward normal. */
function faceTowardArena(t: Tower): { x: number; z: number; nx: number; nz: number } {
  if (Math.abs(t.x) / (DECK.halfX + 900) > Math.abs(t.z) / (DECK.halfZ + 900)) {
    const nx = -Math.sign(t.x);
    return { x: t.x + (nx * t.width) / 2, z: t.z, nx, nz: 0 };
  }
  const nz = -Math.sign(t.z);
  return { x: t.x, z: t.z + (nz * t.depth) / 2, nx: 0, nz };
}

const NEON = [0x22e8ff, 0xff2bd6, 0xffe14a, 0x6cff6a, 0xa15bff].map((c) => new Color(c));

/** Neon signs on the towers nearest the arena (bars, upright or across), each with a soft glow around it. */
export function buildSigns(towers: readonly Tower[], seed: number): Group {
  const random = seededRandom(seed);
  const cores: (Placement & { tint: Color })[] = [];
  const glows: (Placement & { tint: Color })[] = [];
  for (const t of towers) {
    if (Math.abs(t.x) > DECK.halfX + 7000 || Math.abs(t.z) > DECK.halfZ + 7000) continue;
    const face = faceTowardArena(t);
    const faceWidth = face.nx !== 0 ? t.depth : t.width;
    const count = random() < 0.35 ? 0 : 1 + Math.floor(random() * 2);
    for (let k = 0; k < count; k++) {
      const upright = random() < 0.5;
      const w = upright ? 90 + random() * 60 : 500 + random() * Math.min(900, faceWidth * 0.6);
      const h = upright ? 600 + random() * 1100 : 90 + random() * 60;
      const along = (random() - 0.5) * Math.max(0, faceWidth - w - 100);
      const y = -1600 + random() * Math.min(4200, t.height - 2400);
      const tint = NEON[Math.floor(random() * NEON.length)] ?? new Color(0xffffff);
      const yaw = Math.atan2(face.nx, face.nz);
      const at = (out: number): [number, number, number] => [
        face.x + face.nx * out + (face.nz !== 0 ? along : 0),
        y,
        face.z + face.nz * out + (face.nx !== 0 ? along : 0),
      ];
      cores.push({ position: at(14), rotation: [0, yaw, 0], scale: [w, h, 1], tint });
      glows.push({ position: at(24), rotation: [0, yaw, 0], scale: [w + 520, h + 520, 1], tint });
    }
  }
  const glow = new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vTint;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = vec3(1.0);
        #endif
        vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vTint;
      #include <fog_pars_fragment>
      void main() {
        vec2 q = 1.0 - abs(vUv * 2.0 - 1.0);
        float g = q.x * q.y;
        gl_FragColor = vec4(vTint * g * g * 0.6, 1.0);
        #include <colorspace_fragment>
        ${ADDITIVE_FOG}
      }`,
    uniforms: UniformsUtils.clone(UniformsLib.fog),
    fog: true,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const group = new Group();
  group.add(
    instances(new PlaneGeometry(1, 1), new MeshBasicMaterial({ side: DoubleSide }), cores),
    instances(new PlaneGeometry(1, 1), glow, glows),
  );
  return group;
}

const billboardFragment = /* glsl */ `
uniform float time;
varying vec2 vUv;
flat varying float vSeed;
#include <fog_pars_fragment>

vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
float hash(float x) { return fract(sin(x * 91.7) * 43758.5453); }

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  p.x *= 1.8; // (the screens are 1.8 wide to 1 high)
  float t = time + vSeed * 40.0;
  vec3 base = hue(fract(vSeed * 3.7));
  vec3 accent = hue(fract(vSeed * 3.7 + 0.45));
  vec3 color = base * 0.08; // the screen's own dim glow
  float design = floor(vSeed * 3.0);
  if (design < 1.0) {
    // An eye, watching: it looks around, and now and then it blinks
    float open = clamp(abs(sin(t * 0.35)) * 6.0, 0.0, 1.0);
    float lid = 0.72 * (1.0 - (p.x / 1.55) * (p.x / 1.55)) * open;
    float inside = step(abs(p.y), lid);
    vec2 look = vec2(0.45 * sin(t * 0.5), 0.12 * sin(t * 0.83));
    float r = length(p - look);
    color += inside * (base * 0.25 + accent * smoothstep(0.5, 0.46, r) * (0.6 + 0.4 * sin(r * 40.0 - t * 3.0)));
    color *= 1.0 - inside * smoothstep(0.2, 0.17, r); // the pupil
    color += base * smoothstep(0.05, 0.0, abs(abs(p.y) - lid)) * step(0.01, lid); // the lids' outline
  } else if (design < 2.0) {
    // An equaliser: bars bouncing to a beat
    float bar = floor((p.x + 1.8) / 3.6 * 16.0);
    float level = 0.25 + 0.6 * abs(sin(t * (1.5 + hash(bar) * 2.0) + bar * 0.7));
    float y = vUv.y;
    float inBar = step(0.15, fract((p.x + 1.8) / 3.6 * 16.0)) * step(y, level) * step(0.06, y);
    color += inBar * mix(base, accent, y / max(level, 0.01));
  } else {
    // A spinning logo: a diamond in rings
    float a = t * 0.8;
    vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
    float diamond = abs(q.x) + abs(q.y);
    color += accent * smoothstep(0.06, 0.0, abs(diamond - 0.55));
    color += base * smoothstep(0.04, 0.0, abs(length(p) - 0.8 - 0.05 * sin(t * 2.0)));
    color += mix(base, accent, 0.5) * smoothstep(0.35, 0.0, diamond) * 0.7;
  }
  // Scanlines, a frame, the odd flicker
  color *= 0.78 + 0.22 * sin(vUv.y * 420.0 + t * 6.0);
  vec2 border = min(vUv, 1.0 - vUv);
  color += base * smoothstep(0.03, 0.0, min(border.x / 1.8, border.y)) * 0.8;
  color *= 0.85 + 0.15 * step(0.08, hash(floor(t * 12.0)));
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  ${ADDITIVE_FOG}
}
`;

/** Holographic billboards (one draw call): screens with abstract animated designs, glowing over the city. */
export function buildBillboards(placements: readonly Placement[]): { mesh: InstancedMesh; time: { value: number } } {
  const time = { value: 0 };
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      flat varying float vSeed;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec3 at = instanceMatrix[3].xyz;
        vSeed = fract(sin(dot(at.xz, vec2(12.9898, 78.233)) + at.y) * 43758.5453);
        vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: billboardFragment,
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), time },
    fog: true,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  return { mesh: instances(new PlaneGeometry(1, 1), material, placements), time };
}

/** Billboards on the towers facing the arena, as many as `count`, a few storeys above the deck. */
export function billboardsOnTowers(towers: readonly Tower[], seed: number, count: number): Placement[] {
  const random = seededRandom(seed);
  const candidates = towers.filter(
    (t) => Math.abs(t.x) < DECK.halfX + 5000 && Math.abs(t.z) < DECK.halfZ + 5000 && t.height > 6000,
  );
  const out: Placement[] = [];
  while (out.length < count && candidates.length > 0) {
    const t = candidates.splice(Math.floor(random() * candidates.length), 1)[0];
    if (!t) break;
    const face = faceTowardArena(t);
    const faceWidth = face.nx !== 0 ? t.depth : t.width;
    const w = Math.min(2600, faceWidth * 0.85);
    out.push({
      position: [face.x + face.nx * 30, 1200 + random() * 2500, face.z + face.nz * 30],
      rotation: [0, Math.atan2(face.nx, face.nz), 0],
      scale: [w, w / 1.8, 1],
    });
  }
  return out;
}

/** Flying cars in lanes along the street corridors (one draw call); they loop the city, unlit but for their lights. */
export function buildTraffic(seed: number): { mesh: InstancedMesh; time: { value: number } } {
  const random = seededRandom(seed);
  const car = combine([
    part(new BoxGeometry(110, 50, 230), 0x2a2d3a, { position: [0, 0, 0] }),
    part(new BoxGeometry(90, 30, 110), 0x14161e, { position: [0, 38, -10] }),
    part(new BoxGeometry(100, 8, 6), 0xfff6e0, { position: [0, 6, 118] }), // headlights
    part(new BoxGeometry(104, 10, 6), 0xff2040, { position: [0, 8, -118] }), // tail lights
    part(new BoxGeometry(120, 4, 200), 0x18e0ff, { position: [0, -27, 0] }), // underglow
  ]);
  const material = new MeshBasicMaterial({ vertexColors: true });
  const uniforms = animate(
    material,
    /* glsl */ `
      // Along the lane (local +z), at its own speed, looping round the city
      float own = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
      float span = 52000.0;
      transformed.z += mod(time * (900.0 + 1300.0 * own) + own * span, span) - span * 0.5;`,
    "",
    {},
  );
  const lines = streetLines();
  const placements: Placement[] = [];
  for (let lane = 0; lane < 16; lane++) {
    const alongZ = lane % 2 === 0;
    const offset = lines[Math.floor(random() * lines.length)] ?? 0;
    const height = 2700 + lane * 260 + random() * 120;
    const reverse = random() < 0.5;
    for (let c = 0; c < 6; c++) {
      placements.push({
        position: alongZ ? [offset + (reverse ? 90 : -90), height, 0] : [0, height, offset + (reverse ? 90 : -90)],
        rotation: [0, (alongZ ? 0 : Math.PI / 2) + (reverse ? Math.PI : 0), 0],
      });
    }
  }
  return { mesh: instances(car, material, placements), time: uniforms.time };
}

/** An elevated train along a street beside the deck, running through every so often. */
export function buildTrain(trackX: number, trackY: number): { mesh: InstancedMesh; time: { value: number } } {
  const carriage = combine([
    part(new BoxGeometry(260, 220, 880), 0x2c3040, { position: [0, 110, 0] }),
    part(new BoxGeometry(266, 60, 820), 0x7ff6ff, { position: [0, 140, 0] }), // its lit windows
    part(new BoxGeometry(270, 12, 884), 0xff2bd6, { position: [0, 6, 0] }),
  ]);
  const material = new MeshBasicMaterial({ vertexColors: true });
  const uniforms = animate(
    material,
    /* glsl */ `
      // The whole train runs along z, then is gone for a while
      float span = 90000.0;
      transformed.z += mod(time * 2600.0, span) - span * 0.5 - float(gl_InstanceID) * 900.0;`,
    "",
    {},
  );
  const placements = Array.from({ length: 8 }, (): Placement => ({ position: [trackX, trackY, 0] }));
  return { mesh: instances(carriage, material, placements), time: uniforms.time };
}

/** Searchlights on far roofs, sweeping the smog (always leaning away from the arena). CPU-driven, five matrices. */
export function buildSearchlights(towers: readonly Tower[], seed: number): { mesh: InstancedMesh; update(elapsedSeconds: number): void } {
  const random = seededRandom(seed);
  // (9600 long: from the farthest roofs the beams' faded tips stay inside the camera's far plane all through their
  // sweeps, RV-90, RV-113)
  const beam = new CylinderGeometry(800 * (10 / 15), 40, 9600, 20, 1, true).translate(0, 4800, 0);
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying float vFacing;
      void main() {
        vAlong = uv.y;
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vFacing = abs(dot(n, normalize(cameraPosition - world.xyz)));
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlong;
      varying float vFacing;
      void main() {
        // Brightest at the lamp, fading up the beam; soft at its sides
        float glow = pow(1.0 - vAlong, 1.6) * vFacing * vFacing * 0.22;
        gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * glow, 1.0);
        #include <colorspace_fragment>
      }`,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const roofs = towers.filter((t) => t.height > 8000 && Math.hypot(t.x, t.z) > 11000 && Math.hypot(t.x, t.z) < 20000);
  const lights = Array.from({ length: 5 }, () => {
    const t = roofs.splice(Math.floor(random() * roofs.length), 1)[0];
    return {
      at: new Vector3(t?.x ?? 15000, STREET + (t?.height ?? 9000), t?.z ?? 0),
      phase: random() * Math.PI * 2,
      speed: 0.1 + random() * 0.1,
    };
  });
  const mesh = new InstancedMesh(beam, material, lights.length);
  mesh.frustumCulled = false;
  const tilt = new Quaternion();
  const yaw = new Quaternion();
  const matrix = new Matrix4();
  const one = new Vector3(1, 1, 1);
  const update = (seconds: number): void => {
    lights.forEach((l, i) => {
      // Lean outward (away from the arena), sweeping side to side and nodding
      const outward = Math.atan2(l.at.x, l.at.z);
      yaw.setFromAxisAngle(new Vector3(0, 1, 0), outward + 0.9 * Math.sin(seconds * l.speed + l.phase));
      tilt.setFromAxisAngle(new Vector3(1, 0, 0), 0.3 + 0.18 * Math.sin(seconds * l.speed * 1.3 + l.phase * 2));
      mesh.setMatrixAt(i, matrix.compose(l.at, yaw.clone().multiply(tilt), one));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { mesh, update };
}

/** Rain falling outside the arena: faint streaks, `count` of them within `radius`. Returns them and their clock. */
export function buildRain(seed: number, count: number, radius: number): { lines: LineSegments; time: { value: number } } {
  const random = seededRandom(seed);
  const positions: number[] = [];
  const bases: number[] = [];
  const top = 9000;
  const fall = top - STREET;
  while (bases.length < count * 2) {
    const x = (random() * 2 - 1) * radius;
    const z = (random() * 2 - 1) * radius;
    // Not in the arena: the cage keeps it dry, and the play clear
    if (Math.abs(x) < PLAYING_VOLUME.halfX + 300 && Math.abs(z) < PLAYING_VOLUME.halfZ + 300) continue;
    const y = STREET + random() * fall;
    positions.push(x, y, z, x + 12, y + 150, z + 6);
    bases.push(y, y);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("streakBase", new Float32BufferAttribute(bases, 1));
  const material = new LineBasicMaterial({ color: 0x9fb6ff, transparent: true, opacity: 0.22, depthWrite: false });
  const uniforms = animate(
    material,
    /* glsl */ `
      // Both ends of a streak fall together (by its lower end's height), wrapping from the streets back up to the clouds
      float dropped = mod(streakBase - time * 3200.0 + ${(-STREET).toFixed(1)}, ${fall.toFixed(1)}) - ${(-STREET).toFixed(1)};
      transformed.y += dropped - streakBase;`,
    "attribute float streakBase;",
    {},
  );
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  return { lines, time: uniforms.time };
}

/** The deck (dark metal, on columns), billboard poles at its corners, and the train's track: lit by the scene. */
export function buildDeck(trackX: number, trackY: number): Mesh {
  const parts: BufferGeometry[] = [
    part(new BoxGeometry(DECK.halfX * 2, 300, DECK.halfZ * 2), 0x24263a, { position: [0, DECK.top - 150, 0] }),
  ];
  // Columns down to the streets
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 0, 1]) {
      parts.push(
        part(new BoxGeometry(700, DECK.top - 300 - STREET, 700), 0x1d1f2e, {
          position: [sx * (DECK.halfX - 600), (DECK.top - 300 + STREET) / 2, sz * (DECK.halfZ - 900)],
        }),
      );
    }
  }
  // Poles for the corner billboards
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(part(new CylinderGeometry(50, 70, 2600, 8), 0x2e3144, { position: [sx * (DECK.halfX - 250), 1300, sz * (DECK.halfZ - 250)] }));
    }
  }
  // The elevated track: a beam on pillars, the length of the city
  parts.push(part(new BoxGeometry(320, 120, 60000), 0x2a2c3c, { position: [trackX, trackY - 60, 0] }));
  for (let z = -26000; z <= 26000; z += 3000) {
    parts.push(part(new BoxGeometry(160, trackY - 120 - STREET, 160), 0x22243a, { position: [trackX, (trackY - 120 + STREET) / 2, z] }));
  }
  return new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true }));
}

/** Neon rails round the deck's edge: magenta along the sides, cyan at the ends (unlit, one draw call). */
export function buildDeckNeon(): Mesh {
  const parts: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    parts.push(part(new BoxGeometry(24, 24, DECK.halfZ * 2), 0xff2bd6, { position: [s * DECK.halfX, DECK.top + 40, 0] }));
    parts.push(part(new BoxGeometry(24, 24, DECK.halfZ * 2), 0xff2bd6, { position: [s * DECK.halfX, DECK.top + 140, 0] }));
    parts.push(part(new BoxGeometry(DECK.halfX * 2, 24, 24), 0x22e8ff, { position: [0, DECK.top + 40, s * DECK.halfZ] }));
    parts.push(part(new BoxGeometry(DECK.halfX * 2, 24, 24), 0x22e8ff, { position: [0, DECK.top + 140, s * DECK.halfZ] }));
    // A glowing seam along the slab's edge
    parts.push(part(new BoxGeometry(14, 40, DECK.halfZ * 2), 0x7d4dff, { position: [s * (DECK.halfX + 2), DECK.top - 160, 0] }));
    parts.push(part(new BoxGeometry(DECK.halfX * 2, 40, 14), 0x7d4dff, { position: [0, DECK.top - 160, s * (DECK.halfZ + 2)] }));
  }
  return new Mesh(combine(parts), new MeshBasicMaterial({ vertexColors: true }));
}

/** The streets far below: dark ground, faint street-light glow along the corridors. */
export function buildStreets(): Mesh {
  const ground = part(new PlaneGeometry(70000, 70000).rotateX(-Math.PI / 2), 0x0c0c14, { position: [0, STREET, 0] });
  const lamps: BufferGeometry[] = [ground];
  for (const line of streetLines()) {
    for (const axis of [0, 1]) {
      const size: [number, number, number] = axis === 0 ? [60, 4, CITY_RADIUS * 2] : [CITY_RADIUS * 2, 4, 60];
      const at: [number, number, number] = axis === 0 ? [line, STREET + 5, 0] : [0, STREET + 5, line];
      lamps.push(part(new BoxGeometry(...size), 0xffb35c, { position: at }));
    }
  }
  return new Mesh(combine(lamps), new MeshBasicMaterial({ vertexColors: true }));
}
