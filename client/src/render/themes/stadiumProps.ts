// The stadium's screens, ads and near-field props (notes/arena-surroundings.md SUR-9, 10, 13, 17..19): the panels with
// their formulas and our own emblems (no ad artwork), the scaffolds' banners, the corner flags and the light arrows.
import { BoxGeometry, BufferGeometry, type Color, DoubleSide, Float32BufferAttribute, Group, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from "three";
import { fullBright } from "../teamColors";
import { GRASS_CUBE_AT } from "../grassCube";
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
 *  the corner flags and the corners' arrow arrays (z 384-512) */
export const PROPS = {
  scaffolds: [[2048, 6144], [-2048, 6144], [2048, -6144], [-2048, -6144], [4736, 1024], [-4736, 1024], [4736, -1024], [-4736, -1024]] as readonly (readonly [number, number])[],
  scaffold: [273, 1049] as const,
  /** Each scaffold's banner light L (the placements' lightmaps seen from the capture point, SUR-19 and RV-150: the
   *  +X ones about 0.5, the -X ones 0.2-0.3), in `scaffolds`' order; the banner seen is its colour times L */
  scaffoldLight: [
    [0.49, 0.44, 0.32],
    [0.27, 0.24, 0.19],
    [0.53, 0.48, 0.36],
    [0.29, 0.27, 0.21],
    [0.52, 0.47, 0.33],
    [0.22, 0.19, 0.14],
    [0.52, 0.47, 0.33],
    [0.29, 0.25, 0.18],
  ] as readonly (readonly [number, number, number])[],
  /** The corner flags (SUR-10, 19: the static session's measures): each corner 5 poles on an arc (r 6185), 5.62 degrees
   *  apart from its first; the -Y corners the +Y ones turned, not mirrored (RV-153c); a pole 15.5 across from z -1 to
   *  751 with an 88 arm at its top, beside its banner (77 back along the arc, 20 toward the field: RV-153a); its banner
   *  133 x 559 (z 175 to 734), a shaped cloth (81 % of it), facing the field, a strip over its top (z 634 to 751), 2 in
   *  front of it (RV-153b); opaque, two-sided: col = albedo + 0.25 GrassCube, times L (RV-153e). The cloth's mean
   *  albedo 2 T + 0.295 as the texture's two parts (our own design: a light band over the team's colour), 57 % team at
   *  3.51 T and 43 % light at 0.686 (E[X.R (1 - w)] and E[X.R X.A w] over their shares: the capture's per-pixel clip
   *  sees them apart), in the corner's flat light (+X: orange (0.83, 0.75, 0.55), blue (0.76, 0.68, 0.51); -X (0.45,
   *  0.41, 0.31)); the strip's 3.15 T, in one light at every corner (RV-153d); the pole's grey metal as seen (CAL1:
   *  +X (0.44, 0.44, 0.29), -X (0.30, 0.27, 0.18), RV-153f) */
  flags: {
    r: 6185,
    /** each corner's first flag, degrees round from +X (atan2(y, x)); whether it's a +X corner */
    groups: [
      { first: 43.8, plusX: true },
      { first: 113.6, plusX: false },
      { first: 222.6, plusX: false },
      { first: 294.9, plusX: true },
    ] as readonly { first: number; plusX: boolean }[],
    step: 5.62,
    count: 5,
    poleShape: { width: 15.5, z: [-1, 751] as const, arm: 88, along: -77, toward: 20 },
    banner: { width: 133, z: [175, 734] as const, cloth: 0.81 },
    strip: { z: [634, 751] as const, toward: 2 },
    /** the cloth's parts (the light band across v 0.45-0.721: 43 % of what shows under the strip) and the strip's */
    albedo: { team: 3.51, light: 0.686, lightShare: 0.43, band: [0.45, 0.721] as const, strip: [3.152, 0.002] as const },
    light: { plusXOrange: [0.83, 0.75, 0.55], plusXBlue: [0.76, 0.68, 0.51], minusX: [0.45, 0.41, 0.31], strip: [0.52, 0.48, 0.36] } as const,
    pole: { plusX: [0.44, 0.44, 0.29], minusX: [0.3, 0.27, 0.18] } as const,
    /** The GrassCube seen back toward the field from the flags (its mean there: the poles' cube terms') */
    cube: 0.25,
  },
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
export const PANEL_LIGHT = { lowScreen: [2.8, 2.5, 1.9], highScreen: [1.29, 1.26, 1.18], ad: [2.43, 2.27, 1.82], billboard: [1.35, 1.33, 1.22] } as const;
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

/** Basic_Orange_Mat's sat(1.5 (D - 0.25)): its mean over Park_BannerScaffold_D, per channel (SUR-19) */
export const BANNER_D_TERM = 0.153;

/** A banner's colour for a team's linear primary (SUR-19, RV-127d): c0 = 0.5 lerp(W, 4 T, 1) + sat(1.5 (D - 0.25)) = 2 T
 *  + 0.153 (the texture's mean of that term), then the saturation boost c = clamp(c0 + 0.15 (c0 - lum c0), 0, 1.5); T = P
 *  + (FB - P)/16 */
export function bannerColour(c: Color): [number, number, number] {
  const f = fullBright([c.r, c.g, c.b]);
  const t = [c.r + (f[0] - c.r) / 16, c.g + (f[1] - c.g) / 16, c.b + (f[2] - c.b) / 16];
  const c0 = t.map((v) => 2 * v + BANNER_D_TERM);
  const lum = 0.3 * (c0[0] ?? 0) + 0.59 * (c0[1] ?? 0) + 0.11 * (c0[2] ?? 0);
  return c0.map((v) => Math.min(Math.max(v + 0.15 * (v - lum), 0), 1.5)) as [number, number, number];
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

/** A corner's flag colours (linear, as seen: SUR-19, RV-153) for its team's linear primary: the cloth's team part and
 *  light band, the strip's and the pole's */
export function flagColours(primary: Color, plusX: boolean, orange: boolean): { team: number[]; light: number[]; strip: number[]; pole: number[] } {
  const F = PROPS.flags;
  const A = F.albedo;
  const fb = fullBright([primary.r, primary.g, primary.b]);
  const t = [primary.r + (fb[0] - primary.r) / 16, primary.g + (fb[1] - primary.g) / 16, primary.b + (fb[2] - primary.b) / 16];
  const L = !plusX ? F.light.minusX : orange ? F.light.plusXOrange : F.light.plusXBlue;
  const cube = 0.25 * F.cube;
  return {
    team: t.map((v, c) => (A.team * v + cube) * (L[c] ?? 1)),
    light: L.map((l) => (A.light + cube) * l),
    strip: t.map((v, c) => (A.strip[0] * v + A.strip[1] + cube) * (F.light.strip[c] ?? 1)),
    pole: [...(plusX ? F.pole.plusX : F.pole.minusX)],
  };
}

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

/** The screens, ads, billboards and near-field props; `update(elapsedSeconds)` pulses the arrows */
export function buildScreensAndProps(primary0: Color, primary1: Color): { group: Group; update(elapsedSeconds: number): void } {
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
  PROPS.scaffolds.forEach(([x, y], k) => {
    const tower = new Mesh(new BoxGeometry(w, h, w), metal);
    tower.position.set(x, h / 2, y);
    // (its team's colour in the placement's light: RV-150)
    const light = PROPS.scaffoldLight[k] ?? [1, 1, 1];
    const colour = teamColour(y < 0 ? primary0 : primary1).multiply(new Vector3(...light));
    const banner = new Mesh(new PlaneGeometry(w * 0.9, h * 0.6), propMaterial(colour));
    banner.position.set(x, h * 0.55, y - Math.sign(y) * (w / 2 + 2));
    banner.lookAt(0, h * 0.55, 0);
    banner.name = "props: scaffold banner";
    group.add(tower, banner);
  });
  // The corner flags: poles on an arc, each with its banner and strip, facing the field
  const F = PROPS.flags;
  const flagMaterial = (rgb: readonly number[], band: readonly number[] | null = null): ShaderMaterial =>
    new ShaderMaterial({
      vertexShader: panelVertex,
      fragmentShader: /* glsl */ `
        uniform vec3 colour;
        uniform vec3 band;
        uniform bool cloth;
        varying vec2 vUv;
        void main() {
          // (the cloth shaped: a swallowtail cut from its foot, 19 % of it; its light band across)
          if (cloth && vUv.y < 0.38 * (1.0 - abs(2.0 * vUv.x - 1.0))) discard;
          bool light = cloth && vUv.y > ${F.albedo.band[0].toFixed(3)} && vUv.y < ${F.albedo.band[1].toFixed(3)};
          gl_FragColor = vec4(light ? band : colour, 1.0);
          #include <colorspace_fragment>
        }`,
      uniforms: { colour: { value: new Vector3(rgb[0], rgb[1], rgb[2]) }, band: { value: new Vector3(band?.[0] ?? 0, band?.[1] ?? 0, band?.[2] ?? 0) }, cloth: { value: band !== null } },
      side: DoubleSide,
    });
  for (const { first, plusX } of F.groups) {
    const a0 = (first * Math.PI) / 180;
    const orange = Math.sin(a0) > 0;
    const colours = flagColours(orange ? primary1 : primary0, plusX, orange);
    const cloth = flagMaterial(colours.team, colours.light);
    const strip = flagMaterial(colours.strip);
    const poleMaterial = flagMaterial(colours.pole);
    for (let k = 0; k < F.count; k++) {
      const a = ((first + F.step * k) * Math.PI) / 180;
      // (out from the centre, and along the arc toward +az; Three's frame: x, z up, the game's y)
      const [ox, oy] = [Math.cos(a), Math.sin(a)];
      const [tx, ty] = [-oy, ox];
      const at = (out: number, along: number, z: number): Vector3 => new Vector3(out * ox + along * tx, z, out * oy + along * ty);
      const pole = new Mesh(new BoxGeometry(F.poleShape.width, F.poleShape.z[1] - F.poleShape.z[0], F.poleShape.width), poleMaterial);
      pole.position.copy(at(F.r - F.poleShape.toward, F.poleShape.along, (F.poleShape.z[0] + F.poleShape.z[1]) / 2));
      pole.lookAt(0, pole.position.y, 0);
      const banner = new Mesh(new PlaneGeometry(F.banner.width, F.banner.z[1] - F.banner.z[0]), cloth);
      banner.position.copy(at(F.r, 0, (F.banner.z[0] + F.banner.z[1]) / 2));
      banner.lookAt(0, banner.position.y, 0);
      // (the strip across the top, from the pole's arm over the cloth, in front of it)
      const stripWidth = F.banner.width / 2 - F.poleShape.along;
      const top = new Mesh(new PlaneGeometry(stripWidth, F.strip.z[1] - F.strip.z[0]), strip);
      top.position.copy(at(F.r - F.strip.toward, (F.banner.width / 2 + F.poleShape.along) / 2, (F.strip.z[0] + F.strip.z[1]) / 2));
      top.lookAt(0, top.position.y, 0);
      pole.name = "props: flag pole";
      banner.name = "props: flag cloth";
      top.name = "props: flag strip";
      group.add(pole, banner, top);
    }
  }
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
    update: (elapsedSeconds) => {
      time.value = elapsedSeconds;
    },
  };
}

// --- The -X plaza (SUR-1, 4, 25; RV-133: the gap in the stands is no open sightline) -------------------------------

/** The plaza's occluders (the static session's measures): the plinth, a wedge ramp in Stadium_Base (its flat top z 2434
 *  from x -13.3k to -12.1k, falling to z 1280 at -19.7k, 640 wide each side at its front (az 177.0-183.0 from the capture
 *  point: SUR-1's 177.1-182.9), 668 at its back, its front vertical at x -12.12k); the statue on it, a figure (its
 *  bounds x -13199..-11591, y -380..283, z 2339..3841): ours its outline as seen from the capture point, at its distance,
 *  from its foot up to (az, el) (178.6, 9.4), (179, 11.9), (180, 14.4), (180.5, 14), (181, 8.6) (CAL1's first open sky
 *  over it: 18.6 % of az 175-185 over its elevations, the game's figure 14-21 %, RV-154c; SUR-20's 0.17); the poplars
 *  (masked, about 43 % covering, SUR-20's olive-brown; spindles, widest a third of the way up): small ones at az
 *  175.55-176.94 and 183.38-184.5 (r 16.5-17.7k, up to z 2.25k), the large at 175.55 and 184.24 (r 20.7k, up to 3.8k)
 *  and 179.88 (r 19.9k, up to 4.8k) (RV-154b) */
export const PLAZA = {
  plinth: { front: -12120, flatTo: -13300, back: -19700, top: 2434, low: 1280, half: [640, 668] as const },
  statue: { distance: 12400, foot: 2339, outline: [[178.6, 9.4], [179, 11.9], [180, 14.4], [180.5, 14], [181, 8.6]] as const, colour: 0.17 },
  poplars: [
    { az: 175.9, r: 17700, height: 2250, width: 420 },
    { az: 176.9, r: 16500, height: 2250, width: 420 },
    { az: 183.4, r: 16500, height: 2250, width: 420 },
    { az: 184.4, r: 17700, height: 2250, width: 420 },
    { az: 175.55, r: 20700, height: 3800, width: 900 },
    { az: 184.24, r: 20700, height: 3800, width: 900 },
    { az: 179.88, r: 19900, height: 4800, width: 2400 },
  ] as readonly { az: number; r: number; height: number; width: number }[],
  poplarFoot: 1300,
  cover: 0.43,
  foliage: [0.15, 0.11, 0.024] as const,
} as const;

/** A poplar's spindle, `width` x `height` about its centre: half-width 0.5 width sin(pi y^0.7) at y up it (0 to 1:
 *  widest a third of the way up), in 16 bands */
export function spindle(width: number, height: number): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const half = (y: number): number => 0.5 * width * Math.sin(Math.PI * y ** 0.7);
  for (let k = 0; k < 16; k++) {
    const [y0, y1] = [k / 16, (k + 1) / 16];
    const [h0, h1] = [half(y0), half(y1)];
    const [z0, z1] = [(y0 - 0.5) * height, (y1 - 0.5) * height];
    pos.push(-h0, z0, 0, h0, z0, 0, h1, z1, 0, -h0, z0, 0, h1, z1, 0, -h1, z1, 0);
    uv.push(0, y0, 1, y0, 1, y1, 0, y0, 1, y1, 0, y1);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return g;
}

/** The plaza's plinth, statue and poplars */
export function buildPlaza(): Group {
  const group = new Group();
  group.name = "stadium plaza";
  const concrete = seenMaterial(BOWL_COLOURS.concrete);
  // The plinth: a wedge, its cross-section widening toward the back (Three's frame: x, z up, the game's y)
  const p = PLAZA.plinth;
  const zAt = (x: number): number => (x >= p.flatTo ? p.top : p.top + ((p.low - p.top) * (x - p.flatTo)) / (p.back - p.flatTo));
  const halfAt = (x: number): number => p.half[0] + ((p.half[1] - p.half[0]) * (x - p.front)) / (p.back - p.front);
  const xs = [p.front, p.flatTo, p.back];
  const pos: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  for (let k = 0; k + 1 < xs.length; k++) {
    const [x0 = 0, x1 = 0] = [xs[k], xs[k + 1]];
    const [h0, h1, z0, z1] = [halfAt(x0), halfAt(x1), zAt(x0), zAt(x1)];
    quad([x0, z0, -h0], [x0, z0, h0], [x1, z1, h1], [x1, z1, -h1]);
    for (const s of [-1, 1]) quad([x0, 0, s * h0], [x0, z0, s * h0], [x1, z1, s * h1], [x1, 0, s * h1]);
  }
  const h = halfAt(p.front);
  quad([p.front, 0, -h], [p.front, 0, h], [p.front, p.top, h], [p.front, p.top, -h]);
  const plinthGeometry = new BufferGeometry();
  plinthGeometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
  const plinth = new Mesh(plinthGeometry, concrete);
  plinth.name = "plaza: plinth";
  // The statue: its outline at its distance, from its foot up (a strip between the foot and the outline's top)
  const st = PLAZA.statue;
  const at = (az: number, z: number): number[] => {
    const a = (az * Math.PI) / 180;
    return [st.distance * Math.cos(a), z, st.distance * Math.sin(a)];
  };
  const topZ = (el: number): number => GRASS_CUBE_AT.z + st.distance * Math.tan((el * Math.PI) / 180);
  const figure: number[] = [];
  st.outline.forEach(([az, el], k) => {
    const next = st.outline[k + 1];
    if (!next) return;
    const [a0, a1] = [at(az, st.foot), at(next[0], st.foot)];
    const [b0, b1] = [at(az, topZ(el)), at(next[0], topZ(next[1]))];
    figure.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0);
  });
  const figureGeometry = new BufferGeometry();
  figureGeometry.setAttribute("position", new Float32BufferAttribute(figure, 3));
  const statue = new Mesh(figureGeometry, seenMaterial([st.colour, st.colour, st.colour * 0.85]));
  statue.name = "plaza: statue";
  group.add(plinth, statue);
  // The poplars: columns of foliage, 43 % of them covering (the rest cut away in small cells)
  const foliage = new ShaderMaterial({
    vertexShader: panelVertex,
    fragmentShader: /* glsl */ `
      uniform vec3 colour;
      uniform float cover;
      varying vec2 vUv;
      varying vec3 vWorld;
      float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        // (the spindle's own outline: its geometry's)
        if (hash(floor(vWorld.xy / 60.0) + floor(vWorld.zy / 60.0)) > cover / 0.64) discard;
        gl_FragColor = vec4(colour, 1.0);
        #include <colorspace_fragment>
      }`,
    uniforms: { colour: { value: new Vector3(...PLAZA.foliage) }, cover: { value: PLAZA.cover } },
    side: DoubleSide,
  });
  for (const tree of PLAZA.poplars) {
    const a = (tree.az * Math.PI) / 180;
    const mesh = new Mesh(spindle(tree.width, tree.height - PLAZA.poplarFoot), foliage);
    mesh.position.set(tree.r * Math.cos(a), (tree.height + PLAZA.poplarFoot) / 2, tree.r * Math.sin(a));
    mesh.lookAt(0, mesh.position.y, 0);
    mesh.name = "plaza: poplar";
    group.add(mesh);
  }
  return group;
}
