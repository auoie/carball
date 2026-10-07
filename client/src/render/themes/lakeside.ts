// A misty lake at dawn (original designs): a mirror-calm surface reflecting the sky and the shores (a real planar
// reflection, rippled), the arena on a wooden deck over the water, reeds, lily pads and flowers, drifting lanterns, a
// rocky islet with a cave glowing within; and its creatures: a gentle long-necked guardian rising from the mist, swans
// paddling, frogs on the lily pads. Three.js frame: y up.
import {
  BoxGeometry,
  type BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  type InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  PlaneGeometry,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  TubeGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { GROUND_LEVEL, type Land, landscape, smoothstep } from "./nature";
import { seededRandom } from "./random";
import { type Placement, animate, combine, instances, part } from "./shapes";
import { SEA_LEVEL } from "./tropics";

/** The lake's surface. */
export const WATER = SEA_LEVEL;

/** The lake (the flat region, below the water) and the hills round it. */
export function lakeLand(seed: number, lake: { halfX: number; halfZ: number; radius: number }): Land {
  const base = landscape(seed, {
    flat: lake,
    pond: { x: 60000, z: 60000, radius: 1 }, // (none)
    path: () => Infinity,
    hills: { low: 400, high: 2400, rise: 7000, horizon: 2200 },
  });
  // The bed deep under the middle, rising to the shore round the lake's edge, then the hills
  const height = (x: number, z: number): number =>
    base.height(x, z) - GROUND_LEVEL + WATER - 700 + 1000 * smoothstep(-2500, 1500, base.flatDistance(x, z));
  return { ...base, height };
}

/** The layer of what the lake reflects (only what's on it: the reflection is a second render of the scene). */
const REFLECTED = 5;

/** The lake: a planar reflection of what's passed to `reflect` (the big things: drawing everything twice costs too
 *  much), rippled, blended with the water's own colour (more mirror at low angles), fogged. */
export function buildLakeSurface(
  size: number,
  tint: Color,
  resolution: number,
): { mesh: Reflector; time: { value: number }; reflect(...objects: Object3D[]): void } {
  const time = { value: 0 };
  const shader = {
    name: "LakeShader",
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog),
      color: { value: null },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      varying vec4 vUv;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vUv = textureMatrix * vec4(position, 1.0);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform sampler2D tDiffuse;
      uniform float time;
      varying vec4 vUv;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      void main() {
        // Ripples: the reflection wavers a little
        vec2 ripple = vec2(
          sin(vWorld.x * 0.006 + time * 0.9) + sin(vWorld.z * 0.011 + time * 1.3) * 0.5,
          cos(vWorld.z * 0.007 - time * 0.8) + cos(vWorld.x * 0.013 + time * 1.1) * 0.5
        ) * 0.0035;
        vec4 uv = vUv;
        uv.xy += ripple * uv.w;
        vec3 reflection = texture2DProj(tDiffuse, uv).rgb;
        // More mirror at a glance across the water, more of the lake's own colour looking down into it
        float glance = 1.0 - abs(normalize(cameraPosition - vWorld).y);
        float mirror = 0.55 + 0.4 * glance * glance;
        gl_FragColor = vec4(mix(color, reflection, mirror), 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  };
  const mesh = new Reflector(new PlaneGeometry(size, size), {
    color: tint,
    textureWidth: resolution,
    textureHeight: resolution,
    clipBias: 0.003,
    shader,
    multisample: 0,
  });
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = WATER;
  mesh.name = "lake";
  const material = mesh.material as ShaderMaterial;
  material.fog = true;
  material.uniforms["time"] = time; // (the reflector clones the shader's uniforms: give it the shared clock)
  const reflectionCamera = mesh.getReflectionCamera.bind(mesh);
  mesh.getReflectionCamera = (camera) => {
    const reflection = reflectionCamera(camera);
    reflection.layers.set(REFLECTED);
    return reflection;
  };
  return {
    mesh,
    time,
    reflect(...objects) {
      for (const object of objects) {
        object.traverse((o) => {
          o.layers.enable(REFLECTED);
        });
      }
    },
  };
}

/** The deck the arena stands on: a rounded slab of dark timber over the water on pillars, a rail round its edge with
 *  lanterns at its corners (one draw call), and its top's planking (another). Returns where its lanterns' lights are. */
export function buildDeck(half: { x: number; z: number }, radius: number): { root: Group; lights: Vector3[] } {
  const top = GROUND_LEVEL;
  const bottom = WATER + 130;
  const outline = (): Shape => {
    const s = new Shape();
    const [x, z] = [half.x, half.z];
    s.moveTo(-x + radius, -z);
    s.lineTo(x - radius, -z);
    s.absarc(x - radius, -z + radius, radius, -Math.PI / 2, 0, false);
    s.lineTo(x, z - radius);
    s.absarc(x - radius, z - radius, radius, 0, Math.PI / 2, false);
    s.lineTo(-x + radius, z);
    s.absarc(-x + radius, z - radius, radius, Math.PI / 2, Math.PI, false);
    s.lineTo(-x, -z + radius);
    s.absarc(-x + radius, -z + radius, radius, Math.PI, Math.PI * 1.5, false);
    return s;
  };
  const slab = new ExtrudeGeometry(outline(), { depth: top - bottom, bevelEnabled: false, curveSegments: 10 }).rotateX(Math.PI / 2).translate(0, top, 0);
  const parts: BufferGeometry[] = [part(slab, 0x5a4232)];
  // Pillars down into the water, and the rail's posts, along the edge
  const points = outline().getSpacedPoints(64);
  const lights: Vector3[] = [];
  points.forEach((p, i) => {
    if (i % 2 === 0) parts.push(part(new CylinderGeometry(70, 80, 900, 8), 0x4a3628, { position: [p.x * 0.97, bottom - 380, p.y * 0.97] }));
    parts.push(part(new BoxGeometry(40, 300, 40), 0x6a4e3a, { position: [p.x, top + 150, p.y] }));
    const next = points[(i + 1) % points.length] ?? p;
    const length = Math.hypot(next.x - p.x, next.y - p.y);
    parts.push(part(new BoxGeometry(length, 24, 24), 0x7a5c44, { position: [(p.x + next.x) / 2, top + 280, (p.y + next.y) / 2], rotation: [0, -Math.atan2(next.y - p.y, next.x - p.x), 0] }));
  });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const [x, z] = [sx * (half.x - radius * 0.29), sz * (half.z - radius * 0.29)];
    parts.push(part(new CylinderGeometry(30, 40, 900, 6), 0x4a3628, { position: [x, top + 450, z] }));
    parts.push(part(new BoxGeometry(110, 150, 110), 0xffe2b0, { position: [x, top + 960, z] }));
    lights.push(new Vector3(x, top + 960, z));
  }
  const deck = new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true }));
  deck.name = "deck";
  // The planking on top: long boards, staggered, in weathered shades
  const planks = new Mesh(
    new PlaneGeometry(half.x * 2, half.z * 2).rotateX(-Math.PI / 2),
    new ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xz;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec2 extent;
        uniform float radius;
        varying vec2 vWorld;
        #include <fog_pars_fragment>
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 q = abs(vWorld) - (extent - radius);
          if (length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius > 0.0) discard;
          // Boards 180 wide running along x, 1400 long, staggered row by row
          float row = floor(vWorld.y / 180.0);
          float along = vWorld.x / 1400.0 + hash(vec2(row, 1.0));
          vec2 board = vec2(floor(along), row);
          float fx = fract(along);
          float fy = fract(vWorld.y / 180.0);
          float aa = fwidth(vWorld.y / 180.0) * 1.5;
          float seam = max(1.0 - smoothstep(0.0, 0.04 + aa, min(fy, 1.0 - fy)), 1.0 - smoothstep(0.0, 0.004 + fwidth(along), min(fx, 1.0 - fx)));
          // (linear colours: a weathered, honey-brown timber)
          vec3 wood = mix(vec3(0.17, 0.1, 0.055), vec3(0.27, 0.17, 0.095), hash(board));
          wood *= 0.88 + 0.12 * sin(vWorld.x * 0.05 + hash(board) * 20.0); // (grain)
          gl_FragColor = vec4(mix(wood, vec3(0.04, 0.025, 0.018), seam * 0.85), 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      uniforms: { ...UniformsUtils.clone(UniformsLib.fog), extent: { value: [half.x, half.z] }, radius: { value: radius } },
      fog: true,
    }),
  );
  planks.position.y = top + 4;
  const root = new Group();
  root.add(deck, planks);
  return { root, lights };
}

