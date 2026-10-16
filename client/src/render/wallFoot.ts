// The wall's foot as the game's (notes/arena-visuals.md AV-10, AV-10b, AV-11, AV-13, H-5, H-11: the static session's
// lookup AVL1, 2026-10-16; the user's decision: every map as the game): pieces swept along our arena's wall line
// (src/render/arenaSurface.ts wallLine) by their measured profiles, (o, z) with o uu behind the wall's face, in the
// game's frame and mirrored four ways from the quadrant x, y >= 0. Values and placements only, nothing traced.
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2, Vector3 } from "three";
import { CORNER_BACK, CORNER_SIDE, GOAL_TOP, GOAL_X, type Pt, R_GOAL, SEG90, mouthOutline, trimTop, wallLine } from "./arenaSurface";
import { FIELD_MEASURES } from "./stadiumFieldRules";

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

/** The wall line of the quadrant (x, y >= 0) from the side wall at y = `fromY` round the corners to the back wall at
 *  x = `toX`, at height `z`: its stations, with the cut ends put in */
export function wallPath(fromY: number, toX: number, z = 0): PathPoint[] {
  const line = wallLine();
  const out: PathPoint[] = [];
  const at = (p: Pt, n: Pt): PathPoint => ({ x: p[0], y: p[1], z, behind: [-n[0], -n[1], 0] });
  for (let k = 0; k < line.length; k++) {
    const s = line[k];
    const next = line[k + 1];
    if (!s) continue;
    const onSide = s.p[0] >= 4096 - 1e-6;
    const onBack = s.p[1] >= 5120 - 1e-6;
    if (onSide && s.p[1] < fromY) {
      // (the start, cut between this station and the next)
      if (next && next.p[1] > fromY) out.push(at([s.p[0], fromY], s.n));
      continue;
    }
    if (onBack && s.p[0] < toX) {
      const last = out[out.length - 1];
      if (last && last.x > toX) out.push({ ...last, x: toX, y: s.p[1] });
      break;
    }
    out.push(at(s.p, s.n));
  }
  return out;
}

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

/** The cap's cross-section: the face up to the rounded edge, the round, the deck */
function capProfile(): Profile {
  const { height, round, deck } = WALL_FOOT.cap;
  const arc: (readonly [number, number])[] = [];
  for (let k = 0; k <= 4; k++) {
    const t = (k / 4) * (Math.PI / 2);
    arc.push([round - round * Math.cos(t), height - round + round * Math.sin(t)]);
  }
  // (its underside back to the boards' top, o 4, under its front)
  return [[round, 0], [0, 0], ...arc, [deck, height]];
}

/** The cap's goal part on the back wall (+x side, y 5120), from |x| 2048 in: its base points, each with the profile's up
 *  (the top line's normal, away from the goal); the stepped outline's low line and 45 degree line (z = slant - |x|),
 *  0.8 lower, its r 96 bend between; the last section cut straight down at the frame's edge */
function goalCapPath(): PathPoint[] {
  const { height, goalTrimFrom, underGlow, frameEdge } = WALL_FOOT.cap;
  const st = FIELD_MEASURES.glow.stepped;
  const low = st.low - underGlow;
  const slant = st.slant - underGlow;
  const [r] = st.bends;
  const corner = slant - low;
  const tangent = r * Math.tan(Math.PI / 8);
  const centre: Pt = [corner + tangent, low + r];
  const at = (x: number, z: number, up: readonly [number, number, number]): PathPoint => ({
    x,
    y: 5120,
    z: z - up[2] * height,
    behind: [0, 1, 0],
    up,
  });
  const pts: PathPoint[] = [at(goalTrimFrom, low, [0, 0, 1])];
  // (round the bend: the up toward the bend's centre)
  for (let k = 0; k <= 6; k++) {
    const a = -Math.PI / 2 - (Math.PI / 4) * (k / 6);
    const [ux, uz] = [-Math.cos(a), -Math.sin(a)];
    const top: Pt = [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)];
    pts.push({ ...at(top[0], top[1], [ux, 0, uz]), x: top[0] - ux * height });
  }
  // (cut at the frame's edge: its top on the line, its base straight below, so the profile's up there sqrt 2 long)
  pts.push({ x: frameEdge, y: 5120, z: slant - frameEdge - Math.SQRT2 * height, behind: [0, 1, 0], up: [0, 0, Math.SQRT2] });
  return pts;
}

