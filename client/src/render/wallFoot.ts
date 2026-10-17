// The wall's foot's measures and the goal frame the greenhouse builds on (src/render/greenhouse.ts: its boards' top and
// its white goal frame; notes/arena-visuals.md AV-10, AV-13): pieces swept along our arena's wall line
// (src/render/arenaSurface.ts wallLine) by their measured profiles, (o, z) with o uu behind the wall's face, in the
// game's frame and mirrored four ways from the quadrant x, y >= 0. Values and placements only, nothing traced.
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2, Vector3 } from "three";
import { CORNER_BACK, CORNER_SIDE, GOAL_TOP, GOAL_X, type Pt, R_GOAL, SEG90, mouthOutline, trimTop, wallLine } from "./arenaSurface";

type V3 = readonly [number, number, number];

/** A point on a path along the wall: where (game x, y, z), the way behind the surface's face there, and the profile's up
 *  there (across the path in the surface; unless said straight up; its length scales the profile's heights) */
export interface PathPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly behind: V3;
  readonly up?: V3;
}

/** A cross-section: (o behind the face, z above the path's base), from the field side round to the back */
export type Profile = readonly (readonly [number, number])[];

/** The profile swept along the path: its faces facing out of the piece (the profile's outward side: the field, then up,
 *  then back), game frame */
export function sweep(path: readonly PathPoint[], profile: Profile | ((p: PathPoint, k: number) => Profile)): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const sections = path.map((p, k) => (typeof profile === "function" ? profile(p, k) : profile));
  const point = (p: PathPoint, [o, dz]: readonly [number, number]): [number, number, number] => {
    const [ux, uy, uz] = p.up ?? [0, 0, 1];
    return [p.x + p.behind[0] * o + ux * dz, p.y + p.behind[1] * o + uy * dz, p.z + p.behind[2] * o + uz * dz];
  };
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k];
    const b = path[k + 1];
    const sa = sections[k];
    const sb = sections[k + 1];
    if (!a || !b || !sa || !sb) continue;
    for (let j = 0; j + 1 < Math.min(sa.length, sb.length); j++) {
      const [a0, a1, b0, b1] = [point(a, sa[j] ?? [0, 0]), point(a, sa[j + 1] ?? [0, 0]), point(b, sb[j] ?? [0, 0]), point(b, sb[j + 1] ?? [0, 0])];
      // (the face's outward direction: the profile segment's normal toward the field and up, (-dz, do))
      const [o0, z0] = sa[j] ?? [0, 0];
      const [o1, z1] = sa[j + 1] ?? [0, 0];
      const [ux, uy, uz] = a.up ?? [0, 0, 1];
      const out = new Vector3(-(z1 - z0) * a.behind[0] + (o1 - o0) * ux, -(z1 - z0) * a.behind[1] + (o1 - o0) * uy, -(z1 - z0) * a.behind[2] + (o1 - o0) * uz);
      quad(positions, indices, a0, a1, b0, b1, out);
    }
  }
  return { positions, indices };
}

/** A quad (a0, a1, b0, b1: two edges across), its triangles wound to face `out` (game frame) */
export function quad(positions: number[], indices: number[], a0: readonly number[], a1: readonly number[], b0: readonly number[], b1: readonly number[], out: Vector3): void {
  const base = positions.length / 3;
  positions.push(...a0, ...a1, ...b0, ...b1);
  const v = (p: readonly number[]): Vector3 => new Vector3(p[0], p[1], p[2]);
  const n = new Vector3().subVectors(v(a1), v(a0)).cross(new Vector3().subVectors(v(b0), v(a0)));
  if (n.dot(out) >= 0) indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  else indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
}

/** The quadrant's triangles (game frame, wound to face out) made whole, four ways mirrored, in Three's frame (x, z up, y):
 *  a mirror and the frame's swap each reverse a triangle's winding */
