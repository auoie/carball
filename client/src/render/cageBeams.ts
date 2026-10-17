// The arena's beam curves and its goal shockwave (the game's beams' look, notes/arena-visuals.md AV-14, H-8, AV-15): the
// scan stripes' and contracting rings' curves as textures, and the shockwave's time and ring, which the greenhouse's
// glass bars light by (src/render/greenhouse.ts).
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, LinearMipmapNearestFilter, RedFormat, RepeatWrapping } from "three";
/** Curve_Fire_01_Pack.R and Curve_Smoke_01_Pack.G (both sRGB: decoded, as the GPU reads them, RV-60) at 256 points
 *  (values measured from the game's 1-D gradients; 256 keeps the rings' sharp edge, RV-70f), drawn as small data textures */
export const FIRE_CURVE = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.0005, 0.0011, 0.0017, 0.0021, 0.0029, 0.0035,
  0.0044, 0.0056, 0.0068, 0.008, 0.0097, 0.0113, 0.0137, 0.0156, 0.0181, 0.0212, 0.0242, 0.0273, 0.0307, 0.0356,
  0.0396, 0.0452, 0.0505, 0.0561, 0.063, 0.0685, 0.0762, 0.0844, 0.0909, 0.0999, 0.1095, 0.117, 0.1275, 0.1384,
  0.1485, 0.162, 0.1715, 0.1845, 0.1981, 0.2122, 0.2251, 0.2384, 0.2542, 0.2705, 0.2832, 0.3006, 0.3186, 0.3348,
  0.3516, 0.3713, 0.389, 0.4073, 0.4233, 0.4452, 0.4649, 0.4822, 0.5029, 0.5241, 0.5457, 0.5647, 0.5808, 0.6005,
  0.624, 0.641, 0.6654, 0.6831, 0.7047, 0.7231, 0.7417, 0.7567, 0.7758, 0.7952, 0.8109, 0.8308, 0.8509, 0.8632,
  0.8796, 0.8963, 0.9089, 0.9216, 0.9344, 0.943, 0.956, 0.9647, 0.9734, 0.9823, 0.9867, 0.9911, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.9956, 0.9911, 0.9911, 0.9823, 0.9823, 0.9734, 0.9647,
  0.9603, 0.9516, 0.9387, 0.9301, 0.9216, 0.9047, 0.8921, 0.8796, 0.8591, 0.8428, 0.8228, 0.803, 0.7797, 0.753,
  0.7268, 0.6975, 0.6689, 0.6308, 0.6006, 0.5616, 0.518, 0.4736, 0.4288, 0.3763, 0.3233, 0.2687, 0.2106, 0.1578,
  0.1086, 0.0706, 0.044, 0.0264, 0.0157, 0.0092, 0.0056, 0.0034, 0.0018, 0.0005
];
const SMOKE_CURVE = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0.0003, 0.0003, 0.0003, 0.0003, 0.0006, 0.0006, 0.0006, 0.0009, 0.0009, 0.0009, 0.0009, 0.0012, 0.0012,
  0.0012, 0.0015, 0.0015, 0.0015, 0.0018, 0.0018, 0.0018, 0.0021, 0.0021, 0.0021, 0.0024, 0.0024, 0.0024, 0.0024,
  0.0027, 0.0027, 0.0027, 0.003, 0.003, 0.003, 0.0033, 0.0033, 0.0033, 0.0037, 0.0037, 0.004, 0.004, 0.004, 0.0044,
  0.0044, 0.0044, 0.0048, 0.0048, 0.0048, 0.0052, 0.0052, 0.0052, 0.0056, 0.0056, 0.006, 0.006, 0.006, 0.0065,
  0.0065, 0.007, 0.007, 0.007, 0.0075, 0.0075, 0.008, 0.008, 0.008, 0.0086, 0.0086, 0.0091, 0.0091, 0.0091, 0.0097,
  0.0097, 0.0103, 0.0103, 0.011, 0.011, 0.011, 0.0116, 0.0116, 0.0123, 0.0123, 0.013, 0.013, 0.0137, 0.0137, 0.0137,
  0.0144, 0.0144, 0.0152, 0.0152, 0.016, 0.016, 0.0168, 0.0168, 0.0176, 0.0176, 0.0185, 0.0185, 0.0194, 0.0194,
  0.0203, 0.0203, 0.0212, 0.0212, 0.0222, 0.0232, 0.0232, 0.0242, 0.0242, 0.0252, 0.0252, 0.0262, 0.0273, 0.0273,
  0.0284, 0.0284, 0.0296, 0.0307, 0.0307, 0.0319, 0.0331, 0.0331, 0.0343, 0.0356, 0.0356, 0.0369, 0.0382, 0.0395,
  0.0395, 0.0409, 0.0423, 0.0437, 0.0452, 0.0452, 0.0467, 0.0482, 0.0497, 0.0513, 0.0529, 0.0561, 0.0578, 0.0595,
  0.063, 0.0666, 0.0723, 0.0782, 0.0823, 0.0887, 0.0931, 0.0976, 0.1022, 0.1095, 0.1144, 0.1195, 0.1248, 0.1301,
  0.1384, 0.1441, 0.15, 0.1559, 0.162, 0.1683, 0.1746, 0.1845, 0.1912, 0.1981, 0.2051, 0.2122, 0.2195, 0.227, 0.2346,
  0.2462, 0.2542, 0.2623, 0.2705, 0.2789, 0.2874, 0.3005, 0.3095, 0.3185, 0.3278, 0.3372, 0.3467, 0.3613, 0.3712,
  0.3813, 0.3916, 0.4072, 0.4179, 0.4287, 0.4397, 0.4564, 0.4678, 0.4793, 0.4969, 0.5089, 0.5271, 0.5395, 0.552,
  0.5711, 0.5841, 0.6038, 0.624, 0.6376, 0.6584, 0.6795, 0.6939, 0.7157, 0.7379, 0.7605, 0.7835, 0.8148, 0.8388,
  0.8714, 0.9131, 0.956
];


