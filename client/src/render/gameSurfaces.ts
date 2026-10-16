// The game's wall, glass and glow materials (notes/arena-visuals.md H-5, H-6, H-9), drawn in code: the hexagon
// textures they sample replaced by a procedural flat-top hex grid fitted to the game's (TiledPatterns.Hexagons_Pack
// and CS_FX Hexagons_Pack_01_T: 2 x 2 cells a tile, columns half a tile apart, rows half a tile apart across the flats,
// odd columns half a row down; ForcefieldHex the same at 16 x 16), and their channels by profiles measured against the
// hex radius (0 at a cell's centre, 1 at its edge). Values only; the textures stay local.
import { DoubleSide, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";
import type { Color } from "three";

/** By hex radius in 32 steps, measured from the game's textures (the mean over each step: 16 over r 0-0.8, then 16
 *  over 0.8-1 where the lines are; scripts/hex_profile.py, decoded from sRGB where the texture is sRGB, as the GPU
 *  reads it: RV-60): TiledPatterns.Hexagons_Pack G (sRGB; the lower glass's alpha shape); the ball tracker's
 *  Hexagons_Pack_01_T R (sRGB; glowing lines) and G (a band inside each cell); ForcefieldHex R (sRGB; the fine net) */
export const PACK_G = [
  0.85, 0.85, 0.846, 0.811, 0.802, 0.803, 0.803, 0.803, 0.803, 0.803, 0.813, 0.973, 1, 1, 1, 0.801, 0.515, 0.511, 0.51, 0.512, 0.513,
  0.51, 0.501, 0.487, 0.471, 0.451, 0.43, 0.405, 0.368, 0.322, 0.253, 0.178,
];
/** The decoded textures' means: what cells too small to draw average to */
export const PACK_G_MEAN = 0.719;
const NET_R_MEAN = 0.091;
const TRACKER_R = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.001, 0.004, 0.009, 0.02, 0.037, 0.06, 0.1, 0.157, 0.235, 0.426, 0.613,
];
const TRACKER_G = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.736, 1, 1, 1, 0.327, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const NET_R = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.001, 0.004, 0.019, 0.059, 0.126, 0.233, 0.32, 0.465, 0.652, 0.91,
  0.963,
];

const hexGlsl = /* glsl */ `
// The hex radius (0 at a cell's centre, 1 at its edge) at tile coordinates (2 columns a tile): the game's flat-top
// cells, edge 1/3 of a tile, columns 1/2 apart, rows 1/2 apart across the flats (squashed: across flats / edge = 1.5)
float hexRadius(vec2 tile) {
  const float edge = 1.0 / 3.0;
  const float sv = 1.1547005;
  vec2 p = vec2(tile.x, (tile.y - 0.25) * sv);
  float col = floor(p.x / 0.5 + 0.5);
  float best = 9.0;
  for (int dc = -1; dc <= 1; dc++) {
    float c = col + float(dc);
    float ro = mod(c, 2.0) < 0.5 ? 0.0 : 0.25 * sv;
    float row = floor((p.y - ro) / (0.5 * sv) + 0.5);
    vec2 d = abs(p - vec2(c * 0.5, row * 0.5 * sv + ro));
    best = min(best, max(d.y / (0.8660254 * edge), (d.x + d.y * 0.5773503) / edge));
  }
  return best;
}
// A 32-step profile (16 steps over r 0-0.8, 16 over 0.8-1), interpolated between the steps' middles
float profile32(float table[32], float r) {
  float rr = clamp(r, 0.0, 1.0);
  float x = (rr < 0.8 ? rr * 20.0 : 16.0 + (rr - 0.8) * 80.0) - 0.5;
  int i = int(clamp(floor(x), 0.0, 31.0));
  int j = min(i + 1, 31);
  return mix(table[i], table[j], clamp(x - float(i), 0.0, 1.0));
}
float saturate1(float x) { return clamp(x, 0.0, 1.0); }
`;

