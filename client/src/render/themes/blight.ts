// A ruined industrial zone overrun by a parasitic biomass (original designs): jagged, broken buildings with the growth
// creeping up their walls, rubble and toppled girders, a wrecked freighter half buried in the ground, fleshy tendrils
// across the ground and up the ruins, twisted organic spires, carpets of biomass, and pustules that throb with a sickly
// glow. Everything alive moves slowly: tendrils and spires breathe, pustules throb. Three.js frame: ground in x/z, y up.
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  type InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
} from "three";
import { type Land, free } from "./nature";
import { seededRandom, valueNoise } from "./random";
import { ADDITIVE_FOG, type Placement, animate, combine, instances, part } from "./shapes";

const FLESH = [0xb9784c, 0xc98c58, 0xa86a52, 0xd2a062].map((c) => new Color(c));
const SICKLY = new Color(0xc9c25a);
const CONCRETE = [0x8a8478, 0x7a756b, 0x6e695f].map((c) => new Color(c));

export interface Ruin {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly base: number; // ground height
}

/** Ruined buildings scattered round the clearing, between `minRadius` and `maxRadius`. */
export function layoutRuins(land: Land, seed: number, count: number, minRadius: number, maxRadius: number): Ruin[] {
  const random = seededRandom(seed);
  const ruins: Ruin[] = [];
  for (let tries = 0; ruins.length < count && tries < count * 100; tries++) {
    const angle = random() * Math.PI * 2;
    const r = minRadius + random() * (maxRadius - minRadius);
    const x = Math.cos(angle) * r * 0.85;
    const z = Math.sin(angle) * r;
    const width = 900 + random() * 1700;
    const depth = 900 + random() * 1700;
    if (!free(land, x, z, Math.max(width, depth) * 0.75)) continue;
    if (ruins.some((o) => Math.abs(o.x - x) < (o.width + width) / 2 + 400 && Math.abs(o.z - z) < (o.depth + depth) / 2 + 400)) continue;
    ruins.push({ x, z, width, depth, height: 900 + random() ** 1.3 * 3400, base: land.height(x, z) });
  }
  return ruins;
}

/**
 * The ruins, rubble and the wreck, in one mesh: walls of upright strips broken off at different heights (the growth
 * coating some of them from the ground up), a few floor slabs left, toppled slabs and girders around.
 */
