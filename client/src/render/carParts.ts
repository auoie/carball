// The car models' shared parts (src/render/carModel.ts's Sport, src/render/carBodies.ts's other garage cars): their
// materials (the game's default Glossy paint, rubber trim, glass, the lights' clipped colours, tyres and rims), the
// wheels, and the profile tools they're built with (a side profile extruded across, warped in plan; panes along it).
// Local frame (Three.js): x forward, y up, z right; the origin is the car's (the physics body's).
import {
  BufferGeometry,
  type Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  type Group,
  LinearSRGBColorSpace,
  type Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Shape,
} from "three";
import type { CarConfig } from "../engine/world";

export type Point = readonly [x: number, y: number];

/** A wheel: its centre (x, height above the ground, z), radius and width (uu) */
export interface WheelSpec {
  readonly x: number;
  readonly h: number;
  readonly z: number;
  readonly radius: number;
  readonly width: number;
}

/** A car's proportions in FENNEC's field set (uu; the car's frame, heights above the ground under it at rest) */
export interface CarSpec {
  readonly front: number;
  readonly rear: number;
  readonly ground: number;
  readonly halfWidth: number;
  readonly halfWidthBelt: number;
  readonly halfWidthRoof: number;
  readonly halfWidthNose: number;
  readonly halfWidthTail: number;
  readonly clearance: number;
  readonly noseTop: number;
  readonly hood: number;
  readonly belt: number;
  readonly roof: number;
  readonly windscreenBase: number;
  readonly windscreenDeg: number;
  readonly roofFront: number;
  readonly roofBack: number;
  readonly rearWindowBase: readonly [number, number];
  readonly bumperTop: number;
  readonly frontWheel: WheelSpec;
  readonly backWheel: WheelSpec;
}

/** A hitbox as measured on (the game frame's size, its offset's x and z) */
export interface Hitbox {
  readonly size: { readonly x: number; readonly y: number; readonly z: number };
  readonly offset: { readonly x: number; readonly z: number };
}

/** The presets' hitboxes the cars were measured on (engine CarConfig.cpp): Standard (the Octane's, the Fennec's), Flat,
 *  Tall */
export const HITBOXES = {
  standard: { size: { x: 120.507, y: 86.6994, z: 38.6591 }, offset: { x: 13.8757, z: 20.755 } },
  flat: { size: { x: 130.4268, y: 85.78, z: 33.8 }, offset: { x: 9.0, z: 15.75 } },
  tall: { size: { x: 123.2202, y: 79.2103, z: 44.1591 }, offset: { x: 11.37566, z: 21.504988 } },
} as const satisfies Record<string, Hitbox>;
export interface BodyFrame {
  readonly x: (v: number) => number;
  readonly y: (h: number) => number;
  readonly z: (v: number) => number;
}

/** A car's proportions (measured on hitbox `H`, the ground `ground` from the car's origin) set on a car's hitbox: its x,
 *  its heights (above the ground) as y, its widths as z, scaled by the hitbox over `H` (as measured on its own) */
export function bodyFrame(ground: number, H: Hitbox, config: CarConfig): BodyFrame {
  const { hitboxSize: s, hitboxOffset: o } = config;
  const sx = s.x / H.size.x;
  const sy = s.z / H.size.z;
  const sz = s.y / H.size.y;
  return {
    x: (v) => o.x + (v - H.offset.x) * sx,
    y: (h) => o.z - s.z / 2 + (ground + h - (H.offset.z - H.size.z / 2)) * sy,
    z: (v) => v * sz,
  };
}

/** The extruded profiles' rounded edges (uu) */
export const BEVEL = 2.5;

/** The lights' emissive colours (linear), as the game's appear on screen: the painted Fennec's bake shows its tail
 *  lights sRGB (255, 26, 0), linear (1, 0.0103, 0) (RV-23), and its headlights clipped white */
export const HEADLIGHT = [1, 1, 1] as const;
export const TAILLIGHT = [1, 0.0103, 0] as const;

export interface CarMaterials {
  readonly body: MeshPhysicalMaterial;
  readonly trim: MeshStandardMaterial;
  readonly glass: MeshStandardMaterial;
  readonly headlight: MeshStandardMaterial;
  readonly taillight: MeshStandardMaterial;
  readonly tyre: MeshStandardMaterial;
  readonly rim: MeshStandardMaterial;
}

