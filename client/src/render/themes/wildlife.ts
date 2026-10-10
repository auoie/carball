// Wild creatures going about their business outside the arena (original designs): birds circling overhead,
// caterpillars inching along, beetles trundling, butterflies fluttering over the grass, and round critters (see
// critters.ts) wandering at the forest's edge. Their movement is computed in the vertex shader from each one's home
// (its instance position) and the time: slow, and never across the field. One draw call per kind.
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  type InstancedMesh,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
} from "three";
import { ember, puff, ripple, sprout } from "./critters";
import { seededRandom } from "./random";
import { type Placement, animate, combine, instances, part, placementMatrix } from "./shapes";

/** A flock circling high over the arena, flapping. */
export function buildBirds(
  seed: number,
  flight: { readonly radius: readonly [number, number]; readonly height: readonly [number, number]; readonly count?: number },
): { mesh: InstancedMesh; update(elapsedSeconds: number): void } {
  const random = seededRandom(seed);
  const bird = new BufferGeometry();
  // Two wings (spanning x) and a little body, flying along +z
  bird.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 18, -70, 0, -10, 0, 4, -14, 0, 0, 18, 0, 4, -14, 70, 0, -10, 0, -6, 22, 0, 6, -30, 0, -6, -30], 3),
  );
  bird.computeVertexNormals();
  bird.setAttribute("color", new Float32BufferAttribute(new Array<number>(27).fill(0.95), 3));
  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const uniforms = animate(
    material,
    "transformed.y += abs(position.x) * 0.75 * sin(time * 9.0 + float(gl_InstanceID) * 1.37);",
    "",
    {},
  );
  const flock = Array.from({ length: flight.count ?? 26 }, () => ({
    radius: flight.radius[0] + random() * (flight.radius[1] - flight.radius[0]),
    height: flight.height[0] + random() * (flight.height[1] - flight.height[0]),
    speed: (0.05 + random() * 0.04) * (random() < 0.3 ? -1 : 1),
    phase: random() * Math.PI * 2,
    bob: random() * Math.PI * 2,
  }));
  const mesh = instances(bird, material, flock.map((): Placement => ({})));
  const update = (seconds: number): void => {
    flock.forEach((b, i) => {
      const a = b.phase + seconds * b.speed;
      const x = Math.cos(a) * b.radius;
      const z = Math.sin(a) * b.radius * 1.2;
      const y = b.height + Math.sin(seconds * 0.7 + b.bob) * 150;
      // Heading along the circle (the sign of the speed sets the direction)
      const heading = -a + (b.speed < 0 ? Math.PI : 0);
      mesh.setMatrixAt(i, placementMatrix({ position: [x, y, z], rotation: [0, heading, 0], scale: [1.4, 1.4, 1.4] }));
    });
    mesh.instanceMatrix.needsUpdate = true;
    uniforms.time.value = seconds;
  };
  update(0);
  return { mesh, update };
}

/** Where a creature lives: on the ground (x, y, z), its size. */
export interface Home {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  /** How the ground it walks on is turned (Euler XYZ; default upright): [π, 0, 0] walks upside down */
  readonly rotation?: readonly [number, number, number];
}

// Shared GLSL. Each creature circles slowly around its home (in its own frame, so the radius scales with it), facing
// the way it goes. `wander` gives the offset (xz) and the heading (about y) at this time.
const WANDER = /* glsl */ `
vec3 wanderHome() { return (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; }
float wanderSeed() { vec3 h = wanderHome(); return fract(sin(dot(h.xz, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 wander(float speed, float radius) {
  float s = wanderSeed();
  float direction = s > 0.5 ? 1.0 : -1.0;
  float angle = time * speed * (0.6 + 0.8 * fract(s * 7.31)) * direction + s * 6.2832;
  float r = radius * (0.5 + 0.5 * fract(s * 3.17));
  float heading = direction > 0.0 ? -angle : 3.14159265 - angle;
  return vec3(r * cos(angle), r * sin(angle), heading);
}
vec2 turn(vec2 xz, float a) { float c = cos(a), s = sin(a); return vec2(c * xz.x + s * xz.y, -s * xz.x + c * xz.y); }
`;

