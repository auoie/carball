// A ruined temple on a summit under a cosmic sky (original designs): a spiral galaxy; a plaza of worn paving; a
// colonnade of standing, broken and toppled columns; ruined arches; an altar up a flight of stairs; great rings of
// light turning in the air; and its creatures: guardian statues with glowing eyes, and sky whales swimming through the
// stars. Three.js frame: y up.
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";
import { seededRandom } from "./random";
import { animate, combine, part } from "./shapes";

/** A spiral galaxy far off in the sky: a bright core, blue-violet arms speckled with stars (one draw call). */
export function buildGalaxy(at: Vector3, radius: number, tilt: number): Mesh {
  const material = new ShaderMaterial({
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float a = atan(p.y, p.x);
        float arms = pow(sin(a * 2.0 + log(r + 0.01) * 5.0) * 0.5 + 0.5, 3.0);
        float disc = smoothstep(1.0, 0.1, r);
        float core = exp(-r * r * 40.0);
        float dust = step(0.985, hash(floor(vUv * 380.0))) * disc;
        vec3 color = vec3(0.45, 0.5, 1.0) * arms * disc * 0.55 + vec3(1.0, 0.9, 0.75) * core * 1.2 + vec3(0.9, 0.95, 1.0) * dust * 0.8;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  const mesh = new Mesh(new PlaneGeometry(radius * 2, radius * 2), material);
  mesh.position.copy(at);
  mesh.lookAt(0, 0, 0);
  mesh.rotateZ(tilt);
  mesh.scale.set(1, 0.42, 1); // (seen at a slant)
  mesh.renderOrder = -1;
  return mesh;
}

/** The plaza's paving: square stones, each its own shade, some mossy, some cracked, inside a rounded rectangle
 *  (`half`, `radius`), at `y` (one draw call). */
export function buildPaving(half: { x: number; z: number }, radius: number, y: number, stone = 420): Mesh {
  const material = new ShaderMaterial({
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
      uniform vec2 extent; // (half the size; "half" is reserved in GLSL)
      uniform float radius;
      uniform float stone;
      varying vec2 vWorld;
      #include <fog_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        // Inside the rounded rectangle only
        vec2 q = abs(vWorld) - (extent - radius);
        if (length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius > 0.0) discard;
        // Rows offset by half a stone
        vec2 g = vWorld / stone;
        g.x += 0.5 * mod(floor(g.y), 2.0);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float aa = fwidth(g.x) + fwidth(g.y);
        float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
        float grout = 1.0 - smoothstep(0.02, 0.02 + aa, edge);
        float h = hash(cell);
        vec3 color = mix(vec3(0.5, 0.49, 0.55), vec3(0.64, 0.61, 0.58), h);
        color = mix(color, vec3(0.42, 0.52, 0.4), step(0.86, hash(cell + 7.0)) * 0.5); // moss
        // A crack across some stones
        float crack = step(0.8, hash(cell + 3.0)) * (1.0 - smoothstep(0.0, 0.015 + aa, abs(f.y - 0.3 - 0.4 * f.x * hash(cell + 5.0))));
        color = mix(color, vec3(0.32, 0.31, 0.37), max(grout * 0.85, crack * 0.7));
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog),
      extent: { value: [half.x, half.z] },
      radius: { value: radius },
      stone: { value: stone },
    },
    fog: true,
  });
  const mesh = new Mesh(new PlaneGeometry(half.x * 2, half.z * 2).rotateX(-Math.PI / 2), material);
  mesh.position.y = y;
  return mesh;
}

const STONE = 0xc8c0b0;
const STONE_DARK = 0x9a9488;

/** A column standing (a base, a faceted shaft, a capital), `height` tall; or broken off at `broken` (0..1) of it. */
function column(x: number, y: number, z: number, height: number, broken: number | null, random: () => number): BufferGeometry[] {
  const parts = [part(new BoxGeometry(320, 120, 320), STONE_DARK, { position: [x, y + 60, z] })];
  const shaft = broken === null ? height - 300 : (height - 300) * broken;
  parts.push(part(new CylinderGeometry(105, 120, shaft, 12), STONE, { position: [x, y + 120 + shaft / 2, z] }));
  if (broken === null) {
    parts.push(part(new BoxGeometry(300, 70, 300), STONE_DARK, { position: [x, y + 120 + shaft + 35, z] }));
    parts.push(part(new CylinderGeometry(150, 110, 110, 12), STONE, { position: [x, y + 120 + shaft - 55, z] }));
  } else {
    // A jagged top, and a fallen drum at its foot
    parts.push(part(new ConeGeometry(100, 90, 7), STONE, { position: [x, y + 120 + shaft + 30, z], rotation: [random() * 0.6, 0, random() * 0.6] }));
    const a = random() * Math.PI * 2;
    parts.push(part(new CylinderGeometry(110, 110, 260, 12), STONE, { position: [x + Math.cos(a) * 380, y + 110, z + Math.sin(a) * 380], rotation: [Math.PI / 2, a, 0] }));
  }
  return parts;
}

