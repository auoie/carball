// A frozen summit (original designs): snow-laden pines, blue ice-crystal formations, a sea of clouds far below, a
// blizzard of snow and wind streaks (never inside the arena), a cairn and a tattered flag on the summit; and its
// creatures: a great ice bird circling the summit, a gentle giant snow beast sitting on a ledge, and little
// snowpuffs. Three.js frame: y up.
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  type InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";
import { type Area, type Land, scatter } from "./nature";
import { seededRandom } from "./random";
import { type Placement, animate, combine, instances, part } from "./shapes";
import { PLAYING_VOLUME } from "./theme";

/** Pines heavy with snow: dark green tiers, each capped white (one draw call). */
export function buildSnowyPines(land: Land, seed: number, area: Area): InstancedMesh {
  const random = seededRandom(seed);
  const tiers: [number, number, number][] = [
    [420, 900, 700],
    [330, 760, 1120],
    [230, 620, 1500],
  ];
  const parts = [part(new CylinderGeometry(36, 52, 560, 6), 0x4a3a2c, { position: [0, 280, 0] })];
  for (const [r, h, y] of tiers) {
    parts.push(part(new ConeGeometry(r, h, 8), 0x24503a, { position: [0, y, 0] }));
    // The snow lying on the tier: a white cap over its upper part
    parts.push(part(new ConeGeometry(r * 0.72, h * 0.62, 8), 0xf2f7fc, { position: [0, y + h * 0.22, 0] }));
  }
  const placements = scatter(random, land, area).map(([x, z]): Placement & { tint: Color } => {
    const s = 0.7 + random() * 0.7;
    return {
      position: [x, land.height(x, z) - 20, z],
      rotation: [0, random() * Math.PI * 2, 0],
      scale: [s, s * (0.9 + random() * 0.3), s],
      tint: new Color().setScalar(0.85 + random() * 0.2),
    };
  });
  return instances(combine(parts), new MeshLambertMaterial({ vertexColors: true, flatShading: true }), placements);
}

/** Ice-crystal formations: clusters of tall, translucent blue shards (one draw call). */
export function buildIceCrystals(land: Land, seed: number, area: Area): InstancedMesh {
  const random = seededRandom(seed);
  const shards: [number, number, number, number, number][] = [
    [0, 0, 0, 1.0, 0],
    [120, -40, 30, 0.7, -0.35],
    [-110, 30, -50, 0.75, 0.4],
    [40, 60, -120, 0.55, 0.25],
    [-30, -80, 110, 0.5, -0.3],
  ];
  const cluster = combine(
    shards.map(([x, , z, s, lean]) =>
      part(new OctahedronGeometry(110 * s, 0), 0xffffff, { position: [x, 300 * s, z], rotation: [lean * 0.5, 0, lean], scale: [1, 3, 1] }),
    ),
  );
  const tints = [0xa8e4ff, 0xc8f0ff, 0x8fd0ff, 0xd8f4ff].map((c) => new Color(c));
  const placements = scatter(random, land, area).map(([x, z]): Placement & { tint: Color } => {
    const s = 0.8 + random() * 1.4;
    return {
      position: [x, land.height(x, z) - 30, z],
      rotation: [0, random() * Math.PI * 2, 0],
      scale: [s, s, s],
      tint: tints[Math.floor(random() * tints.length)] ?? new Color(0xffffff),
    };
  });
  const material = new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.82, emissive: 0x2a5070, flatShading: true });
  return instances(cluster, material, placements);
}

/** A sea of clouds far below, rolling slowly, out to the horizon (one draw call). */
export function buildCloudSea(height: number): { mesh: Mesh; time: { value: number } } {
  const time = { value: 0 };
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        vec2 p = vWorld.xz / 6000.0 + vec2(time * 0.004, time * 0.002);
        float n = noise(p) * 0.5 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 + 9.1) * 0.2;
        vec3 color = mix(vec3(0.72, 0.78, 0.88), vec3(0.98, 0.99, 1.0), smoothstep(0.3, 0.75, n));
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), time },
    fog: true,
  });
  const mesh = new Mesh(new PlaneGeometry(90000, 90000).rotateX(-Math.PI / 2), material);
  mesh.position.y = height;
  return { mesh, time };
}