/** A car's materials, named (the merged meshes are named after them) */
export function carMaterials(paint: Color): CarMaterials {
  // The game's default Glossy finish (notes/car-paint.md PNT-6/10): the paint area takes the team colour itself, shaded
  // 0.734; Lambert with a tight highlight and a clear coat. Rubber trim: 0.75 x TrimColor 0.12 facing
  const body = new MeshPhysicalMaterial({
    name: "body",
    color: paint.clone().multiplyScalar(0.734),
    roughness: 0.3,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  const trim = new MeshStandardMaterial({ name: "trim", roughness: 0.75, metalness: 0 });
  trim.color.setRGB(0.09, 0.09, 0.09, LinearSRGBColorSpace);
  const glass = new MeshStandardMaterial({ name: "glass", color: 0x0b1018, roughness: 0.08, metalness: 0.8, side: DoubleSide });
  // The lights as the game's show (MAT_Chassis_Grain squares its light term and blends it in by the same, so its
  // HeadlightColor and TailLightColor come out clipped: PNT-12, RV-15): headlights a near-white core, tail lights deep red
  const lights = (name: string, [r, g, b]: readonly [number, number, number]): MeshStandardMaterial => {
    const m = new MeshStandardMaterial({ name, color: 0x000000 });
    m.emissive.setRGB(r, g, b, LinearSRGBColorSpace);
    return m;
  };
  const headlight = lights("headlight", HEADLIGHT);
  const taillight = lights("taillight", TAILLIGHT);
  const tyre = new MeshStandardMaterial({ name: "tyre", color: 0x111214, roughness: 0.9 });
  const rim = new MeshStandardMaterial({ name: "rim", color: 0xb8bec8, roughness: 0.3, metalness: 0.8 });
  return { body, trim, glass, headlight, taillight, tyre, rim };
}

/** The wheels placed (the car's frame): tyre and rim each side, the axle along the car's right axis (Three z) */
export function addWheels(group: Group, wheels: readonly { readonly x: number; readonly y: number; readonly z: number; readonly radius: number; readonly width: number }[], tyre: Material, rim: Material): void {
  for (const wheel of wheels) {
    for (const side of [-1, 1]) {
      for (const [radius, width, material] of [
        [wheel.radius, wheel.width, tyre],
        [wheel.radius * 0.6, wheel.width + 0.6, rim],
      ] as const) {
        const mesh = new Mesh(new CylinderGeometry(radius, radius, width, 20), material);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(wheel.x, wheel.y, side * wheel.z);
        group.add(mesh);
      }
    }
  }
}

/** An outline with points added along its edges, none longer than `step` */
export function densify(points: readonly Point[], step: number): Point[] {
  const out: Point[] = [];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] ?? p;
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step));
    for (let k = 0; k < n; k++) out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  });
  return out;
}

/** A mesh's geometry with each vertex's z taken from `z(x, y, z)` (its own frame): the plan's taper, the tumblehome */
export function warp(mesh: Mesh, z: (x: number, y: number, z: number) => number): Mesh {
  const position = mesh.geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) position.setZ(i, z(position.getX(i), position.getY(i), position.getZ(i)));
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return mesh;
}

/** x on the profile edge a→b at height y. */
export function xAt([a, b]: readonly [Point, Point], y: number): number {
  return a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
}

/** A side profile (x forward, y up) extruded symmetrically to ±halfWidth, edges rounded inside the outline. */
export function extrudeAcross(shape: Shape, halfWidth: number, material: Material, bevel = BEVEL): Mesh {
  const geometry = new ExtrudeGeometry(shape, {
    depth: 2 * (halfWidth - bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geometry.translate(0, 0, -(halfWidth - bevel));
  return new Mesh(geometry, material);
}

/** A pane over the profile edge a→b (a in front of b, over the top), inset 2 uu from its ends, across ±halfA at a and
 *  ±halfB at b (narrowing with the cabin). */
export function paneAlong([a, b]: readonly [Point, Point], halfA: number, halfB: number, material: Material): Mesh {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const t = 2 / len;
  // Outward normal (forward-up on the windscreen, back-up on the hatch), lifted 0.4 uu off the body
  const nx = (dy / len) * 0.4;
  const ny = (-dx / len) * 0.4;
  const [ax, ay] = [a[0] + dx * t + nx, a[1] + dy * t + ny];
  const [bx, by] = [b[0] - dx * t + nx, b[1] - dy * t + ny];
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([ax, ay, -halfA, ax, ay, halfA, bx, by, halfB, bx, by, -halfB], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return new Mesh(geometry, material);
}
