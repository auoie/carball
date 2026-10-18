// The garage's other cars (the user's feature, 2026-10-16): Flat and Tall, in the proportions of the game's Dominus and
// Merc (the Standard, Octane-like, gone: the user's, 2026-10-17), each on its own preset's hitbox (notes/hitboxes.md
// "Body proportions on the presets": the static session's CM1, measured scalars only; the styling ours, no outlines or
// vertex lists: the user's rule). Built as
// the Sport's (src/render/carModel.ts): a side profile through the measured heights, extruded across and pinched in plan
// (the nose, a waist, the fenders over the wheels, the tail), a cabin on it narrowing to the roof, glass, lights and
// wheels; with what each needs past FENNEC's fields (CM1's extra measures): the roof line above the windscreen, the
// rising beltline, the rear deck and tail, the Merc's stepped nose, roof lip and spare wheel. An upright back (the Merc's
// box) has no rear glass.
// Local frame (Three.js): x forward, y up, z right; the origin is the car's (the physics body's).
import { BoxGeometry, type Color, CylinderGeometry, Group, type Material, Mesh, Shape, ShapeGeometry, Vector2 } from "three";
import type { CarConfig } from "../engine/world";
import { mergeByMaterial } from "./merge";
import { type CarSpec, HITBOXES, type Hitbox, type Point, addWheels, bodyFrame, carMaterials, densify, extrudeAcross, paneAlong, warp } from "./carParts";

/** CM1's proportions in FENNEC's field set (notes/hitboxes.md; for cars without rear glass rearWindowBase is the foot of
 *  the cabin's back; the wheels the visual ones) */
export const DOMINUS = {
  front: 89.7,
  rear: -61.1,
  ground: -19.4,
  halfWidth: 36.3,
  halfWidthBelt: 27.6,
  halfWidthRoof: 16.8,
  halfWidthNose: 18.9,
  halfWidthTail: 33.9,
  clearance: 3.4,
  noseTop: 21.5,
  hood: 31.4,
  belt: 31.5,
  roof: 42.8,
  windscreenBase: 27.0,
  windscreenDeg: 29.4,
  roofFront: 7.9,
  roofBack: -34.5,
  rearWindowBase: [-46.2, 36.5] as const,
  bumperTop: 22.0,
  frontWheel: { x: 50.4, h: 13.2, z: 31.1, radius: 12.2, width: 14.5 },
  backWheel: { x: -35.2, h: 13.3, z: 32.9, radius: 14.3, width: 14.5 },
} as const satisfies CarSpec;
export const MERC = {
  front: 72.7,
  rear: -63.0,
  ground: -22.4,
  halfWidth: 34.5,
  halfWidthBelt: 29.3,
  halfWidthRoof: 25.0,
  halfWidthNose: 29.9,
  halfWidthTail: 32.5,
  clearance: 15.1,
  noseTop: 30.7,
  hood: 49.4,
  belt: 47.9,
  roof: 67.8,
  windscreenBase: 48.0,
  windscreenDeg: 46.9,
  roofFront: 37.9,
  roofBack: -57.8,
  rearWindowBase: [-57.8, 60.0] as const,
  bumperTop: 43.2,
  frontWheel: { x: 38.2, h: 14.8, z: 31.7, radius: 15.3, width: 14.0 },
  backWheel: { x: -39.8, h: 16.8, z: 31.7, radius: 16.3, width: 14.5 },
} as const satisfies CarSpec;

/** A garage car's body: its proportions, the hitbox they were measured on, and CM1's extra measures its shape needs */
export interface CarBodySpec {
  readonly spec: CarSpec;
  readonly hitbox: Hitbox;
  /** The bonnet: its height at its front edge (`step` behind the nose: the Merc's stepped nose) and half way back */
  readonly bonnet: { readonly frontH: number; readonly midH: number; readonly step: number };
  /** The windscreen glass's top (h); the roof's front (h at roofFront) and where it peaks (x) */
  readonly windscreenTopH: number;
  readonly roofFrontH: number;
  readonly roofPeakX: number;
  /** The beltline's height at the side glass's front and back, and the side glass (x from back to front, its top) */
  readonly beltH: readonly [front: number, back: number];
  readonly sideGlass: { readonly x: readonly [back: number, front: number]; readonly topH: number };
  /** The rear deck (x, h) and the tail's top */
  readonly rearDeck: readonly [x: number, h: number];
  readonly tailTopH: number;
  /** The plan: the waist (x, half width) and the fenders' half widths (front, back) */
  readonly waist: readonly [x: number, halfWidth: number];
  readonly fenders: readonly [front: number, back: number];
  readonly rearGlass: boolean;
  /** The Merc's: a lip on the roof's back end (its top, x) and a spare wheel on the tail (its top, its back) */
  readonly roofLip?: { readonly top: number; readonly x: number };
  readonly spare?: { readonly top: number; readonly back: number };
}

