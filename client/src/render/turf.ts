// The turf's grain (ours: the user's ask of 2026-10-24, the ground's motion easier to see under the car): a small seamless
// tile of grass speckle generated here (seeded value noise at three scales and a little white noise, copied from
// nothing), mipmapped and filtered anisotropically so it never shimmers far off; the pitch's shader multiplies its
// grass by it a little (greenhouse.ts pitchMaterial), its chalk lines left as they were
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, UnsignedByteType } from "three";
import { seededRandom } from "./themes/random";

/** The tile's texels a side */
export const TURF_TEXELS = 256;

/** The grain on the pitch (the user's pick of the options, 2026-10-24): its tile (uu a side: its features 12-48 uu, seen
 *  under the car at the camera's low angle) and strength (two fetches' sum, its brightness about 6.5 % either way) */
export const TURF = { tile: 768, grain: 0.3 } as const;

/** Seamless value noise on a square of `size` texels, `cells` lattice cells a side (wrapping), in [0, 1] */
function tilingNoise(size: number, cells: number, random: () => number): Float32Array {
  const lattice = Array.from({ length: cells * cells }, random);
  const at = (x: number, y: number): number => lattice[(y % cells) * cells + (x % cells)] ?? 0;
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const gy = (y / size) * cells;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = smooth(gx - ix);
      const fy = smooth(gy - iy);
      const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
      const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
      out[y * size + x] = top + (bottom - top) * fy;
    }
  }
  return out;
}

/** The grain's texels (0-255), its mean 128, its spread about 40 either way: three octaves of seamless noise (cells of
 *  4, 8 and 16 texels) and a little white noise */
export function turfGrain(size = TURF_TEXELS, seed = 7): Uint8Array {
  const random = seededRandom(seed);
  const octaves = [
    [size / 4, 0.45],
    [size / 8, 0.3],
    [size / 16, 0.15],
  ] as const;
  const layers = octaves.map(([cells]) => tilingNoise(size, cells, random));
  const values = new Float32Array(size * size);
  for (let i = 0; i < values.length; i++) {
    values[i] = octaves.reduce((sum, [, weight], k) => sum + (layers[k]?.[i] ?? 0) * weight, 0) + 0.1 * random();
  }
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length) || 1;
  return Uint8Array.from(values, (v) => Math.round(Math.min(255, Math.max(0, 128 + ((v - mean) / sd) * 40))));
}

/** The grain as a texture: one channel, repeating, its mips made by the GPU, trilinear and anisotropic (8: Three takes
 *  the GPU's most if less) */
export function turfTexture(): DataTexture {
  const texture = new DataTexture(turfGrain(), TURF_TEXELS, TURF_TEXELS, RedFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
