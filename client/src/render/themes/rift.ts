// An upside-down dimension (original designs): floating islands at odd angles, some upside down with their trees
// hanging, glowing flora and crystals, waterfalls flowing up off their rims, broken stairs and pillars adrift, motes
// rising, a swirling rift glowing far off; and its creatures: a vast serpent winding through the sky, eye-orbs that
// turn to watch the ball. Three.js frame: y up.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  type Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";
import { seededRandom, valueNoise } from "./random";
import { ADDITIVE_FOG, animate, combine, part } from "./shapes";

/** An island: where it floats, how it's turned (Euler XYZ), its size; its top surface is its local y = 0. */
export interface Island {
  readonly position: Vector3;
  readonly rotation: Euler;
  readonly radius: number;
  readonly depth: number;
  readonly matrix: Matrix4;
  /** A perfectly flat top (the arena's island: bumps would come up through the field) */
  readonly flat: boolean;
}

export function island(position: Vector3, rotation: Euler, radius: number, depth: number, flat = false): Island {
  const matrix = new Matrix4().compose(position, new Quaternion().setFromEuler(rotation), new Vector3(1, 1, 1));
  return { position, rotation, radius, depth, matrix, flat };
}

/** A point on an island's top surface (local polar), in the world. */
export function onIsland(i: Island, angle: number, fraction: number, lift = 0): Vector3 {
  return new Vector3(Math.cos(angle) * i.radius * fraction, lift, Math.sin(angle) * i.radius * fraction).applyMatrix4(i.matrix);
}

/** A jagged island chunk: a mossy top, rocky sides narrowing to a point underneath. Top at y = 0. */
function chunk(radius: number, depth: number, seed: number, flatTop: boolean): BufferGeometry {
  const noise = valueNoise(seed);
  const g = new CylinderGeometry(radius, radius * 0.12, depth, 16, 5).translate(0, -depth / 2, 0);
  const pos = g.getAttribute("position");
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v);
    const y = pos.getY(v);
    const z = pos.getZ(v);
    if (y > -1) {
      // A slightly uneven top
      pos.setY(v, flatTop ? 0 : noise(x / 500, z / 500) * Math.min(60, radius * 0.03));
      continue;
    }
    const k = 1 + 0.22 * noise(x / 400 + seed, y / 300);
    pos.setXYZ(v, x * k, y + noise(z / 300, x / 300) * depth * 0.06, z * k);
  }
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  const p = flat.getAttribute("position");
  const colors = new Float32Array(p.count * 3);
  const moss = new Color(0x2f8f7a);
  const mossDark = new Color(0x22665a);
  const rock = new Color(0x3c3452);
  const rockDeep = new Color(0x221c30);
  const c = new Color();
  for (let v = 0; v < p.count; v += 3) {
    const y = (p.getY(v) + p.getY(v + 1) + p.getY(v + 2)) / 3;
    if (y > -radius * 0.04) c.copy(moss).lerp(mossDark, (v * 0.618) % 1);
    else c.copy(rock).lerp(rockDeep, Math.min(1, -y / depth));
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (v + k) * 3);
  }
  flat.setAttribute("color", new Float32BufferAttribute(colors, 3));
  flat.deleteAttribute("uv");
  return flat;
}

/** Islands (one draw call). */
export function buildIslands(islands: readonly Island[], seed: number): Mesh {
  const geometries = islands.map((i, k) => chunk(i.radius, i.depth, seed + k, i.flat).applyMatrix4(i.matrix));
  return new Mesh(combine(geometries), new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

/** Copies of a geometry at the given matrices, each tinted (one draw call). */
function placed(geometry: BufferGeometry, material: Material, matrices: readonly Matrix4[], tints?: readonly Color[]): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    const t = tints?.[i];
    if (t) mesh.setColorAt(i, t);
  });
  mesh.frustumCulled = false;
  return mesh;
}

/** The flora on the islands: twisted trees with glowing canopies, and crystal clusters (four draw calls), standing
 *  on each island's top however it's turned. */
