// The materials' constant tables in one float texture (the user's decision, 2026-10-16, from the Firefox profile: three.js
// sends a uniform array again at every draw of a material, never cached; a texture is bound once): 32-texel rows, RGBA,
// read by exact texel (texelFetch) and mixed as the arrays were, so every pixel is as before
import { DataTexture, FloatType, NearestFilter, RGBAFormat } from "three";

/** Each row's tables, by channel: the hex floors' Hexagons_Pack_B A, B, G, R; Hexagons_Pack's R and A and the lower
 *  glass's Hexagons_Pack G; ENVPack's stand-in's ring means and spreads (9); the grass light's bins along x, |y| (rgb) */
export interface ConstTables {
  readonly pbA: readonly number[];
  readonly pbB: readonly number[];
  readonly pbG: readonly number[];
  readonly pbR: readonly number[];
  readonly hpR: readonly number[];
  readonly hpA: readonly number[];
  readonly packG: readonly number[];
  readonly envRadial: readonly number[];
  readonly envSpread: readonly number[];
  readonly grassX: readonly (readonly number[])[];
  readonly grassY: readonly (readonly number[])[];
}

export const TABLE_WIDTH = 32;
export const TABLE_ROWS = 5;

/** The tables as the texture's texels (row-major, RGBA) */
export function tableTexels(t: ConstTables): Float32Array {
  const data = new Float32Array(TABLE_WIDTH * TABLE_ROWS * 4);
  const put = (row: number, channel: number, values: readonly number[]): void => {
    if (values.length > TABLE_WIDTH) throw new Error("a table longer than a row");
    values.forEach((v, i) => {
      data[(row * TABLE_WIDTH + i) * 4 + channel] = v;
    });
  };
  [t.pbA, t.pbB, t.pbG, t.pbR].forEach((values, c) => {
    put(0, c, values);
  });
  [t.hpR, t.hpA, t.packG].forEach((values, c) => {
    put(1, c, values);
  });
  put(2, 0, t.envRadial);
  put(2, 1, t.envSpread);
  for (const [row, bins] of [
    [3, t.grassX],
    [4, t.grassY],
  ] as const) {
    for (const c of [0, 1, 2])
      put(
        row,
        c,
        bins.map((rgb) => rgb[c] ?? 0),
      );
  }
  return data;
}

const textures = new Map<ConstTables, DataTexture>();

/** The tables' texture (one for every material using them) */
export function constTablesTexture(t: ConstTables): DataTexture {
  let texture = textures.get(t);
  if (!texture) {
    texture = new DataTexture(tableTexels(t), TABLE_WIDTH, TABLE_ROWS, RGBAFormat, FloatType);
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    textures.set(t, texture);
  }
  return texture;
}

/** GLSL: the texture's sampler, `tableAt(row, i)` (a texel) and `tableProfile(row, channel, r)` (profile32's 32-step
 *  profile over a row's channel: 16 steps over r 0-0.8, 16 over 0.8-1, mixed between the steps' middles); the tables'
 *  (row, channel) as T_* */
export const CONST_TABLES_GLSL = /* glsl */ `
uniform sampler2D constTables;
#define T_PB_A 0, 0
#define T_PB_B 0, 1
#define T_PB_G 0, 2
#define T_PB_R 0, 3
#define T_HP_R 1, 0
#define T_HP_A 1, 1
#define T_PACK_G 1, 2
vec4 tableAt(int row, int i) { return texelFetch(constTables, ivec2(i, row), 0); }
float tableProfile(int row, int channel, float r) {
  float rr = clamp(r, 0.0, 1.0);
  float x = (rr < 0.8 ? rr * 20.0 : 16.0 + (rr - 0.8) * 80.0) - 0.5;
  int i = int(clamp(floor(x), 0.0, 31.0));
  int j = min(i + 1, 31);
  return mix(tableAt(row, i)[channel], tableAt(row, j)[channel], clamp(x - float(i), 0.0, 1.0));
}
`;

// ---- The tables (the materials' own data: the floor's, the glass's, the environment's, the grass's light) ----

