// The grass's pattern (notes/arena-visuals.md AV-6a: FieldSkin_FutureGrid as rules, the static session's GR1), all on
// q = (|X|, |Y|) (the texture mirrored both ways; the team tint switching at Y = 0): a plaid of lighter and darker bands
// along X and Y; light paths between the pads and a light arc round the centre; dashed lines; a darker rim inside every
// grass edge (src/render/stadiumFieldRules.ts grassRim, its own mesh); and the team lines (the texture's alpha): three
// hatched lanes a quadrant and thin "circuit" traces, these generated from the measured statistics with a fixed seed
// (the user's decision, 2026-10-16: the same look-alike on every build), not traced.
import { type Pt } from "./arenaSurface";
import { grassHoles, grassOutline } from "./stadiumFieldRules";

/** The lattice the team lines are on (the texture's 128 texels: 6172.84 / 128 uu) */
const G = 48.225;

export const GRASS_PATTERN = {
  /** The plaid: its period (6172.84 / 12), a band light within this of its middle; the four levels (linear: dark/dark,
   *  light across X only (a band along Y), light across Y only, light/light); its edges' blend (uu) */
  plaid: {
    period: 514.4,
    light: 140.4,
    levels: [
      [0.032, 0.0511, 0.0273],
      [0.0431, 0.0708, 0.0383],
      [0.0534, 0.089, 0.0436],
      [0.0673, 0.1085, 0.0544],
    ] as readonly (readonly [number, number, number])[],
    edge: 6,
  },
  /** The rim: 2g wide inside every grass edge, drawn over the rest */
  rim: { width: 2 * G, colour: [0.0423, 0.0666, 0.0307] as const },
  /** The light paths: 2g wide, from the big pad (3072, 4096) along X - Y = -1024 to X = 55g, along it to Y 3164, along
   *  X - Y = -512 to X = 24g, along it to Y = 24g, then X = Y into the centre; and the light arc r 1060-1157 */
  paths: { width: 2 * G, colour: [0.0782, 0.1301, 0.0685] as const, bigPad: [3072, 4096] as Pt, first: -1024, turn: 55, down: 3164, second: -512, inner: 24, arc: [1060, 1157] as const },
  /** The dashed lines: 12 wide; along X = 838 for Y 1258-3005 (dashes 54 long every 108.5), and round r 1512.7 (dashes
   *  half their pitch long, their middles from 9 to 81.4 degrees) */
  dashes: { width: 12, colour: [0.181, 0.216, 0.171] as const, line: { x: 838, from: 1258, to: 3005, dash: 54, pitch: 108.5 }, arc: { r: 1512.7, from: 9, to: 81.4, pitch: 4.55 } },
  /** The team lines (alpha): weight sat(1.094 a) toward twice the team's primary; the lanes (4g wide, 6 uu outline at
   *  0.267, vertical hatch 0.129 / 0.0745 by frac(X / g)) in g: C [16, 20] chamfered (20, 26) to (16, 22); A [37, 41]
   *  chamfered (41, 12) to (37, 8); B [59, 63] chamfered (63, 26) to (59, 22), up to its bend at (61, 60) and on along
   *  X - Y = g */
  team: { weight: 1.094 },
  lanes: { g: G, outline: 6, alpha: { outline: 0.267, hatch: [0.129, 0.0745] as const } },
  /** The thin traces: 12.06 wide at 0.094; generated on the g lattice (rows from the goal end to Y = 0): a straight run
   *  ends with p 1/16 a row, then a 45 degree jog of 1-7 g (11/26/23/17/8/8/7 %) toward the wider side (p 0.7);
   *  neighbours 4g apart at least; a gap over 8g gets a trace (p 0.25 a row; AV-6a's 9g and its unstated p fitted to
   *  its statistics: 36 k uu a quadrant, about half vertical, 40 junctions, 9 loops) as a branch off a neighbour (p 0.85)
   *  or a new one; a run rejoins a neighbour 2-7 g off (p 0.02, a diamond); the lanes keep them 1g off, the edges 0.5g */
  traces: {
    width: 12.06,
    alpha: 0.094,
    seed: 1,
    runEnd: 1 / 16,
    jogs: [0.11, 0.26, 0.23, 0.17, 0.08, 0.08, 0.07] as const,
    wider: 0.7,
    gap: 4,
    spawnGap: 8,
    spawn: 0.25,
    branch: 0.85,
    rejoin: 0.02,
    laneMargin: 1,
    edgeMargin: 0.5,
  },
} as const;

