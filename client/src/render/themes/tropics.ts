// A tropical volcanic island (original designs): the land sloping from the arena's pitch down to a sand beach, the
// sea round it (turquoise in the shallows, surf at the shore, deep blue beyond), a volcano rising from the sea with
// smoke drifting from its crater; swaying palms; and its creatures: manta rays gliding over the lagoon, leapers arcing
// out of the water, crabs scuttling sideways on the beach. Three.js frame: y up.
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  type InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";
import { GROUND_LEVEL, type Land, landscape, smoothstep } from "./nature";
import { fractalNoise, seededRandom, valueNoise } from "./random";
import { type Placement, animate, combine, instances, part } from "./shapes";

/** The sea's surface. */
export const SEA_LEVEL = GROUND_LEVEL - 250;

export interface Volcano {
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly radius: number; // at its foot
}

/** The island: the arena's flat pitch, the land falling gently to the sea round it, and the volcano. */
export function islandLand(seed: number, flat: { halfX: number; halfZ: number; radius: number }, volcano: Volcano): Land {
  const noise = valueNoise(seed);
  const base = landscape(seed, {
    flat,
    pond: { x: 60000, z: 60000, radius: 1 }, // (none)
    path: () => Infinity,
    hills: { low: 0, high: 0, rise: 1, horizon: 0 },
  });
  const height = (x: number, z: number): number => {
    const d = base.flatDistance(x, z);
    // Down from the pitch to below the sea, with low dunes and hummocks on the way
    let h = -smoothstep(0, 9500, d) * 1100 + fractalNoise(noise, x / 2600, z / 2600, 3) * 140 * smoothstep(0, 1500, d);
    // The volcano: a cone with a crater at its top
    const dv = Math.hypot(x - volcano.x, z - volcano.z);
    h += volcano.height * Math.max(0, 1 - dv / volcano.radius) ** 1.6;
    h -= volcano.height * 0.16 * (1 - smoothstep(volcano.radius * 0.06, volcano.radius * 0.14, dv));
    return GROUND_LEVEL + h;
  };
  return { ...base, height };
}

/** The island's ground: the pitch's grass, lush green inland, sand at the beach, black rock up the volcano. */
export function buildIslandGround(land: Land, seed: number, volcano: Volcano): Mesh {
  const noise = valueNoise(seed);
  const geometry = new PlaneGeometry(70000, 70000, 300, 300);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) position.setY(i, land.height(position.getX(i), position.getZ(i)));
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute("normal");
  const colors = new Float32Array(position.count * 3);
  const grass = new Color(0x3f9a3a);
  const grassLight = new Color(0x6cc04a);
  const sand = new Color(0xf0dfae);
  const wetSand = new Color(0xc8b07a);
  const rock = new Color(0x3a3634);
  const ash = new Color(0x5a5250);
  const color = new Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = position.getY(i);
    color.copy(grass).lerp(grassLight, fractalNoise(noise, x / 2000, z / 2000, 3) * 0.5 + 0.5);
    // The beach: sand from a little above the sea down into it
    const aboveSea = y - SEA_LEVEL;
    color.lerp(sand, 1 - smoothstep(120, 260, aboveSea));
    color.lerp(wetSand, 1 - smoothstep(-20, 40, aboveSea));
    // The volcano: black rock and ash, more of it the higher up and the steeper
    const dv = Math.hypot(x - volcano.x, z - volcano.z);
    const onVolcano = 1 - smoothstep(volcano.radius * 0.35, volcano.radius * 0.7, dv);
    color.lerp(rock, Math.max(onVolcano, smoothstep(0.85, 0.6, normal.getY(i)) * 0.7));
    color.lerp(ash, onVolcano * smoothstep(-0.2, 0.6, fractalNoise(noise, x / 900, z / 900, 2)) * 0.5);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true }));
}

