// A boxy hatchback in the proportions of the game's Fennec (the car the Octane hitbox wears in the game): its length,
// width, heights, wheel placement and glass angles are the Fennec's, measured from the local export as a few scalar
// dimensions (FENNEC below; the user's decision of 2026-10-14: no outlines or vertex lists, the styling our own), set
// on the car's hitbox (other hitboxes get them scaled to theirs). Angular wheel arches flush in the paint (no flares or
// sill cladding: the user's choice), a side vent, a roof spoiler. Our own low-poly model; on the dev server with the
// game's own Fennec exported locally, cars of its hitbox wear that instead (src/render/fennec.ts).
// Local frame (Three.js): x forward, y up, z right; the origin is the car's (the physics body's).
import {
  BoxGeometry,
  BufferGeometry,
  type Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LinearSRGBColorSpace,
  type Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Shape,
  ShapeGeometry,
  Vector2,
} from "three";
import { fennecModel } from "./fennec";
import type { CarConfig } from "../engine/world";
import { mergeByMaterial } from "./merge";

/** The Fennec's proportions (uu, from the local export of the game's body_grain, rounded to 0.1; the Octane car's
 *  frame, heights above the ground under it at rest). The ground and the hitbox they're set on (the Octane preset's) */
export const FENNEC = {
  /** The body's nose and tail (3.9 past the hitbox's front, 16.0 behind its back) */
  front: 78.0,
  rear: -62.4,
  /** The ground at rest, from the car's origin */
  ground: -16.3,
  /** Half its width at the widest (the fenders), at the belt, at the roof, at the nose and at the tail */
  halfWidth: 35.7,
  halfWidthBelt: 32.4,
  halfWidthRoof: 24.4,
  halfWidthNose: 27.6,
  halfWidthTail: 28.5,
  /** Heights: the sills (ground clearance), the nose's top, the hood at the windscreen, the beltline, the roof */
  clearance: 7.0,
  noseTop: 29.7,
  hood: 38.4,
  belt: 35.7,
  roof: 51.6,
  /** The windscreen: its base (x) and its rake from the horizontal (degrees); the roof's front end */
  windscreenBase: 28.9,
  windscreenDeg: 29.5,
  roofFront: 6.0,
  /** The roof's back end (the rear window's top, a spoiler's lip on it) and the rear window's base (x, height): the
   *  window near upright */
  roofBack: -53.0,
  rearWindowBase: [-54.0, 38.6] as const,
  /** The tail's bumper top, under the hatch */
  bumperTop: 22.3,
  /** The wheels (front, back): their centre (x, height above the ground, z), radius and width */
  frontWheel: { x: 48.8, h: 12.8, z: 28.1, radius: 13.0, width: 12.6 },
  backWheel: { x: -36.5, h: 14.2, z: 29.1, radius: 14.0, width: 12.6 },
} as const;
interface WheelSpec {
  readonly x: number;
  readonly h: number;
  readonly z: number;
  readonly radius: number;
  readonly width: number;
}
const OCTANE_HITBOX = { size: { x: 120.507, y: 86.6994, z: 38.6591 }, offset: { x: 13.8757, z: 20.755 } } as const;

const BEVEL = 2.5;
/** The tail past the hitbox's back (uu, the Octane's): the Fennec's covers its rear wheels */
export const TAIL_PAST_HITBOX = OCTANE_HITBOX.offset.x - OCTANE_HITBOX.size.x / 2 - FENNEC.rear;
/** The wheel arches: half width past the tyre, height over it, and the black flares round them (uu) */
const ARCH_PAST_TYRE = 3;
const ARCH_OVER_TYRE = 4;
/** The side vent's gap to the front wheel's arch (uu) */
const VENT_GAP = 3;
/** The plan's taper at the ends: over this far from the nose and the tail (uu) */
const NOSE_TAPER = 30;
const TAIL_TAPER = 14;

type Point = readonly [x: number, y: number];

/** The lights' emissive colours (linear), as the game's appear on screen: the painted Fennec's bake shows its tail
 *  lights sRGB (255, 26, 0), linear (1, 0.0103, 0) (RV-23), and its headlights clipped white */