/** The cap all round (AV-10): along the wall from midfield round the corners to |x| 2048 at z 256, then up the wing's
 *  edge to the goal frame; the quadrant's, game frame */
export function capPieces(): { positions: number[]; indices: number[] } {
  const { z, from, goalTrimFrom } = WALL_FOOT.cap;
  const along = wallPath(from, goalTrimFrom, z);
  return sweep([...along, ...goalCapPath().slice(1)], capProfile());
}

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

/** The wall line at arc length s (between its stations: their points, normals and radii blended) */
function stationAt(s: number): WallStation {
  const S = wallStations();
  for (let k = 0; k + 1 < S.length; k++) {
    const a = S[k];
    const b = S[k + 1];
    if (!a || !b || s > b.s) continue;
    const t = b.s > a.s ? Math.max(0, (s - a.s) / (b.s - a.s)) : 0;
    const n: Pt = [a.n[0] + (b.n[0] - a.n[0]) * t, a.n[1] + (b.n[1] - a.n[1]) * t];
    const l = Math.hypot(n[0], n[1]) || 1;
    return { s, p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t], n: [n[0] / l, n[1] / l], rf: a.rf + (b.rf - a.rf) * t };
  }
  const last = S[S.length - 1];
  return last ?? { s, p: [4096, 0], n: [-1, 0], rf: 256 };
}

