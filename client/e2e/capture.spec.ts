// The stadium's reflection capture binned as the game's reflection profile (notes/arena-surroundings.md SUR-35 v2, the
// in-order profile with the painted vertex colours: TRN1): LDR luminance per azimuth sector and elevation band (RV-197).
import { expect, test } from "./fixtures";

/** SUR-35 v2's pre-blur "ldr" table: per band (el from, to), the 12 sectors' luminance (az 0, 30 .. 330) */
const GAME: [number, number, number[]][] = [
  [-90, -30, [0.09, 0.06, 0.06, 0.14, 0.07, 0.07, 0.12, 0.06, 0.07, 0.13, 0.06, 0.06]],
  [-30, -10, [0.1, 0.09, 0.08, 0.15, 0.09, 0.08, 0.14, 0.08, 0.09, 0.14, 0.08, 0.09]],
  [-10, -3, [0.15, 0.13, 0.19, 0.15, 0.17, 0.1, 0.13, 0.13, 0.19, 0.15, 0.17, 0.1]],
  [-3, 0, [0.1, 0.08, 0.13, 0.12, 0.13, 0.1, 0.08, 0.1, 0.13, 0.12, 0.12, 0.08]],
  [0, 3, [0.12, 0.1, 0.07, 0.14, 0.08, 0.1, 0.13, 0.1, 0.09, 0.13, 0.07, 0.1]],
  [3, 6, [0.16, 0.14, 0.08, 0.18, 0.08, 0.11, 0.19, 0.11, 0.08, 0.16, 0.08, 0.15]],
  [6, 10, [0.19, 0.23, 0.12, 0.24, 0.12, 0.12, 0.25, 0.12, 0.11, 0.2, 0.1, 0.24]],
  [10, 15, [0.2, 0.29, 0.14, 0.25, 0.15, 0.16, 0.32, 0.15, 0.16, 0.25, 0.13, 0.27]],
  [15, 20, [0.16, 0.27, 0.15, 0.22, 0.19, 0.18, 0.42, 0.18, 0.22, 0.27, 0.14, 0.27]],
  [20, 25, [0.12, 0.19, 0.15, 0.19, 0.2, 0.21, 0.38, 0.21, 0.25, 0.25, 0.14, 0.21]],
  [25, 30, [0.07, 0.12, 0.14, 0.3, 0.31, 0.23, 0.3, 0.22, 0.32, 0.32, 0.12, 0.13]],
  [30, 40, [0.06, 0.07, 0.11, 0.22, 0.23, 0.15, 0.18, 0.16, 0.22, 0.21, 0.09, 0.07]],
  [40, 50, [0.05, 0.06, 0.06, 0.09, 0.11, 0.11, 0.13, 0.12, 0.11, 0.1, 0.06, 0.06]],
  [50, 65, [0.05, 0.05, 0.05, 0.05, 0.07, 0.09, 0.11, 0.08, 0.08, 0.07, 0.05, 0.05]],
  [65, 90, [0.04, 0.04, 0.04, 0.04, 0.05, 0.05, 0.06, 0.05, 0.05, 0.04, 0.04, 0.04]],
];

/** Each face's direction at texel (s, t) (Three's face order +x, -x, +y, -y, +z, -z, as the capture reads back) */
const direction = (face: number, sc: number, tc: number): [number, number, number] =>
  ([[1, -tc, -sc], [-1, -tc, sc], [sc, 1, tc], [sc, -1, -tc], [sc, -tc, 1], [-sc, -tc, -1]] as [number, number, number][])[face] ?? [1, 0, 0];

test("the stadium's reflection capture as the game's profile: LDR luminance per sector and band within 0.1 in 95 % of the cells, none past 0.15 (SUR-35 v2, RV-197)", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/?viewer=arena&theme=stadium");
  await page.waitForFunction(() => "carballArenaViewer" in window, null, { timeout: 90_000 });
  await page.waitForFunction(() => (window as unknown as { carballArenaViewer: { captures: () => number } }).carballArenaViewer.captures() >= 3, null, { timeout: 90_000 });
  const faces = await page.evaluate(() => (window as unknown as { carballArenaViewer: { cubeFaces: (raw: boolean) => Promise<string[] | null> } }).carballArenaViewer.cubeFaces(true));
  expect(faces).not.toBeNull();
  const n = 256;
  // (per band and sector: the luminance of min(c, 1), each texel by its solid angle)
  const sums = GAME.map(() => Array.from({ length: 12 }, () => [0, 0]));
  (faces ?? []).forEach((b64, face) => {
    const bytes = Buffer.from(b64, "base64");
    const px = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const [sc, tc] = [(2 * (x + 0.5)) / n - 1, (2 * (y + 0.5)) / n - 1];
        const [dx, dy, dz] = direction(face, sc, tc);
        const r = Math.hypot(dx, dy, dz);
        const el = (Math.asin(dy / r) * 180) / Math.PI;
        const az = ((Math.atan2(dz, dx) * 180) / Math.PI + 360) % 360;
        const sector = Math.floor((az + 15) / 30) % 12;
        const band = GAME.findIndex(([lo, hi]) => el >= lo && (el < hi || hi === 90));
        if (band < 0) continue;
        const k = 4 * (y * n + x);
        const lum = 0.3 * Math.min(px[k] ?? 0, 1) + 0.59 * Math.min(px[k + 1] ?? 0, 1) + 0.11 * Math.min(px[k + 2] ?? 0, 1);
        const w = 1 / (1 + sc * sc + tc * tc) ** 1.5;
        const cell = sums[band]?.[sector];
        if (cell) {
          cell[0] = (cell[0] ?? 0) + lum * w;
          cell[1] = (cell[1] ?? 0) + w;
        }
      }
    }
  });
  const off: string[] = [];
  let within = 0;
  GAME.forEach(([lo, hi, game], band) => {
    game.forEach((want, sector) => {
      const [s = 0, w = 1] = sums[band]?.[sector] ?? [];
      const d = s / w - want;
      if (Math.abs(d) <= 0.1) within++;
      else off.push(`el ${String(lo)}..${String(hi)} az ${String(30 * sector)}: ${d.toFixed(3)}`);
      expect(Math.abs(d), `el ${String(lo)}..${String(hi)} az ${String(30 * sector)}`).toBeLessThanOrEqual(0.15);
    });
  });
  expect(within / (GAME.length * 12), off.join("; ")).toBeGreaterThanOrEqual(0.95);
});
