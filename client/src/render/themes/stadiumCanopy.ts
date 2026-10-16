// The glass canopy as the game's pieces (notes/arena-surroundings.md SUR-6, TRN-19..24): per quarter four sloped
// panels (Stadium_Glass: one-sided, the inner skin facing the field) and four vertical fins (Stadium_Glass_02:
// two-sided, one layer), meeting at the fins; each end instance mirror-symmetric about az 108 (the -Y one the +Y's
// mirrored); between F4 and its mirror an open wedge over the end's centre. The glass as SUR-15's.
import { detailMode } from "../detail";
import { BufferGeometry, type Color, DoubleSide, Float32BufferAttribute, FrontSide, Group, Mesh, ShaderMaterial, Vector3 } from "three";
import { fullBright } from "../teamColors";
import { PRIORITY } from "../translucentSort";

type AzRZ = readonly [number, number, number];

/** The +Y instance's quarter below az 108 (game frame; (az, r, z) from the field's centre): the panels' surfaces,
 *  z = a u² + b u + c along u = x cos phi + y sin phi, and their outlines' corners (inner edge, outer edge, P1's free
 *  side); the fins' planes (their horizontal direction), their corners (inner top, inner bottom, outer top, outer
 *  bottom: the outer edge vertical) and their top and bottom edges as z(r) quadratics (TRN-21..24) */
export const CANOPY = {
  mirrorAz: 108,
  panels: [
    { phi: 45.33, abc: [-7.548e-5, 2.38854, -9543] as const, outline: [[57.58, 20129, 8270], [60.17, 20077, 8468], [60.67, 26056, 2741], [57.44, 26017, 2191], [54.33, 24939, 3708], [54.83, 20800, 7659]] as readonly AzRZ[] },
    { phi: 54.04, abc: [-3.873e-5, 0.905299, 5854] as const, outline: [[66.91, 18119, 9802], [69.27, 17747, 10077], [69.43, 26077, 4084], [66.1, 26108, 3610]] as readonly AzRZ[] },
    { phi: 67.29, abc: [-2.397e-5, 0.398431, 10572] as const, outline: [[79.15, 16231, 10909], [82.19, 15919, 11083], [78.54, 25962, 5201], [75.07, 26034, 4817]] as readonly AzRZ[] },
    { phi: 81.18, abc: [-1.753e-5, 0.21069, 12098] as const, outline: [[92.06, 15028, 11461], [98.55, 14728, 11611], [88.06, 25778, 6056], [84.43, 25868, 5775]] as readonly AzRZ[] },
  ],
  fins: [
    { dir: 60.7, corners: [[62.25, 19062, 9074], [62.26, 18964, 8584], [61.66, 26082, 2920], [61.66, 26082, 368]] as readonly AzRZ[], top: [-6.18e-5, 1.92999, -5301] as const, bottom: [-4.948e-5, 1.08095, 5859] as const },
    { dir: 66.01, corners: [[73.01, 17090, 10400], [73.05, 16982, 9889], [70.46, 26079, 4238], [70.46, 26079, 1686]] as readonly AzRZ[], top: [-3.529e-5, 0.846453, 6209] as const, bottom: [-3.01e-5, 0.399239, 11769] as const },
    { dir: 69.43, corners: [[87.04, 15418, 11251], [87.15, 15325, 10746], [79.62, 25947, 5325], [79.62, 25947, 2773]] as readonly AzRZ[], top: [-2.255e-5, 0.375171, 10802] as const, bottom: [-2.118e-5, 0.128101, 13739] as const },
    { dir: 71.58, corners: [[104.37, 14532, 11610], [104.62, 14442, 11100], [89.2, 25755, 6146], [89.2, 25755, 3594]] as readonly AzRZ[], top: [-1.787e-5, 0.237035, 11915] as const, bottom: [-1.63e-5, -0.003979, 14536] as const },
  ],
} as const;

const rad = Math.PI / 180;
const quad = (c: readonly number[], v: number): number => (c[0] ?? 0) * v * v + (c[1] ?? 0) * v + (c[2] ?? 0);