/** Reeds in clumps: tall blades and cattails, swaying (one draw call). */
export function buildReeds(spots: readonly { x: number; z: number; size: number }[], seed: number): { mesh: InstancedMesh; time: { value: number } } {
  const random = seededRandom(seed);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = random() * Math.PI * 2;
    const r = random() * 90;
    const h = 380 + random() * 320;
    const lean = (random() - 0.5) * 0.25;
    parts.push(part(new ConeGeometry(9, h, 4), i % 3 === 0 ? 0x6a8a3a : 0x4f7a34, { position: [Math.cos(a) * r, h / 2, Math.sin(a) * r], rotation: [lean, 0, lean] }));
    if (i % 3 === 0) {
      parts.push(part(new CylinderGeometry(4, 4, h * 1.1, 4), 0x6a8a3a, { position: [Math.cos(a) * r + 30, h * 0.55, Math.sin(a) * r] }));
      parts.push(part(new CylinderGeometry(18, 18, 90, 6), 0x5a3a22, { position: [Math.cos(a) * r + 30, h * 1.05, Math.sin(a) * r] })); // a cattail
    }
  }
  const material = new MeshLambertMaterial({ vertexColors: true });
  const uniforms = animate(
    material,
    /* glsl */ `
      vec3 rooted = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      transformed.x += sin(time * 0.9 + rooted.x * 0.001 + rooted.z * 0.0008) * position.y * 0.05;`,
    "",
    {},
  );
  const placements = spots.map((s): Placement => ({ position: [s.x, WATER - 40, s.z], rotation: [0, random() * Math.PI * 2, 0], scale: [s.size, s.size, s.size] }));
  const mesh = instances(combine(parts), material, placements);
  mesh.name = "reeds";
  return { mesh, time: uniforms.time };
}

