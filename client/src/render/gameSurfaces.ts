// The game's glass and glow materials (notes/arena-visuals.md H-5, H-6), drawn in code: the goals' nets' hex glass and
// the goals' glow strips. The hexagon textures they sample replaced by a procedural flat-top hex grid fitted to the
// game's (TiledPatterns.Hexagons_Pack: 2 x 2 cells a tile, columns half a tile apart, rows half a tile apart across the
// flats, odd columns half a row down), and their channels by profiles measured against the hex radius (0 at a cell's
// centre, 1 at its edge). Values only; the textures stay local.
import { lowQualityPath } from "./shaderQuality";
import { CONST_TABLES_GLSL, ENV_GLSL, ENV_RADIAL, ENV_SPREAD, tablesUniform } from "./constTables";
export { ENV_GLSL, ENV_RADIAL, ENV_SPREAD, PACK_G } from "./constTables";
import { DoubleSide, ShaderMaterial, UniformsLib, UniformsUtils } from "three";
import type { Color } from "three";

/** The decoded textures' means: what cells too small to draw average to */
export const PACK_G_MEAN = 0.719;

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
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec2 vGlassTile;
#include <fog_pars_fragment>
${CONST_TABLES_GLSL}
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
  float g = tableProfile(T_PACK_G, hexRadius(tile));
  // (cells under a few pixels: the tile's average)
  g = mix(g, ${PACK_G_MEAN}, smoothstep(0.1, 0.3, length(fwidth(tile))));
  float alpha = 0.1875 * g;
  #ifdef CARBALL_LQ
    // (High Quality Shaders off, QG-9: a flat 1/12, no ENVPack along the view)
    vec3 colour = vec3(1.0 / 12.0);
  #else
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
  #endif
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
        constTables: tablesUniform(),
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
    lowQualityPath(this);
  }
}
