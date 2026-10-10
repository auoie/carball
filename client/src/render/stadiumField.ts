// DFH Stadium's field (notes/arena-visuals.md AV-5..AV-9, H-1..H-4 and the lighting model): the grass pieces; the metal
// hex floor (the side bays, the pad bases, the goal ends and mouths, the centre disc); the frame's strips, trims and
// seams (the floor under it all: `frameFloorMaterial`) with their glowing and team-coloured lines; the centre vent; the
// painted markings. The plan is derived from the game's meshes (src/render/stadiumFieldRules.ts, scripts/field_plan.py:
// simplified outlines and lines); the materials are the spec's formulas, the game's textures standing in as
// statistics measured on them (profiles by hex radius, means: values only, the textures stay local). Lighting as the
// game's floor: baked only, SceneColor = emissive + diffuse x the piece's baked light (its lightmap's statistics, along
// the axis it varies most), no sun, sky or specular; reflections from the arena's capture (src/render/grassCube.ts).
import {
  BufferGeometry,
  type Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  ShapeUtils,
  type Texture,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
} from "three";
import { FIELD_LIGHT, type FieldPlan, type FieldRegion, type FloorPiece, type FrameLine, type MarkingGroup, fieldPlan } from "./stadiumFieldRules";
import { ENV_GLSL, ENV_RADIAL, ENV_SPREAD } from "./gameSurfaces";
import { GRASS_CUBE_BLUR_LOD } from "./grassCube";
import { fullBright } from "./teamColors";

/** FieldSkin_FutureGrid_1x1_D's mean albedo (sRGB-flagged: decoded), StadiumFloorLightMap's mean over the field
 *  (the static session: 0.511, 0.488, 0.428) (H-1) */
export const GRASS_ALBEDO = [0.068, 0.11, 0.056] as const;
export const GRASS_LIGHTMAP = [0.511, 0.488, 0.428] as const;
/** H-1's noise factor 0.75 (n + 1.25), its mean looking down (2.0: the static session's statistic of the shader's
 *  three-sample rule on Noise_Generic_02); the reflection's scale (G0 + 1/3) 2/3 at the noise's mean G (0.185) */
export const GRASS_NOISE = 2.0;
export const GRASS_REFLECTION = 0.75 * (0.185 + 1 / 3) * (2 / 3);
/** The markings' baked light (PaintedLine_Mat: each mesh's 1-D directional vertex lightmaps, flat; the static
 *  session's means) */
const MARKING_LIGHT: Readonly<Record<MarkingGroup, readonly [number, number, number]>> = {
  goal: [1.206, 1.099, 0.846],
  side: [0.74, 0.684, 0.531],
  centre: [0.898, 0.83, 0.642],
};

/** Profiles by hex radius (32 steps: 16 over r 0-0.8, 16 over 0.8-1; scripts/hex_profile.py): Hexagons_Pack_B's A
 *  (linear), B, G, R (decoded), Hexagons_Pack's R (decoded) and A */
