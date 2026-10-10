// The stadium's screens, ads and near-field props (notes/arena-surroundings.md SUR-9, 10, 13, 17..19): the panels with
// their formulas and our own emblems (no ad artwork), the scaffolds' banners, the corner flags and the light arrows.
import { BoxGeometry, type Color, DoubleSide, Group, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from "three";
import { fullBright } from "../teamColors";
import { BOWL_COLOURS, seenMaterial } from "./stadiumSurroundings";

// --- Screens, ads, the near-field props (SUR-9, 10, 13, 17..19) -----------------------------------------------------

/** A panel's placement (game frame): its centre, size (uu), and tilt down (degrees); it faces the arena's centre */
interface Panel {
  readonly at: readonly [number, number, number];
  readonly size: readonly [number, number];
  readonly tilt?: number;
}

export const PANELS = {
  /** The big screens (Scoreboard_MIC): low over the back, high over the ends */
  screens: [
    { at: [-21851, 5448, 3670], size: [2279, 1152] },
    { at: [-21851, -5448, 3670], size: [2279, 1152] },
    { at: [-5765, 17700, 10260], size: [3038, 1536], tilt: 34 },
    { at: [-5765, -17700, 10260], size: [3038, 1536], tilt: 34 },
  ] as readonly Panel[],
  /** The ads (2x1 and 4x1: the offline default, a dark panel and a small emblem: SUR-18) */
  ads: [
    { at: [18453, 13440, 6900], size: [5697, 2880] },
    { at: [18453, -13440, 6900], size: [5317, 2688] },
  ] as readonly Panel[],
  billboards: [
    { at: [12160, 19300, 5040], size: [2560, 640] },
    { at: [12160, -19300, 5040], size: [2560, 640] },
    { at: [-20600, 8600, 5104], size: [2560, 640] },
    { at: [-20600, -8600, 5104], size: [2560, 640] },
  ] as readonly Panel[],
} as const;

/** The near-field props (SUR-10): banner scaffolds (273 x 273 x 1049) behind the goals and beside the side walls,
 *  corner flags (2000 x 790, z 360 up) and the corners' arrow arrays (z 384-512) */
export const PROPS = {
  scaffolds: [[2048, 6144], [-2048, 6144], [2048, -6144], [-2048, -6144], [4736, 1024], [-4736, 1024], [4736, -1024], [-4736, -1024]] as readonly (readonly [number, number])[],
  scaffold: [273, 1049] as const,
  flags: [[3450, 4850], [-3450, 4850], [3450, -4850], [-3450, -4850]] as readonly (readonly [number, number])[],
  flag: { size: [2000, 790] as const, z: 360 },
  arrows: [[3312, 4352], [-3312, 4352], [3312, -4352], [-3312, -4352]] as readonly (readonly [number, number])[],
  arrow: { z: [384, 512] as const, width: 600, behindWall: 5870 },
} as const;

const panelVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** SUR-17 and 18: D = 0.5 (1.1875 - (2v - 1)^4)(base + 0.35 noise), shown D (1 + L). A screen's base: lerp(0.125 + e C,
 *  logo) with C = 8/3 (FB + P) - 0.125 by the side and e = sat(32 (|2v - 1| - 0.75)) (team bars over the top and
 *  bottom eighths), our emblem (14 % of it, (0.67, 0.76, 0.85)); an ad's: 0.053 with a centred 0.59 emblem */
/** The panels' (1 + L), their baked light (RV-126: from SUR-17's and SUR-18's totals): the low screens, warm; the high
 *  screens; the 2x1 ads, warm; the 4x1 billboards */
export const PANEL_LIGHT = { lowScreen: [2.8, 2.5, 1.9], highScreen: [1.25, 1.25, 1.25], ad: [2.4, 2.3, 2.0], billboard: [1.4, 1.4, 1.4] } as const;
/** Our screen logo (SUR-40's stand-in, 14 % of the screen in uv 0.12-0.90 x 0.34-0.66: RV-127a): a ring and a bar */
export const SCREEN_LOGO = { centre: [0.51, 0.5], half: [0.42, 0.15], ringAspect: 2.8, ring: 0.65, stroke: 0.45, bar: 0.42, barX: 0.92, colour: [0.67, 0.76, 0.85] } as const;

/** Whether the screen logo covers (u, v) (the shader's, for tests) */
export function screenLogo(u: number, v: number): boolean {
  const L = SCREEN_LOGO;
  const [qx, qy] = [(u - L.centre[0]) / L.half[0], (v - L.centre[1]) / L.half[1]];
  return Math.abs(Math.hypot(qx * L.ringAspect, qy) - L.ring) < L.stroke || (Math.abs(qy) < L.bar && Math.abs(qx) < L.barX);
}

/** The ads' emblems' radii (11 % of a 2x1 ad, 21 % of a 4x1 billboard), in the panel's half-width units */
export const AD_EMBLEM = { ad: Math.sqrt((0.11 * 2) / Math.PI), billboard: Math.sqrt((0.21 * 2) / Math.PI) } as const;