// Keeps blown snow out of the arena: anything that drifts inside it is moved far away (out of sight) for that frame
const KEEP_OUT = /* glsl */ `
  if (abs(transformed.x) < ${(PLAYING_VOLUME.halfX + 250).toFixed(1)} && abs(transformed.z) < ${(PLAYING_VOLUME.halfZ + 250).toFixed(1)}
      && transformed.y < ${(PLAYING_VOLUME.height + 400).toFixed(1)}) {
    transformed.y = -100000.0;
  }`;

/** The blizzard: snow driven sideways on the wind, gusting, and faint streaks of wind; never inside the arena. */
export function buildBlizzard(seed: number, count: number, span: number): { root: Group; time: { value: number } } {
  const random = seededRandom(seed);
  const time = { value: 0 };
  // Flakes: blown along +x, falling, swirling; wrapping round a box `span` wide
  const flakes: number[] = [];
  for (let i = 0; i < count; i++) flakes.push((random() * 2 - 1) * span, -1500 + random() * 6500, (random() * 2 - 1) * span);
  const flakeGeometry = new BufferGeometry();
  flakeGeometry.setAttribute("position", new Float32BufferAttribute(flakes, 3));
  const flakeMaterial = new PointsMaterial({ color: 0xffffff, size: 26, transparent: true, opacity: 0.85, depthWrite: false });
  animate(
    flakeMaterial,
    /* glsl */ `
      float gust = 1.0 + 0.6 * sin(time * 0.35 + position.z * 0.0004);
      transformed.x = mod(position.x + time * 900.0 * gust + ${span.toFixed(1)}, ${(span * 2).toFixed(1)}) - ${span.toFixed(1)};
      transformed.y = mod(position.y - time * 160.0 + 1500.0, 6500.0) - 1500.0;
      transformed.z = position.z + sin(time * 0.8 + position.x * 0.002) * 200.0;
      ${KEEP_OUT}`,
    "",
    { time },
  );
  const points = new Points(flakeGeometry, flakeMaterial);
  points.frustumCulled = false;
  // Wind streaks: long faint lines racing along with the snow
  const streaks: number[] = [];
  for (let i = 0; i < count / 6; i++) {
    const [x, y, z] = [(random() * 2 - 1) * span, -800 + random() * 5000, (random() * 2 - 1) * span];
    const length = 300 + random() * 500;
    streaks.push(x, y, z, x - length, y + length * 0.08, z);
  }
  const streakGeometry = new BufferGeometry();
  streakGeometry.setAttribute("position", new Float32BufferAttribute(streaks, 3));
  const streakMaterial = new LineBasicMaterial({ color: 0xe8f2ff, transparent: true, opacity: 0.18, depthWrite: false });
  animate(
    streakMaterial,
    /* glsl */ `
      transformed.x = mod(position.x + time * 1900.0 + ${span.toFixed(1)}, ${(span * 2).toFixed(1)}) - ${span.toFixed(1)};
      ${KEEP_OUT}`,
    "",
    { time },
  );
  const lines = new LineSegments(streakGeometry, streakMaterial);
  lines.frustumCulled = false;
  const root = new Group();
  root.add(points, lines);
  return { root, time };
}

/** A snowpuff: a round white fluffball with tiny ears, blue cheeks, dark eyes and little feet; facing +z, ~120 tall. */
export function snowpuff(): BufferGeometry {
  const parts = [
    part(new IcosahedronGeometry(58, 2), 0xf8fbff, { position: [0, 60, 0] }),
    part(new IcosahedronGeometry(30, 1), 0xf0f6ff, { position: [-36, 96, -8] }), // fluff
    part(new IcosahedronGeometry(28, 1), 0xf0f6ff, { position: [38, 92, -12] }),
    part(new IcosahedronGeometry(26, 1), 0xf0f6ff, { position: [0, 108, -20] }),
  ];
  for (const s of [-1, 1]) {
    parts.push(part(new ConeGeometry(12, 30, 6), 0xdfe9f7, { position: [s * 26, 120, 0], rotation: [0, 0, s * -0.4] })); // ears
    parts.push(part(new SphereGeometry(8, 6, 5), 0x1b2433, { position: [s * 18, 70, 52], scale: [0.8, 1.2, 0.6] })); // eyes
    parts.push(part(new SphereGeometry(10, 6, 5), 0x9fd2ff, { position: [s * 34, 56, 44], scale: [1, 0.6, 0.4] })); // cheeks
    parts.push(part(new SphereGeometry(16, 6, 5), 0xe3ecf8, { position: [s * 24, 6, 18], scale: [1, 0.5, 1.3] })); // feet
  }
  return combine(parts);
}