/** The goal explosion's ShockWave (AV-15) `sinceExplosion` world seconds after it (null: no explosion): -0.25 at rest,
 *  then lerp(-0.25, 1, min(1, t / 2.5)) */
export function shockWave(sinceExplosion: number | null): number {
  return sinceExplosion === null ? -0.25 : -0.25 + 1.25 * Math.min(1, Math.max(0, sinceExplosion) / 2.5);
}

/** The shockwave's ring (H-8b) at d2 = |P - ball|^2 / 16384^2: 1 - |1 - 2 max(0, 8 (sat(1 - d2 + SW) - 0.875))|, a
 *  ring over d2 in (SW, SW + 0.125) (as the beams' shaders have it) */
export function shockRing(d2: number, wave: number): number {
  const x = Math.min(1, Math.max(0, 1 - d2 + wave));
  return 1 - Math.abs(1 - 2 * Math.max(0, 8 * (x - 0.875)));
}

/** `values` (a wrapping 1-D curve) at `n` texels, read as a linear filter reads it at each texel's centre */
export function resampleCurve(values: readonly number[], n: number): number[] {
  const m = values.length;
  return Array.from({ length: n }, (_, i) => {
    const u = ((i + 0.5) / n) * m - 0.5;
    const k = Math.floor(u);
    const f = u - k;
    return (values[((k % m) + m) % m] ?? 0) * (1 - f) + (values[(((k + 1) % m) + m) % m] ?? 0) * f;
  });
}

/** A 1-D curve's mips (its texels' box averages in linear space, halving to 1 texel: the game's) */
export function curveMips(values: readonly number[]): number[][] {
  const levels = [[...values]];
  for (let last = levels[0] ?? []; last.length > 1; ) {
    const next = Array.from({ length: Math.floor(last.length / 2) }, (_, i) => ((last[2 * i] ?? 0) + (last[2 * i + 1] ?? 0)) / 2);
    levels.push(next);
    last = next;
  }
  return levels;
}

/** Curve_Fire_01_Pack's width (1 x 512, 10 mips, BR1): ours resampled to it so its mips change where the game's do */
const FIRE_TEXELS = 512;

/** A 1-D curve as a texture (half floats: filterable everywhere WebGL2 is), wrapping, with its mips: linear in a mip, the
 *  nearest mip (the game's Effects group: point mip selection, anisotropy 4, BR1) */
function curveTexture(values: readonly number[]): DataTexture {
  const halves = (level: readonly number[]): Uint16Array => new Uint16Array(level.map((v) => DataUtils.toHalfFloat(v)));
  const levels = curveMips(values);
  const texture = new DataTexture(halves(values), values.length, 1, RedFormat, HalfFloatType);
  texture.mipmaps = levels.map((level) => ({ data: halves(level), width: level.length, height: 1 }));
  texture.generateMipmaps = false;
  texture.wrapS = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapNearestFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** The beams' two curves as textures: the scan stripes' (Curve_Fire_01) and the contracting rings' (Curve_Smoke_01) */
export function beamCurves(): { readonly fire: DataTexture; readonly smoke: DataTexture } {
  return { fire: curveTexture(resampleCurve(FIRE_CURVE, FIRE_TEXELS)), smoke: curveTexture(SMOKE_CURVE) };
}
