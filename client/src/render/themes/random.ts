// Seeded randomness for scenery, so a theme looks the same on every load (and in tests).

/** Uniform numbers in [0, 1) from a seed (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 2D value noise in [-1, 1] (lattice values from a hash of the seed and cell, smoothly interpolated). */
export function valueNoise(seed: number): (x: number, y: number) => number {
  const lattice = (ix: number, iy: number): number => {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const top = lattice(ix, iy) + (lattice(ix + 1, iy) - lattice(ix, iy)) * fx;
    const bottom = lattice(ix, iy + 1) + (lattice(ix + 1, iy + 1) - lattice(ix, iy + 1)) * fx;
    return top + (bottom - top) * fy;
  };
}

/** Fractal noise: `octaves` layers of `noise`, each twice the frequency and half the amplitude; about [-1, 1]. */
export function fractalNoise(noise: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude /= 2;
    frequency *= 2;
  }
  return sum / total;
}