/** Ground creatures circling at about `speed` (rad/s) within `radius` of home; `extra`: GLSL for their gait (with
 *  `wanderSeed()` and `time`). */
export function walkers(
  geometry: BufferGeometry,
  homes: readonly Home[],
  speed: number,
  radius: number,
  extra: string,
): { mesh: InstancedMesh; time: { value: number } } {
  const material = new MeshLambertMaterial({ vertexColors: true });
  const uniforms = animate(
    material,
    /* glsl */ `
      vec3 w = wander(${speed.toFixed(3)}, ${radius.toFixed(1)});
      ${extra}
      transformed.xz = turn(transformed.xz, w.z) + w.xy;`,
    WANDER,
    {},
    /* glsl */ `objectNormal.xz = turn(objectNormal.xz, wander(${speed.toFixed(3)}, ${radius.toFixed(1)}).z);`,
  );
  const mesh = instances(
    geometry,
    material,
    homes.map((h) => ({ position: [h.x, h.y, h.z], rotation: h.rotation ?? [0, 0, 0], scale: [h.scale, h.scale, h.scale] })),
  );
  return { mesh, time: uniforms.time };
}

/** A plump green caterpillar: five segments and a head with antennae, about 150 long (facing +z). */
function caterpillar(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    parts.push(part(new SphereGeometry(17, 8, 6), i % 2 === 0 ? 0xa6d860 : 0x92c94f, { position: [0, 17, -55 + i * 24] }));
  }
  parts.push(part(new SphereGeometry(20, 8, 6), 0xb5e06c, { position: [0, 24, 68] }));
  for (const s of [-1, 1]) {
    parts.push(part(new SphereGeometry(4, 5, 4), 0x1d1d26, { position: [s * 9, 30, 85] }));
    parts.push(part(new ConeGeometry(3, 16, 4), 0xf2c94c, { position: [s * 8, 46, 66], rotation: [0.3, 0, s * -0.35] }));
  }
  return combine(parts);
}