export function buildRuins(land: Land, ruins: readonly Ruin[], seed: number, wreck: { x: number; z: number }): Mesh {
  const random = seededRandom(seed);
  const parts: BufferGeometry[] = [];
  const concrete = (): Color => CONCRETE[Math.floor(random() * CONCRETE.length)] ?? new Color(0x808080);
  const flesh = (): Color => FLESH[Math.floor(random() * FLESH.length)] ?? new Color(0xb07050);
  for (const r of ruins) {
    // Four walls of strips, each broken off somewhere; doorways and gaps where a strip is missing
    const walls: { along: "x" | "z"; at: number; length: number }[] = [
      { along: "x", at: r.z - r.depth / 2, length: r.width },
      { along: "x", at: r.z + r.depth / 2, length: r.width },
      { along: "z", at: r.x - r.width / 2, length: r.depth },
      { along: "z", at: r.x + r.width / 2, length: r.depth },
    ];
    for (const wall of walls) {
      const strips = Math.max(3, Math.round(wall.length / 260));
      const strip = wall.length / strips;
      // Mostly standing, with a stretch collapsed (deepest at its middle) and the odd strip fallen out
      const collapse = { at: random(), width: 0.3 + random() * 0.6, depth: random() < 0.3 ? 0.15 : 0.4 + random() * 0.5 };
      for (let i = 0; i < strips; i++) {
        if (random() < 0.08) continue;
        const u = (i + 0.5) / strips;
        const fallen = collapse.depth * Math.max(0, 1 - Math.abs(u - collapse.at) / (collapse.width / 2));
        const h = r.height * (1 - fallen) * (0.9 + random() * 0.14);
        const offset = -wall.length / 2 + (i + 0.5) * strip;
        const x = wall.along === "x" ? r.x + offset : wall.at;
        const z = wall.along === "x" ? wall.at : r.z + offset;
        const size = (height: number): [number, number, number] =>
          wall.along === "x" ? [strip - 18, height, 70] : [70, height, strip - 18];
        // The growth creeps up some strips from the ground
        const coated = random() < 0.4 ? h * (0.1 + random() * 0.35) : 0;
        if (coated > 0) parts.push(part(new BoxGeometry(...size(coated)).translate(0, coated / 2, 0), flesh(), { position: [x, r.base - 10, z], scale: [1.12, 1, 1.12] }));
        parts.push(part(new BoxGeometry(...size(h - coated)).translate(0, (h - coated) / 2, 0), concrete(), { position: [x, r.base - 10 + coated, z] }));
      }
    }
    // What's left of the floors
    for (let y = 450; y < r.height * 0.8; y += 450) {
      if (random() < 0.5) continue;
      const w = r.width * (0.4 + random() * 0.6);
      const d = r.depth * (0.4 + random() * 0.6);
      parts.push(part(new BoxGeometry(w, 40, d), concrete(), {
        position: [r.x + (random() - 0.5) * (r.width - w), r.base + y, r.z + (random() - 0.5) * (r.depth - d)],
        rotation: [(random() - 0.5) * 0.12, 0, (random() - 0.5) * 0.12],
      }));
    }
    // Rubble about it: toppled slabs and girders
    for (let k = 0; k < 5; k++) {
      const a = random() * Math.PI * 2;
      const out = Math.max(r.width, r.depth) * (0.6 + random() * 0.4);
      const x = r.x + Math.cos(a) * out;
      const z = r.z + Math.sin(a) * out;
      if (!free(land, x, z, 150)) continue;
      const y = land.height(x, z);
      if (random() < 0.5) {
        parts.push(part(new BoxGeometry(300 + random() * 500, 50, 200 + random() * 400), concrete(), {
          position: [x, y + 20, z], rotation: [(random() - 0.5) * 0.5, random() * Math.PI, (random() - 0.5) * 0.5],
        }));
      } else {
        parts.push(part(new BoxGeometry(40, 40, 900 + random() * 900), 0x6b4530, {
          position: [x, y + 120, z], rotation: [0.15 + random() * 0.4, random() * Math.PI, 0],
        }));
      }
    }
  }
  // The wreck: a long rusted freighter hull ploughed into the ground at an angle, its ribs showing
  const hullLength = 9000;
  const wy = land.height(wreck.x, wreck.z);
  const hull = { position: [wreck.x, wy + 300, wreck.z] as [number, number, number], rotation: [0.22, 0.7, 0.12] as [number, number, number] };
  parts.push(part(new BoxGeometry(1700, 1400, hullLength), 0x5a4436, hull));
  parts.push(part(new BoxGeometry(1500, 500, hullLength * 0.6).translate(0, 950, -hullLength * 0.15), 0x4d3a2f, hull));
  parts.push(part(new CylinderGeometry(900, 900, 1700, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, hullLength / 2), 0x5a4436, hull));
  for (let i = 0; i < 9; i++) {
    parts.push(part(new TorusGeometry(1050, 70, 6, 16, Math.PI).translate(0, 0, -hullLength / 2 + (i + 0.5) * (hullLength / 9)), 0x3a2c24, hull));
  }
  return new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

/** A twisted organic spire: a bulging, tapering column, leaning and wavering, coloured flesh to sickly yellow. */
function spire(height: number, radius: number, seed: number): BufferGeometry {
  const random = seededRandom(seed);
  const points: Vector2[] = [];
  const bulges = 2 + Math.floor(random() * 3);
  const phase = random() * Math.PI;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const taper = (1 - t) ** 0.85;
    const bulge = 1 + 0.35 * Math.sin(t * Math.PI * bulges + phase) ** 2;
    points.push(new Vector2(Math.max(4, radius * taper * bulge), t * height));
  }
  const geometry = new LatheGeometry(points, 10);
  const position = geometry.getAttribute("position");
  const lean = (random() - 0.5) * 0.25;
  const twist = random() * 6;
  for (let v = 0; v < position.count; v++) {
    const y = position.getY(v);
    const t = y / height;
    position.setX(v, position.getX(v) + Math.sin(t * 3 + twist) * radius * 0.4 + lean * y);
    position.setZ(v, position.getZ(v) + Math.cos(t * 2.4 + twist) * radius * 0.4);
  }
  geometry.computeVertexNormals();
  const colored = part(geometry, 0xffffff);
  const colors = colored.getAttribute("color");
  const pos = colored.getAttribute("position");
  const base = FLESH[Math.floor(random() * FLESH.length)] ?? new Color(0xb07050);
  const c = new Color();
  for (let v = 0; v < colors.count; v++) {
    const t = pos.getY(v) / height;
    c.copy(base).lerp(SICKLY, Math.min(1, t * 1.4)).multiplyScalar(t > 0.85 ? 0.6 : 1);
    colors.setXYZ(v, c.r, c.g, c.b);
  }
  return colored;
}