/** Lily pads floating (each with a notch), some flowering (two draw calls). */
export function buildLilies(spots: readonly { x: number; z: number; size: number; flower: boolean }[], seed: number): Group {
  const random = seededRandom(seed);
  const pad = part(new CircleGeometry(110, 14, 0.4, Math.PI * 2 - 0.4).rotateX(-Math.PI / 2), 0x3f7a3a);
  const blossom = combine([
    part(new ConeGeometry(34, 46, 6, 1, true).rotateX(Math.PI), 0xffffff, { position: [0, 26, 0] }),
    part(new SphereGeometry(10, 6, 5), 0xffe066, { position: [0, 22, 0] }),
  ]);
  const placements = spots.map((s): Placement & { tint: Color } => ({
    position: [s.x, WATER + 3, s.z],
    rotation: [0, random() * Math.PI * 2, 0],
    scale: [s.size, 1, s.size],
    tint: new Color().setScalar(0.85 + random() * 0.25),
  }));
  const flowers = spots
    .filter((s) => s.flower)
    .map((s): Placement & { tint: Color } => ({
      position: [s.x, WATER + 3, s.z],
      scale: [s.size, s.size, s.size],
      tint: new Color(random() < 0.5 ? 0xffb8d8 : 0xffffff),
    }));
  const group = new Group();
  const pads = instances(pad, new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }), placements);
  pads.name = "lilies";
  group.add(pads, instances(blossom, new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }), flowers));
  return group;
}

