// The stadium's sky (H-10 in full on our own noises) against the game's own sky's statistics: its mean luminance by
// elevation band (the static session's evaluator with the game's textures, at four pan times), and our noises' own
// statistics against the textures' quantiles.
import { describe, expect, it } from "vitest";
import { NOISE_QUANTILES, QUANTILE_P, fromSrgbByte, sampleNoise, skyColour, skyNoise, skyVQ } from "./stadiumSky";

const noise = skyNoise();
const lum = (c: readonly number[]): number => 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);

/** The game's sky, mean luminance over each elevation band (cos-weighted, all azimuths, four pan times) */
const GAME_BANDS: [number, number, number][] = [
  [0, 3, 0.8266],
  [3, 6, 0.4088],
  [6, 10, 0.2252],
  [10, 15, 0.1524],
  [15, 20, 0.1181],
  [20, 25, 0.1093],
  [25, 30, 0.1078],
  [30, 40, 0.0823],
  [40, 50, 0.06],
  [50, 65, 0.0398],
  [65, 90, 0.0223],
];

describe("the stadium's sky (H-10, SUR-25)", () => {
  it("our noises have the textures' medians and upper quartiles", () => {
    const channels: [Uint8Array, number, readonly number[]][] = [
      [noise.smoke, 0, NOISE_QUANTILES.smokeR],
      [noise.smoke, 1, NOISE_QUANTILES.smokeG],
      [noise.speckle, 0, NOISE_QUANTILES.speckleR],
      [noise.fire, 0, NOISE_QUANTILES.fireR],
    ];
    const median = QUANTILE_P.indexOf(50);
    const upper = QUANTILE_P.indexOf(75);
    for (const [bytes, c, table] of channels) {
      const values: number[] = [];
      for (let k = 0; k < noise.size * noise.size; k += 7) values.push(sampleNoise(bytes, noise.size, ((k % noise.size) + 0.5) / noise.size, (Math.floor(k / noise.size) + 0.5) / noise.size)[c] ?? 0);
      values.sort((a, b) => a - b);
      const at = (p: number): number => values[Math.floor((p / 100) * (values.length - 1))] ?? 0;
      expect(Math.abs(at(50) - fromSrgbByte(table[median] ?? 0))).toBeLessThan(0.01);
      expect(Math.abs(at(75) - fromSrgbByte(table[upper] ?? 0))).toBeLessThan(0.015);
    }
  });

  it("its mean luminance by elevation band within 15 % of the game's (the clouds darkening the low sky, the stars lifting the zenith)", () => {
    const report: string[] = [];
    const ratios: number[] = [];
    for (const [a, b, game] of GAME_BANDS) {
      let sum = 0;
      let weights = 0;
      for (let e = a + 0.25; e < b; e += 0.5) {
        const w = Math.cos((e * Math.PI) / 180);
        for (let az = 0.5; az < 360; az += 1) {
          const er = (e * Math.PI) / 180;
          const ar = (az * Math.PI) / 180;
          const dir: [number, number, number] = [Math.cos(er) * Math.cos(ar), Math.cos(er) * Math.sin(ar), Math.sin(er)];
          for (const t of [0, 37, 113, 251]) {
            sum += w * lum(skyColour(noise, dir, t));
            weights += w;
          }
        }
      }
      report.push(`${String(a)}-${String(b)} ${(sum / weights).toFixed(4)} game ${game.toFixed(4)}`);
      ratios.push(sum / weights / game);
    }
    for (const r of ratios) expect(Math.abs(r - 1), report.join("; ")).toBeLessThan(0.15);
  }, 120000);

  it("keeps v and q as the game's dome", () => {
    expect(skyVQ(5).v).toBeCloseTo(0.908, 3);
  });
});