/** The great ice bird: crystalline wings, a crest and long trailing tail streamers; circles the summit, wings beating
 *  slowly. Moved on the CPU. */
export function buildIceBird(centre: Vector3, radius: number, lapSeconds: number): { root: Group; update(elapsedSeconds: number): void } {
  const body = combine([
    part(new SphereGeometry(1, 14, 10), 0xcfe6ff, { scale: [0.55, 0.5, 1.4] }),
    part(new SphereGeometry(0.42, 12, 8), 0xe2f0ff, { position: [0, 0.35, 1.45] }), // head
    part(new ConeGeometry(0.12, 0.5, 6), 0x7ab8e8, { position: [0, 0.3, 1.95], rotation: [Math.PI / 2, 0, 0] }), // beak
  ]);
  const wing = (side: number): BufferGeometry => {
    // A long, swept, faceted wing out along x, in feathered steps
    const g = new BufferGeometry();
    const s = side;
    g.setAttribute(
      "position",
      new Float32BufferAttribute(
        [0, 0, 0.6, s * 2.2, 0.15, 0.1, 0, 0, -0.5, s * 2.2, 0.15, 0.1, s * 4.2, 0.3, -0.6, s * 1.6, 0.05, -1.0, s * 1.6, 0.05, -1.0, s * 4.2, 0.3, -0.6, s * 3.2, 0.2, -1.4],
        3,
      ),
    );
    g.computeVertexNormals();
    return part(g, 0xbfe4ff);
  };
  const tail = (offset: number): BufferGeometry => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([offset - 0.12, 0, -1.2, offset + 0.12, 0, -1.2, offset * 2.2, -0.2, -5.2], 3));
    g.computeVertexNormals();
    return part(g, 0x9fd8ff);
  };
  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, emissive: 0x3a6a9a });
  const uniforms = animate(material, "transformed.y += abs(position.x) * 0.35 * sin(time * 1.8 - abs(position.x) * 0.3);", "", {});
  const bird = new Mesh(combine([body, wing(1), wing(-1), tail(-0.25), tail(0), tail(0.25)]), material);
  const crest = new Mesh(
    combine([
      part(new ConeGeometry(0.08, 0.9, 5), 0x6bf3ff, { position: [0, 0.95, 1.2], rotation: [-0.9, 0, 0] }),
      part(new SphereGeometry(0.07, 6, 4), 0x6bf3ff, { position: [-0.18, 0.45, 1.8] }),
      part(new SphereGeometry(0.07, 6, 4), 0x6bf3ff, { position: [0.18, 0.45, 1.8] }),
    ]),
    new MeshBasicMaterial({ vertexColors: true }), // (glowing)
  );
  const root = new Group();
  bird.name = "ice bird";
  root.add(bird, crest);
  root.scale.setScalar(260);
  const ahead = new Vector3();
  const update = (seconds: number): void => {
    const a = (seconds / lapSeconds) * Math.PI * 2;
    root.position.set(centre.x + Math.cos(a) * radius, centre.y + Math.sin(a * 2) * 400, centre.z + Math.sin(a) * radius);
    ahead.set(centre.x + Math.cos(a + 0.05) * radius, root.position.y, centre.z + Math.sin(a + 0.05) * radius);
    root.lookAt(ahead);
    root.rotateZ(-0.35); // banking into the turn
    uniforms.time.value = seconds;
  };
  update(0);
  return { root, update };
}