/** The sea: turquoise in the shallows, deep blue beyond, foam where it meets the shore, waves rolling (one draw
 *  call). Its depth at each vertex comes from the land beneath. */
export function buildSea(land: Land): { mesh: Mesh; time: { value: number } } {
  const geometry = new PlaneGeometry(80000, 80000, 260, 260);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  const depth = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) depth[i] = SEA_LEVEL - land.height(position.getX(i), position.getZ(i));
  geometry.setAttribute("depth", new Float32BufferAttribute(depth, 1));
  const time = { value: 0 };
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      uniform float time;
      attribute float depth;
      varying float vDepth;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        // Gentle swell out in deep water
        float swell = smoothstep(0.0, 400.0, depth);
        world.y += swell * (sin(world.x * 0.0011 + time * 0.7) * 14.0 + sin(world.z * 0.0013 - time * 0.55) * 11.0);
        vDepth = depth;
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      varying float vDepth;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        if (vDepth < -30.0) discard; // (under the land)
        vec3 shallow = vec3(0.25, 0.85, 0.78);
        vec3 deep = vec3(0.04, 0.3, 0.58);
        vec3 color = mix(shallow, deep, smoothstep(20.0, 1100.0, vDepth));
        // Surf: bands of foam running in to the shore and breaking
        float wave = sin(vDepth * 0.045 + time * 1.6);
        float foam = (1.0 - smoothstep(0.0, 70.0, vDepth)) + smoothstep(0.75, 0.95, wave) * (1.0 - smoothstep(30.0, 220.0, vDepth));
        color = mix(color, vec3(0.97, 0.99, 1.0), clamp(foam, 0.0, 1.0) * 0.85);
        // Glints of sun
        float glint = step(0.996, hash(floor(vWorld.xz / 60.0) + floor(time * 2.0)));
        color += glint * 0.35 * smoothstep(100.0, 600.0, vDepth);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), time },
    fog: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.y = SEA_LEVEL;
  mesh.name = "sea";
  return { mesh, time };
}

/** Palms: a curved, ringed trunk leaning over, a crown of drooping fronds and coconuts; swaying in the breeze (one
 *  draw call). `spots`: where they stand, their size, and which way they lean. */
export function buildPalms(spots: readonly { x: number; y: number; z: number; size: number; lean: number }[], seed: number): {
  mesh: InstancedMesh;
  time: { value: number };
} {
  const random = seededRandom(seed);
  const parts: BufferGeometry[] = [];
  // The trunk: segments curving over towards +x, alternately lighter and darker (its rings)
  let at = new Vector3(0, 0, 0);
  let tilt = 0;
  const segments = 9;
  for (let i = 0; i < segments; i++) {
    const length = 210;
    tilt += 0.055 + i * 0.006;
    const dir = new Vector3(Math.sin(tilt), Math.cos(tilt), 0);
    const centre = at.clone().addScaledVector(dir, length / 2);
    const r = 46 - i * 2.5;
    parts.push(part(new CylinderGeometry(r * 0.92, r, length + 6, 8), i % 2 === 0 ? 0x8a6a48 : 0x7a5c3c, { position: [centre.x, centre.y, 0], rotation: [0, 0, -tilt] }));
    at = at.addScaledVector(dir, length);
  }
  const top = at;
  // Fronds: long leaves arching out and drooping, each a strip of quads
  const fronds = 9;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + random() * 0.3;
    const length = 780 + random() * 200;
    const geometry = new BufferGeometry();
    const vertices: number[] = [];
    const steps = 6;
    const point = (t: number, side: number): [number, number, number] => {
      const out = t * length;
      const droop = -Math.pow(t, 1.8) * length * 0.75 + t * length * 0.25;
      const width = 95 * Math.sin(Math.PI * Math.min(1, t * 1.2)) * side;
      return [Math.cos(a) * out - Math.sin(a) * width, droop, Math.sin(a) * out + Math.cos(a) * width];
    };
    for (let k = 0; k < steps; k++) {
      const [t0, t1] = [k / steps, (k + 1) / steps];
      const [a0, b0, a1, b1] = [point(t0, -1), point(t0, 1), point(t1, -1), point(t1, 1)];
      vertices.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
    }
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    parts.push(part(geometry, f % 2 === 0 ? 0x3f9a3a : 0x2f8a34, { position: [top.x, top.y, top.z] }));
  }
  for (let c = 0; c < 4; c++) {
    const a = (c / 4) * Math.PI * 2;
    parts.push(part(new SphereGeometry(34, 8, 6), 0x6a4a2a, { position: [top.x + Math.cos(a) * 45, top.y - 50, Math.sin(a) * 45] }));
  }
  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const uniforms = animate(
    material,
    /* glsl */ `
      // Swaying: more the higher up, in gusts
      vec3 rooted = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float gust = sin(time * 0.9 + rooted.x * 0.0007 + rooted.z * 0.0005) + 0.35 * sin(time * 2.3 + rooted.z * 0.002);
      float k = position.y / 2000.0;
      transformed.x += gust * k * k * 90.0;
      transformed.z += gust * k * k * 40.0;`,
    "",
    {},
  );
  const placements = spots.map((s): Placement => ({ position: [s.x, s.y - 20, s.z], rotation: [0, s.lean, 0], scale: [s.size, s.size, s.size] }));
  const mesh = instances(combine(parts), material, placements);
  mesh.name = "palms";
  return { mesh, time: uniforms.time };
}