export const HEADLIGHT = [1, 1, 1] as const;
export const TAILLIGHT = [1, 0.0103, 0] as const;

/** The Fennec's proportions set on a hitbox: its x, its heights (above the ground) as y, its widths as z, scaled by the
 *  hitbox over the Octane's (the Octane's: as measured) */
export function fennecFrame(config: CarConfig): { readonly x: (v: number) => number; readonly y: (h: number) => number; readonly z: (v: number) => number } {
  const { hitboxSize: s, hitboxOffset: o } = config;
  const H = OCTANE_HITBOX;
  const sx = s.x / H.size.x;
  const sy = s.z / H.size.z;
  const sz = s.y / H.size.y;
  return {
    x: (v) => o.x + (v - H.offset.x) * sx,
    y: (h) => o.z - s.z / 2 + (FENNEC.ground + h - (H.offset.z - H.size.z / 2)) * sy,
    z: (v) => v * sz,
  };
}

/** The model as one mesh per material (seven draw calls), named after the material: body, trim, glass, headlight,
 *  taillight, tyre, rim; or the game's Fennec where it is loaded (src/render/fennec.ts). */
export function buildCarModel(config: CarConfig, paint: Color, team = 0): Group {
  const fennec = fennecModel(config, paint, team);
  if (fennec) return fennec;
  const F = FENNEC;
  const { x: X, y: Y, z: Z } = fennecFrame(config);
  const front = X(F.front);
  const rear = X(F.rear);
  const halfWidth = Z(F.halfWidth);
  const bottom = Y(F.clearance);
  const belt = Y(F.belt);
  const roof = Y(F.roof);
  const hood = Y(F.hood);
  const cowl = X(F.windscreenBase);
  const length = front - rear;

  // (the merged meshes are named after their material)
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

  const place = (w: WheelSpec): { x: number; y: number; z: number; radius: number; width: number } => ({
    x: X(w.x),
    y: Y(w.h),
    z: Z(w.z),
    radius: Y(w.radius) - Y(0),
    width: Z(w.width),
  });
  const wheels = [place(F.backWheel), place(F.frontWheel)] as const;
  const frontWheel = wheels[1];
  const archHalfWidth = (wheel: { readonly radius: number }): number => wheel.radius + ARCH_PAST_TYRE;
  const archTop = (wheel: (typeof wheels)[number]): number => wheel.y + wheel.radius + ARCH_OVER_TYRE;
  // An arch's outline (x, y) from its back foot to its front foot: square shoulders, chamfered top corners
  const archOutline = (wheel: (typeof wheels)[number], grow: number): Point[] => {
    const w = archHalfWidth(wheel) + grow;
    const crest = archTop(wheel) + grow;
    const shoulder = wheel.y + 0.2 * wheel.radius;
    return [
      [wheel.x - w, bottom],
      [wheel.x - w, shoulder],
      [wheel.x - 0.55 * w, crest],
      [wheel.x + 0.55 * w, crest],
      [wheel.x + w, shoulder],
      [wheel.x + w, bottom],
    ];
  };

  // The glass lines: the windscreen up from its base at its rake to the roof, the rear window from the roof's back
  // end down to its base
  const slope = (deg: number): number => Math.tan((deg * Math.PI) / 180);
  const roofFront = Math.max(X(F.roofFront), cowl - (roof - hood) / slope(F.windscreenDeg));
  const windscreen: [Point, Point] = [[cowl, hood], [roofFront, roof]];
  const [rwx, rwh] = F.rearWindowBase;
  const rearBase: Point = [X(rwx), Y(rwh)];
  const rearTop: Point = [X(F.roofBack), roof - 1.5];
  const hatch: [Point, Point] = [rearTop, rearBase];

  const group = new Group();
  const box = (material: Material, sx: number, sy: number, sz: number, x: number, y: number, z: number): Mesh => {
    const mesh = new Mesh(new BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  // The plan's taper at the nose and the tail (the body's width there over its widest)
  const noseRatio = F.halfWidthNose / F.halfWidth;
  const tailRatio = F.halfWidthTail / F.halfWidth;
  const taper = (x: number): number => {
    const toNose = (front - x) / (NOSE_TAPER * (length / (F.front - F.rear)));
    const toTail = (x - rear) / (TAIL_TAPER * (length / (F.front - F.rear)));
    if (toNose < 1) return noseRatio + (1 - noseRatio) * Math.max(0, toNose);
    if (toTail < 1) return tailRatio + (1 - tailRatio) * Math.max(0, toTail);
    return 1;
  };
  // The cabin's tumblehome: from its width at the belt to the roof's
  const cabinHalfWidth = Z(F.halfWidthBelt);
  const tumble = (y: number): number => {
    const t = Math.min(1, Math.max(0, (y - belt) / (roof - belt)));
    return 1 + (F.halfWidthRoof / F.halfWidthBelt - 1) * t;
  };

  // Lower body: side profile with the wheel arches cut out, extruded across the car's width, tapered at the ends. The
  // tail: the bumper, then the hatch's lower panel leaning in to the rear window's base
  const tailTop = Y(F.bumperTop);
  const hatchAtBelt = rearBase[0] + ((rear + 1 - rearBase[0]) * (rearBase[1] - belt)) / (rearBase[1] - tailTop);
  const outline: Point[] = [[rear + 2, bottom]];
  for (const wheel of wheels) {
    const arch = archOutline(wheel, 0).filter(([x]) => x > rear + 1);
    const [firstX = rear + 1, firstY = bottom] = arch[0] ?? [];
    if (arch.length === 6) outline.push([firstX, firstY]);
    outline.push(...arch);
  }
  outline.push(
    [front - 2, bottom],
    [front, bottom + 4],
    [front, Y(F.noseTop) - 2],
    [front - 3, Y(F.noseTop) + 1],
    [cowl, hood],
    [cowl - 4, belt],
    [hatchAtBelt, belt],
    [rear + 1, tailTop],
    [rear, tailTop - 2],
    [rear, bottom + 5],
  );
  // (points every few uu along it, so the taper and the hood's narrowing bend the sides smoothly: on the outline's
  // points alone they stretched its faces into fins)
  const lower = new Shape(densify(outline, 4).map(([x, y]) => new Vector2(x, y)));
  // (above the belt, the hood's rise by the windscreen narrowing to the cabin's width: full width, it stood out past
  // the pillars as fins)
  const hoodNarrow = (y: number): number => {
    const t = Math.min(1, Math.max(0, (y - (belt - 2)) / (hood - belt + 2)));
    return 1 + (F.halfWidthBelt / F.halfWidth - 1) * t;
  };
  group.add(warp(extrudeAcross(lower, halfWidth, body), (x, y, z) => z * taper(x) * hoodNarrow(y)));

  // Cabin: raked windscreen, the roof, the rear window leaning back under the spoiler; narrowing to the roof
  const cabin = new Shape();
  cabin.moveTo(cowl - 4, belt);
  cabin.lineTo(...windscreen[0]);
  cabin.lineTo(...windscreen[1]);
  cabin.lineTo(rearTop[0] + 1.5, roof);
  cabin.lineTo(...rearTop);
  cabin.lineTo(...rearBase);
  cabin.lineTo(hatchAtBelt, belt);
  cabin.closePath();
  group.add(warp(extrudeAcross(cabin, cabinHalfWidth, body), (_x, y, z) => z * tumble(y)));

  // Glass: side windows inside the pillars (split by a B-pillar), leaning in with the cabin; windscreen and rear window
  const low = belt + 1.5;
  const high = roof - 3;
  const sideWindow = [
    new Vector2(xAt(windscreen, low) - 3.5, low),
    new Vector2(xAt(windscreen, high) - 3.5, high),
    new Vector2(xAt(hatch, high) + 3, high),
    new Vector2(xAt(hatch, low) + 3, low),
  ];
  const pillarX = rear + 0.38 * length;
  for (const side of [-1, 1]) {
    const window = warp(new Mesh(new ShapeGeometry(new Shape(sideWindow)), glass), (_x, y) => side * ((cabinHalfWidth + 0.3) * tumble(y)));
    group.add(window);
    const pillarY = (high + low) / 2;
    box(body, 3.5, high - low + 1, 0.8, pillarX, pillarY, side * (cabinHalfWidth * tumble(pillarY) + 0.5));
  }
  group.add(
    paneAlong(windscreen, (cabinHalfWidth - 3) * tumble(windscreen[0][1]), (cabinHalfWidth - 3) * tumble(windscreen[1][1]), glass),
    paneAlong(hatch, (cabinHalfWidth - 3) * tumble(hatch[0][1]), (cabinHalfWidth - 3) * tumble(hatch[1][1]), glass),
  );

  // The roof spoiler: a lip at the roof's back end, a little past the rear window (on the roof, not in it: a face in the
  // roof's plane flickers against it)
  const lip = 0.06 * length;
  box(body, lip, 1.8, 2 * cabinHalfWidth * tumble(roof) + 2, rearTop[0] + 1.5 - lip / 2 + 2, roof + 0.9, 0);
  // The grille, the bumpers' black lips
  const noseHalf = halfWidth * noseRatio;
  const tailHalf = halfWidth * tailRatio;
  box(trim, 1, 6, 2 * noseHalf - 22, front + 0.1, Y(F.noseTop) - 7, 0);
  box(trim, 4, 4, 2 * noseHalf - 1, front - 1.5, bottom + 2, 0);
  box(trim, 4, 4, 2 * tailHalf - 1, rear + 1.5, bottom + 7, 0);
  // A side vent behind the front wheel
  const sillEnd = frontWheel.x - archHalfWidth(frontWheel) - VENT_GAP;
  const ventOutline: Point[] = [
    [sillEnd - 3, bottom + 9],
    [sillEnd - 15, bottom + 9],
    [sillEnd - 8, belt - 10],
    [sillEnd - 1, belt - 10],
  ];
  for (const side of [-1, 1]) {
    box(headlight, 1, 5, 11, front + 0.2, Y(F.noseTop) - 6, side * (noseHalf - 7));
    box(taillight, 1, 4, 12, rear - 0.2, tailTop - 4, side * (tailHalf - 8));
    // (the left one turned round to face out: built from its x negated, which the turn puts back)
    const vent = new Shape(ventOutline.map(([x, y]) => new Vector2(side * x, y)));
    const ventMesh = new Mesh(new ShapeGeometry(vent), trim);
    ventMesh.position.z = side * (halfWidth + 0.3);
    if (side < 0) ventMesh.rotation.y = Math.PI;
    group.add(ventMesh);
  }

  // Wheels: tyre and rim, axle along the car's right axis (Three z)
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
  return mergeByMaterial(group);
}

/** An outline with points added along its edges, none longer than `step` */
function densify(points: readonly Point[], step: number): Point[] {
  const out: Point[] = [];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] ?? p;
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step));
    for (let k = 0; k < n; k++) out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  });
  return out;
}

/** A mesh's geometry with each vertex's z taken from `z(x, y, z)` (its own frame): the plan's taper, the tumblehome */
function warp(mesh: Mesh, z: (x: number, y: number, z: number) => number): Mesh {
  const position = mesh.geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) position.setZ(i, z(position.getX(i), position.getY(i), position.getZ(i)));
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return mesh;
}

/** x on the profile edge a→b at height y. */
function xAt([a, b]: readonly [Point, Point], y: number): number {
  return a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
}

/** A side profile (x forward, y up) extruded symmetrically to ±halfWidth, edges rounded inside the outline. */
function extrudeAcross(shape: Shape, halfWidth: number, material: Material): Mesh {
  const geometry = new ExtrudeGeometry(shape, {
    depth: 2 * (halfWidth - BEVEL),
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelOffset: -BEVEL,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geometry.translate(0, 0, -(halfWidth - BEVEL));
  return new Mesh(geometry, material);
}

/** A pane over the profile edge a→b (a in front of b, over the top), inset 2 uu from its ends, across ±halfA at a and
 *  ±halfB at b (narrowing with the cabin). */
function paneAlong([a, b]: readonly [Point, Point], halfA: number, halfB: number, material: Material): Mesh {
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