const PB_A = [
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.998, 0.99, 0.967, 0.94, 0.905, 0.865, 0.819, 0.753, 0.676, 0.573,
  0.416, 0.253,
];
const PB_B = [
  0.558, 0.557, 0.562, 0.598, 0.609, 0.606, 0.607, 0.606, 0.607, 0.607, 0.592, 0.474, 0.462, 0.462, 0.462, 0.647, 0.994, 1, 1, 1,
  0.999, 0.993, 0.976, 0.956, 0.938, 0.916, 0.89, 0.849, 0.804, 0.755, 0.676, 0.604,
];
const PB_G = [
  0.849, 0.849, 0.845, 0.809, 0.801, 0.802, 0.802, 0.802, 0.802, 0.802, 0.813, 0.973, 1, 1, 1, 0.801, 0.514, 0.512, 0.511, 0.512,
  0.512, 0.509, 0.499, 0.486, 0.472, 0.455, 0.436, 0.405, 0.369, 0.327, 0.251, 0.181,
];
const PB_R = [
  0.557, 0.556, 0.556, 0.56, 0.683, 0.684, 0.688, 0.684, 0.68, 0.666, 0.657, 0.651, 0.627, 0.628, 0.627, 0.631, 0.646, 0.652,
  0.656, 0.654, 0.659, 0.656, 0.657, 0.661, 0.659, 0.663, 0.661, 0.662, 0.665, 0.663, 0.666, 0.663,
];
const HP_R = [
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.997, 0.972, 0.919, 0.862, 0.799, 0.719, 0.634, 0.526, 0.412,
  0.293, 0.176, 0.07,
];
const HP_A = [
  0.628, 0.628, 0.628, 0.631, 0.734, 0.735, 0.738, 0.735, 0.732, 0.72, 0.712, 0.707, 0.685, 0.686, 0.685, 0.685, 0.7, 0.703,
  0.707, 0.705, 0.708, 0.706, 0.707, 0.711, 0.709, 0.712, 0.71, 0.711, 0.714, 0.712, 0.715, 0.713,
];
/** The world hex tiling of the floor's materials (AV-8, H-2, H-3): uu per tile along x and y */
const HEX_TILE = [323.4, 384] as const;