/** The stations from s0 to s1: the line's own between, the ends and `breaks` put in */
function stationsBetween(s0: number, s1: number, breaks: readonly number[] = []): WallStation[] {
  const at = new Set<number>([s0, s1, ...breaks.filter((b) => b > s0 && b < s1)]);
  for (const st of wallStations()) if (st.s > s0 && st.s < s1) at.add(st.s);
  return [...at].sort((a, b) => a - b).map(stationAt);
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

/** Where (arc length) the frame's top first falls to z (round the back corner: it falls steadily there) */
function frameFallsTo(z: number): number {
  let [lo, hi] = [wallParam(...CORNER_SIDE[1]), wallParam(...CORNER_BACK[1])];
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (frameTopAt(mid) > z) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** The fillet's surface at height z of a station (o: behind the wall's face, so negative in front) */
function filletO(st: WallStation, z: number): number {
  const h = Math.min(z, st.rf);
  return -st.rf + Math.sqrt(Math.max(st.rf * st.rf - (st.rf - h) * (st.rf - h), 0));
}

/** How far the stack has become the back wall's: 0 while the frame's top is up at 139, 1 once down at 96 */
function backness(zTop: number): number {
  return Math.min(Math.max((139 - zTop) / (139 - 96), 0), 1);
}

/** The boards' (or glass's) profile, foot to top, (o, z): the side walls' circle and the back wall's, blended */
function boardProfile(w: number): Profile {
  const { r, o: oTop, from } = STACK.circle;
  const { foot, knee } = STACK.back;
  const N = 8;
  const out: (readonly [number, number])[] = [];
  for (let k = 0; k <= N; k++) {
    const zs = from + ((STACK.top - from) * k) / N;
    const os = oTop - r + Math.sqrt(r * r - (STACK.top - zs) * (STACK.top - zs));
    const [ob, zb] = k === 0 ? foot : [knee[0], knee[1] + ((STACK.top - knee[1]) * (k - 1)) / (N - 1)];
    out.push([os + (ob - os) * w, zs + (zb - zs) * w]);
  }
  return out;
}

/** The foot of a station's pieces (on the floor, its profiles' z absolute) */
function onFloor(st: WallStation): PathPoint {
  return { x: st.p[0], y: st.p[1], z: 0, behind: [-st.n[0], -st.n[1], 0] };
}

/** The back wall's grate plane's o at height z (through (o -9, z 96) and (o 1.7, z 137.4)) shifted with the boards' foot */
function grateO(footO: number, z: number): number {
  const [o1, z1] = STACK.back.foot;
  return footO + ((z - z1) * (o1 + 9)) / (z1 - 96);
}

/** The stack's pieces (the quadrant's, game frame): the frame's lip up to the glass or the boards where no grate is,
 *  the side glass (with its tiles), the boards, the grate, the bar, the posts */
export function stackPieces(): Record<"lip" | "glass" | "boards" | "grate" | "bar" | "posts", { positions: number[]; indices: number[] }> & { glassTile: number[] } {
  const sOf = (x: number, y: number): number => wallParam(x, y);
  const sGlass0 = sOf(4096, STACK.glass.from);
  const sGlass1 = sOf(4096, STACK.glass.to);
  const sBoards1 = sOf(STACK.boards.to, 5120);
  const sWing = sOf(1536, 5120);
  const sGrate0 = frameFallsTo(STACK.circle.from);
  const sGrate1 = sOf(STACK.grate.to, 5120);
  const sBar0 = sGrate0;
  const sBar1 = sOf(STACK.bar.to, 5120);
  const corners = [CORNER_SIDE[1], CORNER_BACK[0], CORNER_BACK[1]].map(([x, y]) => sOf(x, y));
  const breaks = [...corners, ...STACK.frameTop.wing.map((x) => sOf(x, 5120)), sGlass1, sBoards1, sWing, sGrate0];
  const profileAt = (st: WallStation): { zTop: number; w: number; board: Profile } => {
    const zTop = frameTopAt(st.s);
    const w = backness(zTop);
    return { zTop, w, board: boardProfile(w) };
  };
  // The lip: the frame's cut edge back to the glass's or boards' foot (from inside the midfield arch to where the grate
  // starts)
  const lipPath = stationsBetween(sGlass0, sGrate0, breaks);
  const lip = sweep(lipPath.map(onFloor), (_, k) => {
    const st = lipPath[k] ?? stationAt(0);
    const { zTop, board } = profileAt(st);
    const [foot = [0, 0]] = board;
    return [[filletO(st, zTop), zTop], foot];
  });
  // The side glass and the boards
  const glassPath = stationsBetween(sGlass0, sGlass1, breaks);
  const glass = sweep(glassPath.map(onFloor), (_, k) => profileAt(glassPath[k] ?? stationAt(0)).board);
  // (its tiles: along the wall and up the circle, by its scale)
  const glassTile: number[] = [];
  for (let i = 0; i < glass.positions.length; i += 3) {
    const [y, z] = [glass.positions[i + 1] ?? 0, glass.positions[i + 2] ?? 0];
    const angle = (h: number): number => Math.asin(Math.min((STACK.top - h) / STACK.circle.r, 1));
    const up = STACK.circle.r * (angle(STACK.circle.from) - angle(z));
    glassTile.push((3 * y) / STACK.glass.su, ((7 / 3) * up) / STACK.glass.sv);
  }
  const boardPath = stationsBetween(sGlass1, sBoards1, breaks);
  const boards = sweep(boardPath.map(onFloor), (_, k) => profileAt(boardPath[k] ?? stationAt(0)).board);
  // The grate: from the frame's cut edge up the plane to the boards' foot (under the wing to z 127)
  const gratePiece = (from: number, to: number, wing: boolean): { positions: number[]; indices: number[] } => {
    const path = stationsBetween(from, to, breaks);
    return sweep(path.map(onFloor), (_, k) => {
      const st = path[k] ?? stationAt(0);
      const { zTop, board } = profileAt(st);
      const [foot = [0, 0]] = board;
      const top: readonly [number, number] = wing ? [grateO(foot[0], STACK.grate.wing), STACK.grate.wing] : foot;
      return [[filletO(st, zTop), zTop], top[1] > zTop ? top : [filletO(st, zTop), zTop]];
    });
  };
  const grate = merge([gratePiece(sGrate0, sBoards1, false), gratePiece(sWing, sGrate1, true)]);
  // The bar: the back wall's section carried with the boards' foot
  const barPath = stationsBetween(sBar0, sBar1, breaks);
  const [[fo0, fz0], [fo1, fz1]] = STACK.bar.front as readonly [Pt, Pt];
  const frontO = (z: number): number => fo0 + ((fo1 - fo0) * (z - fz0)) / (fz1 - fz0);
  const [z0, z1] = STACK.bar.z;
  const bar = sweep(barPath.map(onFloor), (_, k) => {
    const { board } = profileAt(barPath[k] ?? stationAt(0));
    const shift = (board[0]?.[0] ?? 0) - STACK.back.foot[0];
    return [
      [STACK.bar.back + shift, z0],
      [frontO(z0) + shift, z0],
      [frontO(z1) + shift, z1],
      [STACK.bar.back + shift, z1],
    ];
  });
  // The posts: up the boards (or the glass, or the wing glass), 2 proud, 12 wide
  const posts: { positions: number[]; indices: number[] }[] = [];
  const { width, proud } = STACK.posts;
  const post = (st: WallStation, profile: Profile): void => {
    const tangent: V3 = [st.n[1], -st.n[0], 0];
    const path: PathPoint[] = [];
    for (let k = 0; k < profile.length; k++) {
      const [o, z] = profile[k] ?? [0, 0];
      const [o0, zz0] = profile[Math.max(k - 1, 0)] ?? [0, 0];
      const [o1, zz1] = profile[Math.min(k + 1, profile.length - 1)] ?? [0, 0];
      // (the profile's own behind: across its rise, (dz, -do))
      const [dO, dZ] = [o1 - o0, zz1 - zz0];
      const l = Math.hypot(dO, dZ) || 1;
      const [bo, bz] = [dZ / l, -dO / l];
      path.push({
        x: st.p[0] - st.n[0] * o,
        y: st.p[1] - st.n[1] * o,
        z,
        behind: [-st.n[0] * bo, -st.n[1] * bo, bz],
        up: tangent,
      });
    }
    posts.push(sweep(path, [[0, -width / 2], [-proud, -width / 2], [-proud, width / 2], [0, width / 2]]));
  };
  const panel = (sBoards1 - sGlass1) / STACK.posts.panels;
  for (let k = -1; k <= STACK.posts.panels; k++) {
    const at = stationAt(sGlass1 + k * panel);
    post(at, profileAt(at).board);
  }
  const st = FIELD_MEASURES.glow.stepped;
  for (const x of STACK.posts.wing) {
    const top = Math.max(STACK.top, st.slant - WALL_FOOT.cap.underGlow - x - Math.SQRT2 * WALL_FOOT.cap.height);
    post(stationAt(sOf(x, 5120)), [
      [STACK.wing.o, STACK.wing.foot],
      [STACK.wing.o, top],
    ]);
  }
  return { lip, glass, glassTile, boards, grate, bar, posts: merge(posts) };
}

/** Pieces made one (their indices shifted) */
export function merge(pieces: readonly { positions: number[]; indices: number[] }[]): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const p of pieces) {
    const b = positions.length / 3;
    positions.push(...p.positions);
    indices.push(...p.indices.map((i) => i + b));
  }
  return { positions, indices };
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