/** Breathing: surfaces swell and settle slowly along their normals (`amount` uu), in waves. */
function breathing(material: MeshLambertMaterial, amount: number): { value: number } {
  return animate(
    material,
    `transformed += objectNormal * sin(time * 1.2 + position.x * 0.004 + position.y * 0.006 + position.z * 0.005) * ${amount.toFixed(1)};`,
    "",
    {},
  ).time;
}

export interface Spire {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly height: number;
  readonly radius: number;
}

/** Spires (one draw call). */
export function buildSpires(spires: readonly Spire[], seed: number): { mesh: Mesh; time: { value: number } } {
  const geometry = combine(spires.map((s, i) => spire(s.height, s.radius, seed + i).translate(s.x, s.y - 20, s.z)));
  const material = new MeshLambertMaterial({ vertexColors: true });
  const time = breathing(material, 12);
  return { mesh: new Mesh(geometry, material), time };
}

/** A tendril: a tube along `points`, thick at its root and tapering to its tip, mottled flesh colours. */
function tendril(points: readonly Vector3[], radius: number, random: () => number): BufferGeometry {
  const curve = new CatmullRomCurve3([...points]);
  const segments = Math.max(8, Math.round(curve.getLength() / 120));
  const radial = 6;
  const tube = new TubeGeometry(curve, segments, radius, radial, false);
  const position = tube.getAttribute("position");
  const centre = new Vector3();
  const v = new Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, centre);
    const taper = 1 - 0.8 * t;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(position, k).sub(centre).multiplyScalar(taper).add(centre);
      position.setXYZ(k, v.x, v.y, v.z);
    }
  }
  tube.computeVertexNormals();
  const colored = part(tube, 0xffffff);
  const colors = colored.getAttribute("color");
  const a = FLESH[Math.floor(random() * FLESH.length)] ?? new Color(0xb07050);
  const b = FLESH[Math.floor(random() * FLESH.length)] ?? new Color(0xc08060);
  const c = new Color();
  for (let i = 0; i <= segments; i++) {
    c.copy(a).lerp(b, 0.5 + 0.5 * Math.sin(i * 0.9 + random()));
    for (let j = 0; j <= radial; j++) colors.setXYZ(i * (radial + 1) + j, c.r, c.g, c.b);
  }
  return colored;
}

/**
 * Tendrils (one draw call): runners snaking over the ground, climbers up the ruins' walls, and coils round the spires.
 * All of them stay off the clearing.
 */
export function buildTendrils(
  land: Land,
  seed: number,
  ruins: readonly Ruin[],
  spires: readonly Spire[],
  runners: number,
): { mesh: Mesh; time: { value: number } } {
  const random = seededRandom(seed);
  const wander = valueNoise(seed);
  const parts: BufferGeometry[] = [];
  // Runners: over the ground, wandering, keeping off the clearing
  for (let n = 0, tries = 0; n < runners && tries < runners * 20; tries++) {
    const angle = random() * Math.PI * 2;
    const r = 7000 + random() * 9000;
    let x = Math.cos(angle) * r * 0.85;
    let z = Math.sin(angle) * r;
    const radius = 25 + random() * 45;
    let heading = random() * Math.PI * 2;
    const points: Vector3[] = [];
    for (let k = 0; k < 6; k++) {
      if (!free(land, x, z, 200)) break;
      points.push(new Vector3(x, land.height(x, z) + radius * 0.6, z));
      heading += wander(x / 3000, z / 3000) * 1.4;
      const step = 500 + random() * 700;
      x += Math.cos(heading) * step;
      z += Math.sin(heading) * step;
    }
    if (points.length < 3) continue;
    parts.push(tendril(points, radius, random));
    n++;
  }
  // Climbers: up a ruin's wall from the ground, wavering
  for (const r of ruins) {
    for (let k = 0; k < 3; k++) {
      const side = Math.floor(random() * 4);
      const along = (random() - 0.5) * 0.8;
      const out = 60;
      const at = (y: number, wobble: number): Vector3 => {
        const u = along + wobble;
        if (side === 0) return new Vector3(r.x + u * r.width, y, r.z - r.depth / 2 - out);
        if (side === 1) return new Vector3(r.x + u * r.width, y, r.z + r.depth / 2 + out);
        if (side === 2) return new Vector3(r.x - r.width / 2 - out, y, r.z + u * r.depth);
        return new Vector3(r.x + r.width / 2 + out, y, r.z + u * r.depth);
      };
      const top = r.height * (0.3 + random() * 0.4);
      const points = [0, 0.3, 0.6, 1].map((t) => at(r.base + 20 + t * top, (random() - 0.5) * 0.15));
      parts.push(tendril(points, 30 + random() * 30, random));
    }
  }
  // Coils round the spires
  for (const s of spires) {
    const turns = 1.5 + random() * 1.5;
    const start = random() * Math.PI * 2;
    const points: Vector3[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const a = start + t * turns * Math.PI * 2;
      const r = s.radius * (1 - 0.7 * t) + 40;
      points.push(new Vector3(s.x + Math.cos(a) * r, s.y + t * s.height * 0.6, s.z + Math.sin(a) * r));
    }
    parts.push(tendril(points, 30 + random() * 20, random));
  }
  const material = new MeshLambertMaterial({ vertexColors: true });
  const time = breathing(material, 6);
  return { mesh: new Mesh(combine(parts), material), time };
}