/** Paper lanterns floating on the water, bobbing (one draw call; their glow is separate). */
export function buildLanterns(spots: readonly { x: number; z: number }[]): { mesh: InstancedMesh; time: { value: number } } {
  const lantern = combine([
    part(new BoxGeometry(120, 26, 120), 0x5a4232, { position: [0, 13, 0] }),
    part(new BoxGeometry(100, 130, 100), 0xffd8a0, { position: [0, 90, 0] }),
    part(new ConeGeometry(80, 50, 4), 0x5a4232, { position: [0, 180, 0], rotation: [0, Math.PI / 4, 0] }),
  ]);
  const material = new MeshBasicMaterial({ vertexColors: true });
  const uniforms = animate(
    material,
    "transformed.y += sin(time * 0.8 + float(gl_InstanceID) * 1.7) * 6.0;",
    "",
    {},
  );
  const mesh = instances(lantern, material, spots.map((s): Placement => ({ position: [s.x, WATER, s.z] })));
  mesh.name = "lanterns";
  return { mesh, time: uniforms.time };
}

/** The islet: a heap of mossy rocks with a dark cave mouth facing `facing`, a few small pines on top (one draw call);
 *  returns where the cave's glow is. */
export function buildIslet(at: Vector3, facing: number, seed: number): { mesh: Mesh; cave: Vector3 } {
  const random = seededRandom(seed);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) {
    const a = random() * Math.PI * 2;
    const r = random() * 1300;
    const s = 380 + random() * 520 - r * 0.15;
    parts.push(part(new DodecahedronGeometry(s, 0), i % 3 === 0 ? 0x5a6a58 : 0x6a6a66, {
      position: [at.x + Math.cos(a) * r, at.y + s * 0.5 + (1300 - r) * 0.45, at.z + Math.sin(a) * r],
      rotation: [random(), random(), random()],
      scale: [1, 0.75, 1],
    }));
  }
  // The cave mouth: a dark arch on the side facing the arena
  const out = new Vector3(Math.sin(facing), 0, Math.cos(facing));
  const mouth = at.clone().addScaledVector(out, 1150).setY(at.y + 120);
  parts.push(part(new CircleGeometry(420, 16, 0, Math.PI).scale(1, 1.3, 1).rotateY(facing), 0x0c0e12, { position: [mouth.x, mouth.y, mouth.z] }));
  for (let i = 0; i < 4; i++) {
    const a = random() * Math.PI * 2;
    const p = at.clone().add(new Vector3(Math.cos(a) * 500, 1150, Math.sin(a) * 500));
    const h = 900 + random() * 500;
    parts.push(part(new CylinderGeometry(22, 32, h * 0.35, 5), 0x4a3a2c, { position: [p.x, p.y + h * 0.17, p.z] }));
    parts.push(part(new ConeGeometry(240, h, 7), 0x2f5a3a, { position: [p.x, p.y + h * 0.6, p.z] }));
  }
  const mesh = new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.name = "islet";
  return { mesh, cave: mouth.clone().addScaledVector(out, 80) };
}

/** The lake's guardian: a gentle long-necked creature, its back humped out of the water, neck rising in a curve to a
 *  small head; soft blue-teal with a pale throat and a ridge of fins (unit scale: the neck ~4 tall, facing +z). */