/** Side_Trim's vertex colour's alpha for its glows (the far glow and the arch halos, H-5): the mesh has no colour stream
 *  and none of its placements an override, so white, 1 (the static session, 2026-10-16); the one constant to change */
export const SIDE_TRIM_GLOW_ALPHA = 1;

/** The opening's measures (AV-10b; the quadrant's; o behind the side wall's face): named measures and rules */
export const OPENING = {
  /** the arches at |y| 110-146 (Frame_01_V2), as named measures (not a traced outline): on the fillet from the frame's
   *  top (our r 256 fillet, easing to the r 260 circle by z 256), the front leg 4 behind the face up to z 352, its
   *  corner r 40, the top rising 1:4 back, 33 thick (the front leg too; inside corners r 7), the back leg 359-400 behind
   *  down to z 127; inside down the front leg to the recess's shelf; its foot on the floor from 408 in front */
  arch: { front: 4, corner: 352, radius: 40, rise: 1 / 4, thick: 33, back: [359, 400] as Pt, backFoot: 127, foot: 408 },
  /** no trim above Field_Mid_A's top (z 75) between the arches; the overlay down to it */
  trimTop: 75,
  /** Sideline_A behind it (lit metal, dark: baked light 0.33/0.30/0.22), (o, z): a lip from the fillet at z 73 up to
   *  the face at z 96, a shelf 192 deep, a riser to z 192, a tread to 368 behind, a riser to z 328, back to 400 behind,
   *  the back plate up to the far glow's trough's top (z 336) */
  sidelineFrom: 73,
  sideline: [
    [0, 96],
    [192, 96],
    [192, 192],
    [368, 192],
    [368, 328],
    [400, 328],
    [400, 336],
  ] as readonly Pt[],
  sidelineLight: [0.33, 0.3, 0.22] as const,
  /** the far glow (Side_Trim[1]) 384 behind the face, 64 high: its attached edge at z 336 at y 0, sinking 1 in 56 to
   *  |y| 1760, then 0.0895 a uu to 1912; there bending in 51 degrees from the wall for 265 uu, sinking 0.135 a uu; then
   *  straight down to z 64 (its free edge then 64 on along its way: a hard end); continuous across y 0 (each half its
   *  team's) */
  farGlow: { behind: 384, width: 64, foot: 336, sink: 1 / 56, steep: { from: 1760, sink: 0.0895, to: 1912 }, bend: { angle: 51, length: 265, sink: 0.135 }, bottom: 64 },
  /** its trough (Side_Trim[2]): 18 either side of the glow, 34 deep under its foot; walls 2 thick */
  trough: { half: 18, depth: 34, wall: 2 },
} as const;