const vertexShader = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
attribute vec2 glassTile;
varying vec2 vGlassTile;
#include <fog_pars_vertex>
void main() {
  vGlassTile = glassTile;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** The overlay's surfaces sit just outside the arena's: FF_Side at |x| 4100 and FF_Goal at |y| 5124 (4 uu out), FF_Roof
 *  at z 2052 (8 up): each vertex pushed out along its normal (RV-74) */
const overlayVertexShader = vertexShader.replace(
  "  vWorldPosition = world.xyz;",
  `  vec3 surfaceNormal = normalize(mat3(modelMatrix) * normal);
  vec3 outward = dot(surfaceNormal, world.xyz - vec3(0.0, 1022.0, 0.0)) > 0.0 ? surfaceNormal : -surfaceNormal;
  world.xyz += outward * (abs(surfaceNormal.y) > 0.7 ? 8.0 : 4.0);
  vWorldPosition = world.xyz;`,
);

/** The overlay surfaces' UV, 256 uu a unit (the FF meshes' charts: side walls, and FF_Side's strip down the fillet, u =
 *  1 + |y| / 256, v = 1 - z / 256; the roof u = -30.978 - |x| / 256, v = |y| / 256 + 1.002; the back walls u = -30.978 -
 *  |x| / 256, v = 0.999 - z / 256: RV-70c, RV-74). The corners (RV-109): FF_Goal's vertical ones the side walls' u to
 *  the 45-degree seam (3843, 4226: the diagonal's end, the diagonal itself the back walls'), the back walls' beyond, v =
 *  0.9988 - 0.003902 z; the wall-ceiling fillets the walls'
 *  charts, but for their top row (n.z over 0.55) along FF_Goal's diagonal corners (n.x and n.y both over 0.42), which
 *  takes the roof's (from the meshes' UVs, 40 faces). `p` in the game's frame, `n` its normal's absolute
 *  (OVERLAY_UV_GLSL's, for tests) */
export function overlayUv(p: readonly [number, number, number], n: readonly [number, number, number]): [number, number] {
  const [ax, ay, z] = [Math.abs(p[0]), Math.abs(p[1]), p[2]];
  const corner = n[2] < 0.3;
  const side = 1 + ay / 256;
  const back = -30.978 - ax / 256;
  if (n[2] > 0.7 || (n[2] > 0.55 && Math.min(n[0], n[1]) > 0.42)) return [back, ay / 256 + 1.002];
  if (n[1] > 0.97) return [back, 0.999 - z / 256];
  if (n[0] > 0.97 || (ay <= 128 && z < 256)) return [side, 1 - z / 256];
  if (n[0] > n[1] + 0.001) return [side, corner ? 0.9988 - 0.003902 * z : 1 - z / 256];
  return [back, corner ? 0.9988 - 0.003902 * z : 0.999 - z / 256];
}

export const OVERLAY_UV_GLSL = /* glsl */ `
vec2 overlayUv(vec3 p, vec3 n) {
  float ax = abs(p.x);
  float ay = abs(p.y);
  bool corner = n.z < 0.3;
  float side = 1.0 + ay / 256.0;
  float back = -30.978 - ax / 256.0;
  return n.z > 0.7 || (n.z > 0.55 && min(n.x, n.y) > 0.42) ? vec2(back, ay / 256.0 + 1.002)
    : n.y > 0.97 ? vec2(back, 0.999 - p.z / 256.0)
    : n.x > 0.97 || (ay <= 128.0 && p.z < 256.0) ? vec2(side, 1.0 - p.z / 256.0)
    : n.x > n.y + 0.001 ? vec2(side, corner ? 0.9988 - 0.003902 * p.z : 1.0 - p.z / 256.0)
    : vec2(back, corner ? 0.9988 - 0.003902 * p.z : 0.999 - p.z / 256.0);
}
`;

/** FF_Side / FF_Roof (Beach_NetFence_MIC, AV-16, H-9): over the walls and ceiling, a faint fine hex net everywhere
 *  (25 % on its lines), and round the ball a hex disc within 220-300 uu and a thin team-coloured ring at 312-325 uu */
const overlayFragment = /* glsl */ `
uniform vec3 ballPosition;
uniform vec3 primary0;
uniform vec3 primary1;
uniform float trackerR[32];
uniform float trackerG[32];
uniform float netR[32];
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
#include <fog_pars_fragment>
${hexGlsl}
${OVERLAY_UV_GLSL}
void main() {
  // (the game's frame: Three's x, z, y)
  vec3 p = vWorldPosition.xzy;
  vec3 n = abs(normalize(vWorldNormal).xzy);
  // Not below the game's overlay surfaces (FF_Side, FF_Roof, FF_Goal: from z 256 up, FF_Side down the fillet to z 72.6
  // for |y| <= 128 (RV-74); on the back walls not under FF_Goal's lower edge, (880, 704) to (1328, 256): RV-66)
  float ax = abs(p.x);
  float ay = abs(p.y);
  bool midfield = ay <= 128.0;
  float lowest = ay > 5100.0 && ax < 1328.0 ? (ax < 880.0 ? 704.0 : 704.0 - (ax - 880.0)) : midfield ? 72.6 : 256.0;
  if (p.z < lowest) discard;
  vec2 uv = overlayUv(p, n);
  float d = length(p - ballPosition.xzy);
  float F = saturate1(1.0 - 0.04 * (d - 300.0));
  float outside = saturate1(12.0 * (0.5 - F));
  float ring = saturate1(2.0 * (outside * F - 0.001));
  // The ball tracker (Hexagons_Pack_01_T) at uv x 1.75; ForcefieldHex (16 columns a tile) at uv x (0.99, 0.9)
  float hexR = hexRadius(uv * 1.75);
  float hex = 8.0 * profile32(trackerR, hexR) * saturate1((220.0 - d) * 0.0015)
    + saturate1(0.025 * profile32(trackerG, hexR) * saturate1((300.0 - d) * 0.01));
  vec2 netTile = uv * vec2(0.99, 0.9) * 8.0;
  float net = profile32(netR, hexRadius(netTile));
  // (where the net's cells shrink under a few pixels: their average, not shimmer)
  float shrink = smoothstep(0.08, 0.25, length(fwidth(netTile)));
  net = mix(net, ${NET_R_MEAN}, shrink);
  float alpha = mix(ring * (1.0 - net - 0.25 * outside * net) + 0.25 * outside * net, hex, F);
  vec3 team = 2.0 * mix(primary0, primary1, saturate1(p.y / 400.0 + 0.5));
  // (the hexagon term unclamped in the colour's lerp: 0.25 + 1.23 (0.6 - 0.25) on a line at the ball, RV-65)
  vec3 colour = mix(mix(vec3(0.25), team, ring), vec3(0.6), hex);
  gl_FragColor = vec4(colour, saturate1(alpha));
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** ENVPack.G (sRGB, decoded) by |uv| of its lookup at -normalize(tangent-space camera vector).xy, which is the sine of
 *  the view's angle to the glass's normal: its mean over each ring (|uv| 0-1 in 8 steps; at 0 the head-on texel),
 *  measured from the game's texture (a statistic: the texture itself stays local) */
export const ENV_RADIAL = [0.205, 0.217, 0.166, 0.227, 0.394, 0.441, 0.286, 0.269, 0.3];
/** ENVPack.G's spread round each of those rings (its standard deviation, the same lookup: a statistic) */
export const ENV_SPREAD = [0, 0.155, 0.117, 0.251, 0.3, 0.249, 0.236, 0.216, 0.243];
/** Our own smooth environment for ENVPack.G (RV-71: the user's choice (c); the texture can't ship, and no low-order fit of
 *  it holds): at |uv| its rings' mean, and round each ring one cosine with the ring's spread, its phase turning with the
 *  radius (ours, not the texture's), clamped 0..1. Needs uniforms envRadial[9], envSpread[9] */
/** ENV_GLSL's envG at uv (the shader's, for tests: RV-71, RV-113) */
export function envG(u: number, v: number): number {
  const s = Math.min(Math.hypot(u, v), 1);
  const x = s < 0.0625 ? s / 0.0625 : 1 + (s - 0.0625) / 0.125;
  const i = Math.min(Math.max(Math.floor(x), 0), 7);
  const f = Math.min(Math.max(x - i, 0), 1);
  const mean = (ENV_RADIAL[i] ?? 0) + ((ENV_RADIAL[i + 1] ?? 0) - (ENV_RADIAL[i] ?? 0)) * f;
  const spread = (ENV_SPREAD[i] ?? 0) + ((ENV_SPREAD[i + 1] ?? 0) - (ENV_SPREAD[i] ?? 0)) * f;
  return Math.min(Math.max(mean + 1.4142 * spread * Math.cos(Math.atan2(v, u) - 6.2832 * s), 0), 1);
}

export const ENV_GLSL = /* glsl */ `
float envG(vec2 uv) {
  float s = min(length(uv), 1.0);
  float x = s < 0.0625 ? s / 0.0625 : 1.0 + (s - 0.0625) / 0.125;
  int i = int(clamp(floor(x), 0.0, 7.0));
  float f = clamp(x - float(i), 0.0, 1.0);
  float mean = mix(envRadial[i], envRadial[i + 1], f);
  float spread = mix(envSpread[i], envSpread[i + 1], f);
  return clamp(mean + 1.4142 * spread * cos(atan(uv.y, uv.x) - 6.2832 * s), 0.0, 1.0);
}
`;

/** The goal net's flat side walls' chart (Goal_STD_Glass_Outer's, planar: RV-73, RV-110), at |y|, z (NET_SIDE_GLSL's, for
 *  tests) */
export function netSideUv(ay: number, z: number): [number, number] {
  return [0.004898 * ay - 25.7024, 1.21 - 0.004732 * z];
}

export const NET_SIDE_GLSL = /* glsl */ `
vec2 netSideUv(float ay, float z) {
  return vec2(0.004898 * ay - 25.7024, 1.21 - 0.004732 * z);
}
`;

/** The goal-side glass panel's chart (RV-72) as fitted rules, not the mesh's own UVs (RV-99): U a unit every 213.3 uu
 *  from 6 at |x| 960 to |x| 1344, then every 160 uu; V up the face a line in z (within 0.045 of the mesh's UVs from z 256
 *  up, about 0.1 of a hex tile: RV-115); below that down to the bottom row (z 127), whose V rises with |x| as a
 *  smoothstep, within 0.031 */
export const GOAL_SIDE_CHART = {
  u: { at: 960, value: 6, bend: 1344, inner: 213.33, outer: 160 },
  face: { v0: 1.293, perZ: -0.004873, from: 256 },
  bottom: { z: 127, v0: 0.652, rise: 0.149, from: 960, span: 384 },
} as const;

/** The panel's V at |x|, z (the shader's rule, for tests) */
export function goalSideV(ax: number, z: number): number {
  const { face, bottom } = GOAL_SIDE_CHART;
  const line = (h: number): number => face.v0 + face.perZ * h;
  if (z >= face.from) return line(z);
  const t = Math.min(Math.max((ax - bottom.from) / bottom.span, 0), 1);
  const low = bottom.v0 + bottom.rise * t * t * (3 - 2 * t);
  return low + ((line(face.from) - low) * (z - bottom.z)) / (face.from - bottom.z);
}

/** The lower glass (Field_STD_Glass, Goal_STD_Glass; H-6): white, not team-tinted, its alpha 0.1875 x Hexagons_Pack.G
 *  at its tile coordinates (`glassTile`: the mesh UV0 x (3, 7/3)), its colour ENVPack.G seen along the view + 1/12
 *  (head-on 0.205 + 0.083: RV-61) */
const glassFragment = /* glsl */ `
uniform float packG[32];
uniform float envRadial[9];
uniform float envSpread[9];
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec2 vGlassTile;
#include <fog_pars_fragment>
${hexGlsl}
${ENV_GLSL}
${NET_SIDE_GLSL}
void main() {
  vec2 tile = vGlassTile;
  #ifdef GOAL_SIDE_GLASS
    // The glass panel beside each goal mouth (Goal_STD_Glass, y +-5124; RV-72): its chart's fitted rules (GOAL_SIDE_CHART,
    // goalSideV: RV-99)
    float ax = abs(vWorldPosition.x);
    float z = vWorldPosition.y;
    float uBend = ${GOAL_SIDE_CHART.u.value.toFixed(1)} - (${GOAL_SIDE_CHART.u.bend.toFixed(1)} - ${GOAL_SIDE_CHART.u.at.toFixed(1)}) / ${GOAL_SIDE_CHART.u.inner};
    float u = ax <= ${GOAL_SIDE_CHART.u.bend.toFixed(1)} ? ${GOAL_SIDE_CHART.u.value.toFixed(1)} - (ax - ${GOAL_SIDE_CHART.u.at.toFixed(1)}) / ${GOAL_SIDE_CHART.u.inner}
      : uBend - (ax - ${GOAL_SIDE_CHART.u.bend.toFixed(1)}) / ${GOAL_SIDE_CHART.u.outer.toFixed(1)};
    float faceAt = ${GOAL_SIDE_CHART.face.from.toFixed(1)};
    float face = ${GOAL_SIDE_CHART.face.v0} + ${GOAL_SIDE_CHART.face.perZ} * max(z, faceAt);
    float t = clamp((ax - ${GOAL_SIDE_CHART.bottom.from.toFixed(1)}) / ${GOAL_SIDE_CHART.bottom.span.toFixed(1)}, 0.0, 1.0);
    float low = ${GOAL_SIDE_CHART.bottom.v0} + ${GOAL_SIDE_CHART.bottom.rise} * t * t * (3.0 - 2.0 * t);
    float v = z < faceAt ? mix(low, face, (z - ${GOAL_SIDE_CHART.bottom.z.toFixed(1)}) / (faceAt - ${GOAL_SIDE_CHART.bottom.z.toFixed(1)})) : face;
    tile = vec2(3.0 * u, (7.0 / 3.0) * v);
  #endif
  #ifdef NET_SIDE_WALLS
    // The goal net's flat side walls: the game's planar chart there (netSideUv; the swept profile's not carried on: RV-73,
    // RV-110)
    vec3 n = normalize(vWorldNormal);
    if (abs(n.x) > 0.97) tile = vec2(3.0, 7.0 / 3.0) * netSideUv(abs(vWorldPosition.z), vWorldPosition.y);
  #endif
  float g = profile32(packG, hexRadius(tile));
  // (cells under a few pixels: the tile's average)
  g = mix(g, ${PACK_G_MEAN}, smoothstep(0.1, 0.3, length(fwidth(tile))));
  float alpha = 0.1875 * g;
  vec3 toCamera = normalize(cameraPosition - vWorldPosition);
  // The view in the glass's tangent frame (T, B along its tiles' u and v: from their screen derivatives; RV-71), ENVPack
  // looked up at -V.xy: our smooth stand-in
  vec3 normalTs = normalize(vWorldNormal);
  vec3 dp1 = dFdx(vWorldPosition);
  vec3 dp2 = dFdy(vWorldPosition);
  vec2 duv1 = dFdx(tile);
  vec2 duv2 = dFdy(tile);
  vec3 tangentTs = dp2 * duv1.y - dp1 * duv2.y;
  vec3 bitangentTs = dp1 * duv2.x - dp2 * duv1.x;
  tangentTs = normalize(tangentTs - normalTs * dot(normalTs, tangentTs) + 1e-6);
  bitangentTs = normalize(bitangentTs - normalTs * dot(normalTs, bitangentTs) + 1e-6);
  vec3 viewTs = vec3(dot(toCamera, tangentTs), dot(toCamera, bitangentTs), dot(toCamera, normalTs));
  float env = envG(-normalize(viewTs).xy);
  vec3 colour = vec3(env + 1.0 / 12.0);
  gl_FragColor = vec4(colour, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The team glow strips (TrimLight_Glow_Team1/2, H-5): unlit, two-sided; `glow` 1 at the edge a sheet is attached by,
 *  0 at its far edge; colour C0 + k (2 FB - C0) with k = sat(glow^2 - 0.75), C0 the team's primary; alpha 0.5 glow^4 */
const glowVertex = /* glsl */ `
attribute float glow;
varying float vGlow;
#include <fog_pars_vertex>
void main() {
  vGlow = glow;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const glowFragment = /* glsl */ `
uniform vec3 primary;
uniform vec3 bright;
uniform float vertexAlpha;
varying float vGlow;
#include <fog_pars_fragment>
void main() {
  float u = clamp(vGlow, 0.0, 1.0);
  float k = clamp(u * u - 0.75, 0.0, 1.0);
  vec3 colour = primary + k * (2.0 * bright - primary);
  gl_FragColor = vec4(colour, 0.5 * u * u * u * u * vertexAlpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class GlowStripMaterial extends ShaderMaterial {
  /** `primary` and `bright`: the team's primary and its FullBright (linear); `vertexAlpha` its mesh's vertex colour's
   *  alpha (H-5: 1 unless said) */
  constructor(primary: Color, bright: Color, vertexAlpha = 1) {
    super({
      vertexShader: glowVertex,
      fragmentShader: glowFragment,
      uniforms: { ...UniformsUtils.clone(UniformsLib.fog), primary: { value: primary }, bright: { value: bright }, vertexAlpha: { value: vertexAlpha } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
  }
}

/** The walls' and ceiling's overlay round the ball, in the teams' linear primaries */
export class ForceFieldMaterial extends ShaderMaterial {
  readonly ballPosition: Vector3;

  constructor(primary0: Color, primary1: Color) {
    const ballPosition = new Vector3(0, -100_000, 0);
    super({
      vertexShader: overlayVertexShader,
      fragmentShader: overlayFragment,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ballPosition: { value: ballPosition },
        primary0: { value: primary0 },
        primary1: { value: primary1 },
        trackerR: { value: TRACKER_R },
        trackerG: { value: TRACKER_G },
        netR: { value: NET_R },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
    this.ballPosition = ballPosition;
  }
}

/** The back wall's grate (Goal_STD_Glass[1], H-11): near black (albedo 0.03), its alpha its texture's mean, 0.58 near
 *  and 0.53 beyond ~670 uu (its alpha sat(4.125 R (1 - 0.425 sat(4 (d/1024 - 0.4)))) fading with distance d) */
export const GRATE = { albedo: 0.03, near: 0.58, far: 0.53 } as const;

export class GrateMaterial extends ShaderMaterial {
  constructor() {
    super({
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main() {
          float fade = clamp(4.0 * (distance(cameraPosition, vWorld) / 1024.0 - 0.4), 0.0, 1.0);
          gl_FragColor = vec4(vec3(${GRATE.albedo.toFixed(3)}), mix(${GRATE.near.toFixed(3)}, ${GRATE.far.toFixed(3)}, fade));
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      uniforms: UniformsUtils.clone(UniformsLib.fog),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
  }
}

/** The lower glass: its mesh carries `glassTile` (tile coordinates: its UV0 x (3, 7/3)) */
export class HexGlassMaterial extends ShaderMaterial {
  /** `net`: the goal net's (its side walls on their own planar chart); `goalSide`: the panels beside the goal mouths
   *  (their chart from the position) */
  constructor(options: { readonly net?: boolean; readonly goalSide?: boolean } = {}) {
    super({
      vertexShader,
      fragmentShader: glassFragment,
      defines: { ...(options.net ? { NET_SIDE_WALLS: "" } : {}), ...(options.goalSide ? { GOAL_SIDE_GLASS: "" } : {}) },
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        packG: { value: PACK_G },
        envRadial: { value: ENV_RADIAL },
        envSpread: { value: ENV_SPREAD },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
  }
}