/** An angle mirrored: about az 108 (the instance's own symmetry), and to the -Y instance (y -> -y) */
const mirrored = (az: number, aboutEnd: boolean, minusY: boolean): number => {
  const a = aboutEnd ? 2 * CANOPY.mirrorAz - az : az;
  return minusY ? -a : a;
};

/** A panel's surface in each of its four places: its plan outline cut into strips across u, z from its quadratic;
 *  wound to face the field (Three's frame) */
function panelGeometry(panel: (typeof CANOPY.panels)[number], aboutEnd: boolean, minusY: boolean, out: number[]): void {
  const phi = mirrored(panel.phi, aboutEnd, minusY) * rad;
  const [cu, su] = [Math.cos(phi), Math.sin(phi)];
  const plan = panel.outline.map(([az, r]) => {
    const a = mirrored(az, aboutEnd, minusY) * rad;
    return [r * Math.cos(a), r * Math.sin(a)] as const;
  });
  const uOf = ([x, y]: readonly [number, number]): number => x * cu + y * su;
  const us = plan.map(uOf);
  const [u0, u1] = [Math.min(...us), Math.max(...us)];
  // (the outline's two ends across u: where the line u = const cuts it, a convex polygon)
  const cut = (u: number): [readonly [number, number], readonly [number, number]] => {
    const hits: (readonly [number, number])[] = [];
    plan.forEach((p, i) => {
      const q = plan[(i + 1) % plan.length] ?? p;
      const [a, b] = [uOf(p) - u, uOf(q) - u];
      if ((a <= 0 && b >= 0) || (a >= 0 && b <= 0)) {
        const t = a === b ? 0 : a / (a - b);
        hits.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    });
    // (the two farthest apart along the cut)
    let [best, bi, bj] = [-1, 0, 0];
    hits.forEach((p, i) => {
      hits.forEach((q, j) => {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d > best) [best, bi, bj] = [d, i, j];
      });
    });
    // (in order across the panel, so the strips don't twist)
    const zero: readonly [number, number] = [0, 0];
    const [p, q] = [hits[bi] ?? zero, hits[bj] ?? zero];
    const across = (h: readonly [number, number]): number => -h[0] * su + h[1] * cu;
    return across(p) <= across(q) ? [p, q] : [q, p];
  };
  const steps = 10;
  const point = (p: readonly [number, number]): number[] => [p[0], quad(panel.abc, uOf(p)), p[1]];
  let previous: number[][] | null = null;
  for (let k = 0; k <= steps; k++) {
    // (a hair inside the ends: the cut through a corner)
    const u = u0 + (u1 - u0) * (k === 0 ? 1e-4 : k === steps ? 1 - 1e-4 : k / steps);
    const [a, b] = cut(u);
    const row = [point(a), point(b)];
    if (previous) {
      const [p0 = [], p1 = []] = previous;
      const [r0 = [], r1 = []] = row;
      // (facing the field: the normal's horizontal part toward the centre, then down)
      const n = new Vector3(...(r0 as [number, number, number])).sub(new Vector3(...(p0 as [number, number, number]))).cross(new Vector3(...(p1 as [number, number, number])).sub(new Vector3(...(p0 as [number, number, number]))));
      const toward = new Vector3(-(p0[0] ?? 0), 0, -(p0[2] ?? 0));
      const tris = n.dot(toward) > 0 ? [p0, r0, p1, p1, r0, r1] : [p0, p1, r0, p1, r1, r0];
      for (const v of tris) out.push(...v);
    }
    previous = row;
  }
}

/** A fin's band in each of its places: along its plane from its inner end to its outer edge, between its top and
 *  bottom edges (Three's frame) */