export function fourWays(
  positions: readonly number[],
  indices: readonly number[],
  mirrors: readonly (readonly [number, number])[] = QUADRANTS,
  extra: readonly { readonly name: string; readonly size: number; readonly data: readonly number[] }[] = [],
): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const more = extra.map(() => [] as number[]);
  for (const [sx, sy] of mirrors) {
    const base = pos.length / 3;
    extra.forEach((e, k) => more[k]?.push(...e.data));
    for (let i = 0; i < positions.length; i += 3) pos.push(sx * (positions[i] ?? 0), positions[i + 2] ?? 0, sy * (positions[i + 1] ?? 0));
    // (the swap of y and z reverses the winding once, a mirror once more each)
    const flip = sx * sy > 0;
    for (let i = 0; i < indices.length; i += 3) {
      const [a = 0, b = 0, c = 0] = [indices[i], indices[i + 1], indices[i + 2]];
      idx.push(base + a, ...(flip ? [base + c, base + b] : [base + b, base + c]));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  extra.forEach((e, k) => g.setAttribute(e.name, new BufferAttribute(new Float32Array(more[k] ?? []), e.size)));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export const QUADRANTS: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/** The wall foot's measures (AVL1, notes/arena-visuals.md) */
export const WALL_FOOT = {
  /** The midfield arches (AV-10b): |y| 110-146; the pieces along the wall end inside them */
  arch: { y0: 110, y1: 146 },
  /** The cap (AV-10): z 256-272, its front on the face (o 0), its top edge rounded r 4 back to o 4, a deck to o 28;
   *  from |x| 2048 on the back wall (Goal_STD_Trim, the same profile) its top follows the stepped outline (AV-11, 0.8
   *  under the glow's foot): the r 96 bend up onto the wing's 45 degree edge, to the goal frame's outer edge at |x| 969
   *  (AV-13), which carries it on up into its top band; from |y| 128, its end inside the midfield arch (AV-10b) */
  cap: { z: 256, height: 16, round: 4, deck: 28, from: 128, goalTrimFrom: 2048, underGlow: 0.8, frameEdge: 969 },
  /** The goal-mouth frame on the back wall (AV-13: Goal_STD_Trim, opaque lit metal, no lit band): each post at |x|
   *  896-969 across (|x|, o): the jamb at the opening's edge, the face (2 proud), a rail, the channel (0.8 proud), a
   *  rail (2.2 proud), the outer edge back to the wing glass (o 4); straight up from the fillet (z 57, where the
   *  quarterpipe stops) to the opening's corner (z 544), the channel alone (|x| 932-956) on down the r 96 fillet to the
   *  floor; above, the face's plain: round the opening's corner and over it (the band z 640-720.8), its outer edge at
   *  969 up to z 622.5, then the 45 degree line (z = 1591.5 - |x|) to the band's top, a deck back to o 28 along its
   *  top as the cap's. The jamb 10 deep: over our mouth's chamfer (8 behind the face), not the game's 36 */
  frame: {
    post: [
      [8, 896],
      [-2, 896],
      [-2, 919],
      [-2.2, 919],
      [-2.2, 931],
      [-0.8, 931],
      [-0.8, 957],
      [-2.2, 957],
      [-2.2, 969],
      [4, 969],
    ] as Profile,
    channel: { x: [932, 956], proud: 0.8 },
    face: 2,
    from: 57,
    outer: 969,
    corner: 622.5,
    slant: 1591.5,
    top: 720.8,
    fillet: { y: 5024, z: 96, r: 96 },
  },
} as const;

/** The goal-mouth frame (AV-13) round the +y goal's +x half: the post swept up the fillet and the wall, the face's plain
 *  above it, the jamb round the opening's top, the deck along its outer top; the quadrant's, game frame */
export function framePieces(): { positions: number[]; indices: number[] } {
  const f = WALL_FOOT.frame;
  const positions: number[] = [];
  const indices: number[] = [];
  const add = (piece: { positions: number[]; indices: number[] }): void => {
    const base = positions.length / 3;
    positions.push(...piece.positions);
    indices.push(...piece.indices.map((i) => i + base));
  };
  // (on the fillet: angle t from the floor (0) to the wall (pi/2), behind into it; then up the wall)
  const onFillet = (t: number): PathPoint => ({
    x: 0,
    y: f.fillet.y + f.fillet.r * Math.sin(t),
    z: f.fillet.z - f.fillet.r * Math.cos(t),
    behind: [0, Math.sin(t), -Math.cos(t)],
    up: [1, 0, 0],
  });
  const tFrom = Math.acos((f.fillet.z - f.from) / f.fillet.r);
  const filletPath = (t0: number, t1: number): PathPoint[] => Array.from({ length: 7 }, (_, k) => onFillet(t0 + ((t1 - t0) * k) / 6));
  const cornerZ = GOAL_TOP - R_GOAL;
  const wallUp: PathPoint = { x: 0, y: 5120, z: cornerZ, behind: [0, 1, 0], up: [1, 0, 0] };
  add(sweep([...filletPath(tFrom, Math.PI / 2), wallUp], f.post));
  // (its ends: at the corner's height the relief's steps closed to the plain's face (up where prouder, down where
  // recessed); at its foot on the fillet the proud parts closed down to the fillet, but the channel, which goes on)
  const ends: number[] = [];
  const endIdx: number[] = [];
  const foot = onFillet(tFrom);
  const at = (p: PathPoint, o: number, x: number): number[] => [x, p.y + p.behind[1] * o, p.z + p.behind[2] * o];
  for (let j = 0; j + 1 < f.post.length; j++) {
    const [o0, x0] = f.post[j] ?? [0, 0];
    const [o1, x1] = f.post[j + 1] ?? [0, 0];
    if (x0 === x1) continue;
    if (o0 !== -f.face) quad(ends, endIdx, at(wallUp, o0, x0), at(wallUp, o1, x1), at(wallUp, -f.face, x0), at(wallUp, -f.face, x1), new Vector3(0, 0, o0 < -f.face ? 1 : -1));
    if (o0 !== -f.channel.proud) quad(ends, endIdx, at(foot, o0, x0), at(foot, o1, x1), at(foot, 0, x0), at(foot, 0, x1), new Vector3(0, -Math.cos(tFrom), -Math.sin(tFrom)));
  }
  add({ positions: ends, indices: endIdx });
  // (the channel alone down the rest of the fillet to the floor)
  const [c0, c1] = f.channel.x;
  add(sweep(filletPath(0, tFrom), [[0, c0], [-f.channel.proud, c0], [-f.channel.proud, c1], [0, c1]]));
  // The face's plain above: inside, the opening's corner and over it; outside, the outer edge, the 45 degree line, the
  // band's top
  const inner = mouthOutline(0);
  const slantTop = f.slant - f.top;
  const outline: Pt[] = [[GOAL_X, cornerZ], ...inner.slice(1, SEG90 + 1), [0, GOAL_TOP], [0, f.top], [slantTop, f.top], [f.outer, f.corner], [f.outer, cornerZ]];
  const contour = outline.map(([x, z]) => new Vector2(x, z));
  const faceBase = positions.length / 3;
  for (const [x, z] of outline) positions.push(x, 5120 - f.face, z);
  for (const [a = 0, b = 0, c = 0] of ShapeUtils.triangulateShape(contour, [])) {
    // (facing the field, -y)
    const [pa, pb, pc] = [outline[a] ?? [0, 0], outline[b] ?? [0, 0], outline[c] ?? [0, 0]];
    const cross = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
    // ((x, z) anticlockwise is facing -y: x cross z = -y)
    indices.push(...(cross > 0 ? [faceBase + a, faceBase + b, faceBase + c] : [faceBase + a, faceBase + c, faceBase + b]));
  }
  // The jamb round the opening's top (facing into the opening) and the outer edge's side up to the 45 degree line
  const opening: PathPoint[] = [[GOAL_X, cornerZ] as Pt, ...inner.slice(1, SEG90 + 1), [0, GOAL_TOP] as Pt].map(([x, z]) => {
    const d = Math.hypot(x - (GOAL_X - R_GOAL), z - cornerZ);
    const n: V3 = x > GOAL_X - R_GOAL ? [-(x - (GOAL_X - R_GOAL)) / d, 0, -(z - cornerZ) / d] : [0, 0, -1];
    return { x, y: 5120, z, behind: [0, 1, 0], up: n };
  });
  const [jambBack] = f.post[0] ?? [0, 0];
  add(sweep(opening, [[-f.face, 0], [jambBack, 0]]));
  const [outerBack] = f.post[f.post.length - 1] ?? [0, 0];
  add(
    sweep(
      [
        { x: f.outer, y: 5120, z: cornerZ, behind: [0, 1, 0], up: [1, 0, 0] },
        { x: f.outer, y: 5120, z: f.corner, behind: [0, 1, 0], up: [1, 0, 0] },
      ],
      [[-f.face, 0], [outerBack, 0]],
    ),
  );
  // The deck along the outer top: up the 45 degree line, across the band's top
  const deck: Profile = [[-f.face, 0], [WALL_FOOT.cap.deck, 0]];
  const up45: V3 = [Math.SQRT1_2, 0, Math.SQRT1_2];
  add(
    sweep(
      [
        { x: f.outer, y: 5120, z: f.corner, behind: [0, 1, 0], up: up45 },
        { x: slantTop, y: 5120, z: f.top, behind: [0, 1, 0], up: up45 },
      ],
      deck,
    ),
  );
  add(
    sweep(
      [
        { x: slantTop, y: 5120, z: f.top, behind: [0, 1, 0], up: [0, 0, 1] },
        { x: 0, y: 5120, z: f.top, behind: [0, 1, 0], up: [0, 0, 1] },
      ],
      deck,
    ),
  );
  return { positions, indices };
}

// --- The stack under the cap (AV-10) ---------------------------------------------------------------------------------

/** A station of the quadrant's wall line by its arc length s from the side wall's middle: its point, the way to the
 *  field, its floor fillet's radius */
interface WallStation {
  readonly s: number;
  readonly p: Pt;
  readonly n: Pt;
  readonly rf: number;
}

let byLength: WallStation[] | undefined;

function wallStations(): WallStation[] {
  if (byLength) return byLength;
  const out: WallStation[] = [];
  let s = 0;
  let prev: Pt | undefined;
  for (const st of wallLine()) {
    if (prev) s += Math.hypot(st.p[0] - prev[0], st.p[1] - prev[1]);
    out.push({ s, p: st.p, n: st.n, rf: trimTop(st.p[0], st.p[1]) });
    prev = st.p;
  }
  byLength = out;
  return out;
}

/** The arc length of the wall line's point nearest (|x|, |y|) */
export function wallParam(x: number, y: number): number {
  const [ax, ay] = [Math.abs(x), Math.abs(y)];
  const S = wallStations();
  let best = Infinity;
  let at = 0;
  for (let k = 0; k + 1 < S.length; k++) {
    const a = S[k];
    const b = S[k + 1];
    if (!a || !b) continue;
    const [dx, dy] = [b.p[0] - a.p[0], b.p[1] - a.p[1]];
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(Math.max(((ax - a.p[0]) * dx + (ay - a.p[1]) * dy) / l2, 0), 1) : 0;
    const d = Math.hypot(ax - (a.p[0] + dx * t), ay - (a.p[1] + dy * t));
    if (d < best) {
      best = d;
      at = a.s + (b.s - a.s) * t;
    }
  }
  return at;
}

/** The stack's measures (AV-10, H-11; o behind the wall's face): rules and named measures (fitted to AVL1's points,
 *  within ~2 uu, so no list of the meshes' points ships) */
export const STACK = {
  /** the fillet frame's top: 140 along the side walls and the side corner, 128 at the back corner's start, 96 at its
   *  end (round the back corner, `roundBack`), 96 along the back wall to |x| 1344, then straight down to 57 by 960 */
  frameTop: { side: 140, corner: 128, back: 96, wing: [1344, 960] as Pt, post: 57 },
  /** the side walls' boards and glass on the r 260 circle (o 4 at z 256, its centre at the cap's foot, 260 in front),
   *  from z 139; the back corner's and back wall's from (o 1.7, z 137.4) to (o 4, z 160), then straight up; the one
   *  becoming the other as the frame's top falls from 139 to 96 */
  circle: { r: 260, o: 4, from: 139 },
  back: { foot: [1.7, 137.4] as Pt, knee: [4, 160] as Pt },
  top: 256,
  /** the side glass (Field_STD_Glass) |y| 128-1019, its tiles' scale (HEX-4: 168.9 uu along, ~121 up per UV) */
  glass: { from: 128, to: 1019, su: 168.9, sv: 121 },
  /** the boards (AdvertStrip_Field) from |y| 1019 round the corners to |x| 1537 on the back wall */
  boards: { to: 1537 },
  /** the grate (Goal_STD_Glass[1]) from the frame's top up to the boards' foot, from where the frame falls below it (a
   *  zero-height sliver there) to |x| 961; under the wing (|x| < 1537) up to z 127; on the back wall the plane (o -9,
   *  z 96) to (o 1.7, z 137.4) (ours from the frame's cut edge on our fillet, within 4.4 uu of it) */
  grate: { to: 961, wing: 127 },
  /** the bar (AdvertStrip_Frame) at z 125-141, from where the grate starts to |x| 961: on the back wall its front (o -2,
   *  z 128) to (o 0.9, z 139.4), carried on to its foot and top; its depth back to the boards; round the corner carried
   *  forward with the boards' foot */
  bar: { to: 961, z: [125, 141] as Pt, front: [[-2, 128], [0.9, 139.4]] as readonly Pt[], back: 4 },
  /** the posts (AdvertStrip_Frame): 12 wide, 2 proud of the boards or the glass, up to the cap; along the wall line 12
   *  even panels between the boards' ends (|y| 1019, |x| 1537), and one more on the glass; on the wing every 128 from
   *  |x| 1344 */
  posts: { width: 12, proud: 2, panels: 12, wing: [1344, 1216, 1088] },
  /** the wing glass's foot (z 127, o 4) and its top under the cap (the cap's base: 256, then the 45 degree line 16
   *  under its top, z = 1590.7 - |x| - 16 sqrt 2) */
  wing: { foot: 127, o: 4 },
} as const;

/** A measure round the back corner (AV-10, AV-11: AVL1's points fitted): `side` along the side walls and the side
 *  corner, easing in (cubic) along the diagonal to `corner` at the back corner's start, out (cubic) round the back
 *  corner to `back` at its end, `back` on along the back wall */
export function roundBack(s: number, side: number, corner: number, back: number): number {
  const [s0, s1, s2] = [wallParam(...CORNER_SIDE[1]), wallParam(...CORNER_BACK[0]), wallParam(...CORNER_BACK[1])];
  if (s <= s0) return side;
  if (s <= s1) return side + (corner - side) * ((s - s0) / (s1 - s0)) ** 3;
  if (s <= s2) return corner + (back - corner) * (1 - (1 - (s - s1) / (s2 - s1)) ** 3);
  return back;
}

/** The fillet frame's top at arc length s */
export function frameTopAt(s: number): number {
  const f = STACK.frameTop;
  const [w0, w1] = f.wing.map((x) => wallParam(x, 5120));
  if (s <= (w0 ?? 0)) return roundBack(s, f.side, f.corner, f.back);
  return f.back + ((f.post - f.back) * Math.min((s - (w0 ?? 0)) / ((w1 ?? 1) - (w0 ?? 0)), 1));
}

/** The surface's triangles (game frame) kept where `level(x, y, z)` is at most 0 (or, `above`, at least 0): those
 *  across its zero cut there, the cut's new vertices shared by the triangles either side; the winding kept */
export function clip(
  positions: ArrayLike<number>,
  indices: readonly number[],
  level: (x: number, y: number, z: number) => number,
  above = false,
): { positions: number[]; indices: number[] } {
  const out: number[] = [];
  const idx: number[] = [];
  const kept = new Map<number, number>();
  const cuts = new Map<string, number>();
  const f = new Map<number, number>();
  const sign = above ? -1 : 1;
  const levelAt = (v: number): number => {
    let value = f.get(v);
    if (value === undefined) {
      value = sign * level(positions[3 * v] ?? 0, positions[3 * v + 1] ?? 0, positions[3 * v + 2] ?? 0);
      f.set(v, value);
    }
    return value;
  };
  const keep = (v: number): number => {
    let i = kept.get(v);
    if (i === undefined) {
      i = out.length / 3;
      out.push(positions[3 * v] ?? 0, positions[3 * v + 1] ?? 0, positions[3 * v + 2] ?? 0);
      kept.set(v, i);
    }
    return i;
  };
  const cut = (a: number, b: number): number => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let i = cuts.get(key);
    if (i === undefined) {
      const [fa, fb] = [levelAt(a), levelAt(b)];
      const t = fa / (fa - fb);
      i = out.length / 3;
      for (let c = 0; c < 3; c++) out.push((positions[3 * a + c] ?? 0) + ((positions[3 * b + c] ?? 0) - (positions[3 * a + c] ?? 0)) * t);
      cuts.set(key, i);
    }
    return i;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0];
    const inside = tri.map((v) => levelAt(v) <= 0);
    if (inside.every((b) => !b)) continue;
    const poly: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k] ?? 0;
      const b = tri[(k + 1) % 3] ?? 0;
      if (inside[k]) poly.push(keep(a));
      if (inside[k] !== inside[(k + 1) % 3]) poly.push(cut(a, b));
    }
    for (let k = 1; k + 1 < poly.length; k++) idx.push(poly[0] ?? 0, poly[k] ?? 0, poly[k + 1] ?? 0);
  }
  return { positions: out, indices: idx };
}

// --- The midfield opening (AV-10b) -----------------------------------------------------------------------------------