/** The arch's outline in its plane (x, z), round: on up the fillet from the frame's top, the front leg, over the top,
 *  down the back leg; then up its inside, back over, down the front leg's inside to the shelf, the lip, down the fillet;
 *  with which edges are rims (the outside from the frame's top, the inside: not those on the fillet or the recess) */
export function archOutline(): { points: Pt[]; rim: boolean[] } {
  const a = OPENING.arch;
  const face = 4096;
  const front = face + a.front;
  const frontIn = front + a.thick;
  const [backIn, backOut] = a.back.map((o) => face + o) as [number, number];
  const points: Pt[] = [];
  const rim: boolean[] = [];
  const add = (p: Pt, isRim: boolean): void => {
    points.push(p);
    rim.push(isRim);
  };
  const fillet = (z: number, r: number): number => 3840 + Math.sqrt(r * r - (256 - z) * (256 - z));
  const frameTop = 140;
  // (up the fillet: r 256 to z 157, easing to r 260 at z 256, where it is the front leg's face, x 4100)
  for (const z of [frameTop, 157, 180, 205, 230, 256]) add([fillet(z, z <= 157 ? 256 : 256 + (4 * (z - 157)) / (256 - 157)), z], true);
  const slant = Math.hypot(1, a.rise);
  const d: Pt = [1 / slant, a.rise / slant];
  // (the top's outside: tangent to the front corner's circle (centre r in from the leg at z 352), rising 1:4; its
  // inside 33 under it, across)
  const lineOut = (x: number): number => a.corner + a.radius * slant + (x - (front + a.radius)) * a.rise;
  const lineIn = (x: number): number => lineOut(x) - a.thick * slant;
  const inner = a.radius - a.thick;
  /** A rounded corner at `c` between the directions `d0` and `d1` (radius r): its points from the first line on */
  const corner = (c: Pt, d0: Pt, d1: Pt, r: number): Pt[] => {
    const turn = Math.acos(Math.min(Math.max(d0[0] * d1[0] + d0[1] * d1[1], -1), 1));
    const t = r * Math.tan(turn / 2);
    const p0: Pt = [c[0] - d0[0] * t, c[1] - d0[1] * t];
    const p1: Pt = [c[0] + d1[0] * t, c[1] + d1[1] * t];
    // (the centre: from p0 along d0's normal toward d1's side)
    const cross = d0[0] * d1[1] - d0[1] * d1[0];
    const n: Pt = cross > 0 ? [-d0[1], d0[0]] : [d0[1], -d0[0]];
    const centre: Pt = [p0[0] + n[0] * r, p0[1] + n[1] * r];
    const a0 = Math.atan2(p0[1] - centre[1], p0[0] - centre[0]);
    let a1 = Math.atan2(p1[1] - centre[1], p1[0] - centre[0]);
    if (cross > 0 && a1 < a0) a1 += 2 * Math.PI;
    if (cross < 0 && a1 > a0) a1 -= 2 * Math.PI;
    return Array.from({ length: 7 }, (_, k): Pt => {
      const angle = a0 + ((a1 - a0) * k) / 6;
      return [centre[0] + r * Math.cos(angle), centre[1] + r * Math.sin(angle)];
    });
  };
  for (const p of corner([front, lineOut(front)], [0, 1], d, a.radius)) add(p, true);
  for (const p of corner([backOut, lineOut(backOut)], d, [0, -1], a.radius)) add(p, true);
  add([backOut, a.backFoot], true);
  // (the back leg's foot, then its inside)
  add([backIn, a.backFoot], true);
  for (const p of corner([backIn, lineIn(backIn)], [0, 1], [-d[0], -d[1]], inner)) add(p, true);
  for (const p of corner([frontIn, lineIn(frontIn)], [-d[0], -d[1]], [0, -1], inner)) add(p, true);
  // (down to the shelf, the lip, the fillet: no rims)
  const [shelf = [0, 96]] = OPENING.sideline;
  add([frontIn, shelf[1]], false);
  add([face + shelf[0], shelf[1]], false);
  for (const z of [OPENING.sidelineFrom, 95, 118]) add([fillet(z, 256), z], false);
  return { points, rim };
}

