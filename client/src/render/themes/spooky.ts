// A haunted graveyard at night (original designs): tombstones, crosses and obelisks (some leaning) inside wrought-iron
// fences, a crypt, bare twisted trees, jack-o'-lanterns and lanterns glowing and flickering, will-o'-wisps drifting over
// the graves, bats circling, fog banks rolling, a haunted mansion on the hill and a full moon behind it.
// Three.js frame: ground in x/z, y up.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  type InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";
import { seededRandom } from "./random";
import { ADDITIVE_FOG, type Placement, animate, combine, instances, part } from "./shapes";

type Tinted = Placement & { tint: Color };

/** A place on the ground: where, which way it faces (about y), how it leans. */
export interface Spot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: number;
  readonly lean: number;
}

// --- Gravestones -----------------------------------------------------------------------------------------------

/** A headstone with a rounded top, on a little plinth (facing +z). */
function headstone(): BufferGeometry {
  const s = new Shape();
  s.moveTo(-80, 0);
  s.lineTo(80, 0);
  s.lineTo(80, 170);
  s.absarc(0, 170, 80, 0, Math.PI, false);
  s.closePath();
  const slab = new ExtrudeGeometry(s, { depth: 36, bevelEnabled: true, bevelThickness: 4, bevelSize: 4, bevelSegments: 1, curveSegments: 10 });
  return combine([part(slab.translate(0, 20, -18), 0xffffff), part(new BoxGeometry(200, 24, 70), 0xd8d8d8, { position: [0, 12, 0] })]);
}

/** A stone cross on a stepped base. */
function cross(): BufferGeometry {
  return combine([
    part(new BoxGeometry(44, 300, 44), 0xffffff, { position: [0, 180, 0] }),
    part(new BoxGeometry(170, 44, 44), 0xffffff, { position: [0, 250, 0] }),
    part(new BoxGeometry(140, 40, 100), 0xd8d8d8, { position: [0, 20, 0] }),
  ]);
}

/** An obelisk: a tapering square column on a plinth, with a pointed cap. */
function obelisk(): BufferGeometry {
  return combine([
    part(new BoxGeometry(150, 70, 150), 0xd8d8d8, { position: [0, 35, 0] }),
    part(new CylinderGeometry(34, 58, 420, 4), 0xffffff, { position: [0, 280, 0], rotation: [0, Math.PI / 4, 0] }),
    part(new ConeGeometry(48, 90, 4), 0xffffff, { position: [0, 535, 0], rotation: [0, Math.PI / 4, 0] }),
  ]);
}

/** Gravestones of three kinds (three draw calls), in weathered greys with moss. */
export function buildGraves(spots: readonly Spot[], seed: number): Group {
  const random = seededRandom(seed);
  const kinds: Tinted[][] = [[], [], []];
  for (const s of spots) {
    const r = random();
    const kind = r < 0.62 ? 0 : r < 0.85 ? 1 : 2;
    const grey = 0.38 + random() * 0.22;
    const size = 0.85 + random() * 0.35;
    kinds[kind]?.push({
      position: [s.x, s.y - 6, s.z],
      rotation: [s.lean, s.facing, s.lean * 0.6],
      scale: [size, size, size],
      tint: new Color(grey, grey * (1.02 + random() * 0.08), grey * 0.95), // (a little moss in the grey)
    });
  }
  const material = new MeshLambertMaterial({ vertexColors: true });
  const group = new Group();
  group.add(...[headstone(), cross(), obelisk()].map((g, i) => instances(g, material, kinds[i] ?? [])));
  return group;
}

/** Rows of gravestone spots filling a rectangle (x0..x1, z0..z1), facing `facing`, some leaning. */
export function graveRows(
  rect: { x0: number; x1: number; z0: number; z1: number },
  facing: number,
  height: (x: number, z: number) => number,
  seed: number,
): Spot[] {
  const random = seededRandom(seed);
  const spots: Spot[] = [];
  for (let x = rect.x0 + 250; x < rect.x1 - 150; x += 380) {
    for (let z = rect.z0 + 250; z < rect.z1 - 150; z += 460) {
      if (random() < 0.18) continue;
      const px = x + (random() - 0.5) * 110;
      const pz = z + (random() - 0.5) * 110;
      spots.push({ x: px, y: height(px, pz), z: pz, facing: facing + (random() - 0.5) * 0.35, lean: random() < 0.3 ? (random() - 0.5) * 0.35 : 0 });
    }
  }
  return spots;
}