/** The paths' centreline (q's quadrant), from the big pad in to the centre */
export function grassPathRoute(): Pt[] {
  const p = GRASS_PATTERN.paths;
  const [px, py] = p.bigPad;
  const turnX = p.turn * G;
  const innerX = p.inner * G;
  return [
    [px, py],
    [turnX, turnX - p.first],
    [turnX, p.down],
    [innerX, innerX - p.second],
    [innerX, innerX],
    [innerX / 2, innerX / 2],
  ];
}

const f = (v: number): string => v.toFixed(4);
const v3 = (c: readonly number[]): string => `vec3(${c.map(f).join(", ")})`;

/** GLSL: `grassRgb(q)` (the plaid, the paths and arc, the dashes: linear) and `grassLaneAlpha(q)` (the lanes' alpha) */
export function grassPatternGlsl(): string {
  const P = GRASS_PATTERN;
  const [dd, xl, yl, ll] = P.plaid.levels;
  const route = grassPathRoute();
  const segments = route.slice(1).map((b, k) => {
    const a = route[k] ?? b;
    return `d = min(d, grassSegment(q, vec2(${f(a[0])}, ${f(a[1])}), vec2(${f(b[0])}, ${f(b[1])})));`;
  });
  const [arc0, arc1] = P.paths.arc;
  const { line, arc } = P.dashes;
  const arcCount = Math.round((arc.to - arc.from) / arc.pitch);
  const arcPitch = (arc.to - arc.from) / arcCount;
  const L = P.lanes;
  const g = L.g;
  return /* glsl */ `
// (a band's coverage at a distance from its middle, its edge blended over 6 uu or a pixel or so)
float grassBand(float dist, float halfWidth) {
  float aa = max(${f(P.plaid.edge / 2)}, fwidth(dist) * 0.75);
  return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, dist);
}
float grassSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
vec3 grassRgb(vec2 q) {
  // The plaid: light across X where a band along Y is, across Y where one along X is
  float lx = grassBand(abs(fract(q.x / ${f(P.plaid.period)}) - 0.5) * ${f(P.plaid.period)}, ${f(P.plaid.light)});
  float ly = grassBand(abs(fract(q.y / ${f(P.plaid.period)}) - 0.5) * ${f(P.plaid.period)}, ${f(P.plaid.light)});
  vec3 rgb = mix(mix(${v3(dd ?? [])}, ${v3(xl ?? [])}, lx), mix(${v3(yl ?? [])}, ${v3(ll ?? [])}, lx), ly);
  // The light paths and the arc
  float d = 1e9;
  ${segments.join("\n  ")}
  float path = max(grassBand(d, ${f(P.paths.width / 2)}), grassBand(abs(length(q) - ${f((arc0 + arc1) / 2)}), ${f((arc1 - arc0) / 2)}));
  rgb = mix(rgb, ${v3(P.paths.colour)}, path);
  // The dashed lines: along X = 838, and round r 1512.7
  float along = q.y - ${f(line.from)};
  float lineDash = grassBand(abs(q.x - ${f(line.x)}), ${f(P.dashes.width / 2)})
    * grassBand(abs(mod(along, ${f(line.pitch)}) - ${f(line.dash / 2)}), ${f(line.dash / 2)})
    * step(0.0, along) * step(q.y, ${f(line.to)});
  float r = length(q);
  float theta = degrees(atan(q.y, max(q.x, 1e-3)));
  float k = clamp(floor((theta - ${f(arc.from)}) / ${f(arcPitch)} + 0.5), 0.0, ${f(arcCount)});
  float off = abs(theta - (${f(arc.from)} + k * ${f(arcPitch)})) * ${f(Math.PI / 180)} * r;
  float arcDash = grassBand(abs(r - ${f(arc.r)}), ${f(P.dashes.width / 2)}) * grassBand(off, ${f((arcPitch * Math.PI) / 180 / 4)} * r);
  return mix(rgb, ${v3(P.dashes.colour)}, max(lineDash, arcDash));
}
// A lane (uu): between x0 and x1, its end at the bottom cut at 45 degrees from (x1, yc) down to its tip at x0
float grassLaneSd(vec2 q, float x0, float x1, float yc) {
  return max(max(x0 - q.x, q.x - x1), (q.x - q.y - (x1 - yc)) * 0.7071068);
}
float grassLaneAlpha(vec2 q) {
  float c = grassLaneSd(q, ${f(16 * g)}, ${f(20 * g)}, ${f(26 * g)});
  float a = grassLaneSd(q, ${f(37 * g)}, ${f(41 * g)}, ${f(12 * g)});
  // (B: up to its bend, then along X - Y = g, the two meeting across the bend's perpendicular)
  float bUp = max(grassLaneSd(q, ${f(59 * g)}, ${f(63 * g)}, ${f(26 * g)}), q.y - ${f(62 * g)});
  float bOn = max(abs(q.x - q.y - ${f(g)}) * 0.7071068 - ${f(2 * g)}, (${f(121 * g)} - q.x - q.y) * 0.7071068);
  float sd = min(min(c, a), min(bUp, bOn));
  float aa = max(1.0, fwidth(sd) * 0.75);
  float inside = 1.0 - smoothstep(-aa, aa, sd);
  float outline = inside * smoothstep(-${f(L.outline)} - aa, -${f(L.outline)} + aa, sd);
  float stripe = fract(q.x / ${f(g)});
  float hatch = mix(${f(L.alpha.hatch[1])}, ${f(L.alpha.hatch[0])}, grassBand(abs(stripe - 0.25) * ${f(g)}, ${f(g / 4)}));
  return mix(hatch * inside, ${f(L.alpha.outline)}, outline);
}
`;
}