/** The opening's pieces, the quadrant's (game frame): the arch (its two faces, its rims) and its foot on the floor,
 *  Sideline_A's steps between the arches, the far glow's trough */
export function openingPieces(): Record<"arch" | "sideline" | "trough", { positions: number[]; indices: number[] }> {
  const { y0, y1 } = WALL_FOOT.arch;
  const { points, rim } = archOutline();
  const positions: number[] = [];
  const indices: number[] = [];
  // (its faces: y 110 facing the opening (-y), y 146 facing away (+y))
  const contour = points.map(([x, z]) => new Vector2(x, z));
  const triangles = ShapeUtils.triangulateShape(contour, []);
  for (const [y, facing] of [
    [y0, -1],
    [y1, 1],
  ] as const) {
    const b = positions.length / 3;
    for (const [x, z] of points) positions.push(x, y, z);
    for (const [i = 0, j = 0, k = 0] of triangles) {
      const [pa, pb, pc] = [points[i] ?? [0, 0], points[j] ?? [0, 0], points[k] ?? [0, 0]];
      // ((x, z) anticlockwise faces -y)
      const cross = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      indices.push(...((cross > 0) === (facing < 0) ? [b + i, b + j, b + k] : [b + i, b + k, b + j]));
    }
  }
  // (its rims: each outline edge across y 110-146, facing away from the arch's inside)
  let area = 0;
  for (let k = 0; k < points.length; k++) {
    const [p, q] = [points[k] ?? [0, 0], points[(k + 1) % points.length] ?? [0, 0]];
    area += p[0] * q[1] - q[0] * p[1];
  }
  for (let k = 0; k + 1 < points.length; k++) {
    if (!rim[k] || !rim[k + 1]) continue;
    const [p, q] = [points[k] ?? [0, 0], points[k + 1] ?? [0, 0]];
    const [dx, dz] = [q[0] - p[0], q[1] - p[1]];
    // (outward: the edge's right for an anticlockwise outline, its left for a clockwise one)
    const out = area > 0 ? new Vector3(dz, 0, -dx) : new Vector3(-dz, 0, dx);
    quad(positions, indices, [p[0], y0, p[1]], [q[0], y0, q[1]], [p[0], y1, p[1]], [q[0], y1, q[1]], out);
  }
  // (its foot on the floor, from x 3688 to the fillet's foot, just above it)
  const footX = 4096 - OPENING.arch.foot;
  quad(positions, indices, [footX, y0, 0.4], [3840, y0, 0.4], [footX, y1, 0.4], [3840, y1, 0.4], new Vector3(0, 0, 1));
  // Sideline_A between the arches: its profile across y 0-110, facing up and to the field
  const sideline: { positions: number[]; indices: number[] } = { positions: [], indices: [] };
  const lipFrom = OPENING.sidelineFrom;
  const steps: Pt[] = [[3840 + Math.sqrt(256 * 256 - (256 - lipFrom) * (256 - lipFrom)), lipFrom], ...OPENING.sideline.map(([o, z]): Pt => [4096 + o, z])];
  for (let k = 0; k + 1 < steps.length; k++) {
    const [p, q] = [steps[k] ?? [0, 0], steps[k + 1] ?? [0, 0]];
    const [dx, dz] = [q[0] - p[0], q[1] - p[1]];
    quad(sideline.positions, sideline.indices, [p[0], 0, p[1]], [q[0], 0, q[1]], [p[0], y0, p[1]], [q[0], y0, q[1]], new Vector3(-dz, 0, dx));
  }
  // The far glow's trough along the glow's run (to where it drops)
  const tr = OPENING.trough;
  const run = farGlowRun();
  const trough = sweep(
    run.map((p) => ({ ...p, z: p.z })),
    [
      [tr.half, 0],
      [tr.half, -tr.depth],
      [-tr.half, -tr.depth],
      [-tr.half, 0],
      [-tr.half + tr.wall, 0],
      [-tr.half + tr.wall, -tr.depth + tr.wall],
      [tr.half - tr.wall, -tr.depth + tr.wall],
      [tr.half - tr.wall, 0],
      [tr.half, 0],
    ],
  );
  return { arch: { positions, indices }, sideline, trough };
}