/** Wrought-iron fences round rectangles: spiked bars between two rails, a gap for a gate (one draw call). */
export function buildFences(rects: readonly { x0: number; x1: number; z0: number; z1: number }[], height: (x: number, z: number) => number): Mesh {
  const parts: BufferGeometry[] = [];
  const iron = 0x1c1a20;
  for (const r of rects) {
    const sides: [number, number, number, number][] = [
      [r.x0, r.z0, r.x1, r.z0],
      [r.x1, r.z0, r.x1, r.z1],
      [r.x1, r.z1, r.x0, r.z1],
      [r.x0, r.z1, r.x0, r.z0],
    ];
    sides.forEach(([ax, az, bx, bz], side) => {
      const length = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d <= length; d += 70) {
        const t = d / length;
        if (side === 0 && Math.abs(t - 0.5) < 0.06) continue; // the gate
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const y = height(x, z);
        const post = d % 560 < 70;
        parts.push(part(new CylinderGeometry(post ? 16 : 6, post ? 16 : 6, post ? 440 : 380, 4), iron, { position: [x, y + (post ? 220 : 190), z] }));
        parts.push(part(new ConeGeometry(post ? 26 : 13, post ? 50 : 34, 4), iron, { position: [x, y + (post ? 465 : 395), z] }));
      }
      // Rails, following the ground at each end
      for (const h of [70, 330]) {
        const ya = height(ax, az) + h;
        const yb = height(bx, bz) + h;
        const rail = new CylinderGeometry(7, 7, length, 4);
        rail.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(bx - ax, yb - ya, bz - az).normalize()));
        parts.push(part(rail, iron, { position: [(ax + bx) / 2, (ya + yb) / 2, (az + bz) / 2] }));
      }
    });
  }
  return new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true }));
}

// --- Dead trees ------------------------------------------------------------------------------------------------

/** A bare, twisted tree: a trunk forking again and again into crooked branches (about 1800 tall). */
function deadTree(seed: number): BufferGeometry {
  const random = seededRandom(seed);
  const parts: BufferGeometry[] = [];
  const up = new Vector3(0, 1, 0);
  const grow = (from: Vector3, direction: Vector3, length: number, radius: number, depth: number): void => {
    // A crooked limb: two segments, the second bent
    let at = from.clone();
    let dir = direction.clone();
    for (let k = 0; k < 2; k++) {
      const to = at.clone().addScaledVector(dir, length / 2);
      const segment = new CylinderGeometry(radius * 0.8, radius, length / 2, 5).translate(0, length / 4, 0);
      segment.applyQuaternion(new Quaternion().setFromUnitVectors(up, dir));
      segment.translate(at.x, at.y, at.z);
      parts.push(part(segment, 0x2a2420));
      at = to;
      dir = dir.clone().add(new Vector3((random() - 0.5) * 0.7, (random() - 0.3) * 0.3, (random() - 0.5) * 0.7)).normalize();
      radius *= 0.8;
    }
    if (depth === 0) return;
    const forks = 2 + (random() < 0.4 ? 1 : 0);
    for (let f = 0; f < forks; f++) {
      const spread = 0.5 + random() * 0.6;
      const around = random() * Math.PI * 2;
      const side = new Vector3(Math.cos(around), 0, Math.sin(around));
      const next = dir.clone().multiplyScalar(Math.cos(spread)).addScaledVector(side, Math.sin(spread)).normalize();
      grow(at, next, length * (0.62 + random() * 0.15), radius * 0.72, depth - 1);
    }
  };
  grow(new Vector3(0, -20, 0), up, 900, 70, 4);
  return combine(parts);
}

/** Bare trees (one draw call per shape; three shapes). */
export function buildDeadTrees(spots: readonly Spot[], seed: number): Group {
  const shapes = [deadTree(seed), deadTree(seed + 1), deadTree(seed + 2)];
  const random = seededRandom(seed + 3);
  const material = new MeshLambertMaterial({ vertexColors: true });
  const byShape: Placement[][] = shapes.map(() => []);
  for (const s of spots) {
    const k = 0.9 + random() * 0.8;
    byShape[Math.floor(random() * shapes.length)]?.push({ position: [s.x, s.y, s.z], rotation: [s.lean, s.facing, 0], scale: [k, k, k] });
  }
  const group = new Group();
  group.add(...shapes.map((g, i) => instances(g, material, byShape[i] ?? [])));
  return group;
}

// --- Lights: jack-o'-lanterns, lanterns, glows, wisps ----------------------------------------------------------