// --- The traces ------------------------------------------------------------------------------------------------------

/** A seeded uniform generator (mulberry32) */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inside(pts: readonly Pt[], x: number, y: number): boolean {
  let odd = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[i] ?? [0, 0];
    const [bx, by] = pts[j] ?? [0, 0];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) odd = !odd;
  }
  return odd;
}

function edgeDistance(pts: readonly Pt[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j] ?? [0, 0];
    const [bx, by] = pts[i] ?? [0, 0];
    const [dx, dy] = [bx - ax, by - ay];
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return best;
}

/** The lanes' signed distance (uu), as the shader's */
function laneDistance(x: number, y: number): number {
  const lane = (x0: number, x1: number, yc: number): number => Math.max(x0 - x, x - x1, (x - y - (x1 - yc)) * Math.SQRT1_2);
  const bUp = Math.max(lane(59 * G, 63 * G, 26 * G), y - 62 * G);
  const bOn = Math.max(Math.abs(x - y - G) * Math.SQRT1_2 - 2 * G, (121 * G - x - y) * Math.SQRT1_2);
  return Math.min(lane(16 * G, 20 * G, 26 * G), lane(37 * G, 41 * G, 12 * G), bUp, bOn);
}

/** Whether a lattice point (X, Y = i g, j g) may carry a trace: on the visible grass (out of the pieces over it and
 *  their 32 uu seams) by 0.5g, 1g off the lanes */