function guardianShape(): BufferGeometry {
  const skin = 0x5a8a9a;
  const pale = 0xd8e8e4;
  const parts: BufferGeometry[] = [
    part(new SphereGeometry(1, 18, 12), skin, { position: [0, -0.2, -0.9], scale: [1.1, 0.75, 1.9] }), // back
    part(new SphereGeometry(0.6, 14, 10), skin, { position: [0, -0.35, -3.1], scale: [0.8, 0.6, 1.3] }), // second hump
  ];
  // The neck: one smooth tube rising and curving forward, tapering, pale down its front (the throat); fins on its back
  const neckAt = (t: number): Vector3 => new Vector3(0, 0.2 + t * 3.6, 0.6 + Math.sin(t * 1.4) * 1.3);
  const curve = new CatmullRomCurve3(Array.from({ length: 11 }, (_, i) => neckAt(i / 10)));
  const [tubular, radial] = [40, 14];
  const tube = new TubeGeometry(curve, tubular, 1, radial, false);
  const position = tube.getAttribute("position");
  const centre = new Vector3();
  const v = new Vector3();
  for (let i = 0; i < position.count; i++) {
    const t = Math.floor(i / (radial + 1)) / tubular;
    curve.getPointAt(t, centre);
    v.fromBufferAttribute(position, i).sub(centre).multiplyScalar(0.44 - t * 0.22).add(centre);
    position.setXYZ(i, v.x, v.y, v.z);
  }
  tube.computeVertexNormals();
  const neck = part(tube, skin);
  const normal = neck.getAttribute("normal");
  const color = neck.getAttribute("color");
  const shade = new Color();
  for (let i = 0; i < normal.count; i++) {
    shade.set(skin).lerp(new Color(pale), smoothstep(0.15, 0.6, normal.getZ(i)));
    color.setXYZ(i, shade.r, shade.g, shade.b);
  }
  parts.push(neck);
  for (let i = 0; i < 5; i++) {
    const t = 0.05 + i * 0.17;
    const at = neckAt(t);
    parts.push(part(new ConeGeometry(0.1, 0.35, 5), 0x3a6a7a, { position: [0, at.y + 0.05, at.z - (0.44 - t * 0.22) * 0.85], rotation: [-0.6, 0, 0] }));
  }
  const head = new Vector3(0, 3.95, 0.6 + Math.sin(1.4) * 1.3 + 0.25);
  parts.push(part(new SphereGeometry(0.38, 14, 10), skin, { position: [head.x, head.y, head.z], scale: [0.9, 0.8, 1.25] }));
  parts.push(part(new SphereGeometry(0.06, 6, 5), 0x0a1418, { position: [-0.22, head.y + 0.1, head.z + 0.22] }));
  parts.push(part(new SphereGeometry(0.06, 6, 5), 0x0a1418, { position: [0.22, head.y + 0.1, head.z + 0.22] }));
  parts.push(part(new ConeGeometry(0.06, 0.4, 5), 0xc8e0e8, { position: [-0.18, head.y + 0.42, head.z - 0.15], rotation: [-0.5, 0, 0.3] })); // little horns
  parts.push(part(new ConeGeometry(0.06, 0.4, 5), 0xc8e0e8, { position: [0.18, head.y + 0.42, head.z - 0.15], rotation: [-0.5, 0, -0.3] }));
  return combine(parts);
}

/** The guardian rising from the water, lingering, looking about, and sinking away again, on a slow cycle. */
export function buildGuardian(at: Vector3, facing: number, size: number, cycleSeconds: number): { root: Group; update(seconds: number): void } {
  const body = new Mesh(guardianShape(), new MeshLambertMaterial({ vertexColors: true }));
  body.name = "guardian";
  const root = new Group();
  root.add(body);
  root.scale.setScalar(size);
  const update = (seconds: number): void => {
    const p = (seconds / cycleSeconds) % 1;
    // Rise (0-0.15), linger (to 0.7), sink (to 0.85), gone (to 1)
    const up = p < 0.15 ? smoothstep(0, 0.15, p) : p < 0.7 ? 1 : 1 - smoothstep(0.7, 0.85, p);
    root.position.set(at.x, WATER - size * 4.6 * (1 - up) + Math.sin(seconds * 0.6) * size * 0.06, at.z);
    root.rotation.set(Math.sin(seconds * 0.4) * 0.04, facing + Math.sin(seconds * 0.15) * 0.5, 0);
  };
  update(0);
  return { root, update };
}