/** A column lying where it fell: drums in a row along `angle`, a little apart. */
function toppled(x: number, y: number, z: number, angle: number): BufferGeometry[] {
  const parts = [part(new BoxGeometry(320, 120, 320), STONE_DARK, { position: [x, y + 60, z] })];
  for (let i = 0; i < 4; i++) {
    const d = 350 + i * 470;
    parts.push(
      part(new CylinderGeometry(110, 115, 440, 12), STONE, {
        position: [x + Math.cos(angle) * d, y + 110, z + Math.sin(angle) * d],
        rotation: [0, -angle, Math.PI / 2 + (i % 2) * 0.08],
      }),
    );
  }
  return parts;
}

/** The colonnade: columns round a rectangle, every `spacing` uu, standing, broken or toppled outwards, with lintels
 *  across neighbours that stand; gaps where `skip` says (one draw call). */
export function buildColonnade(
  half: { x: number; z: number },
  spacing: number,
  height: number,
  y: number,
  skip: (x: number, z: number) => boolean,
  seed: number,
): Mesh {
  const random = seededRandom(seed);
  const points: [number, number][] = [];
  for (let x = -half.x; x < half.x; x += spacing) points.push([x, -half.z]);
  for (let z = -half.z; z < half.z; z += spacing) points.push([half.x, z]);
  for (let x = half.x; x > -half.x; x -= spacing) points.push([x, half.z]);
  for (let z = half.z; z > -half.z; z -= spacing) points.push([-half.x, z]);
  const parts: BufferGeometry[] = [];
  let previousStanding: [number, number] | null = null;
  for (const [x, z] of points) {
    if (skip(x, z)) {
      previousStanding = null;
      continue;
    }
    const r = random();
    if (r < 0.55) {
      parts.push(...column(x, y, z, height, null, random));
      if (previousStanding && random() < 0.6) {
        const [px, pz] = previousStanding;
        const length = Math.hypot(x - px, z - pz);
        parts.push(part(new BoxGeometry(length + 280, 160, 260), STONE, { position: [(x + px) / 2, y + height + 75, (z + pz) / 2], rotation: [0, -Math.atan2(z - pz, x - px), 0] }));
      }
      previousStanding = [x, z];
    } else if (r < 0.85) {
      parts.push(...column(x, y, z, height, 0.25 + random() * 0.5, random));
      previousStanding = null;
    } else {
      // Fallen outwards, away from the arena
      parts.push(...toppled(x, y, z, Math.atan2(z, x) + (random() - 0.5) * 0.6));
      previousStanding = null;
    }
  }
  return new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

/** Arches standing on the plaza (`whole`: both piers and the arch; else one pier and half the arch), facing `facing`. */
export function buildArches(arches: readonly { at: Vector3; facing: number; whole: boolean }[]): Mesh {
  const parts: BufferGeometry[] = [];
  for (const { at, facing, whole } of arches) {
    const place = (g: BufferGeometry, color: number): void => {
      parts.push(part(g.rotateY(facing).translate(at.x, at.y, at.z), color));
    };
    place(new BoxGeometry(320, 2200, 420).translate(-900, 1100, 0), STONE);
    if (whole) {
      place(new BoxGeometry(320, 2200, 420).translate(900, 1100, 0), STONE);
      place(new TorusGeometry(900, 170, 6, 18, Math.PI).translate(0, 2200, 0), STONE);
      place(new BoxGeometry(220, 300, 440).translate(0, 3150, 0), STONE_DARK); // the keystone
    } else {
      place(new TorusGeometry(900, 170, 6, 9, Math.PI / 2).rotateY(Math.PI).rotateZ(Math.PI / 2).translate(0, 2200, 0), STONE);
      place(new BoxGeometry(300, 320, 300).translate(700, 160, 400), STONE); // fallen block
    }
  }
  return new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

/** The altar: three broad steps up to a block, braziers at its sides (one draw call); returns where their flames are. */
export function buildAltar(at: Vector3): { mesh: Mesh; flames: Vector3[]; top: number } {
  const parts: BufferGeometry[] = [];
  const steps: [number, number][] = [
    [3400, 2600],
    [2800, 2000],
    [2200, 1400],
  ];
  steps.forEach(([w, d], i) => {
    parts.push(part(new BoxGeometry(w, 220, d), i % 2 === 0 ? STONE : STONE_DARK, { position: [at.x, at.y + 110 + i * 220, at.z] }));
  });
  const top = at.y + steps.length * 220;
  parts.push(part(new BoxGeometry(900, 500, 600), STONE_DARK, { position: [at.x, top + 250, at.z + 200] }));
  const flames: Vector3[] = [];
  for (const side of [-1, 1]) {
    const x = at.x + side * 1500;
    const z = at.z - 900;
    parts.push(part(new CylinderGeometry(70, 110, 700, 8), STONE_DARK, { position: [x, at.y + 350, z] }));
    parts.push(part(new CylinderGeometry(190, 90, 160, 10), STONE, { position: [x, at.y + 780, z] }));
    flames.push(new Vector3(x, at.y + 900, z));
  }
  return { mesh: new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true, flatShading: true })), flames, top };
}

