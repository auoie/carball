// A boxy hatchback in the style of the game's Fennec (which uses the Octane hitbox), built around the physics
// hitbox: its nose, roof and sides are the hitbox's; the tail reaches a little past it to cover the rear wheels, as
// the Fennec's does. Angular wheel arches with black flares, black lower cladding and a side vent, a roof spoiler.
// Our own low-poly model, generated from the car's dimensions, so other hitboxes get a matching body too. (On the dev
// server with the game's own Fennec exported locally, cars of its hitbox wear that instead: src/render/fennec.ts.)
// Local frame (Three.js): x forward, y up, z right; the origin is the car's centre of mass.
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
import type { CarConfig, WheelConfig } from "../engine/world";
import { mergeByMaterial } from "./merge";

/** Suspension travel: at rest the wheels sit about this far above full extension. */
const SUSPENSION_TRAVEL = 12;
const TYRE_WIDTH = 14;
const BEVEL = 2.5;
/** The tail past the hitbox's back (uu): the Fennec's body covers its rear wheels, which stick out of the hitbox */
export const TAIL_PAST_HITBOX = 10;
/** The wheel arches: half width past the tyre, height over it, and the black flares round them (uu) */
const ARCH_PAST_TYRE = 3;
const ARCH_OVER_TYRE = 4;
const FLARE = 3;

type Point = readonly [x: number, y: number];

/** The lights' emissive colours (linear), as the game's appear on screen: the painted Fennec's bake shows its tail
 *  lights (255, 26, 0) and its headlights clipped white */
export const HEADLIGHT = [1, 1, 1] as const;
export const TAILLIGHT = [1, 0.1, 0] as const;

/** Where a wheel is drawn at rest (Three.js local frame, the right-hand wheel). */
function wheelRestPosition(wheel: WheelConfig, halfWidth: number): { x: number; y: number; z: number } {
  return {
    x: wheel.offset.x,
    y: wheel.offset.z - (wheel.suspensionRest - SUSPENSION_TRAVEL),
    // Tyres flush with the body's sides (the physics casts its wheel rays from the configured offset, a few uu away)
    z: halfWidth - 1 - TYRE_WIDTH / 2,
  };
}

/** The model as one mesh per material (seven draw calls), named after the material: body, trim, glass, headlight,
 *  taillight, tyre, rim; or the game's Fennec where it is loaded (src/render/fennec.ts). */