type FramePiece = "trimB" | "trim" | "centreTrim" | "centreStrip" | "halfway";
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
float profile32(float table[32], float r) {
  float rr = clamp(r, 0.0, 1.0);
  float x = (rr < 0.8 ? rr * 20.0 : 16.0 + (rr - 0.8) * 80.0) - 0.5;
  int i = int(clamp(floor(x), 0.0, 31.0));
  int j = min(i + 1, 31);
  return mix(table[i], table[j], clamp(x - float(i), 0.0, 1.0));
}
// The piece's baked light: its bins along the game's x or |y| (lightAxis: axis 0 none, 1 x, 2 |y|; start; bin; count)
uniform vec3 lightTable[16];
uniform vec4 lightAxis;
vec3 bakedLight(vec2 xy) {
  int n = int(lightAxis.w);
  if (lightAxis.x < 0.5 || n < 2) return lightTable[0];
  float s = lightAxis.x < 1.5 ? xy.x : abs(xy.y);
  float f = clamp((s - lightAxis.y) / lightAxis.z - 0.5, 0.0, float(n - 1));
  int i = int(floor(f));
  int j = min(i + 1, n - 1);
  return mix(lightTable[i], lightTable[j], f - float(i));
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
#include <fog_pars_vertex>
void main() {
  vAcross = across;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** H-1 (unlit): the albedo x the lightmap x the view factor 2 ((1 - sat(3 cos))^4 + 0.25) (0.5 from above, up to 2.5
 *  grazing) x the noise (its mean), + the reflection x 0.75 x its scale. Not drawn: FieldSkin's team line network
 *  (game artwork) */
const grassFragment = /* glsl */ `
uniform vec3 albedo;
uniform float reflection;
varying vec3 vWorld;
#include <fog_pars_fragment>
${commonGlsl}
void main() {
  vec3 toCamera = normalize(cameraPosition - vWorld);
  float g = 1.0 - saturate1(3.0 * abs(toCamera.y));
  float view = 2.0 * (g * g * g * g + 0.25);
  gl_FragColor = vec4(albedo * view + reflection * floorReflection(toCamera), 1.0);
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
uniform float pbA[32];
uniform float pbB[32];
uniform float pbG[32];
uniform float pbR[32];
uniform float hpR[32];
uniform float hpA[32];
uniform float envRadial[9];
uniform float envSpread[9];
varying vec3 vWorld;
#include <fog_pars_fragment>
${commonGlsl}
${ENV_GLSL}
void main() {
  vec2 xy = vec2(vWorld.x, vWorld.z); // (the game's frame: Three's x and z)
  vec3 toCamera = normalize(cameraPosition - vWorld);
  vec2 h = xy / vec2(${HEX_TILE[0].toFixed(1)}, ${HEX_TILE[1].toFixed(1)});
  float r = hexRadius(h);
  float c = saturate1(32.0 * (profile32(pbA, r) - 0.45));
  float pb = profile32(pbB, r);
  float pg = profile32(pbG, r);
  float f = 1.0 - saturate1(toCamera.y);
  vec3 cube = floorReflection(toCamera);
  float lines = 1.0 - profile32(hpR, hexRadius(h - 0.04921875 * vec2(toCamera.x, toCamera.z)));
  // (the reflection's tangent-space y and z: the game's y, up; ENVPack.G there our smooth stand-in, RV-71)
  vec2 reflYz = vec2(-toCamera.z, toCamera.y);
  #ifdef FLOOR_B
    vec3 T = 2.0 * mix(vec3(1.0, 0.9687, 0.9061), 2.0 * mix(primary0, primary1, saturate1(xy.y / 2049.2 + 0.5)), min(abs(xy.y) / 1024.6, 1.0));
    vec3 a = (0.5 * envG(2.0 * reflYz) + 0.25) * cube;
    float lumA = dot(a, vec3(0.3, 0.59, 0.11));
    vec3 env = 8.0 * (saturate1(1.5 * (pg - 0.75)) + 0.0625) * (a + clamp(0.25 * a + 0.25 * lumA - 0.015625, 0.0, 1.0));
    vec3 cell = 0.75 * (profile32(hpA, hexRadius(h / 5.0)) + 2.0) * pb * (f * f + 0.375) * (f * f * env + (4.0 - pb) / 32.0);
  #else
    vec3 T = mix(vec3(1.0, 0.9687, 0.9061), 2.0 * mix(primary0, primary1, saturate1(xy.y / 256.0 + 0.5)), min(abs(xy.y) / 128.0, 1.0));
    float pb2r = profile32(pbR, hexRadius(h / 5.0));
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
const frameFragment = /* glsl */ `
uniform float frameR;
uniform float frameG;
varying vec3 vWorld;
varying float vAcross;
#include <fog_pars_fragment>
${commonGlsl}
${teamGlsl}
void main() {
  vec2 xy = vec2(vWorld.x, vWorld.z);
  vec3 toCamera = normalize(cameraPosition - vWorld);
  vec3 refl = 4.0 * (0.125 + 0.625 * frameG) * floorReflection(toCamera);
  vec3 emissive = vec3(0.0);
  vec3 diffuse;
  #ifdef LINE
    float m = 1.0 - smoothstep(0.75, 1.0, abs(2.0 * vAcross - 1.0));
    #ifdef LINE_E
      emissive = m * teamC(xy.y);
      diffuse = clamp(vec3(frameR) + refl * (1.0 - 0.8 * m), 0.0, 1.0);
    #else
      diffuse = clamp(mix(vec3(frameR) + refl, teamCmix(xy.y), m), 0.0, 1.0);
    #endif
  #else
    diffuse = clamp(vec3(frameR) + refl, 0.0, 1.0);
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
uniform float pbA[32];
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
float profile32(float table[32], float r) {
  float rr = clamp(r, 0.0, 1.0);
  float x = (rr < 0.8 ? rr * 20.0 : 16.0 + (rr - 0.8) * 80.0) - 0.5;
  int i = int(clamp(floor(x), 0.0, 31.0));
  int j = min(i + 1, 31);
  return mix(table[i], table[j], clamp(x - float(i), 0.0, 1.0));
}
void main() {
  float h = profile32(pbA, hexRadius(vec2(vWorld.x, vWorld.z) / vec2(${HEX_TILE[0].toFixed(1)}, ${HEX_TILE[1].toFixed(1)})));
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
function lightUniforms(piece: FloorPiece): Record<string, { value: unknown }> {
  const { axis, start, bin, rgb } = FIELD_LIGHT[piece];
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
  constructor(cube: { value: Texture }) {
    const [r, g, b] = GRASS_ALBEDO;
    const [lr, lg, lb] = GRASS_LIGHTMAP;
    super({
      vertexShader,
      fragmentShader: grassFragment,
      uniforms: {
        ...shared(cube),
        albedo: { value: new Vector3(r * lr * GRASS_NOISE, g * lg * GRASS_NOISE, b * lb * GRASS_NOISE) },
        reflection: { value: GRASS_REFLECTION },
        ...lightUniforms("hexPads"),
      },
      fog: true,
    });
  }
}

export class HexFloorMaterial extends ShaderMaterial {
  /** `piece`: its baked light; `floorB`: Reflective_Floor_B (the goal mouths) */
  constructor(
    cube: { value: Texture },
    primary0: Color,
    primary1: Color,
    readonly piece: FloorPiece,
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
        pbA: { value: PB_A },
        pbB: { value: PB_B },
        pbG: { value: PB_G },
        pbR: { value: PB_R },
        hpR: { value: HP_R },
        hpA: { value: HP_A },
        envRadial: { value: ENV_RADIAL },
        envSpread: { value: ENV_SPREAD },
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
    super({
      vertexShader,
      fragmentShader: frameFragment,
      defines: line === null ? {} : line === "E" ? { LINE: "", LINE_E: "" } : { LINE: "" },
      uniforms: { ...shared(cube), ...teamUniforms(primary0, primary1), frameR: { value: r }, frameG: { value: g }, ...lightUniforms(piece) },
      fog: true,
      polygonOffset: line !== null,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
  }
}

export class MarkingMaterial extends ShaderMaterial {
  /** `group`: which mesh's (its baked light) */
  constructor(readonly group: MarkingGroup) {
    const [r, g, b] = MARKING_LIGHT[group];
    super({
      vertexShader,
      fragmentShader: markingFragment,
      uniforms: { ...UniformsUtils.clone(UniformsLib.fog), light: { value: new Vector3(r, g, b) }, pbA: { value: PB_A } },
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
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

  /** A region with its holes, in each of its mirror images */
  region(region: FieldRegion, height: number): void {
    const contour = vectors(region.outline);
    const holes = (region.holes ?? []).map(vectors);
    const all = [...contour, ...holes.flat()];
    const faces = ShapeUtils.triangulateShape(contour, holes);
    for (const [sx, sy] of images(region.mirror)) {
      const at = (n: number): Pt => {
        const v = all[n];
        return v ? [sx * v.x, sy * v.y] : [0, 0];
      };
      for (const [i = 0, j = 0, k = 0] of faces) this.triangle(at(i), at(j), at(k), height);
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
  const add = (sheet: Sheet, material: ShaderMaterial | MeshStandardMaterial, name: string): void => {
    if (sheet.empty) return;
    const m = new Mesh(sheet.geometry(), material);
    m.name = name;
    group.add(m);
  };
  const sheetOf = (regions: readonly FieldRegion[], height = REGION_Z): Sheet => {
    const s = new Sheet();
    for (const r of regions) s.region(r, height);
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
  add(sheetOf(plan.grass, GRASS_Z), behind(new GrassMaterial(cube), 4), "grass");
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
  // (Frame_01_White_MIC: a light frame)
  const vent = new Sheet();
  vent.ring(0, VENT.grate, REGION_Z);
  add(vent, new MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.8 }), "vent grate");
  const ring = new Sheet();
  ring.ring(VENT.ring[0], VENT.ring[1], RING_Z, 96);
  add(ring, new MeshStandardMaterial({ color: 0xd0d4d8, roughness: 0.5, metalness: 0.4 }), "vent ring");
  // The painted markings, by mesh (each its baked light)
  for (const mesh of ["goal", "side", "centre"] as const) {
    const markings = new Sheet();
    for (const m of plan.markings[mesh]) {
      const pts = polyline(m, 1);
      for (const [sx, sy] of images("xy")) markings.strip(pts.map(([x, y]): Pt => [sx * x, sy * y]), m[0] ?? 16, MARKING_Z);
    }
    add(markings, new MarkingMaterial(mesh), `markings: ${mesh}`);
  }
  return group;
}