/** Great rings of light, each turning slowly about its own axis (unlit, one mesh each). */
export function buildSkyRings(rings: readonly { at: Vector3; radius: number; tilt: number; speed: number }[]): {
  root: Group;
  update(elapsedSeconds: number): void;
} {
  const root = new Group();
  const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, blending: AdditiveBlending, depthWrite: false });
  const meshes = rings.map((r) => {
    const ring = new Mesh(
      combine([
        part(new TorusGeometry(r.radius, r.radius * 0.012, 6, 96), 0xfff0c8),
        part(new TorusGeometry(r.radius * 0.93, r.radius * 0.005, 4, 96), 0xc8d8ff),
      ]),
      material,
    );
    ring.position.copy(r.at);
    ring.rotation.set(Math.PI / 2 + r.tilt, 0, r.tilt * 0.7);
    ring.name = "sky ring";
    root.add(ring);
    return { ring, speed: r.speed };
  });
  return {
    root,
    update(elapsedSeconds) {
      for (const { ring, speed } of meshes) ring.rotation.z = elapsedSeconds * speed;
    },
  };
}

/** A guardian statue: a beast sitting up on a pedestal, ears up, tail curled round; and its eyes (separately, to
 *  glow). Unit scale: about 2.4 tall with the pedestal, facing +z. */
function guardian(): { stone: BufferGeometry; eyes: BufferGeometry } {
  const s = 0xb8b0a2;
  const stone = combine([
    part(new BoxGeometry(1.5, 0.5, 2.0), 0x8a8478, { position: [0, 0.25, 0] }), // pedestal
    part(new SphereGeometry(0.62, 12, 10), s, { position: [0, 1.05, -0.15], scale: [1, 1.15, 1.2] }), // body
    part(new SphereGeometry(0.42, 12, 10), s, { position: [0, 1.25, 0.35], scale: [0.95, 1.1, 0.9] }), // chest
    part(new SphereGeometry(0.4, 12, 10), s, { position: [0, 1.95, 0.45] }), // head
    part(new SphereGeometry(0.2, 10, 8), s, { position: [0, 1.85, 0.8], scale: [1, 0.8, 1.2] }), // muzzle
    part(new ConeGeometry(0.13, 0.42, 6), s, { position: [-0.22, 2.38, 0.38], rotation: [0, 0, 0.25] }), // ears
    part(new ConeGeometry(0.13, 0.42, 6), s, { position: [0.22, 2.38, 0.38], rotation: [0, 0, -0.25] }),
    part(new CylinderGeometry(0.12, 0.14, 0.75, 8), s, { position: [-0.25, 0.85, 0.55] }), // front legs
    part(new CylinderGeometry(0.12, 0.14, 0.75, 8), s, { position: [0.25, 0.85, 0.55] }),
    part(new TorusGeometry(0.45, 0.1, 6, 14, Math.PI * 1.3), s, { position: [0.1, 0.7, -0.35], rotation: [Math.PI / 2, 0, 0.6] }), // tail
  ]);
  const eyes = combine([
    part(new SphereGeometry(0.07, 8, 6), 0x9fe8ff, { position: [-0.16, 2.02, 0.8] }),
    part(new SphereGeometry(0.07, 8, 6), 0x9fe8ff, { position: [0.16, 2.02, 0.8] }),
  ]);
  return { stone, eyes };
}