/** The snow beast: a gentle giant, white and shaggy, with a blue face, sitting on a ledge looking out; it breathes
 *  slowly. About 2600 tall, facing `facing` (about y). */
export function buildSnowBeast(at: Vector3, facing: number): { mesh: Mesh; time: { value: number } } {
  const fur = 0xeef3f8;
  const parts = [
    part(new IcosahedronGeometry(900, 2), fur, { position: [0, 900, 0], scale: [1, 1.05, 0.85] }), // body
    part(new IcosahedronGeometry(560, 2), fur, { position: [0, 1950, 120] }), // head
    part(new SphereGeometry(360, 14, 10), 0x7fa6c8, { position: [0, 1900, 520], scale: [1, 0.85, 0.5] }), // face
    part(new SphereGeometry(48, 8, 6), 0x101820, { position: [-130, 2000, 690] }), // eyes
    part(new SphereGeometry(48, 8, 6), 0x101820, { position: [130, 2000, 690] }),
    part(new SphereGeometry(70, 8, 6), 0x46607a, { position: [0, 1850, 720], scale: [1.2, 0.7, 0.6] }), // nose
  ];
  for (const s of [-1, 1]) {
    parts.push(part(new IcosahedronGeometry(330, 1), fur, { position: [s * 900, 800, 260], scale: [0.8, 1.6, 0.8], rotation: [0.3, 0, s * 0.25] })); // arms
    parts.push(part(new IcosahedronGeometry(380, 1), fur, { position: [s * 480, 220, 620], scale: [0.9, 0.6, 1.4] })); // legs
    parts.push(part(new ConeGeometry(110, 380, 6), 0xcfdbe8, { position: [s * 420, 2420, 0], rotation: [0, 0, s * -0.5] })); // horns
    parts.push(part(new SphereGeometry(60, 8, 6), 0xa8c8e8, { position: [s * 260, 1820, 650], scale: [1, 0.6, 0.4] })); // cheeks
  }
  const geometry = combine(parts).rotateY(facing).translate(at.x, at.y, at.z);
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const uniforms = animate(material, "transformed += objectNormal * (sin(time * 0.7) * 0.5 + 0.5) * 18.0;", "", {});
  const mesh = new Mesh(geometry, material);
  mesh.name = "snow beast";
  return { mesh, time: uniforms.time };
}

/** A cairn of stones on the summit with a tattered flag on a pole (one draw call). */
export function buildCairn(at: Vector3): Mesh {
  const random = seededRandom(7);
  const parts = [];
  let y = 0;
  for (let i = 0; i < 7; i++) {
    const s = 260 - i * 30;
    parts.push(part(new DodecahedronGeometry(s, 0), 0x6c7280, { position: [at.x + (random() - 0.5) * 60, at.y + y + s * 0.6, at.z + (random() - 0.5) * 60], scale: [1, 0.6, 1] }));
    y += s * 0.75;
  }
  parts.push(part(new CylinderGeometry(18, 22, 1800, 6), 0x5a4a3a, { position: [at.x, at.y + y + 800, at.z] }));
  // The flag, torn at its end
  const flag = new BufferGeometry();
  flag.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 700, -60, 0, 0, -380, 0, 700, -60, 0, 560, -300, 0, 0, -380, 0], 3));
  flag.computeVertexNormals();
  parts.push(part(flag, 0x2a7fff, { position: [at.x, at.y + y + 1650, at.z] }));
  return new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, flatShading: true }));
}

/** Sparkles glinting on the snow, near the ground. */
export function buildSparkles(seed: number, count: number, keepOut: (x: number, z: number) => boolean, land: Land): Points {
  const random = seededRandom(seed);
  const positions: number[] = [];
  while (positions.length < count * 3) {
    const x = (random() * 2 - 1) * 12000;
    const z = (random() * 2 - 1) * 14000;
    if (keepOut(x, z)) continue;
    positions.push(x, land.height(x, z) + 10 + random() * 40, z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const points = new Points(geometry, new PointsMaterial({ color: 0xffffff, size: 14, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }));
  points.frustumCulled = false;
  return points;
}