/** A swan-like paddler (~250 long, facing +z): white, a long curved neck, a yellow bill, folded wings. */
export function swan(): BufferGeometry {
  return combine([
    part(new SphereGeometry(70, 14, 10), 0xf8f8f6, { position: [0, 30, 0], scale: [1, 0.7, 1.6] }),
    part(new SphereGeometry(60, 12, 8), 0xeeeeea, { position: [-40, 50, -15], scale: [0.6, 0.6, 1.4] }), // wings
    part(new SphereGeometry(60, 12, 8), 0xeeeeea, { position: [40, 50, -15], scale: [0.6, 0.6, 1.4] }),
    part(new CylinderGeometry(14, 18, 130, 8), 0xf8f8f6, { position: [0, 100, 85], rotation: [-0.25, 0, 0] }), // neck
    part(new SphereGeometry(24, 10, 8), 0xf8f8f6, { position: [0, 165, 100] }), // head
    part(new ConeGeometry(9, 40, 6), 0xf2c94c, { position: [0, 160, 130], rotation: [Math.PI / 2 - 0.2, 0, 0] }), // bill
    part(new SphereGeometry(5, 6, 5), 0x111111, { position: [-14, 172, 112] }),
    part(new SphereGeometry(5, 6, 5), 0x111111, { position: [14, 172, 112] }),
  ]);
}

/** A frog (~120 across, facing +z), sitting: green, bulging eyes, a pale throat, folded legs. */
export function frog(): BufferGeometry {
  const green = 0x5aa040;
  return combine([
    part(new SphereGeometry(50, 12, 8), green, { position: [0, 32, 0], scale: [1.1, 0.75, 1] }),
    part(new SphereGeometry(30, 10, 8), 0xe8f0c8, { position: [0, 26, 34], scale: [1, 0.7, 0.6] }), // throat
    part(new SphereGeometry(16, 8, 6), green, { position: [-26, 62, 22] }), // eyes
    part(new SphereGeometry(16, 8, 6), green, { position: [26, 62, 22] }),
    part(new SphereGeometry(8, 6, 5), 0x111111, { position: [-28, 66, 34] }),
    part(new SphereGeometry(8, 6, 5), 0x111111, { position: [28, 66, 34] }),
    part(new SphereGeometry(24, 8, 6), green, { position: [-48, 16, -10], scale: [0.8, 0.5, 1.4] }), // legs
    part(new SphereGeometry(24, 8, 6), green, { position: [48, 16, -10], scale: [0.8, 0.5, 1.4] }),
  ]);
}

/** Frogs on the lily pads, breathing (puffing a little), facing about (one draw call). */
export function buildFrogs(spots: readonly { x: number; z: number }[], seed: number, size: number): { mesh: InstancedMesh; time: { value: number } } {
  const random = seededRandom(seed);
  const material = new MeshLambertMaterial({ vertexColors: true });
  const uniforms = animate(material, "transformed *= 1.0 + 0.05 * max(0.0, sin(time * 2.6 + float(gl_InstanceID) * 2.3));", "", {});
  const placements = spots.map((s): Placement => ({ position: [s.x, WATER + 4, s.z], rotation: [0, random() * Math.PI * 2, 0], scale: [size, size, size] }));
  const mesh = instances(frog(), material, placements);
  mesh.name = "wildlife: frog";
  return { mesh, time: uniforms.time };
}

/** Points of the shore in a rounded band `low`..`high` uu either side of the waterline (negative: out in the water). */
export function shoreSpots(land: Land, random: () => number, count: number, low: number, high: number, keepOut: (x: number, z: number) => boolean): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let tries = 0; out.length < count && tries < count * 500; tries++) {
    const x = (random() * 2 - 1) * 20000;
    const z = (random() * 2 - 1) * 22000;
    const above = land.height(x, z) - WATER;
    if (above < low || above > high || keepOut(x, z)) continue;
    out.push({ x, z });
  }
  return out;
}
