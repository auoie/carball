// The roof arch's ring of flags (SUR-11, FLG1): the placement rule against the game's banners (the local per-banner
// table), our designs against the atlas's statistics, the material's light and the wind.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FLAG_PALETTE, FLAG_RING, buildFlagRing, flagAzimuths, flagBanners, flagColour, flagDesigns, flagEdge, flagWind } from "./stadiumFlags";

const TABLE = join(__dirname, "../../../../out/bsim/agents/FLG1/banners.json");

describe("the roof arch's flags (SUR-11, FLG1)", () => {
  it("49 banners in the game's runs: 7 on the +Y arm, 5 over each end, 23 along the back, 9 on the -Y arm; the back symmetric about az 180 (but its fit's square term, 0.011 at the corners)", () => {
    const az = flagAzimuths();
    expect(az).toHaveLength(49);
    expect(az[0]).toBeCloseTo(57.9, 6);
    expect(az[23]).toBeCloseTo(180, 6);
    for (let i = 1; i <= 11; i++) expect(Math.abs((az[23 - i] ?? 0) + (az[23 + i] ?? 0) - 360)).toBeLessThan(0.012);
    expect(az[48]).toBeCloseTo(285.16 + 8 * 2.764, 6);
  });

  it.skipIf(!existsSync(TABLE))("the rule where the game's banners are (the local table): centres within 160 uu (rms 70), top edges within 90 (rms 40), facing within 7 degrees", () => {
    const table = (JSON.parse(readFileSync(TABLE, "utf8")) as { banners: { az: number; centre: number[]; z_top: number; facing_yaw: number }[] }).banners;
    expect(table).toHaveLength(49);
    const ours = flagBanners();
    const azOf = (x: number, y: number): number => ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    let [centreSq, topSq] = [0, 0];
    for (const game of table) {
      const mine = ours.reduce((best, b) => (Math.abs(azOf(b.centre[0], b.centre[1]) - game.az) < Math.abs(azOf(best.centre[0], best.centre[1]) - game.az) ? b : best));
      const d = Math.hypot(mine.centre[0] - (game.centre[0] ?? 0), mine.centre[1] - (game.centre[1] ?? 0));
      const dz = mine.top - game.z_top;
      const yaw = (Math.atan2(mine.normal[1], mine.normal[0]) * 180) / Math.PI;
      const dyaw = ((yaw - game.facing_yaw + 540) % 360) - 180;
      expect(d, `az ${game.az.toFixed(1)}: centre`).toBeLessThan(160);
      expect(Math.abs(dz), `az ${game.az.toFixed(1)}: top`).toBeLessThan(90);
      expect(Math.abs(dyaw), `az ${game.az.toFixed(1)}: facing`).toBeLessThan(7);
      centreSq += d * d;
      topSq += dz * dz;
    }
    expect(Math.sqrt(centreSq / 49)).toBeLessThan(70);
    expect(Math.sqrt(topSq / 49)).toBeLessThan(40);
  });

  it("our designs as the atlas's used cells by their statistics: mean 2a (0.372, 0.246, 0.267) within 0.01; albedo luminance p10/p50/p90 0.021/0.074/0.315 within 0.005/0.01/0.04", () => {
    const bands = flagDesigns().flatMap((d) => d.bands);
    expect(bands).toHaveLength(147);
    const colours = bands.map((b) => FLAG_PALETTE.colours[b] ?? [0, 0, 0]);
    const mean = [0, 1, 2].map((c) => (2 * colours.reduce((s, a) => s + (a[c] ?? 0), 0)) / colours.length);
    [0.372, 0.246, 0.267].forEach((want, c) => {
      expect(Math.abs((mean[c] ?? 0) - want)).toBeLessThan(0.01);
    });
    const lum = colours.map((a) => 0.3 * a[0] + 0.59 * a[1] + 0.11 * a[2]).sort((a, b) => a - b);
    const p = (q: number): number => lum[Math.min(lum.length - 1, Math.floor(q * lum.length))] ?? 0;
    expect(Math.abs(p(0.1) - 0.021)).toBeLessThan(0.005);
    expect(Math.abs(p(0.5) - 0.074)).toBeLessThan(0.01);
    expect(Math.abs(p(0.9) - 0.315)).toBeLessThan(0.04);
    // (no band beside its own colour)
    for (const d of flagDesigns()) expect(d.bands[0] !== d.bands[1] && d.bands[1] !== d.bands[2]).toBe(true);
  });

  it("the material's light: 2a Ldiff + (2a + 0.25) Lspec, the front's spec only; the ring's mean seen from the field as FLG1's from C without fog (0.867, 0.539, 0.326) within 0.04", () => {
    const shares = FLAG_PALETTE.shares;
    const a = [0, 1, 2].map((c) => FLAG_PALETTE.colours.reduce((s, col, i) => s + (col[c] ?? 0) * (shares[i] ?? 0), 0));
    const seen = flagColour(a, 0.5, true);
    [0.867, 0.539, 0.326].forEach((want, c) => {
      expect(Math.abs((seen[c] ?? 0) - want), `channel ${String(c)}: ${seen.map((v) => v.toFixed(3)).join(", ")}`).toBeLessThan(0.04);
    });
    // (the back: no spec)
    expect(flagColour([0.1, 0.1, 0.1], 0, false)).toEqual([0.2 * 1.85, 0.2 * 1.66, 0.2 * 0.94].map((v) => v));
  });

  it("the wind: a banner's foot thrown 122 uu on average along its direction (-17 to 439 over the 8 s pattern), its top edge barely (-1 to 34)", () => {
    const W = FLAG_RING.wind;
    const dir = new Vector3(W.dir[0], W.dir[1], W.dir[2]).normalize();
    const along = (o: number[]): number => (o[0] ?? 0) * dir.x + (o[1] ?? 0) * dir.y + (o[2] ?? 0) * dir.z;
    const foot: number[] = [];
    const top: number[] = [];
    for (const b of flagBanners()) {
      for (let t = 0; t < 8; t += 0.05) {
        foot.push(along(flagWind([b.centre[0], b.centre[1], b.top - FLAG_RING.banner.height], 0, t)));
        top.push(along(flagWind([b.centre[0], b.centre[1], b.top], FLAG_RING.banner.height, t)));
      }
    }
    const mean = foot.reduce((s, v) => s + v, 0) / foot.length;
    expect(Math.abs(mean - 122)).toBeLessThan(15);
    expect(Math.min(...foot)).toBeGreaterThan(-40);
    expect(Math.max(...foot)).toBeLessThan(470);
    expect(Math.min(...top)).toBeGreaterThan(-5);
    expect(Math.max(...top)).toBeLessThan(40);
  });

  it("a banner's outline as the game's: 440 across at the top, its sides tapering to -202 and +177 at its foot (the +u side cut over its lowest 108), its area 0.946 of the top's width by its height", () => {
    const B = FLAG_RING.banner;
    expect([flagEdge(B.height), flagEdge(108), flagEdge(0)]).toEqual([220, 200, 177]);
    // (the area: the two edges' integrals, the -u side straight)
    const steps = 10000;
    let area = 0;
    for (let k = 0; k < steps; k++) {
      const h = ((k + 0.5) / steps) * B.height;
      area += (flagEdge(h) - (B.minus[1] + ((B.minus[0] - B.minus[1]) * h) / B.height)) * (B.height / steps);
    }
    expect(Math.abs(area / (B.width * B.height) - 0.946)).toBeLessThan(0.003);
  });

  it("one mesh, each banner's faces toward the field, two-sided", () => {
    const mesh = buildFlagRing();
    const position = mesh.geometry.getAttribute("position");
    // (6 rows of two triangles a banner)
    expect(position.count).toBe(49 * 6 * 6);
    const banners = flagBanners();
    banners.forEach((b, k) => {
      const at = (i: number): Vector3 => new Vector3().fromBufferAttribute(position, k * 36 + i);
      const n = at(1).sub(at(0)).cross(at(2).sub(at(0))).normalize();
      expect(n.dot(new Vector3(b.normal[0], 0, b.normal[1])), `banner ${String(k)}`).toBeGreaterThan(0.99);
    });
  });
});
