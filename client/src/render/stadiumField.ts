// DFH Stadium's field (notes/arena-visuals.md AV-5..AV-9, H-1..H-4 and the lighting model): the grass pieces; the metal
// hex floor (the side bays, the pad bases, the goal ends and mouths, the centre disc); the frame's strips, trims and
// seams (the floor under it all: `frameFloorMaterial`) with their glowing and team-coloured lines; the centre vent; the
// painted markings. The plan is derived from the game's meshes (src/render/stadiumFieldRules.ts, scripts/field_plan.py:
// simplified outlines and lines); the materials are the spec's formulas, the game's textures standing in as
// statistics measured on them (profiles by hex radius, means: values only, the textures stay local). Lighting as the
// game's floor: baked only, SceneColor = emissive + diffuse x the piece's baked light (its lightmap's statistics, along
// the axis it varies most), no sun, sky or specular; reflections from the arena's capture (src/render/grassCube.ts).
import { lowQualityPath } from "./shaderQuality";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  Group,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  ShapeUtils,
  type Texture,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
} from "three";
import { FIELD_LIGHT, type FieldPlan, type FieldRegion, type FloorPiece, type FrameLine, type LightProfile, type MarkingGroup, fieldPlan, grassOutline, grassRim } from "./stadiumFieldRules";
import { GRASS_PATTERN, grassPatternGlsl, grassTraces } from "./grassPattern";
import { CONST_TABLES_GLSL, ENV_GLSL, GRASS_LIGHT, tablesUniform } from "./constTables";
export { GRASS_LIGHT } from "./constTables";
import { GRASS_CUBE_BLUR_LOD } from "./grassCube";
import { fullBright } from "./teamColors";
import { ARENA_PRIORITY } from "./translucentSort";
import { BALL_RETICLE_GLSL, RETICLE_GLSL_FN } from "./ballShadow";


/** The GLSL arguments for grassBin: the first two and last two bins' centres, the bins' count */
function binCentres(edge0: number, edge1: number, count: number): string {
  const step = GRASS_LIGHT.step;
  const inner0 = Math.ceil(edge0 / step) * step;
  const inner1 = Math.floor(edge1 / step) * step;
  return [(edge0 + inner0) / 2, inner0 + step / 2, inner1 - step / 2, (inner1 + edge1) / 2, count].map((v) => v.toFixed(1)).join(", ");
}

/** A position's place among a GRASS_LIGHT table's bins (its bins' centres at whole numbers: the partial end bins' centres
 *  half their width in, the rest on 256's), from `edge0` (the first bin's outer edge) to `edge1`, `count` bins */
export function grassBin(s: number, edge0: number, edge1: number, count: number): number {
  const step = GRASS_LIGHT.step;
  const inner0 = Math.ceil(edge0 / step) * step;
  const [c0, c1] = [(edge0 + inner0) / 2, inner0 + step / 2];
  const inner1 = Math.floor(edge1 / step) * step;
  const [cLast, cBefore] = [(inner1 + edge1) / 2, inner1 - step / 2];
  const f = s <= c1 ? (s - c0) / (c1 - c0) : s >= cBefore ? count - 2 + (s - cBefore) / (cLast - cBefore) : 1 + (s - c1) / step;
  return Math.min(Math.max(f, 0), count - 1);
}

/** H-1's noise factor 0.75 (n + 1.25), its mean looking down (2.0: the static session's statistic of the shader's
 *  three-sample rule on Noise_Generic_02); G0, Noise_Generic_02's mean G; ENVAmount */
export const GRASS_NOISE = 2.0;
export const GRASS_G0 = 0.185;
export const GRASS_ENV_AMOUNT = 0.75;
/** The grass's low-quality resource (QG-5): LightColor, its flat light in place of the lightmap; the composite noise's
 *  mean n in its noise factor 0.285 (n + 1.5): the same n as H-1's (GQ1's low permutation computes it alike: RV-496),
 *  from GRASS_NOISE = 0.75 (n + 1.25), so n = 1.417 and the factor 0.831 */
export const GRASS_LQ_LIGHT = [0.768, 0.698, 0.53] as const;
export const GRASS_LQ_NOISE = GRASS_NOISE / 0.75 - 1.25;

/** H-1's reflection term (RV-100), per channel: ENVAmount [0.375 (1.5 - cos) Cg + sat(0.25 ((1.5 - cos) Cg - 0.125))],
 *  Cg = cube (G0 + 1/3) 2/3, cos the view's against the floor's normal (the shader adds it to the lit albedo and
 *  saturates the sum: the asm's mad_sat) */
export function grassReflection(cos: number, cube: number, g0 = GRASS_G0): number {
  const cg = cube * (g0 + 1 / 3) * (2 / 3);
  const k = (1.5 - cos) * cg;
  return GRASS_ENV_AMOUNT * (0.375 * k + Math.min(Math.max(0.25 * (k - 0.125), 0), 1));
}

/** grassReflection in the shader, per channel */
export const GRASS_REFLECTION_GLSL = /* glsl */ `
vec3 grassReflection(float cosView, vec3 cube, float g0) {
  vec3 k = (1.5 - cosView) * cube * (g0 + 1.0 / 3.0) * (2.0 / 3.0);
  return ${GRASS_ENV_AMOUNT.toFixed(2)} * (0.375 * k + clamp(0.25 * (k - 0.125), 0.0, 1.0));
}
`;
/** The markings' baked light (PaintedLine_Mat: each mesh's 1-D directional vertex lightmaps, flat; the static
 *  session's means) */
const MARKING_LIGHT: Readonly<Record<MarkingGroup, readonly [number, number, number]>> = {
  goal: [1.206, 1.099, 0.846],
  side: [0.74, 0.684, 0.531],
  centre: [0.898, 0.83, 0.642],
};


/** The world hex tiling of the floor's materials (AV-8, H-2, H-3): uu per tile along x and y */
const HEX_TILE = [323.4, 384] as const;