/** Profiles by hex radius (32 steps: 16 over r 0-0.8, 16 over 0.8-1; scripts/hex_profile.py): Hexagons_Pack_B's A
 *  (linear), B, G, R (decoded), Hexagons_Pack's R (decoded) and A */
export const PB_A = [
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.998, 0.99, 0.967, 0.94, 0.905, 0.865, 0.819, 0.753, 0.676, 0.573, 0.416, 0.253,
];
export const PB_B = [
  0.558, 0.557, 0.562, 0.598, 0.609, 0.606, 0.607, 0.606, 0.607, 0.607, 0.592, 0.474, 0.462, 0.462, 0.462, 0.647, 0.994, 1, 1, 1, 0.999, 0.993, 0.976, 0.956,
  0.938, 0.916, 0.89, 0.849, 0.804, 0.755, 0.676, 0.604,
];
export const PB_G = [
  0.849, 0.849, 0.845, 0.809, 0.801, 0.802, 0.802, 0.802, 0.802, 0.802, 0.813, 0.973, 1, 1, 1, 0.801, 0.514, 0.512, 0.511, 0.512, 0.512, 0.509, 0.499, 0.486,
  0.472, 0.455, 0.436, 0.405, 0.369, 0.327, 0.251, 0.181,
];
export const PB_R = [
  0.557, 0.556, 0.556, 0.56, 0.683, 0.684, 0.688, 0.684, 0.68, 0.666, 0.657, 0.651, 0.627, 0.628, 0.627, 0.631, 0.646, 0.652, 0.656, 0.654, 0.659, 0.656, 0.657,
  0.661, 0.659, 0.663, 0.661, 0.662, 0.665, 0.663, 0.666, 0.663,
];
export const HP_R = [
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.997, 0.972, 0.919, 0.862, 0.799, 0.719, 0.634, 0.526, 0.412, 0.293, 0.176, 0.07,
];
export const HP_A = [
  0.628, 0.628, 0.628, 0.631, 0.734, 0.735, 0.738, 0.735, 0.732, 0.72, 0.712, 0.707, 0.685, 0.686, 0.685, 0.685, 0.7, 0.703, 0.707, 0.705, 0.708, 0.706, 0.707,
  0.711, 0.709, 0.712, 0.71, 0.711, 0.714, 0.712, 0.715, 0.713,
];

/** By hex radius in 32 steps, measured from the game's textures (the mean over each step: 16 over r 0-0.8, then 16
 *  over 0.8-1 where the lines are; scripts/hex_profile.py, decoded from sRGB where the texture is sRGB, as the GPU
 *  reads it: RV-60): TiledPatterns.Hexagons_Pack G (sRGB; the lower glass's alpha shape); the ball tracker's
 *  Hexagons_Pack_01_T R (sRGB; glowing lines) and G (a band inside each cell); ForcefieldHex R (sRGB; the fine net) */
export const PACK_G = [
  0.85, 0.85, 0.846, 0.811, 0.802, 0.803, 0.803, 0.803, 0.803, 0.803, 0.813, 0.973, 1, 1, 1, 0.801, 0.515, 0.511, 0.51, 0.512, 0.513, 0.51, 0.501, 0.487, 0.471,
  0.451, 0.43, 0.405, 0.368, 0.322, 0.253, 0.178,
];

/** ENVPack.G (sRGB, decoded) by |uv| of its lookup at -normalize(tangent-space camera vector).xy, which is the sine of
 *  the view's angle to the glass's normal: its mean over each ring (|uv| 0-1 in 8 steps; at 0 the head-on texel),
 *  measured from the game's texture (a statistic: the texture itself stays local) */
export const ENV_RADIAL = [0.205, 0.217, 0.166, 0.227, 0.394, 0.441, 0.286, 0.269, 0.3];
/** ENVPack.G's spread round each of those rings (its standard deviation, the same lookup: a statistic) */
export const ENV_SPREAD = [0, 0.155, 0.117, 0.251, 0.3, 0.249, 0.236, 0.216, 0.243];