/** The far glow's run (its attached edge, the quadrant's): along x 4480 from y 0, bending in, to where it drops; each
 *  point with the way behind it (away from the field, level) */
function farGlowRun(): PathPoint[] {
  const g = OPENING.farGlow;
  const x = 4096 + g.behind;
  const zAt = (y: number): number => g.foot - Math.min(y, g.steep.from) * g.sink - Math.max(Math.min(y, g.steep.to) - g.steep.from, 0) * g.steep.sink;
  const turn = (g.bend.angle * Math.PI) / 180;
  const zBend = zAt(g.steep.to);
  const pts: V3[] = [
    ...[0, g.steep.from, g.steep.to].map((y): V3 => [x, y, zAt(y)]),
    [x - g.bend.length * Math.sin(turn), g.steep.to + g.bend.length * Math.cos(turn), zBend - g.bend.length * g.bend.sink],
  ];
  return pts.map((p, k) => {
    const a = pts[Math.max(k - 1, 0)] ?? p;
    const b = pts[Math.min(k + 1, pts.length - 1)] ?? p;
    const [tx, ty] = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(tx, ty) || 1;
    // (behind: the run's right in plan, its way +y: +x on the side wall)
    return { x: p[0], y: p[1], z: p[2], behind: [ty / l, -tx / l, 0] };
  });
}

/** The far glow (Side_Trim[1], AV-10b), the quadrant's: attached (glow 1) and free (0) edges: up 64 along its run, round
 *  its corner at the drop (r 64 about it, sharp) onto 64 on along its way, down to z 64 */
export function farGlowRibbon(): { attached: number[]; free: number[] } {
  const g = OPENING.farGlow;
  const run = farGlowRun();
  const attached: number[] = [];
  const free: number[] = [];
  for (const p of run) {
    attached.push(p.x, p.y, p.z);
    free.push(p.x, p.y, p.z + g.width);
  }
  const corner = run[run.length - 1];
  const before = run[run.length - 2];
  if (corner && before) {
    const l = Math.hypot(corner.x - before.x, corner.y - before.y) || 1;
    const f: Pt = [(corner.x - before.x) / l, (corner.y - before.y) / l];
    for (let k = 1; k <= 6; k++) {
      const a = ((Math.PI / 2) * k) / 6;
      attached.push(corner.x, corner.y, corner.z);
      free.push(corner.x + f[0] * g.width * Math.sin(a), corner.y + f[1] * g.width * Math.sin(a), corner.z + g.width * Math.cos(a));
    }
    attached.push(corner.x, corner.y, g.bottom);
    free.push(corner.x + f[0] * g.width, corner.y + f[1] * g.width, g.bottom);
  }
  return { attached, free };
}