type FramePiece = "trimB" | "trim" | "centreTrim" | "centreStrip" | "halfway";
/** H-4's tire-mark factor m on each frame piece, scaling its diffuse and emissive (RV-105b: the static session's means
 *  over each mesh's up-facing area: Field_STD_Trim, TrimB, Center_Trim, CenterField_Team1/2, Mid_A) */
export const TIRE_MARKS: Readonly<Record<FramePiece, number>> = { trim: 0.917, trimB: 0.888, centreTrim: 0.893, centreStrip: 0.9135, halfway: 0.885 };
/** FrameTexture_PACK (sRGB, decoded) over each frame piece's faces facing up, through its UVs, outside the stripes:
 *  the mean R (the diffuse) and G (the reflection's amount) (H-4: measured, area-weighted) */
const FRAME_TEXTURE: Readonly<Record<FramePiece, { readonly r: number; readonly g: number }>> = {
  trimB: { r: 0.033, g: 0.304 },
  trim: { r: 0.035, g: 0.259 },
  centreTrim: { r: 0.023, g: 0.178 },
  centreStrip: { r: 0.299, g: 0.147 },
  halfway: { r: 0.284, g: 0.153 },
};
/** The centre vent (Field_CenterVent): its grate's radius and its white frame ring's top */
export const VENT = { grate: 232, ring: [210, 254] } as const;
/** Heights over the floor (uu): the grass, the seams over it, the regions, the frame lines on them, the centre's trim
 *  (the mesh's z 1) and its lines, the vent's ring (z 2), the markings (z 0.5) */
const GRASS_Z = 0.04;
const SEAM_Z = 0.07;
const REGION_Z = 0.1;
const LINE_Z = 0.3;
const TRIM_Z = 1;
const TRIM_LINE_Z = 1.2;
const RING_Z = 2;
const MARKING_Z = 0.5;

const commonGlsl = /* glsl */ `
float saturate1(float x) { return clamp(x, 0.0, 1.0); }
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
${CONST_TABLES_GLSL}
// The piece's baked light: its bins along the game's x or |y| (lightAxis: axis 0 none, 1 x, 2 |y|; start; bin; count);
// merged pieces (mergeFieldPieces) carry their axis with their vertices and read their table, a row of one texture, by
// exact texel: the same values, the same mix
#ifdef PER_VERTEX_PIECE
flat varying vec4 vPieceAxis;
flat varying vec3 vPieceFrame;
flat varying float vPieceRow;
uniform sampler2D lightTex;
#define LIGHT_AXIS vPieceAxis
vec3 lightAt(int k) { return texelFetch(lightTex, ivec2(k, int(vPieceRow)), 0).rgb; }
#else
uniform vec3 lightTable[16];
uniform vec4 lightAxis;
#define LIGHT_AXIS lightAxis
vec3 lightAt(int k) { return lightTable[k]; }
#endif
vec3 bakedLight(vec2 xy) {
  int n = int(LIGHT_AXIS.w);
  if (LIGHT_AXIS.x < 0.5 || n < 2) return lightAt(0);
  float s = LIGHT_AXIS.x < 1.5 ? xy.x : abs(xy.y);
  float f = clamp((s - LIGHT_AXIS.y) / LIGHT_AXIS.z - 0.5, 0.0, float(n - 1));
  int i = int(floor(f));
  int j = min(i + 1, n - 1);
  return mix(lightAt(i), lightAt(j), f - float(i));
}
// The arena's capture, seen along this view reflected off the floor (Three's frame: y up), blurred (its mipmaps)
uniform samplerCube grassCube;
vec3 floorReflection(vec3 toCamera) {
  return textureLod(grassCube, vec3(-toCamera.x, toCamera.y, -toCamera.z), ${GRASS_CUBE_BLUR_LOD.toFixed(1)}).rgb;
}
`;