/** StadiumFloorLightMap over the grass (RV-105a, the static session's statistics, linear): separable, a(x) b(|y|) /
 *  mean (within 4.9 % RMS), each table in bins on multiples of 256 with partial ones at its ends (x: -3806, -3584,
 *  -3328 ... 3584, 3806; |y|: 64, 256, 512 ... 4608, 4830: RV-146) */
export const GRASS_LIGHT = {
  mean: [0.553, 0.527, 0.461],
  step: 256,
  x0: -3806,
  x1: 3806,
  x: [
    [0.481, 0.462, 0.406],
    [0.48, 0.462, 0.404],
    [0.471, 0.452, 0.396],
    [0.485, 0.466, 0.408],
    [0.497, 0.477, 0.416],
    [0.507, 0.486, 0.424],
    [0.519, 0.497, 0.433],
    [0.511, 0.49, 0.43],
    [0.513, 0.492, 0.434],
    [0.521, 0.5, 0.437],
    [0.526, 0.501, 0.438],
    [0.534, 0.507, 0.442],
    [0.544, 0.519, 0.452],
    [0.556, 0.529, 0.463],
    [0.565, 0.536, 0.469],
    [0.575, 0.545, 0.477],
    [0.58, 0.549, 0.481],
    [0.581, 0.55, 0.482],
    [0.584, 0.553, 0.483],
    [0.589, 0.558, 0.487],
    [0.598, 0.566, 0.496],
    [0.604, 0.576, 0.503],
    [0.612, 0.582, 0.51],
    [0.637, 0.605, 0.531],
    [0.633, 0.6, 0.526],
    [0.625, 0.592, 0.519],
    [0.609, 0.575, 0.504],
    [0.564, 0.533, 0.467],
    [0.453, 0.431, 0.378],
    [0.412, 0.391, 0.342],
  ],
  y0: 64,
  y1: 4830,
  y: [
    [0.483, 0.465, 0.407],
    [0.502, 0.483, 0.422],
    [0.517, 0.494, 0.434],
    [0.523, 0.501, 0.438],
    [0.528, 0.504, 0.441],
    [0.536, 0.508, 0.445],
    [0.542, 0.516, 0.451],
    [0.551, 0.523, 0.459],
    [0.561, 0.532, 0.467],
    [0.571, 0.542, 0.473],
    [0.578, 0.548, 0.479],
    [0.579, 0.548, 0.481],
    [0.571, 0.544, 0.477],
    [0.572, 0.545, 0.476],
    [0.576, 0.549, 0.479],
    [0.586, 0.56, 0.489],
    [0.603, 0.573, 0.503],
    [0.623, 0.592, 0.518],
    [0.641, 0.611, 0.536],
  ],
} as const;

/** ENVPack.G's stand-in (RV-71) at uv, from the tables' row 2 (CONST_TABLES_GLSL before it) */
export const ENV_GLSL = /* glsl */ `
float envG(vec2 uv) {
  float s = min(length(uv), 1.0);
  float x = s < 0.0625 ? s / 0.0625 : 1.0 + (s - 0.0625) / 0.125;
  int i = int(clamp(floor(x), 0.0, 7.0));
  float f = clamp(x - float(i), 0.0, 1.0);
  float mean = mix(tableAt(2, i).x, tableAt(2, i + 1).x, f);
  float spread = mix(tableAt(2, i).y, tableAt(2, i + 1).y, f);
  return clamp(mean + 1.4142 * spread * cos(atan(uv.y, uv.x) - 6.2832 * s), 0.0, 1.0);
}
`;

/** Every table, one texture for all the materials reading them */
export const FIELD_TABLES: ConstTables = {
  pbA: PB_A,
  pbB: PB_B,
  pbG: PB_G,
  pbR: PB_R,
  hpR: HP_R,
  hpA: HP_A,
  packG: PACK_G,
  envRadial: ENV_RADIAL,
  envSpread: ENV_SPREAD,
  grassX: GRASS_LIGHT.x,
  grassY: GRASS_LIGHT.y,
};

/** The tables' texture as a uniform's value (shared) */
export function tablesUniform(): { value: DataTexture } {
  return { value: constTablesTexture(FIELD_TABLES) };
}