/** A jack-o'-lantern: a ribbed pumpkin and its carved face, glowing from inside (two draw calls: rind, face). */
export function buildPumpkins(spots: readonly Spot[]): Group {
  const body = new SphereGeometry(80, 24, 12);
  const pos = body.getAttribute("position");
  for (let v = 0; v < pos.count; v++) {
    // Ribs round it
    const angle = Math.atan2(pos.getZ(v), pos.getX(v));
    const k = 1 + 0.07 * Math.cos(angle * 10);
    pos.setXYZ(v, pos.getX(v) * k, pos.getY(v) * 0.78, pos.getZ(v) * k);
  }
  body.computeVertexNormals();
  const rind = combine([
    part(body, 0xe8761c, { position: [0, 62, 0] }),
    part(new CylinderGeometry(8, 12, 40, 5), 0x4a5a22, { position: [0, 132, 0], rotation: [0.25, 0, 0] }),
  ]);
  // The face: two eyes, a nose and a jagged grin, standing just out from the front
  const shape = (points: readonly [number, number][]): Shape => {
    const s = new Shape();
    points.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
    s.closePath();
    return s;
  };
  const faceShapes = [
    shape([[-46, 70], [-14, 70], [-30, 96]]),
    shape([[14, 70], [46, 70], [30, 96]]),
    shape([[-9, 55], [9, 55], [0, 68]]),
    shape([[-52, 40], [-34, 30], [-22, 40], [-8, 28], [8, 40], [22, 28], [34, 40], [52, 34], [36, 14], [0, 8], [-36, 14]]),
  ];
  const face = combine(faceShapes.map((s) => part(new ExtrudeGeometry(s, { depth: 4, bevelEnabled: false }).translate(0, 0, 76), 0xffc24a)));
  const placements = spots.map((s): Placement => ({ position: [s.x, s.y - 8, s.z], rotation: [0, s.facing, 0], scale: [1.4, 1.4, 1.4] }));
  const group = new Group();
  group.add(
    instances(rind, new MeshLambertMaterial({ vertexColors: true }), placements),
    instances(face, new MeshBasicMaterial({ vertexColors: true }), placements),
  );
  return group;
}

/** Soft glows (one draw call), always facing the camera, each in its colour and size, flickering like a flame. */
export function buildGlows(glows: readonly { x: number; y: number; z: number; size: number; color: Color; flicker: number }[]): {
  mesh: InstancedMesh;
  time: { value: number };
} {
  const time = { value: 0 };
  const geometry = new PlaneGeometry(1, 1);
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      uniform float time;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vBright;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec3 at = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float own = fract(sin(dot(at.xz, vec2(12.9898, 78.233)) + at.y) * 43758.5453);
        // How much it flickers is carried in the instance's z scale (0: steady; a plane has no depth to scale)
        float depth = length(instanceMatrix[2].xyz);
        float flame = 0.6 * sin(time * 9.0 + own * 40.0) + 0.4 * sin(time * 23.0 + own * 17.0);
        vBright = 1.0 - depth * (0.5 + 0.5 * flame);
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = vec3(1.0);
        #endif
        vec4 mvPosition = viewMatrix * modelMatrix * vec4(at, 1.0);
        mvPosition.xy += position.xy * length(instanceMatrix[0].xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vBright;
      #include <fog_pars_fragment>
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        float g = pow(max(0.0, 1.0 - r), 2.4) * vBright;
        gl_FragColor = vec4(vTint * g * 0.7, 1.0);
        #include <colorspace_fragment>
        ${ADDITIVE_FOG}
      }`,
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), time },
    fog: true,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const placements = glows.map((g): Tinted => ({
    position: [g.x, g.y, g.z],
    // (z scale carries the flicker: see the shader)
    scale: [g.size, g.size, g.flicker],
    tint: g.color,
  }));
  return { mesh: instances(geometry, material, placements), time };
}

/** Lantern posts along the path: a post, a crossbar and a hanging lantern (one draw call; their glow is separate). */
export function buildLanternPosts(spots: readonly Spot[]): Mesh {
  const parts: BufferGeometry[] = [];
  for (const s of spots) {
    const at = (dx: number, dy: number): [number, number, number] => [s.x + Math.sin(s.facing) * dx, s.y + dy, s.z + Math.cos(s.facing) * dx];
    parts.push(part(new CylinderGeometry(14, 18, 520, 5), 0x1c1a20, { position: at(0, 260) }));
    parts.push(part(new BoxGeometry(14, 14, 120), 0x1c1a20, { position: at(55, 500), rotation: [0, s.facing, 0] }));
    parts.push(part(new BoxGeometry(56, 76, 56), 0xffd58a, { position: at(110, 440) }));
    parts.push(part(new ConeGeometry(44, 34, 4), 0x1c1a20, { position: at(110, 495), rotation: [0, Math.PI / 4, 0] }));
  }
  return new Mesh(combine(parts), new MeshBasicMaterial({ vertexColors: true }));
}

/** Will-o'-wisps: pale glows wandering in slow loops over the graves (one draw call). */
export function buildWisps(
  homes: readonly [number, number, number][],
  color: Color = new Color(0.55, 1.0, 0.85),
): { mesh: InstancedMesh; time: { value: number } } {
  const time = { value: 0 };
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      uniform float time;
      varying vec2 vUv;
      varying float vPulse;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec3 at = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float own = fract(sin(dot(at.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float a = time * (0.15 + 0.15 * own) + own * 6.2832;
        at += vec3(cos(a) * 320.0, sin(time * 0.6 + own * 9.0) * 90.0, sin(a * 1.3) * 260.0);
        vPulse = 0.7 + 0.3 * sin(time * 1.7 + own * 12.0);
        vec4 mvPosition = viewMatrix * modelMatrix * vec4(at, 1.0);
        mvPosition.xy += position.xy * length(instanceMatrix[0].xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 tint;
      varying vec2 vUv;
      varying float vPulse;
      #include <fog_pars_fragment>
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        float core = smoothstep(0.18, 0.0, r);
        float halo = pow(max(0.0, 1.0 - r), 3.0);
        gl_FragColor = vec4(tint * (core * 1.2 + halo * 0.45) * vPulse, 1.0);
        #include <colorspace_fragment>
        ${ADDITIVE_FOG}
      }`,
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), time, tint: { value: color } },
    fog: true,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  return { mesh: instances(new PlaneGeometry(1, 1), material, homes.map((h) => ({ position: h, scale: [260, 260, 1] }))), time };
}