/** The garage's Flat (Dominus-like): a long low bonnet to a beak, a low roof, a rear window down to a short trunk and
 *  its ducktail */
export const FLAT_BODY: CarBodySpec = {
  spec: DOMINUS,
  hitbox: HITBOXES.flat,
  bonnet: { frontH: 24.1, midH: 30.8, step: 4 },
  windscreenTopH: 40.7,
  roofFrontH: 42.4,
  roofPeakX: -4.2,
  beltH: [31.5, 34.5],
  sideGlass: { x: [-19.0, 20.8], topH: 40.2 },
  rearDeck: [-49.2, 35.3],
  tailTopH: 38.6,
  waist: [-4.9, 31.6],
  fenders: [34.8, 36.3],
  rearGlass: true,
};

/** The garage's Tall (Merc-like): a stepped nose, an upright windscreen, a tall boxy cabin with an upright back, a roof
 *  lip, a spare wheel on its tail (CM1's tail top 64.7 taken as the spare's top, the body's tail its deck's) */
export const TALL_BODY: CarBodySpec = {
  spec: MERC,
  hitbox: HITBOXES.tall,
  bonnet: { frontH: 42.2, midH: 44.4, step: 6.0 },
  windscreenTopH: 58.9,
  roofFrontH: 62.4,
  roofPeakX: 2.0,
  beltH: [47.9, 50.6],
  sideGlass: { x: [11.0, 43.7], topH: 59.4 },
  rearDeck: [-60.8, 59.3],
  tailTopH: 59.3,
  waist: [15.5, 30.9],
  fenders: [34.5, 34.5],
  rearGlass: false,
  roofLip: { top: 71.9, x: -57.9 },
  spare: { top: 64.7, back: -68.4 },
};

/** The garage car's body (its id: src/game/cars.ts), null for the Sport (src/render/carModel.ts's), the retired Standard
 *  (1) too */
export function carBody(car: number): CarBodySpec | null {
  return [null, null, FLAT_BODY, TALL_BODY][car] ?? null;
}

/** The extruded profiles' rounded edges (uu: less than the Sport's, for these bodies' thin bonnets over their arches) */
const BODY_BEVEL = 1.5;
/** The wheel arches: half width past the tyre, height over it (and at least this much under the profile's top) */
const ARCH_PAST_TYRE = 3;
const ARCH_OVER_TYRE = 4;
const ARCH_UNDER_TOP = 3.5;
/** The fenders' fall past their arches, in plan (uu) */
const FENDER_FALL = 6;