function traceGrid(): (i: number, j: number) => boolean {
  const T = GRASS_PATTERN.traces;
  const { outline, centre } = grassOutline();
  const seam = 32;
  const images = (mirror: string): Pt[] => (mirror === "xy" ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : mirror === "x" ? [[1, 1], [-1, 1]] : mirror === "y" ? [[1, 1], [1, -1]] : [[1, 1]]);
  const holes = grassHoles().flatMap((h) => images(h.mirror).map(([sx, sy]) => h.pts.map(([x, y]): Pt => [sx * x, sy * y])));
  const memo = new Map<number, boolean>();
  return (i, j) => {
    const key = i * 1000 + j;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const [x, y] = [i * G, j * G];
    const edge = T.edgeMargin * G;
    let ok = i >= 1 && j >= 1 && inside(outline, x, y) && edgeDistance(outline, x, y) >= edge && Math.hypot(x, y) >= centre + edge;
    ok &&= laneDistance(x, y) >= T.laneMargin * G;
    for (const h of holes) {
      if (!ok) break;
      ok = !inside(h, x, y) && edgeDistance(h, x, y) >= seam + edge;
    }
    memo.set(key, ok);
    return ok;
  };
}

/** The thin traces (q's quadrant, uu): segments [x0, y0, x1, y1], vertical or at 45 degrees on the g lattice; generated
 *  row by row from the goal end to Y = 0 by AV-6a's rules, with its fixed seed; the lanes' chamfer stubs with them */
export function grassTraces(): [number, number, number, number][] {
  // (generated once: every arena build draws the same, RX19-B)
  generatedTraces ??= generateTraces();
  return generatedTraces;
}

let generatedTraces: [number, number, number, number][] | null = null;