export function buildFlora(islands: readonly Island[], seed: number): Group {
  const random = seededRandom(seed);
  const trunk = combine([
    part(new CylinderGeometry(22, 40, 420, 6), 0x2a2030, { position: [0, 210, 0], rotation: [0, 0, 0.12] }),
    part(new CylinderGeometry(14, 22, 260, 5), 0x2a2030, { position: [40, 480, 0], rotation: [0, 0, -0.35] }),
  ]);
  const canopy = combine([
    part(new IcosahedronGeometry(170, 1), 0xffffff, { position: [70, 640, 0] }),
    part(new IcosahedronGeometry(120, 1), 0xffffff, { position: [-60, 560, 60] }),
    part(new IcosahedronGeometry(110, 1), 0xffffff, { position: [150, 540, -70] }),
  ]);
  const crystal = combine([
    part(new OctahedronGeometry(60, 0), 0xffffff, { position: [0, 140, 0], scale: [1, 3.2, 1] }),
    part(new OctahedronGeometry(40, 0), 0xffffff, { position: [70, 90, 20], rotation: [0, 0, -0.5], scale: [1, 2.6, 1] }),
    part(new OctahedronGeometry(35, 0), 0xffffff, { position: [-55, 80, -30], rotation: [0.3, 0, 0.5], scale: [1, 2.4, 1] }),
  ]);
  const leafColors = [0x4fffd2, 0xb36bff, 0x7cff8a, 0xff6be0].map((c) => new Color(c));
  const crystalColors = [0xc28bff, 0x6bf3ff, 0xff8be8].map((c) => new Color(c));
  const trees: Matrix4[] = [];
  const treeTints: Color[] = [];
  const crystals: Matrix4[] = [];
  const crystalTints: Color[] = [];
  for (const i of islands) {
    const count = Math.round(i.radius / 450);
    for (let k = 0; k < count; k++) {
      const local = new Matrix4().compose(
        new Vector3(...polar(random, i.radius * 0.75)),
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), random() * Math.PI * 2),
        new Vector3().setScalar(0.8 + random() * 0.8),
      );
      const world = i.matrix.clone().multiply(local);
      if (random() < 0.65) {
        trees.push(world);
        treeTints.push(leafColors[Math.floor(random() * leafColors.length)] ?? new Color(0xffffff));
      } else {
        crystals.push(world);
        crystalTints.push(crystalColors[Math.floor(random() * crystalColors.length)] ?? new Color(0xffffff));
      }
    }
  }
  const group = new Group();
  group.add(
    placed(trunk, new MeshLambertMaterial({ vertexColors: true }), trees),
    placed(canopy, new MeshBasicMaterial({ vertexColors: true }), trees, treeTints), // (glowing: unlit)
    placed(crystal, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }), crystals, crystalTints),
  );
  return group;
}

const polar = (random: () => number, max: number): [number, number, number] => {
  const a = random() * Math.PI * 2;
  const r = Math.sqrt(random()) * max;
  return [Math.cos(a) * r, 0, Math.sin(a) * r];
};

/** Waterfalls flowing up off island rims: streaming ribbons (crossed pairs), bright at the base, fading as they climb;
 *  one draw call. `falls`: where each starts, how tall and wide. */