/** A garage car's model (seven meshes, one per material, as the Sport's) on a car's hitbox */
export function buildCarBody(look: CarBodySpec, config: CarConfig, paint: Color): Group {
  const F = look.spec;
  const { x: X, y: Y, z: Z } = bodyFrame(F.ground, look.hitbox, config);
  const { body, trim, glass, headlight, taillight, tyre, rim } = carMaterials(paint);
  const group = new Group();
  const box = (material: Material, sx: number, sy: number, sz: number, x: number, y: number, z: number): Mesh => {
    const mesh = new Mesh(new BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const front = X(F.front);
  const rear = X(F.rear);
  const bottom = Y(F.clearance);
  const halfWidth = Z(F.halfWidth);
  const place = (w: CarSpec["frontWheel"]): { x: number; y: number; z: number; radius: number; width: number } => ({
    x: X(w.x),
    y: Y(w.h),
    z: Z(w.z),
    radius: Y(w.radius) - Y(0),
    width: Z(w.width),
  });
  const wheels = [place(F.backWheel), place(F.frontWheel)] as const;

  // The profile's top, nose to tail: the nose, the bonnet (stepped back on the Merc), the cowl at the windscreen's base,
  // the beltline along the side glass, the cabin's back foot, the rear deck, the tail's top
  const rearWindowBase: Point = [X(F.rearWindowBase[0]), Y(F.rearWindowBase[1])];
  const beltFront: Point = [X(look.sideGlass.x[1]), Y(look.beltH[0])];
  const beltBack: Point = [X(look.sideGlass.x[0]), Y(look.beltH[1])];
  const cowl: Point = [X(F.windscreenBase), Y(F.hood)];
  const bonnetFront: Point = [X(F.front - look.bonnet.step), Y(look.bonnet.frontH)];
  const bonnetMid: Point = [(bonnetFront[0] + cowl[0]) / 2, Y(look.bonnet.midH)];
  const tailTop = Y(look.tailTopH);
  const deck: Point[] = look.rearDeck[0] < F.rearWindowBase[0] - 0.5 ? [[X(look.rearDeck[0]), Y(look.rearDeck[1])]] : [];
  const top: Point[] = [
    [front, Y(F.noseTop) - 2],
    [front - 2, Y(F.noseTop)],
    bonnetFront,
    bonnetMid,
    cowl,
    beltFront,
    beltBack,
    rearWindowBase,
    ...deck,
    [rear + 1.5, tailTop],
  ];
  /** The top's height at x (between its points) */
  const topAt = (x: number): number => {
    for (let i = 1; i < top.length; i++) {
      const [a, b] = [top[i - 1], top[i]];
      if (a && b && x <= a[0] && x >= b[0]) return a[1] + ((b[1] - a[1]) * (a[0] - x)) / (a[0] - b[0] || 1);
    }
    return x > front ? Y(F.noseTop) : tailTop;
  };

  // The arches: square shoulders, a chamfered crest over the tyre, kept under the top
  const archHalfWidth = (wheel: (typeof wheels)[number]): number => wheel.radius + ARCH_PAST_TYRE;
  const arch = (wheel: (typeof wheels)[number]): Point[] => {
    const w = archHalfWidth(wheel);
    const room = Math.min(topAt(wheel.x - 0.55 * w), topAt(wheel.x + 0.55 * w)) - ARCH_UNDER_TOP;
    const crest = Math.max(wheel.y + wheel.radius + 1, Math.min(wheel.y + wheel.radius + ARCH_OVER_TYRE, room));
    const shoulder = wheel.y + 0.2 * wheel.radius;
    const points: Point[] = [
      [wheel.x - w, bottom],
      [wheel.x - w, shoulder],
      [wheel.x - 0.55 * w, crest],
      [wheel.x + 0.55 * w, crest],
      [wheel.x + w, shoulder],
      [wheel.x + w, bottom],
    ];
    return points.filter(([x]) => x > rear + 1 && x < front - 1);
  };
  const outline: Point[] = [
    [rear + 2, bottom],
    ...wheels.flatMap(arch),
    [front - 2, bottom],
    [front, bottom + 4],
    ...top,
    [rear, tailTop - 2],
    [rear, bottom + 5],
  ];

  // The plan: the body's half width through the nose, the waist and the tail, the fenders over the wheels wider
  const lerp = (points: readonly Point[], x: number): number => {
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      if (a && b && x <= a[0] && x >= b[0]) return a[1] + ((b[1] - a[1]) * (a[0] - x)) / (a[0] - b[0] || 1);
    }
    return x > front ? (points[0]?.[1] ?? 0) : (points[points.length - 1]?.[1] ?? 0);
  };
  const plan: Point[] = [
    [front, 0.92 * Z(F.halfWidthNose)],
    [front - 4, Z(F.halfWidthNose)],
    [X(look.waist[0]), Z(look.waist[1])],
    [rear + 4, Z(F.halfWidthTail)],
    [rear, 0.92 * Z(F.halfWidthTail)],
  ];
  const fender = (x: number): number =>
    Math.max(
      ...wheels.map((wheel, i) => {
        const past = Math.abs(x - wheel.x) - archHalfWidth(wheel);
        return Z(look.fenders[i === 1 ? 0 : 1]) * Math.min(1, Math.max(0, 1 - past / FENDER_FALL));
      }),
    );
  const halfAt = (x: number): number => Math.min(halfWidth, Math.max(lerp(plan, x), fender(x)));
  const lower = new Shape(densify(outline, 3).map(([x, y]) => new Vector2(x, y)));
  group.add(warp(extrudeAcross(lower, halfWidth, body, BODY_BEVEL), (x, _y, z) => (z * halfAt(x)) / halfWidth));

  // The cabin: the windscreen at its rake to its glass's top, the roof's front rising to its peak and on to its back,
  // the back (a rear window, or upright) down to its foot, along the beltline to the cowl; narrowing to the roof
  const roof = Y(F.roof);
  const slope = Math.tan((F.windscreenDeg * Math.PI) / 180);
  const windscreenTop: Point = [cowl[0] - (Y(look.windscreenTopH) - cowl[1]) / slope, Y(look.windscreenTopH)];
  const roofFront: Point = [Math.min(X(F.roofFront), windscreenTop[0]), Y(look.roofFrontH)];
  const peak: Point = [Math.min(X(look.roofPeakX), roofFront[0] - 1), roof];
  const roofBack: Point = [Math.min(X(F.roofBack), peak[0]), roof - (look.rearGlass ? 1 : 0)];
  const cabin = new Shape([cowl, windscreenTop, roofFront, peak, roofBack, rearWindowBase, beltBack, beltFront].map(([x, y]) => new Vector2(x, y)));
  const belt = Math.min(beltFront[1], beltBack[1], rearWindowBase[1]);
  const cabinHalf = Z(F.halfWidthBelt);
  const tumble = (y: number): number => 1 + (F.halfWidthRoof / F.halfWidthBelt - 1) * Math.min(1, Math.max(0, (y - belt) / (roof - belt)));
  group.add(warp(extrudeAcross(cabin, cabinHalf, body, BODY_BEVEL), (_x, y, z) => z * tumble(y)));

  // Glass: the windscreen, a rear window where there is one, the side windows inside the cabin's outline
  const pane = (a: Point, b: Point): Mesh => paneAlong([a, b], (cabinHalf - 2.5) * tumble(a[1]), (cabinHalf - 2.5) * tumble(b[1]), glass);
  group.add(pane(cowl, windscreenTop));
  if (look.rearGlass) group.add(pane(roofBack, rearWindowBase));
  const edgeAt = (edge: readonly Point[], y: number, fallback: number): number => {
    for (let i = 1; i < edge.length; i++) {
      const [a, b] = [edge[i - 1], edge[i]];
      if (a && b && y >= Math.min(a[1], b[1]) && y <= Math.max(a[1], b[1])) return a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1);
    }
    return fallback;
  };
  const glassTop = Y(look.sideGlass.topH) - 1;
  const frontEdge = [cowl, windscreenTop, roofFront, peak];
  const backEdge = [rearWindowBase, roofBack];
  const side: Point[] = [
    [Math.min(beltFront[0], edgeAt(frontEdge, beltFront[1] + 1, beltFront[0]) - 2), beltFront[1] + 1],
    [Math.min(beltFront[0], edgeAt(frontEdge, glassTop, beltFront[0]) - 2.5), glassTop],
    [Math.max(beltBack[0], edgeAt(backEdge, glassTop, beltBack[0]) + 2.5), glassTop],
    [Math.max(beltBack[0], edgeAt(backEdge, beltBack[1] + 1, beltBack[0]) + 2), beltBack[1] + 1],
  ];
  for (const s of [-1, 1]) {
    // (0.8 off the cabin's outline: its bevelled sides 0.5 under it at least, not to fight far off: RV-487)
    group.add(warp(new Mesh(new ShapeGeometry(new Shape(side.map(([x, y]) => new Vector2(x, y)))), glass), (_x, y) => s * ((cabinHalf + 0.8) * tumble(y))));
  }

  // Lights, the grille and the bumpers' black lips
  const noseHalf = Z(F.halfWidthNose);
  const tailHalf = Z(F.halfWidthTail);
  const noseTop = Y(F.noseTop);
  // (the grille clear of the headlights beside it, not under them 0.1 apart: RV-487)
  box(trim, 1, 5, Math.max(4, 2 * noseHalf - 23), front + 0.1, noseTop - 7, 0);
  // (the front lip 1 uu under the sills: its underside clear of the body's, not in its plane, where they z-fought: the
  // user's finding)
  box(trim, 4, 5, 2 * noseHalf - 1, front - 1.5, bottom + 1.5, 0);
  box(trim, 4, 4, 2 * tailHalf - 1, rear + 1.5, bottom + 7, 0);
  for (const s of [-1, 1]) {
    box(headlight, 1, 4, Math.min(10, noseHalf - 4), front + 0.2, noseTop - 5, s * (noseHalf - 6));
    box(taillight, 1, 4, Math.min(12, tailHalf - 4), rear - 0.2, tailTop - 5, s * (tailHalf - 7));
  }

  // The Merc's roof lip and spare wheel
  if (look.roofLip) {
    const lipFront = X(look.roofLip.x) + 6;
    const width = 2 * cabinHalf * tumble(roof) + 2;
    box(body, lipFront - roofBack[0], Y(look.roofLip.top) - roof, width, (lipFront + roofBack[0]) / 2, (roof + Y(look.roofLip.top)) / 2, 0);
  }
  if (look.spare) {
    const radius = wheels[0].radius;
    const width = 9;
    const centre = { x: X(look.spare.back) + width / 2, y: Y(look.spare.top) - radius };
    for (const [r, w, material] of [
      [radius, width, tyre],
      [radius * 0.6, width + 1.2, rim], // (0.6 proud of the tyre's faces: RV-487)
    ] as const) {
      const mesh = new Mesh(new CylinderGeometry(r, r, w, 20), material);
      mesh.rotation.z = Math.PI / 2; // (its axle along the car's length)
      mesh.position.set(centre.x, centre.y, 0);
      group.add(mesh);
    }
  }

  addWheels(group, wheels, tyre, rim);
  return mergeByMaterial(group);
}