const vertexShader = /* glsl */ `
attribute float across;
varying vec3 vWorld;
varying float vAcross;
#ifdef PER_VERTEX_PIECE
attribute vec4 pieceAxis;
attribute vec3 pieceFrame;
attribute float pieceRow;
flat varying vec4 vPieceAxis;
flat varying vec3 vPieceFrame;
flat varying float vPieceRow;
#endif
#include <fog_pars_vertex>
void main() {
  vAcross = across;
  #ifdef PER_VERTEX_PIECE
    vPieceAxis = pieceAxis;
    vPieceFrame = pieceFrame;
    vPieceRow = pieceRow;
  #endif
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** H-1 (unlit): sat(the albedo x the lightmap (GRASS_LIGHT, by x and |y|) x the view factor 2 ((1 - sat(3 cos))^4 +
 *  0.25) (0.5 from above, up to 2.5 grazing) x the noise (its mean) + the reflection (grassReflection: RV-100)); the
 *  albedo FieldSkin's pattern as rules (AV-6a, src/render/grassPattern.ts: the plaid, paths, dashes; the rim its own
 *  mesh, GRASS_RIM; the team lines lerped toward twice the team's primary by sat(1.094 a): the lanes here, the traces
 *  their own mesh, GRASS_TRACE) */
const grassFragment = /* glsl */ `
uniform vec3 primary0;
uniform vec3 primary1;
uniform float noise;
uniform float g0;
uniform vec3 lightMean;
varying vec3 vWorld;
#include <fog_pars_fragment>
${commonGlsl}
// (grassBin: the bins' centres, the partial end bins' half their width in)
float grassBin(float s, float c0, float c1, float cBefore, float cLast, float count) {
  float f = s <= c1 ? (s - c0) / (c1 - c0) : s >= cBefore ? count - 2.0 + (s - cBefore) / (cLast - cBefore) : 1.0 + (s - c1) / ${GRASS_LIGHT.step.toFixed(1)};
  return clamp(f, 0.0, count - 1.0);
}
${GRASS_REFLECTION_GLSL}
${grassPatternGlsl()}
vec3 grassLight(float x, float y) {
  float fx = grassBin(x, ${binCentres(GRASS_LIGHT.x0, GRASS_LIGHT.x1, GRASS_LIGHT.x.length)});
  int ix = int(min(floor(fx), ${(GRASS_LIGHT.x.length - 2).toFixed(1)}));
  float fy = grassBin(abs(y), ${binCentres(GRASS_LIGHT.y0, GRASS_LIGHT.y1, GRASS_LIGHT.y.length)});
  int iy = int(min(floor(fy), ${(GRASS_LIGHT.y.length - 2).toFixed(1)}));
  return mix(tableAt(3, ix).rgb, tableAt(3, ix + 1).rgb, fx - float(ix)) * mix(tableAt(4, iy).rgb, tableAt(4, iy + 1).rgb, fy - float(iy)) / lightMean;
}
void main() {
  vec3 toCamera = normalize(cameraPosition - vWorld);
  float cosView = abs(toCamera.y);
  float g = 1.0 - saturate1(3.0 * cosView);
  float view = 2.0 * (g * g * g * g + 0.25);
  // (the game's x and y: Three's x and z; the texture mirrored both ways, the team's by the side of Y = 0)
  vec2 q = abs(vWorld.xz);
  #ifdef GRASS_RIM
    vec3 rgb = vec3(${GRASS_PATTERN.rim.colour.map((c) => c.toFixed(4)).join(", ")});
  #else
    vec3 rgb = grassRgb(q);
  #endif
  float a = grassLaneAlpha(q);
  #ifdef GRASS_TRACE
    a = max(a, ${GRASS_PATTERN.traces.alpha.toFixed(4)});
  #endif
  vec3 team = vWorld.z < 0.0 ? primary0 : primary1;
  #ifdef CARBALL_LQ
    // (High Quality Shaders off, QG-5: no lightmap (LightColor's flat light), no capture: a sheen tinted toward the team
    // the farther the view is from each axis; the low-quality view and noise factors (the noise its mean: ours))
    float v4 = pow(1.0 - cosView, 4.0);
    vec3 axes = abs(vec3(toCamera.x, toCamera.z, toCamera.y));
    float off = saturate1(2.0 * (axes.x - 2.0 / 3.0)) + saturate1(2.0 * (axes.y - 2.0 / 3.0)) + saturate1(2.0 * (axes.z - 2.0 / 3.0));
    vec3 sheen = 0.15 * off * off * mix(2.0 * primary0, 2.0 * primary1, saturate1(vWorld.z / 4096.0 + 0.5)) * ${GRASS_ENV_AMOUNT.toFixed(2)};
    vec3 albedo = mix(rgb, 2.0 * team, clamp(${GRASS_PATTERN.team.weight.toFixed(3)} * a, 0.0, 1.0)) * 0.285 * (${GRASS_LQ_NOISE.toFixed(4)} + 1.5);
    gl_FragColor = vec4(clamp(albedo * vec3(${GRASS_LQ_LIGHT.join(", ")}) * 3.0 * (v4 + 1.0 / 3.0) + sheen, 0.0, 1.0), 1.0);
  #else
    vec3 albedo = mix(rgb, 2.0 * team, clamp(${GRASS_PATTERN.team.weight.toFixed(3)} * a, 0.0, 1.0)) * noise;
    vec3 lit = albedo * grassLight(vWorld.x, vWorld.z) * view;
    gl_FragColor = vec4(clamp(lit + grassReflection(cosView, floorReflection(toCamera), g0), 0.0, 1.0), 1.0);
  #endif
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** H-3, Reflective_Floor_V2 (and, with FLOOR_B, Reflective_Floor_B: the goal mouth): the lines tinted (T, the view's
 *  parallax on Hexagons_Pack.R), the cells untinted and reflective at grazing angles (f = 1 - cos: the hex normal map
 *  isn't exported, the cells flat), diffuse = lerp(lines, cells, c) x the baked light */
const hexFragment = /* glsl */ `
uniform vec3 primary0;
uniform vec3 primary1;
varying vec3 vWorld;
#include <fog_pars_fragment>
${commonGlsl}
${ENV_GLSL}
void main() {
  vec2 xy = vec2(vWorld.x, vWorld.z); // (the game's frame: Three's x and z)
  vec3 toCamera = normalize(cameraPosition - vWorld);
  vec2 h = xy / vec2(${HEX_TILE[0].toFixed(1)}, ${HEX_TILE[1].toFixed(1)});
  float r = hexRadius(h);
  float c = saturate1(32.0 * (tableProfile(T_PB_A, r) - 0.45));
  float pb = tableProfile(T_PB_B, r);
  float pg = tableProfile(T_PB_G, r);
  float f = 1.0 - saturate1(toCamera.y);
  vec3 cube = floorReflection(toCamera);
  float lines = 1.0 - tableProfile(T_HP_R, hexRadius(h - 0.04921875 * vec2(toCamera.x, toCamera.z)));
  // (the reflection's tangent-space y and z: the game's y, up; ENVPack.G there our smooth stand-in, RV-71)
  vec2 reflYz = vec2(-toCamera.z, toCamera.y);
  #ifdef FLOOR_B
    vec3 T = 2.0 * mix(vec3(1.0, 0.9687, 0.9061), 2.0 * mix(primary0, primary1, saturate1(xy.y / 2049.2 + 0.5)), min(abs(xy.y) / 1024.6, 1.0));
    vec3 a = (0.5 * envG(2.0 * reflYz) + 0.25) * cube;
    float lumA = dot(a, vec3(0.3, 0.59, 0.11));
    vec3 env = 8.0 * (saturate1(1.5 * (pg - 0.75)) + 0.0625) * (a + clamp(0.25 * a + 0.25 * lumA - 0.015625, 0.0, 1.0));
    vec3 cell = 0.75 * (tableProfile(T_HP_A, hexRadius(h / 5.0)) + 2.0) * pb * (f * f + 0.375) * (f * f * env + (4.0 - pb) / 32.0);
  #else
    vec3 T = mix(vec3(1.0, 0.9687, 0.9061), 2.0 * mix(primary0, primary1, saturate1(xy.y / 256.0 + 0.5)), min(abs(xy.y) / 128.0, 1.0));
    float pb2r = tableProfile(T_PB_R, hexRadius(h / 5.0));
    vec3 cell = (0.625 + f) * pb2r * pb * (2.0 * pb * (envG(reflYz) + 0.25) * f * f * cube + 0.0625 * (pg + 0.75));
  #endif
  vec3 diffuse = mix(T * lines, cell, c);
  gl_FragColor = vec4(diffuse * bakedLight(xy), 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** H-4's team colours: C = lerp(0.75, 2 lerp(P0, P1, t), w), t = sat(Y / 1024 + 0.5), w = min(|Y| / 512, 1) (white
 *  round midfield, the team's beyond 512 uu); Cmix (the lit team colour) = lerp(C, lerp(0.75, 4 lerp(FB0, FB1, t), w),
 *  1/16) */
const teamGlsl = /* glsl */ `
uniform vec3 primary0;
uniform vec3 primary1;
uniform vec3 bright0;
uniform vec3 bright1;
vec3 teamC(float y) {
  float t = saturate1(y / 1024.0 + 0.5);
  float w = min(abs(y) / 512.0, 1.0);
  return mix(vec3(0.75), 2.0 * mix(primary0, primary1, t), w);
}
vec3 teamCmix(float y) {
  float t = saturate1(y / 1024.0 + 0.5);
  float w = min(abs(y) / 512.0, 1.0);
  return mix(teamC(y), mix(vec3(0.75), 4.0 * mix(bright0, bright1, t), w), 1.0 / 16.0);
}
`;

/** H-4, Frame_01_V2 off its stripes: diffuse = sat(R + 4 (0.125 + 0.625 G) cube) (no Fresnel, no tint; R, G the
 *  piece's texture means) x the baked light. With LINE: one of its stripes, `across` 0..1 over its width (soft at its
 *  edges): E adds C (emissive) and dims the reflection (1 - 0.8 E); D lerps the diffuse to sat(Cmix) */
/** The centre's raised trim's outer radius (RV-102: its band r 752-776, bent in over the strips' ends): the strips, their
 *  lines and the paint stop there, nothing of them lying under a raised piece */
const CENTRE_CLIP = 776;

const frameFragment = /* glsl */ `
#ifdef PER_VERTEX_PIECE
  #define frameR vPieceFrame.x
  #define frameG vPieceFrame.y
  #define tireMarks vPieceFrame.z
#else
  uniform float frameR;
  uniform float frameG;
  uniform float tireMarks;
#endif
varying vec3 vWorld;
varying float vAcross;
#include <fog_pars_fragment>
${commonGlsl}
${teamGlsl}
void main() {
  #ifdef CLIP_CENTRE
    // (the strips that run in under the centre's raised trim: none of them there, so none bleeds through it far off)
    if (length(vWorld.xz) < CLIP_CENTRE) discard;
  #endif
  vec2 xy = vec2(vWorld.x, vWorld.z);
  vec3 toCamera = normalize(cameraPosition - vWorld);
  #ifdef CARBALL_LQ
    // (High Quality Shaders off, QG-8: FrameTexture_N and PACK only: no capture's reflection, no tire marks)
    vec3 refl = vec3(0.0);
    #undef tireMarks
    #define tireMarks 1.0
  #else
    vec3 refl = 4.0 * (0.125 + 0.625 * frameG) * floorReflection(toCamera);
  #endif
  vec3 emissive = vec3(0.0);
  vec3 diffuse;
  #ifdef LINE
    float m = 1.0 - smoothstep(0.75, 1.0, abs(2.0 * vAcross - 1.0));
    // (the tire marks inside the saturate, H-4's sat(m x): RV-144)
    #ifdef LINE_E
      emissive = tireMarks * m * teamC(xy.y);
      diffuse = clamp(tireMarks * (vec3(frameR) + refl * (1.0 - 0.8 * m)), 0.0, 1.0);
    #else
      diffuse = clamp(tireMarks * mix(vec3(frameR) + refl, teamCmix(xy.y), m), 0.0, 1.0);
    #endif
  #else
    diffuse = clamp(tireMarks * (vec3(frameR) + refl), 0.0, 1.0);
  #endif
  gl_FragColor = vec4(emissive + diffuse * bakedLight(xy), 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** H-2: 0.75 x its light; opacity sat(8 (h^2 - (2u - 1)^2 - 0.5) k) sat(k), k = 2 cos + 0.125 (corrected 2026-10-09), h
 *  the hexes (Hexagons_Pack_B.A), u across the strip: perforated by the hexes, its solid core about 71 % of the width */
const markingFragment = /* glsl */ `
uniform vec3 light;
varying vec3 vWorld;
varying float vAcross;
#include <fog_pars_fragment>
float saturate1(float x) { return clamp(x, 0.0, 1.0); }
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
${CONST_TABLES_GLSL}
void main() {
  // (no paint under the centre's raised trim)
  if (length(vWorld.xz) < ${CENTRE_CLIP.toFixed(1)}) discard;
  float h = tableProfile(T_PB_A, hexRadius(vec2(vWorld.x, vWorld.z) / vec2(${HEX_TILE[0].toFixed(1)}, ${HEX_TILE[1].toFixed(1)})));
  float k = 2.0 * abs(normalize(cameraPosition - vWorld).y) + 0.125;
  float u = vAcross * 2.0 - 1.0;
  float alpha = saturate1(8.0 * (h * h - u * u - 0.5) * k) * saturate1(k);
  gl_FragColor = vec4(0.75 * light, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

type Pt = readonly [number, number];

/** A piece's baked light as uniforms (16 bins at most) */
function lightUniforms(piece: FloorPiece | LightProfile): Record<string, { value: unknown }> {
  const { axis, start, bin, rgb } = typeof piece === "string" ? FIELD_LIGHT[piece] : piece;
  const table = Array.from({ length: 16 }, (_, i) => {
    const [r = 1, g = 1, b = 1] = rgb[Math.min(i, rgb.length - 1)] ?? [];
    return new Vector3(r, g, b);
  });
  const code = axis === null ? 0 : axis === "x" ? 1 : 2;
  return { lightTable: { value: table }, lightAxis: { value: [code, start, bin, rgb.length] } };
}

/** Uniforms every field material shares: fog, the arena's capture (one object: its value turns to each new capture) */
function shared(cube: { value: Texture }): Record<string, { value: unknown }> {
  return { ...UniformsUtils.clone(UniformsLib.fog), grassCube: cube };
}

function teamUniforms(primary0: Color, primary1: Color): Record<string, { value: unknown }> {
  const bright = (c: Color): Vector3 => new Vector3(...fullBright([c.r, c.g, c.b]));
  return { primary0: { value: primary0 }, primary1: { value: primary1 }, bright0: { value: bright(primary0) }, bright1: { value: bright(primary1) } };
}

export class GrassMaterial extends ShaderMaterial {
  /** `primary0`, `primary1`: the teams' primaries (linear: the team lines); `variant`: the rim's band or the traces'
   *  strips (AV-6a), else the grass */
  constructor(cube: { value: Texture }, primary0: Color, primary1: Color, readonly variant: "grass" | "rim" | "trace" = "grass") {
    const v3 = (c: readonly number[]): Vector3 => new Vector3(c[0], c[1], c[2]);
    super({
      vertexShader,
      fragmentShader: grassFragment,
      defines: variant === "rim" ? { GRASS_RIM: "" } : variant === "trace" ? { GRASS_TRACE: "" } : {},
      uniforms: {
        ...shared(cube),
        primary0: { value: primary0 },
        primary1: { value: primary1 },
        noise: { value: GRASS_NOISE },
        // (Cg's scale: (G0 + 1/3) 2/3)
        g0: { value: GRASS_G0 },
        constTables: tablesUniform(),
        lightMean: { value: v3(GRASS_LIGHT.mean) },
        ...lightUniforms("hexPads"),
      },
      fog: true,
    });
    lowQualityPath(this);
  }
}

export class HexFloorMaterial extends ShaderMaterial {
  /** `piece`: its baked light (a field piece's, or a profile of its own: the goals' OOBFloor); `floorB`:
   *  Reflective_Floor_B (the goal mouths) */
  constructor(
    cube: { value: Texture },
    primary0: Color,
    primary1: Color,
    readonly piece: FloorPiece | LightProfile,
    floorB = false,
  ) {
    super({
      vertexShader,
      fragmentShader: hexFragment,
      defines: floorB ? { FLOOR_B: "" } : {},
      uniforms: {
        ...shared(cube),
        primary0: { value: primary0 },
        primary1: { value: primary1 },
        constTables: tablesUniform(),
        ...lightUniforms(piece),
      },
      fog: true,
    });
  }
}

export class FrameMaterial extends ShaderMaterial {
  /** A frame piece (its texture's means, its baked light); `line`: one of its stripes, E (glowing) or D (team colour) */
  constructor(
    cube: { value: Texture },
    primary0: Color,
    primary1: Color,
    readonly piece: FramePiece,
    line: FrameLine["kind"] | null = null,
  ) {
    const { r, g } = FRAME_TEXTURE[piece];
    const clip = piece === "centreStrip" || piece === "halfway" ? { CLIP_CENTRE: CENTRE_CLIP.toFixed(1) } : {};
    super({
      vertexShader,
      fragmentShader: frameFragment,
      defines: { ...clip, ...(line === null ? {} : line === "E" ? { LINE: "", LINE_E: "" } : { LINE: "" }) },
      uniforms: { ...shared(cube), ...teamUniforms(primary0, primary1), frameR: { value: r }, frameG: { value: g }, tireMarks: { value: TIRE_MARKS[piece] }, ...lightUniforms(piece) },
      fog: true,
      // (a constant pull, not one growing at grazing views: those bled over the raised pieces far off)
      polygonOffset: line !== null,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -2,
    });
    lowQualityPath(this);
  }
}

/** AV-10, H-4: the wall's foot (Side_Trim[0], Frame_01_V2: the r 256 fillet up to its cap at z 256-272) as the frames'
 *  material: sat(m (R + 4 (0.125 + 0.625 G) cube)) x its baked light, the capture along the fillet's own reflection
 *  (it curves up from the floor), m Side_Trim's tire marks, its light Side_Trim's up-facing mean; its texture's means
 *  Field_STD_Trim's (Side_Trim's own aren't measured) */
export const SIDE_TRIM = { m: 0.904, light: [0.735, 0.677, 0.524] as const, texture: FRAME_TEXTURE.trim } as const;

export class SideTrimMaterial extends ShaderMaterial {
  /** `ballPosition`: the ball (Three's frame), read every frame, for its reticle on the trim (VT-30a); `light` its baked
   *  light (Side_Trim's unless said) */
  constructor(cube: { value: Texture }, ballPosition: Vector3, light: readonly [number, number, number] = SIDE_TRIM.light) {
    super({
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormal;
        #include <fog_pars_vertex>
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vNormal = mat3(modelMatrix) * normal;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform samplerCube grassCube;
        uniform vec3 reticleBall;
        varying vec3 vWorld;
        varying vec3 vNormal;
        #include <fog_pars_fragment>
        ${RETICLE_GLSL_FN}
        void main() {
          vec3 toCamera = normalize(cameraPosition - vWorld);
          #ifdef CARBALL_LQ
            // (High Quality Shaders off, QG-8: no capture's reflection, no tire marks)
            vec3 diffuse = vec3(${SIDE_TRIM.texture.r.toFixed(3)});
          #else
            vec3 cube = textureLod(grassCube, reflect(-toCamera, normalize(vNormal)), ${GRASS_CUBE_BLUR_LOD.toFixed(1)}).rgb;
            vec3 diffuse = clamp(${SIDE_TRIM.m.toFixed(3)} * (vec3(${SIDE_TRIM.texture.r.toFixed(3)}) + 4.0 * (0.125 + 0.625 * ${SIDE_TRIM.texture.g.toFixed(3)}) * cube), 0.0, 1.0);
          #endif
          gl_FragColor = vec4(diffuse * vec3(${light.map((v) => v.toFixed(3)).join(", ")}), 1.0);
          vec3 vReticleWorld = vWorld;
          vec3 vReticleNormal = vNormal;
          ${BALL_RETICLE_GLSL}
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      uniforms: { ...shared(cube), reticleBall: { value: ballPosition } },
      fog: true,
    });
    lowQualityPath(this);
  }
}

export class MarkingMaterial extends ShaderMaterial {
  /** `group`: which mesh's (its baked light) */
  constructor(readonly group: MarkingGroup) {
    const [r, g, b] = MARKING_LIGHT[group];
    super({
      vertexShader,
      fragmentShader: markingFragment,
      uniforms: { ...UniformsUtils.clone(UniformsLib.fog), light: { value: new Vector3(r, g, b) }, constTables: tablesUniform() },
      transparent: true,
      depthWrite: false,
      fog: true,
      // (a constant pull, as the lines')
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -4,
    });
  }
}

/** The field's pieces one shader draws in one state (a frame's or a hex floor's, opaque, the same defines and depth
 *  offset) merged into one mesh each: fewer draw calls, the same pixels (the user's choice, 2026-10-16). Each piece's
 *  own uniforms (its baked light's axis and table, a frame's means and tire marks) go with its vertices, flat (no
 *  interpolation: the same values), its table a row of one float texture (texelFetch: exact); the pieces kept in the
 *  order three drew them (opaque: by their materials' creation), the first's material drawing them all */
export function mergeFieldPieces(group: Group): void {
  // (the group's children in their materials' creation order: each made as it was added)
  const sets = new Map<string, Mesh<BufferGeometry, ShaderMaterial>[]>();
  for (const child of group.children) {
    if (!(child instanceof Mesh)) continue;
    const mesh = child as Mesh<BufferGeometry, ShaderMaterial>;
    const m = mesh.material;
    if (!(m instanceof FrameMaterial || m instanceof HexFloorMaterial) || m.transparent) continue;
    const key = [m instanceof FrameMaterial ? "frame" : "hex", JSON.stringify(m.defines), m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.side].join("|");
    sets.set(key, [...(sets.get(key) ?? []), mesh]);
  }
  for (const meshes of sets.values()) {
    if (meshes.length < 2) continue;
    const counts = meshes.map((mesh) => mesh.geometry.getAttribute("position").count);
    const total = counts.reduce((a, b) => a + b, 0);
    const join = (name: string, size: number): Float32Array => {
      const out = new Float32Array(total * size);
      let at = 0;
      for (const mesh of meshes) {
        const a = mesh.geometry.getAttribute(name);
        out.set(a.array, at);
        at += a.count * size;
      }
      return out;
    };
    const axis = new Float32Array(total * 4);
    const frame = new Float32Array(total * 3);
    const row = new Float32Array(total);
    const table = new Float32Array(16 * 4 * meshes.length);
    let at = 0;
    meshes.forEach((mesh, k) => {
      const u = mesh.material.uniforms;
      const lightAxis = u["lightAxis"]?.value as readonly number[];
      const values = mesh.material instanceof FrameMaterial ? [u["frameR"]?.value, u["frameG"]?.value, u["tireMarks"]?.value].map(Number) : [0, 0, 0];
      for (let i = 0; i < (counts[k] ?? 0); i++) {
        axis.set(lightAxis, 4 * (at + i));
        frame.set(values, 3 * (at + i));
        row[at + i] = k;
      }
      at += counts[k] ?? 0;
      (u["lightTable"]?.value as readonly Vector3[]).forEach((v, i) => {
        table.set([v.x, v.y, v.z, 0], 4 * (16 * k + i));
      });
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(join("position", 3), 3));
    geometry.setAttribute("across", new BufferAttribute(join("across", 1), 1));
    geometry.setAttribute("normal", new BufferAttribute(join("normal", 3), 3));
    geometry.setAttribute("pieceAxis", new BufferAttribute(axis, 4));
    geometry.setAttribute("pieceFrame", new BufferAttribute(frame, 3));
    geometry.setAttribute("pieceRow", new BufferAttribute(row, 1));
    const lightTex = new DataTexture(table, 16, meshes.length, RGBAFormat, FloatType);
    lightTex.minFilter = NearestFilter;
    lightTex.magFilter = NearestFilter;
    lightTex.needsUpdate = true;
    const [first, ...rest] = meshes;
    if (!first) continue;
    const material = first.material;
    material.defines = { ...material.defines, PER_VERTEX_PIECE: "" };
    material.uniforms["lightTex"] = { value: lightTex };
    material.needsUpdate = true;
    const merged = new Mesh(geometry, material);
    merged.name = meshes.map((m) => m.name).join(" + ");
    let start = 0;
    merged.userData["pieces"] = meshes.map((m, k) => {
      const piece = { name: m.name, start, count: counts[k] ?? 0 };
      start += piece.count;
      return piece;
    });
    // (in the first piece's place among the group's children: the scene drawn in the order it was)
    group.children.splice(group.children.indexOf(first), 0, merged);
    merged.parent = group;
    for (const mesh of meshes) {
      group.remove(mesh);
      mesh.geometry.dispose();
    }
    for (const mesh of rest) mesh.material.dispose();
  }
}

/** The floor under the field (the frame's seams between the regions, Field_STD_TrimB, and its edge trim): pushed back
 *  in depth further than the field's grass (4) and seams (2), the field lying in its plane */
export function frameFloorMaterial(cube: { value: Texture }, primary0: Color, primary1: Color): FrameMaterial {
  const material = new FrameMaterial(cube, primary0, primary1, "trimB");
  material.polygonOffset = true;
  material.polygonOffsetFactor = 4;
  material.polygonOffsetUnits = 8;
  return material;
}

/** Triangles on the floor (Three's frame: x, height, the game's y), each turned to face up; `across` per vertex */
class Sheet {
  readonly #position: number[] = [];
  readonly #across: number[] = [];

  get empty(): boolean {
    return this.#position.length === 0;
  }

  triangle(a: Pt, b: Pt, c: Pt, height: number, across: readonly [number, number, number] = [0, 0, 0]): void {
    // (facing +y: (b - a) x (c - a) has y = dz_ab dx_ac - dx_ab dz_ac > 0)
    const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0;
    const [p, q] = up ? [b, c] : [c, b];
    const [ap, aq] = up ? [across[1], across[2]] : [across[2], across[1]];
    this.#position.push(a[0], height, a[1], p[0], height, p[1], q[0], height, q[1]);
    this.#across.push(across[0], ap, aq);
  }

  /** A region with its holes, in each of its mirror images; only the triangles whose centre `keep` takes, if given */
  region(region: FieldRegion, height: number, keep?: (x: number, y: number) => boolean): void {
    const contour = vectors(region.outline);
    const holes = (region.holes ?? []).map(vectors);
    const all = [...contour, ...holes.flat()];
    const faces = ShapeUtils.triangulateShape(contour, holes);
    for (const [sx, sy] of images(region.mirror)) {
      const at = (n: number): Pt => {
        const v = all[n];
        return v ? [sx * v.x, sy * v.y] : [0, 0];
      };
      for (const [i = 0, j = 0, k = 0] of faces) {
        const [a, b, c] = [at(i), at(j), at(k)];
        if (keep && !keep((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3)) continue;
        this.triangle(a, b, c, height);
      }
    }
  }

  /** A ring (or a disc, inner 0) round the centre */
  ring(inner: number, outer: number, height: number, segments = 128): void {
    const p = (r: number, a: number): Pt => [r * Math.cos(a), r * Math.sin(a)];
    for (let s = 0; s < segments; s++) {
      const [a0, a1] = [(s / segments) * 2 * Math.PI, ((s + 1) / segments) * 2 * Math.PI];
      if (inner <= 0) this.triangle([0, 0], p(outer, a0), p(outer, a1), height);
      else {
        this.triangle(p(inner, a0), p(outer, a0), p(outer, a1), height);
        this.triangle(p(inner, a0), p(outer, a1), p(inner, a1), height);
      }
    }
  }

  /** A strip `width` wide along a polyline, `across` 0 on its one edge and 1 on the other (mitred joints) */
  strip(pts: readonly Pt[], width: number, height: number): void {
    const edges = pts.map((p, k): [Pt, Pt] => {
      const [nx, ny] = mitre(pts, k);
      const h = width / 2;
      return [
        [p[0] - nx * h, p[1] - ny * h],
        [p[0] + nx * h, p[1] + ny * h],
      ];
    });
    for (let k = 0; k + 1 < edges.length; k++) {
      const e0 = edges[k];
      const e1 = edges[k + 1];
      if (!e0 || !e1) continue;
      this.triangle(e0[0], e1[0], e1[1], height, [0, 0, 1]);
      this.triangle(e0[0], e1[1], e0[1], height, [0, 1, 1]);
    }
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.#position, 3));
    g.setAttribute("across", new Float32BufferAttribute(this.#across, 1));
    g.computeVertexNormals();
    return g;
  }
}

/** Whether (x, y) is inside a polygon (even-odd) */
function insidePolygon(points: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let inside = false;
  points.forEach(([ax, ay], i) => {
    const [bx, by] = points[(i + 1) % points.length] ?? [ax, ay];
    if (ay > y !== by > y && x < ax + ((bx - ax) * (y - ay)) / (by - ay)) inside = !inside;
  });
  return inside;
}

/** A flat [x0, y0, x1, y1, ...] loop as points (open: a repeated first point dropped) */
function vectors(flat: readonly number[]): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push(new Vector2(flat[i], flat[i + 1]));
  const [first] = out;
  const last = out.at(-1);
  if (out.length > 1 && first && last && first.equals(last)) out.pop();
  return out;
}

/** A flat [x0, y0, ...] polyline (from index `from`) as points */
function polyline(flat: readonly number[], from = 0): Pt[] {
  const out: Pt[] = [];
  for (let i = from; i + 1 < flat.length; i += 2) out.push([flat[i] ?? 0, flat[i + 1] ?? 0]);
  return out;
}

/** The images of a piece (x, y signs) */
function images(mirror: FieldRegion["mirror"]): Pt[] {
  if (mirror === "none") return [[1, 1]];
  if (mirror === "x") {
    return [
      [1, 1],
      [-1, 1],
    ];
  }
  if (mirror === "y") {
    return [
      [1, 1],
      [1, -1],
    ];
  }
  return [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
}

/** The unit offset at a polyline's point k: its left normal, mitred at joints (the mitre capped at 4) */
function mitre(pts: readonly Pt[], k: number): Pt {
  const p = pts[k];
  const a = pts[k - 1];
  const b = pts[k + 1];
  const normal = (u: Pt, v: Pt): Pt => {
    const [dx, dy] = [v[0] - u[0], v[1] - u[1]];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  if (!p) return [0, 1];
  if (!a) return b ? normal(p, b) : [0, 1];
  if (!b) return normal(a, p);
  const n1 = normal(a, p);
  const n2 = normal(p, b);
  const [mx, my] = [n1[0] + n2[0], n1[1] + n2[1]];
  const l = Math.hypot(mx, my);
  if (l < 1e-6) return n1;
  const scale = 1 / Math.max(0.25, (n1[0] * mx + n1[1] * my) / l);
  return [(mx / l) * scale, (my / l) * scale];
}

/** The field above the floor mesh, from `plan` (the game's traced shapes where the dev server has them, else the one
 *  built from measurements: src/render/stadiumFieldRules.ts): one mesh per material. `cube`: the arena's capture's
 *  uniform (GrassCube.uniform) */
export function buildStadiumField(primary0: Color, primary1: Color, cube: { value: Texture }, plan: FieldPlan = fieldPlan()): Group {
  const group = new Group();
  const add = (sheet: Sheet, material: ShaderMaterial | MeshBasicMaterial, name: string): void => {
    if (sheet.empty) return;
    const m = new Mesh(sheet.geometry(), material);
    m.name = name;
    group.add(m);
  };
  const sheetOf = (regions: readonly FieldRegion[], height = REGION_Z, keep?: (x: number, y: number) => boolean): Sheet => {
    const s = new Sheet();
    for (const r of regions) s.region(r, height, keep);
    return s;
  };
  // (layered: the grass under the seams under the regions, each pushed back in depth from the next, too close in height
  // to tell apart from afar)
  const behind = <T extends ShaderMaterial>(material: T, units: number): T => {
    material.polygonOffset = true;
    material.polygonOffsetFactor = units / 2;
    material.polygonOffsetUnits = units;
    return material;
  };
  add(sheetOf(plan.grass, GRASS_Z), behind(new GrassMaterial(cube, primary0, primary1), 4), "grass");
  // (its rim over it, then its traces: AV-6a; by the rules on every build, the traces the generated look-alike)
  // (only on the grass: the rings round the goal's floor pieces run on past its end, over the goal's see-through floor)
  const { outline } = grassOutline();
  const onGrass = (x: number, y: number): boolean => insidePolygon(outline, Math.abs(x), Math.abs(y));
  add(sheetOf(grassRim(GRASS_PATTERN.rim.width), GRASS_Z, onGrass), behind(new GrassMaterial(cube, primary0, primary1, "rim"), 3), "grass rim");
  const traces = new Sheet();
  const w = GRASS_PATTERN.traces.width;
  for (const [x0, y0, x1, y1] of grassTraces()) {
    // (each piece a little past its ends, so the kinks close)
    const l = Math.hypot(x1 - x0, y1 - y0) || 1;
    const [ux, uy] = [((x1 - x0) / l) * (w / 4), ((y1 - y0) / l) * (w / 4)];
    for (const [sx, sy] of images("xy")) traces.strip([[sx * (x0 - ux), sy * (y0 - uy)], [sx * (x1 + ux), sy * (y1 + uy)]], w, GRASS_Z);
  }
  add(traces, behind(new GrassMaterial(cube, primary0, primary1, "trace"), 2.5), "grass traces");
  add(sheetOf(plan.seams ?? [], SEAM_Z), behind(new FrameMaterial(cube, primary0, primary1, "trim"), 2), "seams");
  add(sheetOf(plan.hexSide), new HexFloorMaterial(cube, primary0, primary1, "hexSide"), "hex floor: side bays");
  add(sheetOf(plan.hexPads), new HexFloorMaterial(cube, primary0, primary1, "hexPads"), "hex floor: pad bases");
  add(sheetOf(plan.goalEnds), new HexFloorMaterial(cube, primary0, primary1, "goalEnd"), "hex floor: goal ends");
  add(sheetOf(plan.goalMouths), new HexFloorMaterial(cube, primary0, primary1, "goalMouth", true), "hex floor: goal mouths");
  add(sheetOf(plan.centreDisc), new HexFloorMaterial(cube, primary0, primary1, "disc"), "hex floor: centre disc");
  add(sheetOf(plan.centreStrips), new FrameMaterial(cube, primary0, primary1, "centreStrip"), "centre strips");
  add(sheetOf(plan.halfway), new FrameMaterial(cube, primary0, primary1, "halfway"), "halfway strip");
  // (raised over the disc's edge and the strips' ends, as the game's)
  add(sheetOf(plan.centreTrim, TRIM_Z), new FrameMaterial(cube, primary0, primary1, "centreTrim"), "centre trim");
  // The frame pieces' stripes: the glowing team lines (E) round the panels and the centre, the team-coloured lines (D)
  // on the strips
  for (const piece of ["trim", "centreTrim", "centreStrip", "halfway"] as const) {
    for (const kind of ["E", "D"] as const) {
      const sheet = new Sheet();
      for (const line of plan.frameLines.filter((l) => l.piece === piece && l.kind === kind)) {
        const pts = polyline(line.points);
        const height = piece === "centreTrim" ? TRIM_LINE_Z : LINE_Z;
        for (const [sx, sy] of images(line.mirror)) sheet.strip(pts.map(([x, y]): Pt => [sx * x, sy * y]), line.width, height);
      }
      add(sheet, new FrameMaterial(cube, primary0, primary1, piece, kind), `${piece} lines ${kind}`);
    }
  }
  // The centre vent: its grate (CrossHatched_Grate_MIC: dark; its see-through cells are ours to do) and its ring
  // (Frame_01_White_MIC: a light frame); baked light only, the disc's round it (RV-106)
  const [dr, dg, db] = FIELD_LIGHT.disc.rgb[0] ?? [1, 1, 1];
  const baked = (albedo: number): MeshBasicMaterial => new MeshBasicMaterial({ color: new Color(albedo).multiply(new Color().setRGB(dr, dg, db)) });
  const vent = new Sheet();
  vent.ring(0, VENT.grate, REGION_Z);
  add(vent, baked(0x0b0b0c), "vent grate");
  const ring = new Sheet();
  ring.ring(VENT.ring[0], VENT.ring[1], RING_Z, 96);
  add(ring, baked(0xd0d4d8), "vent ring");
  // The painted markings, by mesh (each its baked light)
  for (const mesh of ["goal", "side", "centre"] as const) {
    const markings = new Sheet();
    for (const m of plan.markings[mesh]) {
      const pts = polyline(m, 1);
      for (const [sx, sy] of images("xy")) markings.strip(pts.map(([x, y]): Pt => [sx * x, sy * y]), m[0] ?? 16, MARKING_Z);
    }
    add(markings, new MarkingMaterial(mesh), `markings: ${mesh}`);
  }
  // (the markings' TranslucencySortPriority, TRN1: Field_Center_Lines -2, Goal_Lines and Field_Side_Lines 0)
  const centre = group.getObjectByName("markings: centre");
  if (centre) centre.renderOrder = ARENA_PRIORITY.centreLines;
  return group;
}