/** A panel's colour at (u, v) (the shader's, for tests): a screen on side t (0 the blue -y, 1 the orange +y) with the
 *  teams' primaries and full brights, or an ad with its emblem's radius; times its light */
export function panelColour(
  u: number,
  v: number,
  panel: { screen: true; t: number; p: readonly [readonly number[], readonly number[]]; fb: readonly [readonly number[], readonly number[]] } | { screen: false; emblem: number },
  light: readonly number[],
): [number, number, number] {
  const w = 2 * v - 1;
  const shade = 0.5 * (1.1875 - w ** 4);
  return [0, 1, 2].map((k) => {
    let base: number;
    if (panel.screen) {
      const mix = (a: readonly number[], b: readonly number[]): number => (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * panel.t;
      const C = (8 / 3) * (mix(panel.fb[0], panel.fb[1]) + mix(panel.p[0], panel.p[1])) - 0.125;
      const e = Math.min(Math.max(32 * (Math.abs(w) - 0.75), 0), 1);
      base = screenLogo(u, v) ? (SCREEN_LOGO.colour[k] ?? 0) : 0.125 + e * C;
    } else base = Math.hypot((u - 0.5) * 2, v - 0.5) < panel.emblem ? 0.59 : 0.053;
    return shade * (base + 0.35 * 0.225) * (light[k] ?? 1);
  }) as [number, number, number];
}

const panelFragment = /* glsl */ `
uniform bool screen;
uniform float emblem;
uniform vec3 light;
uniform vec3 primary0;
uniform vec3 primary1;
uniform vec3 bright0;
uniform vec3 bright1;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float v = 2.0 * vUv.y - 1.0;
  vec3 base;
  if (screen) {
    float t = clamp(vWorld.z / 256.0 + 0.5, 0.0, 1.0);
    vec3 C = (8.0 / 3.0) * (mix(bright0, bright1, t) + mix(primary0, primary1, t)) - 0.125;
    float e = clamp(32.0 * (abs(v) - 0.75), 0.0, 1.0);
    // (our logo: screenLogo)
    vec2 q = (vUv - vec2(${SCREEN_LOGO.centre.join(", ")})) / vec2(${SCREEN_LOGO.half.join(", ")});
    bool logo = abs(length(q * vec2(${SCREEN_LOGO.ringAspect}, 1.0)) - ${SCREEN_LOGO.ring}) < ${SCREEN_LOGO.stroke} || (abs(q.y) < ${SCREEN_LOGO.bar} && abs(q.x) < ${SCREEN_LOGO.barX});
    base = logo ? vec3(${SCREEN_LOGO.colour.join(", ")}) : vec3(0.125) + e * C;
  } else {
    vec2 q = (vUv - 0.5) * vec2(2.0, 1.0);
    base = vec3(length(q) < emblem ? 0.59 : 0.053);
  }
  vec3 d = 0.5 * (1.1875 - v * v * v * v) * (base + 0.35 * 0.225);
  gl_FragColor = vec4(d * light, 1.0);
  #include <colorspace_fragment>
}
`;

/** Basic_Orange_Mat's sat(1.5 (D - 0.25)) at its texture's mean D, 0.317 (fit to SUR-19's banner colours) */
export const BANNER_D_TERM = Math.min(Math.max(1.5 * (0.317 - 0.25), 0), 1);

/** A banner's colour for a team's linear primary: 2 T + BANNER_D_TERM, clamped at 1.5, T = P + (FB - P)/16 (SUR-19) */
export function bannerColour(c: Color): [number, number, number] {
  const f = fullBright([c.r, c.g, c.b]);
  const t = [c.r + (f[0] - c.r) / 16, c.g + (f[1] - c.g) / 16, c.b + (f[2] - c.b) / 16];
  return t.map((v) => Math.min(1.5, 2 * v + BANNER_D_TERM)) as [number, number, number];
}

/** SUR-19: the scaffolds' banners (Basic_Orange_Mat), the team's colour, T = P + (FB - P)/16, doubled and clamped at 1.5
 *  (blue (0.29, 1.03, 1.5), orange (1.5, 0.9, 0.27)); the corner flags the team's with a light stripe (SUR-43's stand-in;
 *  the game's flag art can't ship); the arrows pulse once a second */
const propFragment = /* glsl */ `
uniform vec3 colour;
uniform float pulse;
uniform bool stripe;
uniform float time;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float glow = pulse > 0.0 ? 0.5 * (1.0 + sin(6.2831853 * (time + pulse))) : 1.0;
  // (an arrow's chevrons along it)
  if (pulse > 0.0 && abs(fract(vUv.x * 4.0 + abs(vUv.y - 0.5)) - 0.5) > 0.2) discard;
  vec3 c = colour;
  if (stripe) c = abs(vUv.y - 0.5) < 0.12 ? vec3(0.85, 0.85, 0.8) : 0.6 * colour;
  gl_FragColor = vec4(c * glow, 1.0);
  #include <colorspace_fragment>
}
`;

/** A panel facing the arena's centre (its normal level, tilted down by `tilt`) */
function panelMesh(panel: Panel, material: ShaderMaterial): Mesh {
  const mesh = new Mesh(new PlaneGeometry(panel.size[0], panel.size[1]), material);
  const [x, y, z] = panel.at;
  // (Three's frame: x, z up, the game's y)
  mesh.position.set(x, z, y);
  mesh.lookAt(0, z, 0);
  // (tilted down toward the field: its face's normal pointing down to the capture point, RV-121)
  if (panel.tilt) mesh.rotateX((panel.tilt * Math.PI) / 180);
  return mesh;
}

/** The screens, ads, billboards and near-field props; `update(seconds)` pulses the arrows */
export function buildScreensAndProps(primary0: Color, primary1: Color): { group: Group; update(seconds: number): void } {
  const group = new Group();
  group.name = "stadium screens and props";
  const b = (c: Color): Vector3 => new Vector3(...fullBright([c.r, c.g, c.b]));
  const panelMaterial = (screen: boolean, emblem: number, light: readonly number[]): ShaderMaterial =>
    new ShaderMaterial({
      vertexShader: panelVertex,
      fragmentShader: panelFragment,
      uniforms: {
        screen: { value: screen },
        emblem: { value: emblem },
        light: { value: new Vector3(light[0], light[1], light[2]) },
        primary0: { value: primary0 },
        primary1: { value: primary1 },
        bright0: { value: b(primary0) },
        bright1: { value: b(primary1) },
      },
      side: DoubleSide,
    });
  const lowScreen = panelMaterial(true, 0, PANEL_LIGHT.lowScreen);
  const highScreen = panelMaterial(true, 0, PANEL_LIGHT.highScreen);
  // (the emblems' radii for 11 % of a 2x1 ad and 21 % of a 4x1 billboard, in the panel's half-width units)
  const adMaterial = panelMaterial(false, AD_EMBLEM.ad, PANEL_LIGHT.ad);
  const billboardMaterial = panelMaterial(false, AD_EMBLEM.billboard, PANEL_LIGHT.billboard);
  for (const s of PANELS.screens) group.add(panelMesh(s, s.tilt ? highScreen : lowScreen));
  for (const a of PANELS.ads) group.add(panelMesh(a, adMaterial));
  for (const bb of PANELS.billboards) group.add(panelMesh(bb, billboardMaterial));
  // The props: team-coloured by side (y < 0 blue)
  const time = { value: 0 };
  const teamColour = (c: Color): Vector3 => new Vector3(...bannerColour(c));
  const propMaterial = (colour: Vector3, pulse = 0, stripe = false): ShaderMaterial =>
    new ShaderMaterial({
      vertexShader: panelVertex,
      fragmentShader: propFragment,
      uniforms: { colour: { value: colour }, pulse: { value: pulse }, stripe: { value: stripe }, time },
      side: DoubleSide,
    });
  const metal = seenMaterial(BOWL_COLOURS.steel, 0.02);
  const [w, h] = PROPS.scaffold;
  PROPS.scaffolds.forEach(([x, y]) => {
    const tower = new Mesh(new BoxGeometry(w, h, w), metal);
    tower.position.set(x, h / 2, y);
    const banner = new Mesh(new PlaneGeometry(w * 0.9, h * 0.6), propMaterial(teamColour(y < 0 ? primary0 : primary1)));
    banner.position.set(x, h * 0.55, y - Math.sign(y) * (w / 2 + 2));
    banner.lookAt(0, h * 0.55, 0);
    group.add(tower, banner);
  });
  PROPS.flags.forEach(([x, y]) => {
    const flag = new Mesh(new PlaneGeometry(PROPS.flag.size[0], PROPS.flag.size[1]), propMaterial(teamColour(y < 0 ? primary0 : primary1), 0, true));
    flag.position.set(x, PROPS.flag.z + PROPS.flag.size[1] / 2, y);
    // (along the corner's cut, as SUR-10's bounds (2.0k x 1.5k) lie, facing in: clear of the cage all along it, RV-116)
    flag.lookAt(flag.position.x - Math.sign(x), flag.position.y, flag.position.z - Math.sign(y));
    group.add(flag);
  });
  PROPS.arrows.forEach(([x, y], k) => {
    const [z0, z1] = PROPS.arrow.z;
    const arrow = new Mesh(new PlaneGeometry(PROPS.arrow.width, z1 - z0), propMaterial(new Vector3(1.2, 1.1, 0.8), 0.25 * k + 0.001));
    // (behind the corner's wall: the placement's point falls inside our wall's line, 5748 out along it; 5870 clears
    // the corner's cut, |x| + |y| = 8064, by 150)
    const r = Math.max(Math.hypot(x, y), PROPS.arrow.behindWall);
    const a = Math.atan2(y, x);
    arrow.position.set(r * Math.cos(a), (z0 + z1) / 2, r * Math.sin(a));
    // (along the corner's cut, facing in)
    arrow.lookAt(arrow.position.x - Math.sign(x), arrow.position.y, arrow.position.z - Math.sign(y));
    group.add(arrow);
  });
  return {
    group,
    update: (seconds) => {
      time.value = seconds;
    },
  };
}