export function buildCarModel(config: CarConfig, paint: Color, team = 0): Group {
  const fennec = fennecModel(config, paint, team);
  if (fennec) return fennec;
  const { hitboxSize: size, hitboxOffset: offset } = config;
  const length = size.x;
  const halfWidth = size.y / 2;
  const front = offset.x + length / 2;
  const rear = offset.x - length / 2 - TAIL_PAST_HITBOX;
  const top = offset.z + size.z / 2;
  const hitboxBottom = offset.z - size.z / 2;

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

  const wheels = [
    { ...wheelRestPosition(config.backWheel, halfWidth), radius: config.backWheel.radius },
    { ...wheelRestPosition(config.frontWheel, halfWidth), radius: config.frontWheel.radius },
  ] as const;
  const [backWheel, frontWheel] = wheels;
  const archHalfWidth = (wheel: { readonly radius: number }): number => wheel.radius + ARCH_PAST_TYRE;

  const bottom = Math.min(hitboxBottom, Math.min(frontWheel.y, backWheel.y) - 3); // sills below the axles
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
  const nose = Math.max(hitboxBottom + 0.48 * size.z, archTop(frontWheel) + 2); // top of the front face
  const belt = Math.max(hitboxBottom + 0.53 * size.z, archTop(frontWheel), archTop(backWheel)); // where the windows start
  const cowl = front - 0.3 * length; // base of the windscreen
  const roofFront = front - 0.5 * length;
  const roofBack = rear + 0.07 * length;
  const cabinHalfWidth = halfWidth - 5;
  const windscreen: [Point, Point] = [[cowl, belt - 1], [roofFront, top]];
  const hatch: [Point, Point] = [[roofBack, top], [rear + 1, belt + 3]];

  const group = new Group();
  const box = (material: Material, sx: number, sy: number, sz: number, x: number, y: number, z: number): void => {
    const mesh = new Mesh(new BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
  };

  // Lower body: side profile with the wheel arches cut out, extruded across the car's width. An arch reaching past
  // the tail opens through the rear face.
  const lower = new Shape();
  let tailBottom = bottom + 4; // where the rear face ends
  let started = false;
  for (const wheel of wheels) {
    const outline = archOutline(wheel, 0).filter(([x]) => x > rear + 1);
    const [firstX = rear + 1, firstY = bottom] = outline[0] ?? [];
    if (!started) {
      if (outline.length < 6) tailBottom = firstY; // (cut by the tail: the rear face ends where the arch meets it)
      lower.moveTo(outline.length < 6 ? rear + 1 : rear + 2, outline.length < 6 ? firstY : bottom);
      started = true;
    }
    if (outline.length === 6) lower.lineTo(firstX, firstY);
    for (const [x, y] of outline) lower.lineTo(x, y);
  }
  lower.lineTo(front - 2, bottom);
  lower.lineTo(front, bottom + 4);
  lower.lineTo(front, nose - 2);
  lower.lineTo(front - 3, nose);
  lower.lineTo(cowl, belt);
  lower.lineTo(rear + 1, belt);
  lower.lineTo(rear, belt - 3);
  lower.lineTo(rear, tailBottom);
  lower.closePath();
  group.add(extrudeAcross(lower, halfWidth - 1, body));

  // Cabin: raked windscreen, flat roof to the back, near-vertical hatch; narrower than the lower body
  const cabin = new Shape();
  cabin.moveTo(...windscreen[0]);
  cabin.lineTo(...windscreen[1]);
  cabin.lineTo(...hatch[0]);
  cabin.lineTo(...hatch[1]);
  cabin.lineTo(rear + 1, belt - 1);
  cabin.closePath();
  group.add(extrudeAcross(cabin, cabinHalfWidth, body));

  // Glass: side windows inside the pillars (split by a B-pillar), windscreen and rear window
  const low = belt + 1.5;
  const high = top - 3;
  const sideWindow = [
    new Vector2(xAt(windscreen, low) - 3.5, low),
    new Vector2(xAt(windscreen, high) - 3.5, high),
    new Vector2(xAt(hatch, high) + 3, high),
    new Vector2(Math.max(xAt(hatch, low), rear + 1) + 3, low),
  ];
  const pillarX = rear + 0.38 * length;
  for (const side of [-1, 1]) {
    const window = new Mesh(new ShapeGeometry(new Shape(sideWindow)), glass);
    window.position.z = side * (cabinHalfWidth + 0.3);
    group.add(window);
    box(body, 3.5, high - low + 1, 0.8, pillarX, (high + low) / 2, side * (cabinHalfWidth + 0.5));
  }
  group.add(paneAlong(windscreen, cabinHalfWidth - 3, glass), paneAlong(hatch, cabinHalfWidth - 3, glass));

  // Roof spoiler (on the roof, not in it: a face in the roof's plane flickers against it), reaching past the hatch
  box(trim, 9, 1.8, cabinHalfWidth * 2 + 2, roofBack - 1.5, top + 0.9, 0);
  box(trim, 1, 6, halfWidth * 2 - 46, front + 0.1, nose - 6, 0);
  box(trim, 4, 4, halfWidth * 2 - 1, front - 1.5, bottom + 2, 0);
  box(trim, 4, 4, halfWidth * 2 - 1, rear + 1.5, tailBottom + 2, 0);
  // Black cladding along the sills (between the arches' flares), a side vent behind the front wheel, the flares
  const sillStart = backWheel.x + archHalfWidth(backWheel) + FLARE;
  const sillEnd = frontWheel.x - archHalfWidth(frontWheel) - FLARE;
  const ventOutline: Point[] = [
    [sillEnd - 3, bottom + 9],
    [sillEnd - 15, bottom + 9],
    [sillEnd - 8, belt - 10],
    [sillEnd - 1, belt - 10],
  ];
  for (const side of [-1, 1]) {
    box(headlight, 1, 5, 11, front + 0.2, nose - 6, side * (halfWidth - 12));
    box(taillight, 1, 4, 12, rear - 0.2, belt - 5, side * (halfWidth - 10));
    box(trim, sillEnd - sillStart, 7, 1.6, (sillStart + sillEnd) / 2, bottom + 3.5, side * (halfWidth - 0.5));
    // (the left one turned round to face out: built from its x negated, which the turn puts back)
    const vent = new Shape(ventOutline.map(([x, y]) => new Vector2(side * x, y)));
    const ventMesh = new Mesh(new ShapeGeometry(vent), trim);
    ventMesh.position.z = side * (halfWidth - 0.7);
    if (side < 0) ventMesh.rotation.y = Math.PI;
    group.add(ventMesh);
    for (const wheel of wheels) {
      group.add(flare(archOutline(wheel, 0), archOutline(wheel, FLARE), rear + 1, bottom + 6, side * (halfWidth - 1.8), trim));
    }
  }

  // Wheels: tyre and rim, axle along the car's right axis (Three z)
  for (const wheel of wheels) {
    for (const side of [-1, 1]) {
      for (const [radius, width, material] of [
        [wheel.radius, TYRE_WIDTH, tyre],
        [wheel.radius * 0.6, TYRE_WIDTH + 0.6, rim],
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

/** A wheel arch's flare: the band between the arch's outline and the same grown by its width, 3 uu thick at `z` (its
 *  inner face), clipped at the tail and above `foot` (where the sill's cladding starts). */
function flare(inner: readonly Point[], outer: readonly Point[], tail: number, foot: number, z: number, material: Material): Mesh {
  const clip = ([x, y]: Point): Vector2 => new Vector2(Math.max(x, tail), Math.max(y, foot));
  const shape = new Shape([...outer.map(clip), ...[...inner].reverse().map(clip)]);
  const geometry = new ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false });
  geometry.translate(0, 0, z < 0 ? z - 3 : z);
  return new Mesh(geometry, material);
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

/** A pane over the profile edge a→b (a in front of b, over the top), inset 2 uu from its ends, across ±halfWidth. */
function paneAlong([a, b]: readonly [Point, Point], halfWidth: number, material: Material): Mesh {
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
    new Float32BufferAttribute([ax, ay, -halfWidth, ax, ay, halfWidth, bx, by, halfWidth, bx, by, -halfWidth], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return new Mesh(geometry, material);
}