/** Smoke rising from the crater: soft puffs swelling, drifting downwind and fading, over and over (one draw call). */
export function buildSmoke(crater: Vector3, count: number): { mesh: InstancedMesh; time: { value: number } } {
  const time = { value: 0 };
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      uniform float time;
      varying vec2 vUv;
      varying float vLife;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec3 vent = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float own = float(gl_InstanceID) * 0.6180339;
        float life = fract(time / 26.0 + own);
        vLife = life;
        // Up and away downwind, spreading
        vec3 at = vent + vec3(life * 7000.0, life * 6500.0 - life * life * 2000.0, life * 2500.0 * sin(own * 6.2832));
        float size = 1600.0 + life * 5500.0;
        vec4 mvPosition = viewMatrix * modelMatrix * vec4(at, 1.0);
        mvPosition.xy += position.xy * size;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vLife;
      #include <fog_pars_fragment>
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        float puff = pow(max(0.0, 1.0 - r), 1.6);
        float fade = smoothstep(0.0, 0.08, vLife) * (1.0 - smoothstep(0.55, 1.0, vLife));
        vec3 color = mix(vec3(0.32, 0.3, 0.31), vec3(0.78, 0.78, 0.8), vLife);
        gl_FragColor = vec4(color, puff * fade * 0.8);
        #include <colorspace_fragment>
        // (only half fogged: a plume this big stands out through the haze)
        #ifdef USE_FOG
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar, vFogDepth) * 0.5);
        #endif
      }`,
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), time },
    fog: true,
    blending: NormalBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = instances(new PlaneGeometry(1, 1), material, Array.from({ length: count }, (): Placement => ({ position: [crater.x, crater.y, crater.z] })));
  mesh.name = "smoke";
  return { mesh, time };
}

/** A crab: a flat round shell, claws held up, legs, eyes on stalks; ~150 across. Built facing +x: it walks sideways. */
export function crab(): BufferGeometry {
  const shell = 0xd8452e;
  const parts: BufferGeometry[] = [
    part(new SphereGeometry(60, 12, 8), shell, { position: [0, 40, 0], scale: [1.25, 0.55, 1] }),
    part(new SphereGeometry(10, 6, 5), 0x1a1a1a, { position: [-18, 78, 42] }), // eyes
    part(new SphereGeometry(10, 6, 5), 0x1a1a1a, { position: [18, 78, 42] }),
    part(new CylinderGeometry(3, 3, 26, 4), shell, { position: [-18, 62, 42] }),
    part(new CylinderGeometry(3, 3, 26, 4), shell, { position: [18, 62, 42] }),
  ];
  for (const s of [-1, 1]) {
    parts.push(part(new SphereGeometry(26, 8, 6), shell, { position: [s * 70, 58, 60], scale: [1, 0.7, 1.3] })); // claws
    parts.push(part(new ConeGeometry(12, 40, 5), shell, { position: [s * 82, 62, 92], rotation: [Math.PI / 2, 0, 0] }));
    for (const z of [-30, 0, 30]) {
      parts.push(part(new CylinderGeometry(4, 4, 70, 4), shell, { position: [s * 80, 22, z - 10], rotation: [0, 0, s * 1.0] }));
    }
  }
  // (turned so it walks sideways: the walkers face their direction of travel along +z)
  return combine(parts).rotateY(Math.PI / 2);
}

/** A manta ray: a broad, flat body with wing tips, head fins and a long thin tail; ~6 across (unit scale), facing +z.
 *  Dark above, pale below. */
function manta(): BufferGeometry {
  const top = 0x2a3448;
  const geometry = new BufferGeometry();
  // A diamond of wings: nose, wing tips, tail root; upper and lower faces
  const nose: [number, number, number] = [0, 0, 1.4];
  const left: [number, number, number] = [-3, 0.15, -0.4];
  const right: [number, number, number] = [3, 0.15, -0.4];
  const tail: [number, number, number] = [0, 0, -1.2];
  const ridge: [number, number, number] = [0, 0.35, 0];
  const under: [number, number, number] = [0, -0.2, 0];
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([...nose, ...ridge, ...left, ...nose, ...right, ...ridge, ...ridge, ...tail, ...left, ...ridge, ...right, ...tail], 3),
  );
  geometry.computeVertexNormals();
  const belly = new BufferGeometry();
  belly.setAttribute(
    "position",
    new Float32BufferAttribute([...nose, ...left, ...under, ...nose, ...under, ...right, ...under, ...left, ...tail, ...under, ...tail, ...right], 3),
  );
  belly.computeVertexNormals();
  return combine([
    part(geometry, top),
    part(belly, 0xe8eef4),
    part(new ConeGeometry(0.18, 0.7, 5), top, { position: [-0.45, 0, 1.55], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 0.4] }), // head fins
    part(new ConeGeometry(0.18, 0.7, 5), top, { position: [0.45, 0, 1.55], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 0.4] }),
    part(new CylinderGeometry(0.02, 0.07, 3.2, 4), top, { position: [0, 0, -2.7], rotation: [Math.PI / 2, 0, 0] }), // tail
  ]);
}

/** Manta rays gliding in slow loops over the lagoon, wings beating: moved on the CPU. */
export function buildMantas(paths: readonly ((t: number) => Vector3)[], loopSeconds: number, size: number): {
  root: Group;
  update(elapsedSeconds: number): void;
} {
  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const uniforms = animate(material, "transformed.y += abs(position.x) * abs(position.x) * 0.09 * sin(time * 1.3 - abs(position.x) * 0.5);", "", {});
  const shape = manta();
  const root = new Group();
  const rays = paths.map((path, i) => {
    const mesh = new Mesh(shape, material);
    mesh.scale.setScalar(size * (1 - i * 0.18));
    mesh.name = "manta";
    root.add(mesh);
    return { mesh, path };
  });
  const ahead = new Vector3();
  const update = (seconds: number): void => {
    for (const { mesh, path } of rays) {
      const t = seconds / loopSeconds;
      mesh.position.copy(path(t));
      ahead.copy(path(t + 0.003));
      mesh.lookAt(ahead);
    }
    uniforms.time.value = seconds;
  };
  update(0);
  return { root, update };
}

/** A leaper: a sleek sea creature, pale aqua with a white belly, a dorsal fin and tail flukes; ~6 long, facing +z. */
function leaper(): BufferGeometry {
  const body = 0x7ac8d8;
  return combine([
    part(new SphereGeometry(1, 16, 10), body, { scale: [0.55, 0.55, 2.4] }),
    part(new SphereGeometry(0.9, 14, 8), 0xeaf6f8, { position: [0, -0.15, 0.2], scale: [0.45, 0.4, 1.9] }), // belly
    part(new ConeGeometry(0.22, 0.9, 6), body, { position: [0, 0.75, -0.3], rotation: [-0.5, 0, 0], scale: [0.3, 1, 1] }), // dorsal fin
    part(new ConeGeometry(0.22, 0.9, 6), body, { position: [-0.65, -0.5, 0.6], rotation: [0.4, 0, 1.3], scale: [0.3, 1, 1] }), // flippers
    part(new ConeGeometry(0.22, 0.9, 6), body, { position: [0.65, -0.5, 0.6], rotation: [0.4, 0, -1.3], scale: [0.3, 1, 1] }),
    part(new ConeGeometry(0.3, 1.0, 6), body, { position: [-0.5, 0, -2.6], rotation: [Math.PI / 2, 0, 1.2], scale: [0.25, 1, 1] }), // flukes
    part(new ConeGeometry(0.3, 1.0, 6), body, { position: [0.5, 0, -2.6], rotation: [Math.PI / 2, 0, -1.2], scale: [0.25, 1, 1] }),
    part(new ConeGeometry(0.2, 0.7, 8), body, { position: [0, -0.08, 2.65], rotation: [Math.PI / 2, 0, 0] }), // snout
    part(new SphereGeometry(0.07, 6, 5), 0x0a1418, { position: [-0.32, 0.15, 1.75] }),
    part(new SphereGeometry(0.07, 6, 5), 0x0a1418, { position: [0.32, 0.15, 1.75] }),
  ]);
}

/** Leapers arcing out of the sea now and then, each from its own spot in its own direction: under the water between
 *  leaps (moved on the CPU, one draw call). */
export function buildLeapers(
  homes: readonly { x: number; z: number; heading: number }[],
  size: number,
  arc: { readonly height: number; readonly length: number } = { height: 1100, length: 1700 },
): {
  mesh: InstancedMesh;
  update(elapsedSeconds: number): void;
} {
  const mesh = instances(leaper(), new MeshLambertMaterial({ vertexColors: true }), homes.map((): Placement => ({})));
  mesh.name = "wildlife: leaper";
  const m = new Matrix4();
  const q = new Quaternion();
  const pitch = new Quaternion();
  const scale = new Vector3().setScalar(size);
  const update = (seconds: number): void => {
    homes.forEach((h, i) => {
      // A leap of 2.2 s every 9 to 14 s
      const period = 9 + (i % 5);
      const t = (seconds + i * 3.7) % period;
      const leap = t / 2.2;
      if (leap >= 1) {
        // Waiting deep under the water, out of sight
        mesh.setMatrixAt(i, m.compose(new Vector3(h.x, SEA_LEVEL - 3000, h.z), q.identity(), scale));
        return;
      }
      const forward = new Vector3(Math.sin(h.heading), 0, Math.cos(h.heading));
      const at = new Vector3(h.x, SEA_LEVEL - size + arc.height * 4 * leap * (1 - leap), h.z).addScaledVector(forward, (leap - 0.5) * arc.length);
      // Nose up rising, nose down falling
      q.setFromAxisAngle(new Vector3(0, 1, 0), h.heading).multiply(pitch.setFromAxisAngle(new Vector3(1, 0, 0), (leap - 0.5) * 2.0));
      mesh.setMatrixAt(i, m.compose(at, q, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { mesh, update };
}