/** Carpets of biomass: flattened blobs in patches on the ground, swelling slowly. */
export function buildBiomass(land: Land, seed: number, patches: readonly [number, number][]): { mesh: InstancedMesh; time: { value: number } } {
  const random = seededRandom(seed);
  const placements: (Placement & { tint: Color })[] = [];
  for (const [cx, cz] of patches) {
    const count = 6 + Math.floor(random() * 14);
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * 700;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (!free(land, x, z, 100)) continue;
      const s = 0.6 + random() * 1.4;
      placements.push({
        position: [x, land.height(x, z) - 15, z],
        rotation: [0, random() * Math.PI, 0],
        scale: [s * (1 + random()), s * (0.25 + random() * 0.25), s * (1 + random())],
        tint: FLESH[Math.floor(random() * FLESH.length)]?.clone().multiplyScalar(0.85 + random() * 0.25) ?? new Color(0xb07050),
      });
    }
  }
  const material = new MeshLambertMaterial({ vertexColors: true });
  const time = breathing(material, 8);
  return { mesh: instances(part(new SphereGeometry(160, 9, 6), 0xffffff), material, placements), time };
}

/**
 * Pustules: fleshy sacs with a glowing core and a soft glow about them (three draw calls), throbbing slowly, each at
 * its own pace. `spots`: where they sit (x, y, z) and their size.
 */
export function buildPustules(spots: readonly { x: number; y: number; z: number; size: number }[]): {
  root: Group;
  time: { value: number };
} {
  const throb = /* glsl */ `
    float own = fract(sin(dot((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz, vec2(12.9898, 78.233))) * 43758.5453);
    float swell = 1.0 + 0.12 * sin(time * (1.4 + own) + own * 6.2832);
    transformed *= swell;`;
  const time = { value: 0 }; // (one clock for the sacs, their cores and their glow)
  const sacMaterial = new MeshLambertMaterial({ vertexColors: true });
  animate(sacMaterial, throb, "", { time });
  const coreMaterial = new MeshBasicMaterial({ color: 0xc8ff5a });
  animate(coreMaterial, throb, "", { time });
  const glow = new ShaderMaterial({
    vertexShader: /* glsl */ `
      uniform float time;
      varying vec2 vUv;
      varying float vPulse;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec3 at = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float own = fract(sin(dot(at.xz, vec2(12.9898, 78.233))) * 43758.5453);
        vPulse = 0.6 + 0.4 * sin(time * (1.4 + own) + own * 6.2832);
        float size = length(instanceMatrix[0].xyz);
        // Always facing the camera
        vec4 mvPosition = viewMatrix * modelMatrix * vec4(at, 1.0);
        mvPosition.xy += position.xy * size;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vPulse;
      #include <fog_pars_fragment>
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        float g = pow(max(0.0, 1.0 - r), 2.2) * vPulse;
        gl_FragColor = vec4(vec3(0.75, 1.0, 0.3) * g * 0.55, 1.0);
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
  const sac = part(new SphereGeometry(60, 10, 8), 0xc58a5c);
  const at = (s: { x: number; y: number; z: number; size: number }, k: number): Placement => ({
    position: [s.x, s.y, s.z],
    scale: [s.size * k, s.size * k, s.size * k],
  });
  const root = new Group();
  root.add(
    instances(sac, sacMaterial, spots.map((s) => at(s, 1))),
    instances(new SphereGeometry(36, 8, 6), coreMaterial, spots.map((s) => ({ ...at(s, 1), position: [s.x, s.y + 22 * s.size, s.z] }))),
    instances(new PlaneGeometry(1, 1), glow, spots.map((s) => at(s, 260))),
  );
  return { root, time };
}