function generateTraces(): [number, number, number, number][] {
  const T = GRASS_PATTERN.traces;
  const rand = random(T.seed);
  const allowed = traceGrid();
  const top = Math.ceil(grassOutline().outline.reduce((m, [, y]) => Math.max(m, y), 0) / G);
  const right = Math.ceil(grassOutline().outline.reduce((m, [x]) => Math.max(m, x), 0) / G);
  const jog = (): number => {
    let u = rand();
    for (let n = 0; n < T.jogs.length; n++) {
      u -= T.jogs[n] ?? 0;
      if (u <= 0) return n + 1;
    }
    return T.jogs.length;
  };
  interface Trace {
    i: number;
    from: [number, number];
    jog: number;
    dir: number;
    /** a branch: its parent, ignored until its first jog is done */
    parent: Trace | null;
    young: number;
    /** rejoining this neighbour (its diamond) */
    toward: Trace | null;
  }
  const segments: [number, number, number, number][] = [];
  const end = (t: Trace, j: number): void => {
    if (t.from[0] !== t.i || t.from[1] !== j) segments.push([t.from[0], t.from[1], t.i, j]);
  };
  // (the lanes' stubs: from each chamfer's middle 45 degrees out 2g, then a trace on down)
  const stubs = [
    [16, 20, 26],
    [37, 41, 12],
    [59, 63, 26],
  ].map(([x0 = 0, x1 = 0, yc = 0]) => ({ i: x1, j: yc - 4, from: [x0 + 2, yc - 2] as [number, number] }));
  let traces: Trace[] = [];
  for (let j = top; j >= 1; j--) {
    const columns: number[] = [];
    for (let i = 0; i <= right; i++) if (allowed(i, j)) columns.push(i);
    // (those off the grass this row end)
    traces = traces.filter((t) => {
      if (allowed(t.i, j)) return true;
      end(t, j + 1);
      return false;
    });
    for (const s of stubs.filter((st) => st.j === j && allowed(st.i, j))) {
      segments.push([s.from[0], s.from[1], s.i, j]);
      traces.push({ i: s.i, from: [s.i, j], jog: 0, dir: 0, parent: null, young: 0, toward: null });
    }
    if (columns.length === 0) continue;
    traces.sort((a, b) => a.i - b.i);
    // Wide gaps (to a neighbour or the grass's edge, run by run) get a trace
    const runs: [number, number][] = [];
    let start = columns[0] ?? 0;
    for (let k = 1; k <= columns.length; k++) {
      const c = columns[k];
      const prev = columns[k - 1] ?? start;
      if (c === undefined || c !== prev + 1) {
        runs.push([start, prev]);
        start = c ?? 0;
      }
    }
    for (const [ra, rb] of runs) {
      const within = traces.filter((t) => t.i >= ra && t.i <= rb).map((t) => t.i);
      const stops = [ra - T.gap / 2, ...within, rb + T.gap / 2];
      for (let k = 0; k + 1 < stops.length; k++) {
        const [a, b] = [stops[k] ?? 0, stops[k + 1] ?? 0];
        if (b - a <= T.spawnGap || rand() >= T.spawn) continue;
        const at = Math.round((a + b) / 2 + Math.floor(rand() * 5) - 2);
        if (!allowed(at, j)) continue;
        const neighbours = traces.filter((t) => t.i === a || t.i === b);
        const parent = neighbours.length > 0 && rand() < T.branch ? neighbours[Math.floor(rand() * neighbours.length)] : undefined;
        if (parent) {
          const n = Math.min(Math.abs(at - parent.i), T.jogs.length);
          traces.push({ i: parent.i, from: [parent.i, j], jog: n, dir: at > parent.i ? 1 : -1, parent, young: n, toward: null });
        } else traces.push({ i: at, from: [at, j], jog: 0, dir: 0, parent: null, young: 0, toward: null });
      }
    }
    traces.sort((a, b) => a.i - b.i);
    // On a row: each straight on, jogging, rejoining or ending
    const next: Trace[] = [];
    traces.forEach((t, k) => {
      const left = traces[k - 1];
      const rightOne = traces[k + 1];
      if (t.jog === 0 && t.young === 0 && t.toward === null && rand() < T.rejoin) {
        const near = [left, rightOne].filter((u): u is Trace => u?.jog === 0 && Math.abs(u.i - t.i) >= 2 && Math.abs(u.i - t.i) <= T.jogs.length);
        const u = near[Math.floor(rand() * near.length)];
        if (u) {
          end(t, j);
          t.from = [t.i, j];
          t.jog = Math.abs(u.i - t.i);
          t.dir = u.i > t.i ? 1 : -1;
          t.toward = u;
        }
      }
      if (t.jog === 0 && rand() < T.runEnd) {
        const spaceLeft = t.i - (left ? left.i : (columns[0] ?? 0) - T.gap);
        const spaceRight = (rightOne ? rightOne.i : (columns[columns.length - 1] ?? 0) + T.gap) - t.i;
        let dir = spaceRight > spaceLeft ? 1 : -1;
        if (rand() >= T.wider) dir = -dir;
        end(t, j);
        t.from = [t.i, j];
        t.jog = jog();
        t.dir = dir;
      }
      let ni = t.i + (t.jog > 0 ? t.dir : 0);
      const others = next.filter((u) => !(t.young > 0 && u === t.parent) && u !== t.toward).map((u) => u.i);
      if (t.young > 0) t.young--;
      const clear = (c: number): boolean => j > 1 && allowed(c, j - 1) && others.every((o) => Math.abs(c - o) >= T.gap);
      let ok = clear(ni);
      if (!ok && t.jog > 0) {
        end(t, j);
        t.from = [t.i, j];
        t.jog = 0;
        ni = t.i;
        ok = clear(ni);
      }
      if (!ok) {
        end(t, j);
        // (against a neighbour: a 45 degree leg onto it, a T)
        const near = others.filter((o) => Math.abs(ni - o) < T.gap);
        const o = near.sort((p, q) => Math.abs(p - t.i) - Math.abs(q - t.i))[0];
        if (o !== undefined && j > 1) {
          const n = Math.abs(o - t.i);
          const s = Math.sign(o - t.i);
          let free = n > 0 && j - n >= 1;
          for (let m = 1; free && m <= n; m++) free = allowed(t.i + s * m, j - m);
          if (free) segments.push([t.i, j, o, j - n]);
        }
        return;
      }
      if (t.jog > 0) {
        t.i = ni;
        t.jog--;
        if (t.jog === 0) {
          end(t, j - 1);
          t.from = [t.i, j - 1];
          if (t.toward) return; // (rejoined: its diamond closed)
        }
      }
      next.push(t);
    });
    traces = next;
  }
  for (const t of traces) end(t, 1);
  return segments.map(([i0, j0, i1, j1]) => [i0 * G, j0 * G, i1 * G, j1 * G]);
}
