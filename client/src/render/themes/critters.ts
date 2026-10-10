// Round little creatures of four (original) kinds: a sprout, an ember, a ripple and a puff. Each is built facing +z,
// standing on y = 0, about 110 uu tall (also used by the forest's wildlife). And the meadow's crowd of them, sitting in
// the stands, breathing gently (just enough to look alive without drawing the eye from the play). One draw call per
// kind.
import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  type InstancedMesh,
  MeshLambertMaterial,
  SphereGeometry,
} from "three";
import type { Seat } from "./stands";
import { type Placement, animate, combine, instances, part } from "./shapes";
import { seededRandom } from "./random";

const EYE = 0x1d1d26;
const SHINE = 0xffffff;

/** Body, feet, eyes with a shine: common to every kind. */
function body(color: number): BufferGeometry[] {
  // (low-poly where it doesn't show: there are well over a thousand of them)
  const parts: BufferGeometry[] = [part(new SphereGeometry(50, 12, 8), color, { position: [0, 50, 0], scale: [1, 0.92, 0.95] })];
  for (const s of [-1, 1]) {
    parts.push(part(new SphereGeometry(16, 6, 4), color, { position: [s * 22, 8, 16], scale: [1, 0.55, 1.2] }));
    parts.push(part(new SphereGeometry(9, 6, 5), EYE, { position: [s * 17, 62, 42], scale: [0.85, 1.15, 0.7] }));
    parts.push(part(new SphereGeometry(3, 4, 3), SHINE, { position: [s * 15, 66, 48] }));
  }
  return parts;
}

export function sprout(): BufferGeometry {
  return combine([
    ...body(0x9be0a0),
    part(new CylinderGeometry(3, 4, 26, 5), 0x6b8f3a, { position: [0, 104, -4] }),
    part(new SphereGeometry(10, 6, 4), 0x3fa046, { position: [-13, 118, -4], rotation: [0, 0, 0.5], scale: [1.9, 0.45, 1] }),
    part(new SphereGeometry(10, 6, 4), 0x4cb552, { position: [13, 120, -4], rotation: [0, 0, -0.5], scale: [1.9, 0.45, 1] }),
  ]);
}

export function ember(): BufferGeometry {
  return combine([
    ...body(0xff8f52),
    part(new ConeGeometry(22, 48, 7), 0xffc43d, { position: [0, 112, -6] }),
    part(new ConeGeometry(13, 34, 6), 0xff5a2e, { position: [9, 122, 0], rotation: [0, 0, -0.3] }),
    part(new ConeGeometry(11, 26, 6), 0xff8f52, { position: [-31, 88, 0], rotation: [0, 0, 0.45] }),
    part(new ConeGeometry(11, 26, 6), 0xff8f52, { position: [31, 88, 0], rotation: [0, 0, -0.45] }),
  ]);
}

export function ripple(): BufferGeometry {
  return combine([
    ...body(0x6cbcff),
    part(new SphereGeometry(32, 8, 6), 0xe9f6ff, { position: [0, 40, 30], scale: [1, 1, 0.45] }),
    part(new ConeGeometry(16, 36, 6), 0x4a9be8, { position: [-46, 68, -4], rotation: [0, 0, 1.15], scale: [1, 1, 0.35] }),
    part(new ConeGeometry(16, 36, 6), 0x4a9be8, { position: [46, 68, -4], rotation: [0, 0, -1.15], scale: [1, 1, 0.35] }),
  ]);
}

export function puff(): BufferGeometry {
  const ears = [-1, 1].flatMap((s) => [
    part(new SphereGeometry(16, 6, 5), 0xd9b8ff, { position: [s * 30, 94, -6] }),
    part(new SphereGeometry(9, 6, 4), 0xffb3d6, { position: [s * 31, 95, 6], scale: [1, 1, 0.5] }),
    part(new SphereGeometry(8, 6, 4), 0xff9ac6, { position: [s * 30, 50, 42], scale: [1, 0.6, 0.4] }),
  ]);
  return combine([...body(0xd9b8ff), ...ears]);
}

/** The crowd on `seats`, and its animation: call `update` with the time. */
export function buildCrowd(seats: readonly Seat[], seed: number): { root: Group; update(elapsedSeconds: number): void } {
  const random = seededRandom(seed);
  const kinds = [sprout(), ember(), ripple(), puff()];
  const names = ["sprout", "ember", "ripple", "puff"];
  const byKind: (Placement & { tint: Color })[][] = kinds.map(() => []);
  for (const seat of seats) {
    const s = 0.95 + random() * 0.3;
    byKind[Math.floor(random() * kinds.length)]?.push({
      position: [seat.x, seat.y, seat.z],
      rotation: [0, seat.facing + (random() - 0.5) * 0.5, 0],
      scale: [s, s, s],
      tint: new Color().setScalar(0.9 + random() * 0.15),
    });
  }
  const material = new MeshLambertMaterial({ vertexColors: true });
  const uniforms = animate(
    material,
    /* glsl */ `
      // Each one breathes slowly at its own pace: a slight stretch up from its feet, no movement across the screen
      vec3 seat = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float own = fract(sin(dot(seat.xz, vec2(12.9898, 78.233))) * 43758.5453);
      float breath = sin(time * (1.1 + 0.4 * own) + own * 6.2832);
      transformed.y *= 1.0 + 0.025 * breath;
      transformed.xz *= 1.0 - 0.012 * breath;`,
    "",
    {},
  );
  const root = new Group();
  kinds.forEach((geometry, i) => {
    const mesh: InstancedMesh = instances(geometry, material, byKind[i] ?? []);
    mesh.name = `crowd: ${names[i] ?? ""}`;
    root.add(mesh);
  });
  return {
    root,
    update(elapsedSeconds) {
      uniforms.time.value = elapsedSeconds;
    },
  };
}