export function buildUpfalls(
  falls: readonly { at: Vector3; height: number; width: number }[],
  color: Color = new Color(0.6, 0.95, 1.0),
): { mesh: Mesh; time: { value: number } } {
  const time = { value: 0 };
  const parts: BufferGeometry[] = [];
  for (const f of falls) {
    for (const turn of [0, Math.PI / 2]) {
      const plane = new PlaneGeometry(f.width, f.height).translate(0, f.height / 2, 0).rotateY(turn);
      parts.push(plane.translate(f.at.x, f.at.y, f.at.z));
    }
  }
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 tint;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
      void main() {
        // Streaks running up, each its own speed; soft at the sides, fading towards the top
        float lane = floor(vUv.x * 10.0);
        float flow = fract(vUv.y * 3.0 - time * (0.35 + 0.3 * hash(lane)) + hash(lane + 7.0));
        float streak = smoothstep(0.0, 0.25, flow) * (1.0 - smoothstep(0.5, 1.0, flow));
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float fade = (1.0 - smoothstep(0.35, 1.0, vUv.y)) * smoothstep(0.0, 0.04, vUv.y);
        gl_FragColor = vec4(tint * (0.25 + 0.75 * streak) * across * fade * 0.55, 1.0);
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
  return { mesh: new Mesh(combine(parts), material), time };
}

/** Broken stairs, pillars and an arch, adrift at odd angles (one draw call). */
export function buildRuins(pieces: readonly { at: Vector3; rotation: Euler }[], seed: number): Mesh {
  const random = seededRandom(seed);
  const stone = 0x6a6380;
  const parts: BufferGeometry[] = [];
  const place = (g: BufferGeometry, at: Vector3, rotation: Euler, color: number): void => {
    parts.push(part(g, color, {}).applyMatrix4(new Matrix4().compose(at, new Quaternion().setFromEuler(rotation), new Vector3(1, 1, 1))));
  };
  pieces.forEach(({ at, rotation }, k) => {
    const kind = k % 3;
    if (kind === 0) {
      // A flight of stairs, broken off
      const steps = 5 + Math.floor(random() * 4);
      const flight = combine(
        Array.from({ length: steps }, (_, s) => part(new BoxGeometry(500, 80, 160), stone, { position: [0, s * 80, s * 160] })),
      );
      place(flight, at, rotation, stone);
    } else if (kind === 1) {
      // A pillar, snapped
      const h = 900 + random() * 900;
      place(
        combine([
          part(new CylinderGeometry(110, 120, h, 10), stone, { position: [0, h / 2, 0] }),
          part(new BoxGeometry(300, 70, 300), 0x5a5470, { position: [0, 0, 0] }),
        ]),
        at,
        rotation,
        stone,
      );
    } else {
      // An arch
      place(
        combine([
          part(new BoxGeometry(160, 1100, 160), stone, { position: [-450, 550, 0] }),
          part(new BoxGeometry(160, 1100, 160), stone, { position: [450, 550, 0] }),
          part(new TorusGeometry(450, 80, 6, 16, Math.PI), stone, { position: [0, 1100, 0] }),
        ]),
        at,
        rotation,
        stone,
      );
    }
  });
  return new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

/** Rocks drifting about, slowly turning and bobbing (one draw call): a turn every 1.5 to 3.5 minutes, a bob of a third
 *  of their size. */
export function buildDriftingRocks(rocks: readonly { at: Vector3; size: number }[]): { mesh: InstancedMesh; time: { value: number } } {
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const uniforms = animate(
    material,
    /* glsl */ `
      // (in the rock's own unit-sized frame, before its size scales it: the bob is a fraction of its size)
      float own = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
      float a = time * (0.03 + 0.06 * own);
      float c = cos(a), s = sin(a);
      transformed = vec3(c * transformed.x + s * transformed.z, transformed.y, -s * transformed.x + c * transformed.z);
      transformed.y += sin(time * 0.25 + own * 6.2832) * 0.3;`,
    "",
    {},
    `float ownN = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
     float aN = time * (0.03 + 0.06 * ownN);
     objectNormal = vec3(cos(aN) * objectNormal.x + sin(aN) * objectNormal.z, objectNormal.y, -sin(aN) * objectNormal.x + cos(aN) * objectNormal.z);`,
  );
  const rock = part(new DodecahedronGeometry(1, 0), 0x463d5e);
  const matrices = rocks.map((r) => new Matrix4().compose(r.at, new Quaternion(), new Vector3(r.size, r.size * 0.75, r.size)));
  return { mesh: placed(rock, material, matrices), time: uniforms.time };
}

/** The rift: a vast swirling vortex of violet and green light far off, turning slowly (one draw call). */
export function buildRift(
  at: Vector3,
  radius: number,
  colors: { readonly a: Color; readonly b: Color; readonly eye: Color } = {
    a: new Color(0.45, 0.15, 0.85),
    b: new Color(0.2, 0.95, 0.65),
    eye: new Color(0.9, 0.8, 1.0),
  },
  /** Where it faces (default: the arena, a little below its own height); and whether far-off (drawn first, unfogged) */
  facing: Vector3 = new Vector3(0, at.y * 0.6, 0),
  far = true,
): { mesh: Mesh; time: { value: number } } {
  const time = { value: 0 };
  const material = new ShaderMaterial({
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 colorA;
      uniform vec3 colorB;
      uniform vec3 colorEye;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float a = atan(p.y, p.x);
        // Spiral arms winding in, turning
        float arms = sin(a * 3.0 + log(r + 0.02) * 6.0 - time * 0.25) * 0.5 + 0.5;
        float body = smoothstep(1.0, 0.15, r) * (0.35 + 0.65 * arms);
        float eye = smoothstep(0.22, 0.0, r);
        vec3 color = mix(colorA, colorB, arms * smoothstep(0.9, 0.2, r));
        gl_FragColor = vec4(color * body * 0.8 + colorEye * eye, 1.0);
        #include <colorspace_fragment>
      }`,
    uniforms: { time, colorA: { value: colors.a }, colorB: { value: colors.b }, colorEye: { value: colors.eye } },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  const mesh = new Mesh(new CircleGeometry(radius, 64), material);
  mesh.position.copy(at);
  mesh.lookAt(facing);
  if (far) mesh.renderOrder = -1;
  return { mesh, time };
}

/** Motes rising through the air instead of falling, and drifting (one draw call). */
export function buildRisingMotes(count: number, seed: number, keepOut: (x: number, z: number) => boolean): { points: Points; time: { value: number } } {
  const random = seededRandom(seed);
  const positions: number[] = [];
  while (positions.length < count * 3) {
    const x = (random() * 2 - 1) * 14000;
    const z = (random() * 2 - 1) * 16000;
    if (keepOut(x, z)) continue;
    positions.push(x, random() * 8000 - 3000, z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({ color: 0xb8ffe8, size: 22, transparent: true, opacity: 0.7, depthWrite: false, blending: AdditiveBlending });
  const uniforms = animate(
    material,
    /* glsl */ `
      transformed.y = mod(position.y + time * (60.0 + 40.0 * fract(position.x * 0.013)) + 3000.0, 8000.0) - 3000.0;
      transformed.x += sin(time * 0.3 + position.z * 0.003) * 80.0;`,
    "",
    {},
  );
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return { points, time: uniforms.time };
}

/** The serpent: a vast creature of dark segments with glowing rings, winding through the sky round the arena,
 *  horned head first, eyes aglow. Moved on the CPU (one matrix per segment, every frame). */
export function buildSerpent(path: (t: number) => Vector3, segments: number, length: number, loopSeconds: number): {
  root: Group;
  update(seconds: number): void;
} {
  const body = new InstancedMesh(new SphereGeometry(1, 14, 10), new MeshLambertMaterial({ color: 0x2c1f45, flatShading: true }), segments);
  const rings = new InstancedMesh(new TorusGeometry(1.08, 0.08, 6, 20), new MeshBasicMaterial({ color: 0x6bf3d0 }), Math.floor(segments / 4));
  const head = new Group();
  head.add(
    new Mesh(
      combine([
        part(new SphereGeometry(1, 16, 12), 0x2c1f45, { scale: [0.8, 0.7, 1.35] }),
        part(new ConeGeometry(0.22, 1.3, 6), 0x7d5bd6, { position: [-0.45, 0.6, -0.6], rotation: [-1.0, 0, 0.35] }),
        part(new ConeGeometry(0.22, 1.3, 6), 0x7d5bd6, { position: [0.45, 0.6, -0.6], rotation: [-1.0, 0, -0.35] }),
        part(new ConeGeometry(0.28, 0.9, 6), 0x7d5bd6, { position: [0, 0.75, -0.2], rotation: [-0.6, 0, 0] }),
      ]),
      new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    ),
    new Mesh(
      combine([
        part(new SphereGeometry(0.16, 8, 6), 0xffe066, { position: [-0.42, 0.22, 0.95] }),
        part(new SphereGeometry(0.16, 8, 6), 0xffe066, { position: [0.42, 0.22, 0.95] }),
      ]),
      new MeshBasicMaterial({ vertexColors: true }),
    ),
  );
  body.frustumCulled = false;
  rings.frustumCulled = false;
  body.name = "serpent";
  const root = new Group();
  root.add(body, rings, head);
  const m = new Matrix4();
  const q = new Quaternion();
  const scale = new Vector3();
  const ahead = new Vector3();
  const forward = new Vector3(0, 0, 1);
  const update = (seconds: number): void => {
    const t0 = seconds / loopSeconds;
    for (let i = 0; i < segments; i++) {
      const t = t0 - (i / segments) * length;
      const at = path(t);
      ahead.copy(path(t + 0.0005)).sub(at).normalize();
      q.setFromUnitVectors(forward, ahead);
      // Thick behind the head, tapering to the tail
      const u = i / segments;
      const r = 360 * (u < 0.08 ? 0.75 + u * 3 : 1 - 0.85 * ((u - 0.08) / 0.92) ** 1.2);
      body.setMatrixAt(i, m.compose(at, q, scale.set(r, r, r * 1.3)));
      if (i % 4 === 2) rings.setMatrixAt((i - 2) / 4, m.compose(at, q, scale.set(r, r, r)));
      if (i === 0) {
        head.position.copy(at).addScaledVector(ahead, r * 1.6);
        head.quaternion.copy(q);
        head.scale.setScalar(r * 1.25);
      }
    }
    body.instanceMatrix.needsUpdate = true;
    rings.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { root, update };
}

/** Eye-orbs: floating spheres with one big eye each, turning to watch the ball (two draw calls: body, eye). */
export function buildWatchers(homes: readonly Vector3[], seed: number): { root: Group; update(seconds: number, ball: Vector3): void } {
  const random = seededRandom(seed);
  const time = { value: 0 };
  const target = { value: new Vector3() };
  // Turns the eye (+z) towards the ball from the instance's home, and bobs. (Functions, not inline code: it's used
  // for the position and for the normal, both in the same shader.)
  const declarations = /* glsl */ `
    uniform float time;
    uniform vec3 target;
    vec3 watcherHome() { return (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; }
    float watcherOwn() { vec3 h = watcherHome(); return fract(sin(dot(h.xz, vec2(12.9898, 78.233))) * 43758.5453); }
    mat3 watcherAim() {
      vec3 zAxis = normalize(target - watcherHome());
      vec3 xAxis = normalize(cross(vec3(0.0, 1.0, 0.0), zAxis));
      return mat3(xAxis, cross(zAxis, xAxis), zAxis);
    }`;
  const material = (base: MeshLambertMaterial | MeshBasicMaterial): MeshLambertMaterial | MeshBasicMaterial => {
    base.onBeforeCompile = (shader) => {
      shader.uniforms["time"] = time;
      shader.uniforms["target"] = target;
      shader.vertexShader = `${declarations}\n${shader.vertexShader}`
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\ntransformed = watcherAim() * transformed;\ntransformed.y += sin(time * 0.8 + watcherOwn() * 6.2832) * 0.4;",
        )
        .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nobjectNormal = watcherAim() * objectNormal;");
    };
    base.customProgramCacheKey = () => (base instanceof MeshBasicMaterial ? "watcher-eye" : "watcher-body");
    return base;
  };
  const bodyGeometry = combine([
    part(new SphereGeometry(1, 18, 14), 0x3a2a5a),
    part(new TorusGeometry(0.6, 0.1, 6, 20), 0x5a3f8a, { position: [0, 0, 0.9] }), // the eyelid's rim
  ]);
  const eyeGeometry = combine([
    // (just in front of the sphere's surface, which bulges to z = 1 at the middle)
    part(new CircleGeometry(0.55, 24), 0xf2f0ff, { position: [0, 0, 1.01] }),
    part(new CircleGeometry(0.3, 20), 0x6bf3d0, { position: [0, 0, 1.02] }),
    part(new CircleGeometry(0.14, 16), 0x0a0612, { position: [0, 0, 1.03] }),
  ]);
  const matrices = homes.map((h) => new Matrix4().compose(h, new Quaternion(), new Vector3().setScalar(110 + random() * 90)));
  const root = new Group();
  root.add(
    placed(bodyGeometry, material(new MeshLambertMaterial({ vertexColors: true })), matrices),
    placed(eyeGeometry, material(new MeshBasicMaterial({ vertexColors: true })), matrices),
  );
  for (const child of root.children) child.name = "watcher";
  return {
    root,
    update(seconds, ball) {
      time.value = seconds;
      target.value.copy(ball);
    },
  };
}