/** Fog banks: soft, wide, low veils, turned to the camera, rolling slowly (one draw call). */
export function buildFogBanks(
  banks: readonly [number, number, number][],
  color: Color = new Color(0.55, 0.6, 0.72),
): { mesh: InstancedMesh; time: { value: number } } {
  const time = { value: 0 };
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      uniform float time;
      varying vec2 vUv;
      varying float vSeed;
      varying float vLevel;
      void main() {
        vUv = uv;
        vec3 at = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vSeed = fract(sin(dot(at.xz, vec2(12.9898, 78.233))) * 43758.5453);
        at.x += sin(time * 0.05 + vSeed * 6.2832) * 600.0;
        // Seen from steeply above, an upright veil is a thin streak: fade it out
        vLevel = 1.0 - smoothstep(0.18, 0.4, abs(normalize(at - cameraPosition).y));
        // Turned to the camera about the vertical only: a veil standing on the ground
        vec3 toCamera = normalize(vec3(cameraPosition.x - at.x, 0.0, cameraPosition.z - at.z));
        vec3 side = vec3(toCamera.z, 0.0, -toCamera.x);
        vec3 world = at + side * position.x * length(instanceMatrix[0].xyz) + vec3(0.0, position.y * length(instanceMatrix[1].xyz), 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 tint;
      varying vec2 vUv;
      varying float vSeed;
      varying float vLevel;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        // Soft all round, thicker low down, wisping with a drifting noise
        vec2 q = vUv * 2.0 - 1.0;
        float shape = (1.0 - smoothstep(0.4, 1.0, abs(q.x))) * (1.0 - smoothstep(-0.2, 1.0, q.y)) * smoothstep(-1.0, -0.7, q.y);
        float wisp = noise(vec2(vUv.x * 5.0 + time * 0.04 + vSeed * 9.0, vUv.y * 2.5)) * 0.6 + 0.4;
        gl_FragColor = vec4(tint, shape * wisp * 0.32 * vLevel);
        #include <colorspace_fragment>
      }`,
    uniforms: { time, tint: { value: color } },
    blending: NormalBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  return { mesh: instances(new PlaneGeometry(1, 1), material, banks.map((b) => ({ position: b, scale: [3200, 900, 1] }))), time };
}

// --- Bats, the moon, the mansion, the crypt --------------------------------------------------------------------

/** Bats flitting in loops round their roosts (one draw call), wings beating fast. */
export function buildBats(roosts: readonly [number, number, number][]): { mesh: InstancedMesh; time: { value: number } } {
  const bat = new BufferGeometry();
  // A body along z and two scalloped wings out along x (four triangles each side)
  const wing = (s: number): number[] => [
    0, 0, 14, s * 70, 6, 4, 0, 0, -12,
    s * 70, 6, 4, s * 120, 0, -6, s * 62, 0, -14,
    s * 70, 6, 4, s * 62, 0, -14, 0, 0, -12,
    s * 120, 0, -6, s * 150, -4, 12, s * 70, 6, 4,
  ];
  bat.setAttribute("position", new Float32BufferAttribute([...wing(-1), ...wing(1), 0, 8, 20, -8, -6, -20, 8, -6, -20], 3));
  bat.computeVertexNormals();
  const geometry = part(bat, 0x141218);
  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const uniforms = animate(
    material,
    /* glsl */ `
      float own = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
      float a = time * (0.35 + 0.3 * own) * (own > 0.5 ? 1.0 : -1.0) + own * 6.2832;
      // Wings beat (the farther out, the more they move)
      transformed.y += abs(position.x) * 0.9 * sin(time * 16.0 + own * 30.0);
      // Facing along the loop, out round it, bobbing erratically
      float heading = own > 0.5 ? -a : 3.14159 - a;
      float c = cos(heading), s = sin(heading);
      transformed.xz = vec2(c * transformed.x + s * transformed.z, -s * transformed.x + c * transformed.z);
      float r = 700.0 + 900.0 * fract(own * 7.1);
      transformed += vec3(cos(a) * r, sin(time * 2.3 + own * 11.0) * 120.0, sin(a) * r) / length(instanceMatrix[0].xyz);`,
    "",
    {},
  );
  return { mesh: instances(geometry, material, roosts.map((r) => ({ position: r, scale: [1.6, 1.6, 1.6] }))), time: uniforms.time };
}

/** The full moon: a pale disc with darker seas, and a wide halo (not fogged; far out along `direction`). */
export function buildMoon(direction: Vector3, distance: number, radius: number): Group {
  const at = direction.clone().normalize().multiplyScalar(distance);
  const facing = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), direction.clone().normalize().negate());
  const disc = new CircleGeometry(radius, 48);
  const colors: number[] = [];
  const pos = disc.getAttribute("position");
  for (let v = 0; v < pos.count; v++) {
    // Darker "seas" in blotches
    const x = pos.getX(v) / radius;
    const y = pos.getY(v) / radius;
    const sea = Math.max(0, 0.5 - Math.hypot(x + 0.25, y - 0.2)) + Math.max(0, 0.35 - Math.hypot(x - 0.3, y + 0.15)) * 1.2;
    const k = 1 - sea * 0.55;
    colors.push(0.95 * k, 0.96 * k, 0.88 * k);
  }
  disc.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const moon = new Mesh(disc, new MeshBasicMaterial({ vertexColors: true, fog: false }));
  moon.quaternion.copy(facing);
  moon.position.copy(at);
  const halo = new Mesh(
    new PlaneGeometry(radius * 7, radius * 7),
    new ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          float r = length(vUv * 2.0 - 1.0);
          gl_FragColor = vec4(vec3(0.6, 0.68, 0.85) * pow(max(0.0, 1.0 - r), 3.0) * 0.6, 1.0);
          #include <colorspace_fragment>
        }`,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  halo.quaternion.copy(facing);
  halo.position.copy(at).addScaledVector(direction.clone().normalize(), 50);
  halo.renderOrder = -1;
  moon.renderOrder = -1;
  const group = new Group();
  group.add(halo, moon);
  return group;
}

/**
 * The haunted mansion (facing `facing`) on its hill, and a crypt among the graves: dark stone and slate, a tower,
 * gables and chimneys (one draw call); and their windows, some lit (another).
 */
export function buildBuildings(mansion: Spot, crypt: Spot): { stone: Mesh; windows: Mesh; lit: { x: number; y: number; z: number }[] } {
  const stone: BufferGeometry[] = [];
  const windows: BufferGeometry[] = [];
  const lit: { x: number; y: number; z: number }[] = [];
  const place = (s: Spot) => (dx: number, dy: number, dz: number): [number, number, number] => [
    s.x + dx * Math.cos(s.facing) + dz * Math.sin(s.facing),
    s.y + dy,
    s.z - dx * Math.sin(s.facing) + dz * Math.cos(s.facing),
  ];
  const at = place(mansion);
  const box = (list: BufferGeometry[], color: number, w: number, h: number, d: number, dx: number, dy: number, dz: number, turn = 0): void => {
    list.push(part(new BoxGeometry(w, h, d), color, { position: at(dx, dy + h / 2, dz), rotation: [0, mansion.facing + turn, 0] }));
  };
  const gable = (w: number, h: number, d: number, dx: number, dy: number, dz: number, turn = 0): void => {
    const s = new Shape();
    s.moveTo(-w / 2 - 80, 0);
    s.lineTo(w / 2 + 80, 0);
    s.lineTo(0, h);
    s.closePath();
    const roof = new ExtrudeGeometry(s, { depth: d + 160, bevelEnabled: false }).translate(0, 0, -(d + 160) / 2);
    stone.push(part(roof, 0x221d29, { position: at(dx, dy, dz), rotation: [0, mansion.facing + turn, 0] }));
  };
  const wall = 0x3a3442;
  box(stone, wall, 3600, 1500, 1800, 0, 0, 0); // the ground floor
  box(stone, wall, 3200, 1300, 1600, 0, 1500, 0); // the upper floor
  gable(3200, 1100, 1600, 0, 2800, 0);
  box(stone, wall, 1100, 1700, 1100, -1100, 1500, 950, 0); // a front wing
  gable(1100, 800, 1100, -1100, 3200, 950, Math.PI / 2);
  box(stone, wall, 900, 4600, 900, 1700, 0, 300); // the tower
  stone.push(part(new ConeGeometry(720, 1700, 4), 0x221d29, { position: at(1700, 5450, 300), rotation: [0, mansion.facing + Math.PI / 4, 0] }));
  for (const dx of [-900, 900]) box(stone, 0x2c2733, 260, 900, 260, dx, 3500, -400); // chimneys
  box(stone, 0x2c2733, 1600, 60, 700, 300, 900, 1250); // the porch roof
  for (const dx of [-400, 1000]) box(stone, 0x2c2733, 70, 900, 70, dx, 0, 1550);
  box(stone, 0x140f18, 380, 650, 30, 300, 0, 905); // the door
  // Windows: rows on both floors and the tower, a few lit (warm, or a ghostly green), the rest dark
  const random = seededRandom(7);
  const window = (dx: number, dy: number, dz: number): void => {
    const r = random();
    const color = r < 0.25 ? 0xffc96b : r < 0.33 ? 0x9fffb8 : 0x0d0b12;
    box(windows, color, 220, 380, 20, dx, dy, dz);
    if (color !== 0x0d0b12) {
      const [x, y, z] = at(dx, dy + 190, dz + 80); // (its glow, just out in front)
      lit.push({ x, y, z });
    }
  };
  for (const dx of [-1300, -650, 650, 1300]) window(dx, 450, 905);
  for (const dx of [-1200, -400, 400, 1200]) window(dx, 1900, 805);
  for (const dy of [1800, 2800, 3800]) window(1700, dy, 755);
  window(-1100, 2100, 1505);

  // The crypt: a stone house with a pediment on columns and a dark door
  const c = place(crypt);
  const cbox = (w: number, h: number, d: number, dx: number, dy: number, dz: number, color = 0x6a6670): void => {
    stone.push(part(new BoxGeometry(w, h, d), color, { position: c(dx, dy + h / 2, dz), rotation: [0, crypt.facing, 0] }));
  };
  cbox(1200, 900, 1400, 0, 0, 0);
  cbox(1400, 120, 1600, 0, 900, 0, 0x5a5660);
  const pediment = new Shape();
  pediment.moveTo(-700, 0);
  pediment.lineTo(700, 0);
  pediment.lineTo(0, 380);
  pediment.closePath();
  stone.push(part(new ExtrudeGeometry(pediment, { depth: 1600, bevelEnabled: false }).translate(0, 0, -800), 0x5a5660, {
    position: c(0, 1020, 0),
    rotation: [0, crypt.facing, 0],
  }));
  for (const dx of [-500, -170, 170, 500]) {
    stone.push(part(new CylinderGeometry(55, 60, 900, 8), 0x7a7680, { position: c(dx, 450, 760) }));
  }
  cbox(420, 620, 30, 0, 0, 705, 0x120e14);
  return {
    stone: new Mesh(combine(stone), new MeshLambertMaterial({ vertexColors: true })),
    windows: new Mesh(combine(windows), new MeshBasicMaterial({ vertexColors: true })),
    lit,
  };
}