// --- The slanted ribbon and the arch halos (AV-11, AV-10b) -----------------------------------------------------------

/** The slanted ribbon under the boards (Field_STD_Glow, AV-11), (o behind the face, z): attached 11.7 behind at z 117.3,
 *  free 128 behind at z 148 along the side walls and the side corner; round the back corner (`roundBack`) its attached
 *  edge sinks to z 103.1 at the back corner's start and 72.53 at its end, 29 behind, its free edge in step to z 102 at
 *  144 behind; from |y| 128 (inside the arch) to |x| 2048, where the beside ribbon carries it on; hard ends */
export const SLANTED = {
  attached: { side: [11.7, 117.3] as Pt, corner: 103.1, back: [29, 72.53] as Pt },
  free: { side: [128, 148] as Pt, back: [144, 102] as Pt },
  to: 2048,
} as const;

/** The slanted ribbon, the quadrant's (game frame): its attached and free edges */
export function slantedRibbon(): { attached: number[]; free: number[] } {
  const { attached: a, free: f } = SLANTED;
  const s0 = wallParam(4096, STACK.glass.from);
  const s1 = wallParam(SLANTED.to, 5120);
  // (finely round the back corner, where it sinks)
  const [c0, c2] = [wallParam(...CORNER_SIDE[1]), wallParam(...CORNER_BACK[1])];
  const fine = Array.from({ length: 32 }, (_, k) => c0 + ((c2 - c0) * (k + 1)) / 33);
  const attached: number[] = [];
  const free: number[] = [];
  for (const st of stationsBetween(s0, s1, fine)) {
    const z = roundBack(st.s, a.side[1], a.corner, a.back[1]);
    const t = (a.side[1] - z) / (a.side[1] - a.back[1]);
    const oAttached = a.side[0] + (a.back[0] - a.side[0]) * t;
    const oFree = f.side[0] + (f.back[0] - f.side[0]) * t;
    attached.push(st.p[0] - st.n[0] * oAttached, st.p[1] - st.n[1] * oAttached, z);
    free.push(st.p[0] - st.n[0] * oFree, st.p[1] - st.n[1] * oFree, f.side[1] + (f.back[1] - f.side[1]) * t);
  }
  return { attached, free };
}

/** The arch halos (Side_Trim[1], AV-10b): in the plane |y| 128, 64 wide, pointing out from the arch's outside, from z
 *  200 up its front leg, over the top, down its back leg to its foot; hard ends */
export const HALO = { y: 128, width: 64, from: 200 } as const;

/** An arch's halo, the quadrant's (game frame): its attached and free edges */
export function archHalo(): { attached: number[]; free: number[] } {
  const { points } = archOutline();
  const a = OPENING.arch;
  const backOut = 4096 + a.back[1];
  const end = points.findIndex(([x, z]) => x === backOut && z === a.backFoot);
  const outside = points.slice(0, end + 1);
  const k = Math.max(outside.findIndex(([, z]) => z >= HALO.from), 1);
  const [p0 = [0, 0], p1 = [0, 0]] = [outside[k - 1], outside[k]];
  const start: Pt = [p0[0] + ((p1[0] - p0[0]) * (HALO.from - p0[1])) / (p1[1] - p0[1] || 1), HALO.from];
  const path: Pt[] = [start, ...outside.slice(k)];
  // (outward: the outline's left for a clockwise one, its right for an anticlockwise one)
  const clockwise = ShapeUtils.isClockWise(points.map(([x, z]) => new Vector2(x, z)));
  const attached: number[] = [];
  const free: number[] = [];
  path.forEach((p, i) => {
    const q0 = path[Math.max(i - 1, 0)] ?? p;
    const q1 = path[Math.min(i + 1, path.length - 1)] ?? p;
    const [dx, dz] = [q1[0] - q0[0], q1[1] - q0[1]];
    const l = Math.hypot(dx, dz) || 1;
    const [nx, nz] = clockwise ? [-dz / l, dx / l] : [dz / l, -dx / l];
    attached.push(p[0], HALO.y, p[1]);
    free.push(p[0] + nx * HALO.width, HALO.y, p[1] + nz * HALO.width);
  });
  return { attached, free };
}
