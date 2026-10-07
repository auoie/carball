// A boxy hatchback in the style of the game's Fennec (which uses the Octane hitbox), built around the physics
// hitbox: its nose, tail, roof and sides are the hitbox's, so what you see is what collides. Our own low-poly model,
// generated from the car's dimensions, so other hitboxes get a matching body too.
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
  type Material,
  Mesh,
  MeshStandardMaterial,
  Shape,
  ShapeGeometry,
  Vector2,
} from "three";
import type { CarConfig, WheelConfig } from "../engine/world";
import { mergeByMaterial } from "./merge";

/** Suspension travel: at rest the wheels sit about this far above full extension. */
const SUSPENSION_TRAVEL = 12;
const TYRE_WIDTH = 14;
const BEVEL = 2.5;

type Point = readonly [x: number, y: number];

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
 *  taillight, tyre, rim. */
export function buildCarModel(config: CarConfig, paint: Color): Group {
  const { hitboxSize: size, hitboxOffset: offset } = config;
  const length = size.x;
  const halfWidth = size.y / 2;
  const front = offset.x + length / 2;
  const rear = offset.x - length / 2;
  const top = offset.z + size.z / 2;
  const hitboxBottom = offset.z - size.z / 2;

  // (the merged meshes are named after their material)
  const body = new MeshStandardMaterial({ name: "body", color: paint, roughness: 0.35, metalness: 0.35 });
  const trim = new MeshStandardMaterial({ name: "trim", color: 0x17191e, roughness: 0.7, metalness: 0.2 });
  const glass = new MeshStandardMaterial({ name: "glass", color: 0x0b1018, roughness: 0.08, metalness: 0.8, side: DoubleSide });
  const headlight = new MeshStandardMaterial({ name: "headlight", color: 0xfff4d6, emissive: 0xfff0c0, emissiveIntensity: 0.9 });
  const taillight = new MeshStandardMaterial({ name: "taillight", color: 0xff2a2a, emissive: 0xc01010, emissiveIntensity: 0.8 });
  const tyre = new MeshStandardMaterial({ name: "tyre", color: 0x111214, roughness: 0.9 });
  const rim = new MeshStandardMaterial({ name: "rim", color: 0xb8bec8, roughness: 0.3, metalness: 0.8 });

  const wheels = [
    { ...wheelRestPosition(config.backWheel, halfWidth), radius: config.backWheel.radius },
    { ...wheelRestPosition(config.frontWheel, halfWidth), radius: config.frontWheel.radius },
  ] as const;
  const [backWheel, frontWheel] = wheels;
  const archRadius = (wheel: { readonly radius: number }): number => wheel.radius + 3.5;

  const bottom = Math.min(hitboxBottom, Math.min(frontWheel.y, backWheel.y) - 3); // sills below the axles
  const archTop = (wheel: (typeof wheels)[number]): number => wheel.y + archRadius(wheel) + 2;
  const nose = Math.max(hitboxBottom + 0.4 * size.z, archTop(frontWheel)); // top of the front face
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
  // the tail (the rear tyres stick out behind some hitboxes) opens through the rear face.
  const lower = new Shape();
  let tailBottom = bottom + 4; // where the rear face ends
  for (const wheel of wheels) {
    const radius = archRadius(wheel);
    const above = bottom - wheel.y;
    const half = Math.sqrt(Math.max(0, radius * radius - above * above));
    const throughTail = wheel.x - half < rear + 3; // (no room for the tail's bottom corner)
    const startX = throughTail ? rear + 1 : wheel.x - half;
    const startY = throughTail ? wheel.y + Math.sqrt(Math.max(0, radius ** 2 - (startX - wheel.x) ** 2)) : bottom;
    if (wheel === backWheel) {
      if (throughTail) tailBottom = startY;
      lower.moveTo(throughTail ? startX : rear + 2, startY);
    }
    if (wheel !== backWheel || !throughTail) lower.lineTo(startX, startY);
    lower.absarc(wheel.x, wheel.y, radius, Math.atan2(startY - wheel.y, startX - wheel.x), Math.atan2(above, half), true);
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

  // Roof spoiler, grille, lights, bumpers, sills
  box(trim, 6, 1.6, cabinHalfWidth * 2 + 1, roofBack + 1, top - 0.8, 0);
  box(trim, 1, 6, halfWidth * 2 - 46, front + 0.1, nose - 6, 0);
  box(trim, 4, 4, halfWidth * 2 - 1, front - 1.5, bottom + 2, 0);
  box(trim, 4, 4, halfWidth * 2 - 1, rear + 1.5, tailBottom + 2, 0);
  const sillStart = backWheel.x + archRadius(backWheel);
  const sillEnd = frontWheel.x - archRadius(frontWheel);
  for (const side of [-1, 1]) {
    box(headlight, 1, 5, 11, front + 0.2, nose - 6, side * (halfWidth - 12));
    box(taillight, 1, 4, 12, rear - 0.2, belt - 5, side * (halfWidth - 10));
    box(trim, sillEnd - sillStart, 3, 1, (sillStart + sillEnd) / 2, bottom + 1.5, side * (halfWidth - 0.6));
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