/** Guardian statues (one draw call for the stone, one for the eyes). Returns where their eyes are (for glows). */
export function buildGuardians(statues: readonly { at: Vector3; facing: number; size: number }[]): { root: Group; eyes: Vector3[] } {
  const shape = guardian();
  const stone: BufferGeometry[] = [];
  const eyes: BufferGeometry[] = [];
  const eyePoints: Vector3[] = [];
  for (const { at, facing, size } of statues) {
    const place = (g: BufferGeometry): BufferGeometry => g.clone().scale(size, size, size).rotateY(facing).translate(at.x, at.y, at.z);
    stone.push(place(shape.stone));
    eyes.push(place(shape.eyes));
    eyePoints.push(new Vector3(0, 2.02 * size, 0.85 * size).applyAxisAngle(new Vector3(0, 1, 0), facing).add(at));
  }
  const root = new Group();
  const body = new Mesh(combine(stone), new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  body.name = "guardians";
  root.add(body, new Mesh(combine(eyes), new MeshBasicMaterial({ vertexColors: true })));
  return { root, eyes: eyePoints };
}

/** A sky whale (unit scale, about 6 long, facing +z): its body, pale beneath, tail flukes and fins; and the glowing
 *  spots along its back (separately). Both undulate the same way, tail most. */
function whale(): { body: BufferGeometry; spots: BufferGeometry } {
  const back = new Color(0x3a4a8a);
  const belly = new Color(0xc8d0f0);
  const hull = part(new SphereGeometry(1, 24, 16), 0xffffff, { scale: [0.85, 0.7, 2.5] });
  const colors = hull.getAttribute("color");
  const pos = hull.getAttribute("position");
  const c = new Color();
  for (let v = 0; v < pos.count; v++) {
    c.copy(back).lerp(belly, Math.min(1, Math.max(0, 0.5 - pos.getY(v) * 1.4)));
    colors.setXYZ(v, c.r, c.g, c.b);
  }
  const body = combine([
    hull,
    part(new CylinderGeometry(0.12, 0.45, 1.6, 10), back, { position: [0, 0, -2.9], rotation: [Math.PI / 2, 0, 0] }), // tail stock
    part(new ConeGeometry(0.35, 1.6, 6), back, { position: [-0.75, 0, -3.8], rotation: [Math.PI / 2, 0, 1.0], scale: [1, 1, 0.2] }), // flukes
    part(new ConeGeometry(0.35, 1.6, 6), back, { position: [0.75, 0, -3.8], rotation: [Math.PI / 2, 0, -1.0], scale: [1, 1, 0.2] }),
    part(new ConeGeometry(0.3, 1.5, 6), back, { position: [-1.0, -0.25, 0.6], rotation: [0.3, 0, 1.25], scale: [1, 1, 0.2] }), // fins
    part(new ConeGeometry(0.3, 1.5, 6), back, { position: [1.0, -0.25, 0.6], rotation: [0.3, 0, -1.25], scale: [1, 1, 0.2] }),
    part(new SphereGeometry(0.08, 8, 6), 0x0a0c1a, { position: [-0.55, 0.12, 1.75] }), // eyes
    part(new SphereGeometry(0.08, 8, 6), 0x0a0c1a, { position: [0.55, 0.12, 1.75] }),
  ]);
  const spots: BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const z = 1.6 - i * 0.42;
    const r = Math.sqrt(Math.max(0, 1 - (z / 2.5) ** 2));
    for (const side of [-1, 1]) {
      spots.push(part(new SphereGeometry(0.07 + 0.03 * (i % 3), 6, 5), i % 2 === 0 ? 0xbfe8ff : 0xfff0c0, { position: [side * 0.32 * r, 0.62 * r, z] }));
    }
  }
  return { body, spots: combine(spots) };
}

// The swim: a wave running down the body to the tail (in the whale's own frame)
const SWIM = `transformed.y += sin(time * 0.9 - position.z * 0.7) * 0.22 * smoothstep(1.0, -3.8, position.z);`;

/** Sky whales swimming a slow loop through the sky (a mother and a calf, following): moved on the CPU. */
export function buildSkyWhales(path: (t: number) => Vector3, loopSeconds: number, whales: readonly { size: number; lag: number }[]): {
  root: Group;
  update(elapsedSeconds: number): void;
} {
  const shape = whale();
  const root = new Group();
  const bodyMaterial = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const spotMaterial = new MeshBasicMaterial({ vertexColors: true });
  const clocks = [animate(bodyMaterial, SWIM, "", {}).time, animate(spotMaterial, SWIM, "", {}).time];
  const groups = whales.map((w) => {
    const g = new Group();
    const body = new Mesh(shape.body, bodyMaterial);
    body.name = "sky whale";
    g.add(body, new Mesh(shape.spots, spotMaterial));
    g.scale.setScalar(w.size);
    root.add(g);
    return { g, lag: w.lag };
  });
  const ahead = new Vector3();
  const update = (seconds: number): void => {
    for (const { g, lag } of groups) {
      const t = seconds / loopSeconds - lag;
      g.position.copy(path(t));
      ahead.copy(path(t + 0.002));
      g.lookAt(ahead);
    }
    for (const clock of clocks) clock.value = seconds;
  };
  update(0);
  return { root, update };
}