function finGeometry(fin: (typeof CANOPY.fins)[number], aboutEnd: boolean, minusY: boolean, out: number[]): void {
  const dir = mirrored(fin.dir, aboutEnd, minusY) * rad;
  // (direction along the plane, outward)
  const d = [Math.cos(dir), Math.sin(dir)];
  const [, , outer] = fin.corners;
  const oa = mirrored(outer?.[0] ?? 0, aboutEnd, minusY) * rad;
  const o = [(outer?.[1] ?? 0) * Math.cos(oa), (outer?.[1] ?? 0) * Math.sin(oa)];
  if ((d[0] ?? 0) * (o[0] ?? 0) + (d[1] ?? 0) * (o[1] ?? 0) < 0) [d[0], d[1]] = [-(d[0] ?? 0), -(d[1] ?? 0)];
  // (the plane's point at distance r from the centre, on the inner side of the outer edge)
  const at = (r: number): [number, number] => {
    const [ox = 0, oy = 0] = o;
    const [dx = 0, dy = 0] = d;
    const b = ox * dx + oy * dy;
    const c = ox * ox + oy * oy - r * r;
    const s = -b - Math.sqrt(Math.max(b * b - c, 0));
    return [ox + s * dx, oy + s * dy];
  };
  const [innerTop, innerBottom] = fin.corners;
  const rOut = outer?.[1] ?? 0;
  const steps = 10;
  for (let k = 0; k < steps; k++) {
    const t = (j: number, r0: number): number => r0 + ((rOut - r0) * j) / steps;
    const [rt0, rt1] = [t(k, innerTop?.[1] ?? 0), t(k + 1, innerTop?.[1] ?? 0)];
    const [rb0, rb1] = [t(k, innerBottom?.[1] ?? 0), t(k + 1, innerBottom?.[1] ?? 0)];
    const v = (r: number, z: number): number[] => {
      const [x, y] = at(r);
      return [x, z, y];
    };
    const [a, b, c, e] = [v(rt0, quad(fin.top, rt0)), v(rb0, quad(fin.bottom, rb0)), v(rt1, quad(fin.top, rt1)), v(rb1, quad(fin.bottom, rb1))];
    for (const p of [a, b, c, c, b, e]) out.push(...p);
  }
}

/** The glass (SUR-15: unlit, alpha 0.5, emissive 2 (R² + R + 1/16) FB(team), R = sat(1.12 - 1.13e-4 z), team by the
 *  side of the field) */
function glassMaterial(bright0: readonly number[], bright1: readonly number[], twoSided: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 bright0;
      uniform vec3 bright1;
      varying vec3 vWorld;
      void main() {
        float r = clamp(1.12 - 1.13e-4 * vWorld.y, 0.0, 1.0);
        vec3 fb = vWorld.z < 0.0 ? bright0 : bright1;
        gl_FragColor = vec4(2.0 * (r * r + r + 0.0625) * fb, 0.5);
        #include <colorspace_fragment>
      }`,
    uniforms: { bright0: { value: new Vector3(bright0[0], bright0[1], bright0[2]) }, bright1: { value: new Vector3(bright1[0], bright1[1], bright1[2]) } },
    transparent: true,
    depthWrite: false,
    side: twoSided ? DoubleSide : FrontSide,
  });
}

/** The canopy: its panels (one-sided, -9) and fins (two-sided, -7), all four quarters */
export function buildCanopy(primary0: Color, primary1: Color): Group {
  const bright = (c: Color): number[] => fullBright([c.r, c.g, c.b]);
  const [panels, fins]: [number[], number[]] = [[], []];
  for (const minusY of [false, true]) {
    for (const aboutEnd of [false, true]) {
      for (const p of CANOPY.panels) panelGeometry(p, aboutEnd, minusY, panels);
      for (const f of CANOPY.fins) finGeometry(f, aboutEnd, minusY, fins);
    }
  }
  const mesh = (position: number[], twoSided: boolean, name: string, priority: number): Mesh => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(position, 3));
    g.computeBoundingSphere();
    const m = new Mesh(g, glassMaterial(bright(primary0), bright(primary1), twoSided));
    m.name = name;
    m.renderOrder = priority;
    return m;
  };
  const group = new Group();
  group.name = "canopy";
  // (Stadium_Glass and _02: DetailMode Medium, gone at World Detail Performance: QG-14)
  detailMode(group, "medium");
  group.add(mesh(panels, false, "bowl: canopy", PRIORITY.canopy), mesh(fins, true, "bowl: canopy fins", PRIORITY.canopy2));
  return group;
}