/** A round beetle: a glossy shell with a seam, a dark head with a little horn, six legs. */
function beetle(): BufferGeometry {
  const parts: BufferGeometry[] = [
    part(new SphereGeometry(32, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x2f9e8f, { position: [0, 14, 0], scale: [1, 0.85, 1.25] }),
    part(new CylinderGeometry(1.5, 1.5, 76, 4), 0x173f3a, { position: [0, 41, -2], rotation: [Math.PI / 2, 0, 0] }),
    part(new SphereGeometry(15, 8, 6), 0x24302e, { position: [0, 18, 40] }),
    part(new ConeGeometry(5, 22, 5), 0x24302e, { position: [0, 30, 52], rotation: [0.9, 0, 0] }),
  ];
  for (const s of [-1, 1]) {
    for (const z of [-18, 2, 22]) {
      parts.push(part(new CylinderGeometry(2, 2, 26, 4), 0x24302e, { position: [s * 34, 8, z], rotation: [0, 0, s * 1.1] }));
    }
  }
  return combine(parts);
}

/** A butterfly: a slim body along z and two pairs of white wings (tinted per butterfly), wingspan about 80. */
function butterfly(): BufferGeometry {
  const parts: BufferGeometry[] = [part(new CylinderGeometry(2.5, 2, 30, 5), 0x3a2f2a, { rotation: [Math.PI / 2, 0, 0] })];
  for (const s of [-1, 1]) {
    // Wings lie flat in x/z, out from the body (|x| > 1 is what flaps)
    parts.push(part(new PlaneGeometry(38, 30), 0xffffff, { position: [s * 21, 0, 6], rotation: [-Math.PI / 2, 0, 0] }));
    parts.push(part(new PlaneGeometry(26, 22), 0xf2f2f2, { position: [s * 15, 0, -14], rotation: [-Math.PI / 2, 0, 0] }));
  }
  return combine(parts);
}

/** The forest's creatures around the given homes. Returns their meshes and the clock to drive them. */
export function buildWildlife(
  seed: number,
  homes: { readonly ground: readonly Home[]; readonly air: readonly Home[] },
  butterflyColors: readonly number[] = [0xfff36b, 0xffffff, 0xffa94d, 0x74b9ff, 0xff8fc0],
): { root: Group; update(elapsedSeconds: number): void } {
  const random = seededRandom(seed);
  // Ground homes shared out between the kinds: caterpillars, beetles, then the four critters
  const groups: Home[][] = Array.from({ length: 6 }, () => []);
  for (const home of homes.ground) groups[Math.floor(random() * groups.length)]?.push(home);
  const [caterpillarHomes = [], beetleHomes = [], ...critterHomes] = groups;
  // (bugs drawn larger than life, so they can be seen from the field)
  const big = (list: readonly Home[]): Home[] => list.map((h) => ({ ...h, scale: h.scale * 1.7 }));
  const caterpillars = big(caterpillarHomes);
  const beetles = big(beetleHomes);
  const waddle = "transformed.y += abs(sin(time * 5.0 + wanderSeed() * 20.0)) * 3.0;";
  const kinds = [
    // Inching: a ripple runs from tail to head
    walkers(caterpillar(), caterpillars, 0.05, 140, "transformed.y += max(0.0, sin(time * 4.0 - position.z * 0.07 + wanderSeed() * 6.28)) * 7.0;"),
    walkers(beetle(), beetles, 0.09, 160, "transformed.y += abs(sin(time * 9.0 + wanderSeed() * 20.0)) * 1.5;"),
    ...[sprout(), ember(), ripple(), puff()].map((geometry, i) => walkers(geometry, critterHomes[i] ?? [], 0.06, 180, waddle)),
  ];
  const root = new Group();
  const names = ["caterpillar", "beetle", "sprout", "ember", "ripple", "puff"];
  kinds.forEach((kind, i) => {
    kind.mesh.name = `wildlife: ${names[i] ?? ""}`;
    root.add(kind.mesh);
  });

  // Butterflies: loops over their patch of grass, bobbing up and down, wings beating
  const palette = butterflyColors.map((c) => new Color(c));
  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const flutter = /* glsl */ `
    float beat = sin(time * 11.0 + wanderSeed() * 40.0) * 0.8 + 0.35;
    if (abs(position.x) > 1.0) {
      float span = abs(transformed.x);
      transformed.y += span * sin(beat);
      transformed.x = sign(transformed.x) * span * cos(beat);
    }`;
  const uniforms = animate(
    material,
    /* glsl */ `
      vec3 w = wander(0.45, 260.0);
      ${flutter}
      transformed.xz = turn(transformed.xz, w.z) + w.xy;
      transformed.y += 40.0 * sin(time * 1.3 + wanderSeed() * 12.0);`,
    WANDER,
    {},
    "objectNormal.xz = turn(objectNormal.xz, wander(0.45, 260.0).z);",
  );
  const butterflies = instances(
    butterfly(),
    material,
    homes.air.map((h) => ({
      position: [h.x, h.y, h.z],
      scale: [h.scale, h.scale, h.scale],
      tint: palette[Math.floor(random() * palette.length)] ?? new Color(0xffffff),
    })),
  );
  butterflies.name = "wildlife: butterfly";
  root.add(butterflies);

  const clocks = [uniforms.time, ...kinds.map((k) => k.time)];
  return {
    root,
    update(elapsedSeconds) {
      for (const clock of clocks) clock.value = elapsedSeconds;
    },
  };
}
