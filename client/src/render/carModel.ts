// A boxy hatchback in the proportions of the game's Fennec (the car the Octane hitbox wears in the game): its length,
// width, heights, wheel placement and glass angles are the Fennec's, measured from the local export as a few scalar
// dimensions (FENNEC below; the user's decision of 2026-10-14: no outlines or vertex lists, the styling our own), set
// on the car's hitbox (other hitboxes get them scaled to theirs). Angular wheel arches flush in the paint (no flares or
// sill cladding: the user's choice), a side vent, a roof spoiler. Our own low-poly model; on the dev server with the
// game's own Fennec exported locally, cars of its hitbox wear that instead (src/render/fennec.ts).
// Local frame (Three.js): x forward, y up, z right; the origin is the car's (the physics body's).
import { BoxGeometry, type Color, Group, type Material, Mesh, type Object3D, Raycaster, Shape, ShapeGeometry, Vector2, Vector3 } from "three";
import { fennecModel } from "./fennec";
import { glbCarModel } from "./carGlb";
import type { CarConfig } from "../engine/world";
import { mergeByMaterial } from "./merge";
import { type BodyFrame, type CarSpec, HITBOXES, type Point, type WheelSpec, addWheels, bodyFrame, carMaterials, densify, extrudeAcross, paneAlong, warp, xAt } from "./carParts";
import { buildCarBody, carBody } from "./carBodies";

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
  /** Heights: the sills (ground clearance), the nose's top, the hood at the windscreen (37.0 on the centreline: the
   *  static session's CM1 re-measure, notes/hitboxes.md), the beltline, the roof */
  clearance: 7.0,
  noseTop: 29.7,
  hood: 37.0,
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
} as const satisfies CarSpec;

const OCTANE_HITBOX = HITBOXES.standard;

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


/** The Fennec's proportions set on a hitbox (measured on the Octane's) */
export function fennecFrame(config: CarConfig): BodyFrame {
  return bodyFrame(FENNEC.ground, OCTANE_HITBOX, config);
}

/** Where a drawn body's boost trail and idle exhaust come out (RV-470: the Fennec's sockets, at x -57, sit inside some
 *  of these bodies): `behind` uu behind the body's back where it meets the line along the car at the Fennec's sockets'
 *  height over the ground (29.16 uu: 12.86 over the car's origin, its ground 16.3 under that) and their spread (20.43
 *  each side), set on the car's hitbox as its body is */
export const BODY_EXHAUST = { behind: 1, height: 29.16, spread: 20.43 } as const;

/** A car's exhausts on its `model` (buildCarModel's, not yet posed), in its frame (x forward, y up, z right): left, then
 *  right. The body's back found along each line (its glass left out) */
export function carExhausts(model: Object3D, config: CarConfig, car = 0): readonly [Vector3, Vector3] {
  const look = carBody(car);
  const { x: X, y: Y, z: Z } = look ? bodyFrame(look.spec.ground, look.hitbox, config) : fennecFrame(config);
  const rear = X((look?.spec ?? FENNEC).rear);
  const [y, z] = [Y(BODY_EXHAUST.height), Z(BODY_EXHAUST.spread)];
  model.updateMatrixWorld(true);
  const solid = model.children.filter((part) => part.name !== "glass");
  const at = (side: number): Vector3 => {
    const hit = new Raycaster(new Vector3(rear - 50, y, side * z), new Vector3(1, 0, 0)).intersectObjects(solid)[0];
    return new Vector3((hit?.point.x ?? rear) - BODY_EXHAUST.behind, y, side * z);
  };
  return [at(-1), at(1)];
}

/** The model as one mesh per material (seven draw calls), named after the material: body, trim, glass, headlight,
 *  taillight, tyre, rim. `car` the garage's (src/game/cars.ts): its Blender model where client/cars has one
 *  (src/render/carGlb.ts); else Sport this Fennec-like hatchback (or the game's Fennec where it is loaded,
 *  src/render/fennec.ts; the retired Standard, 1, too), Flat and Tall their own bodies (src/render/carBodies.ts) */
export function buildCarModel(config: CarConfig, paint: Color, team = 0, car = 0): Group {
  const made = glbCarModel(car, paint);
  if (made) return made;
  const look = carBody(car);
  if (look) return buildCarBody(look, config, paint);
  const fennec = car === 0 ? fennecModel(config, paint, team) : null;
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

  const { body, trim, glass, headlight, taillight, tyre, rim } = carMaterials(paint);

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
    // (0.8 off the cabin's outline: its bevelled sides 0.5 under it at least, not to fight far off: RV-487)
    const window = warp(new Mesh(new ShapeGeometry(new Shape(sideWindow)), glass), (_x, y) => side * ((cabinHalfWidth + 0.8) * tumble(y)));
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
  // (the grille clear of the headlights beside it, not under them 0.1 apart: RV-487)
  box(trim, 1, 6, 2 * noseHalf - 26, front + 0.1, Y(F.noseTop) - 7, 0);
  // (the front lip 1 uu under the sills: its underside clear of the body's, not in its plane, where they z-fought: the
  // user's finding)
  box(trim, 4, 5, 2 * noseHalf - 1, front - 1.5, bottom + 1.5, 0);
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

  addWheels(group, wheels, tyre, rim);
  return mergeByMaterial(group);
}
