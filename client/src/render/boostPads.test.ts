import { InstancedMesh, Matrix4, Vector3, Color } from "three";
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import {
  BIG_PAD,
  BoostPadsView,
  CURTAIN_NOISE,
  PAD_CURVES,
  SMALL_PAD,
  curveAt,
  padArmDirection,
  padBand,
  padBaseGeometry,
  padNoise,
  padTop,
  padUnder,
  padYaw,
  regionMargin,
  smallInlay,
} from "./boostPads";

const deg = (d: number): number => (d * Math.PI) / 180;

describe("the pads' shapes (VT-11a/b's named measures)", () => {
  it("a big pad: three arms, tips an arc at r 89.7 over +-10 degrees, the waist 20.4 at y 60-65, r 36.0 on the bisectors", () => {
    const r = BIG_PAD.radius;
    expect(r(0)).toBeCloseTo(89.7, 3);
    expect(r(deg(9))).toBeCloseTo(89.7, 1);
    // (the arm's half-width along it: the side's points)
    const halfWidthAt = (along: number): number => {
      const t = Math.atan2(20.4, along); // a first guess, then the ray that meets the side at `along`
      let theta = t;
      for (let i = 0; i < 30; i++) theta = Math.atan2(r(theta) * Math.sin(theta), along) ;
      return r(theta) * Math.sin(theta);
    };
    expect(halfWidthAt(62.5)).toBeCloseTo(20.4, 0);
    expect(halfWidthAt(80)).toBeCloseTo(21.9, 0);
    // (between the arms: through PB1's points)
    expect(Math.abs(r(deg(17.5)) - 68)).toBeLessThan(2);
    expect(Math.abs(r(deg(30)) - 46)).toBeLessThan(2);
    expect(Math.abs(r(deg(40)) - 40)).toBeLessThan(1.5);
    expect(r(deg(60))).toBeCloseTo(36, 1);
    // (alike either side of an arm, every 120 degrees)
    for (const t of [5, 20, 35, 50]) {
      expect(r(deg(-t))).toBeCloseTo(r(deg(t)), 6);
      expect(r(deg(t + 120))).toBeCloseTo(r(deg(t)), 6);
    }
  });

  it("a big pad's plate: its top and underside where VT-11a measured them, its side walls 2.26 tall", () => {
    // (the pad's own frame here: an arm along x)
    const axis: [number, number][] = [[0, 13.06], [20, 11.83], [22.5, 11.07], [32.5, 10.04], [35, 11.05], [62.5, 8.88], [65, 7.38], [70, 6.56], [72.5, 7.3], [82.5, 5.03], [85, 3.05], [87.5, 1.51]];
    for (const [along, z] of axis) expect(Math.abs(padTop(BIG_PAD, along, 0) - z), `y ${String(along)}`).toBeLessThan(0.3);
    // The cross-sections' wall tops, and the underside 2.26 below them
    for (const [along, across, z] of [[40, 22.6, 9.24], [60, 20.4, 7.57], [80, 21.9, 3.82]] as const) {
      expect(padTop(BIG_PAD, along, across)).toBeCloseTo(z, 1);
      expect(padTop(BIG_PAD, along, across) - padUnder(BIG_PAD, along, across)).toBeCloseTo(2.26, 1);
    }
    expect(padUnder(BIG_PAD, 0, 0)).toBeCloseTo(7.6, 6);
    expect(padUnder(BIG_PAD, 86, 0)).toBeCloseTo(-0.36, 6); // (the tips on the floor)
  });

  it("a small pad: a rounded triangle (r 48.3 on its lobes, 36.1 in its notches), 6 high at its centre", () => {
    expect(SMALL_PAD.radius(0)).toBeCloseTo(48.3, 6);
    expect(SMALL_PAD.radius(deg(25))).toBeCloseTo(48.3, 6);
    expect(SMALL_PAD.radius(deg(60))).toBeCloseTo(36.1, 6);
    expect(padTop(SMALL_PAD, 0, 0)).toBeCloseTo(6, 6);
    expect(padTop(SMALL_PAD, 14, 0)).toBeCloseTo(5.2, 6);
    expect(padTop(SMALL_PAD, 48.3, 0)).toBeLessThan(0.2);
  });

  it("the bases face out: tops up, a plate's walls outward and underside down (Three's frame)", () => {
    for (const shape of [BIG_PAD, SMALL_PAD]) {
      const g = padBaseGeometry(shape);
      const [position, normal, part] = [g.getAttribute("position"), g.getAttribute("normal"), g.getAttribute("kind")];
      const seen = new Set<number>();
      for (let i = 0; i < position.count; i++) {
        const kind = part.getX(i);
        const n = new Vector3(normal.getX(i), normal.getY(i), normal.getZ(i));
        const p = new Vector3(position.getX(i), 0, position.getZ(i));
        if (kind === 0 && p.length() < 10) expect(n.y, "top").toBeGreaterThan(0.95);
        if (kind === 2 && p.length() < 10) expect(n.y, "underside").toBeLessThan(-0.95);
        if (kind === 1) expect(n.dot(p.normalize()), "wall").toBeGreaterThan(0);
        seen.add(kind);
      }
      expect([...seen].sort()).toEqual(shape.base.kind === "plate" ? [0, 1, 2] : [0]);
    }
  });

  it("its markings' rules: a chevron 9.1 to a side at r 30.25 on the bisector; a barb at the arc line's end", () => {
    const [ring, chevron, , barb] = BIG_PAD.lines;
    if (!ring || !chevron || !barb) throw new Error("the big pad's lines");
    // (on the bisector at 60 degrees, 31 uu out: across it either way of the wedge's edge)
    const bisector = (along: number, across: number): [number, number] => {
      const [c, s] = [Math.cos(deg(60)), Math.sin(deg(60))];
      return [along * c + across * s, along * s - across * c];
    };
    const edge = 9.1 + (31 - 30.25) * Math.tan(deg(37));
    expect(regionMargin(chevron, ...bisector(31, edge - 0.3))).toBeGreaterThan(0);
    expect(regionMargin(chevron, ...bisector(31, edge + 0.3))).toBeLessThan(0);
    expect(regionMargin(chevron, ...bisector(29, 0))).toBeLessThan(0); // (from the ring line out)
    expect(regionMargin(ring, 28.5, 0)).toBeGreaterThan(0);
    // The barb: from |x| 15.5 out to the arm's side, between its edges
    expect(regionMargin(barb, 65, 18)).toBeGreaterThan(0);
    expect(regionMargin(barb, 65, 14)).toBeLessThan(0);
    expect(regionMargin(barb, 58, 17)).toBeLessThan(0);
    expect(regionMargin(barb, 70, 17)).toBeLessThan(0);
  });
});

describe("the pads' yaws (VT-11c)", () => {
  it("the table, and the first arm along the pad frame's y: (-sin yaw, cos yaw)", () => {
    expect(padYaw(3584, 0, true)).toBe(-90);
    expect(padYaw(-3072, 4096, true)).toBe(45);
    expect(padYaw(3072, -4096, true)).toBe(-15);
    expect(padYaw(-1788, 2302, false)).toBe(-135);
    expect(padYaw(0, -4240, false)).toBe(0);
    expect(padYaw(0, 4240, false)).toBe(180);
    expect(padYaw(1024, 0, false)).toBe(-90);
    const [x, y] = padArmDirection(30);
    expect(x).toBeCloseTo(-Math.sin(deg(30)), 9);
    expect(y).toBeCloseTo(Math.cos(deg(30)), 9);
  });
});

describe("the pads' FX (VT-11a/b)", () => {
  it("the big inlays' band is sat(4 Fire_R): 0.11 at 0.30, 0.44 at 0.35, 1 from 0.40 to 0.955, 0 at 1", () => {
    expect(padBand(0.2)).toBe(0);
    expect(padBand(0.3)).toBeCloseTo(0.116, 3);
    expect(padBand(0.35)).toBeCloseTo(0.44, 3);
    expect(padBand(0.5)).toBe(1);
    expect(padBand(0.955)).toBeGreaterThan(0.99);
    expect(padBand(1.3)).toBeCloseTo(padBand(0.3), 9);
  });

  it("a small pad's inlay over a second: the centre (2.03, 0.80, 0.051), the disc (0.49, 0.17, 0.008), r <= 11.3 (0.89, 0.34, 0.019)", () => {
    const mean = (rMax: number): number[] => {
      const sum = [0, 0, 0];
      let weight = 0;
      for (let t = 0; t < 1; t += 1 / 64) {
        for (let r = rMax / 80; r <= rMax; r += rMax / 40) {
          for (let k = 0; k < 8; k++) {
            const [cr, cg, cb] = smallInlay(r * Math.cos((k * Math.PI) / 4), r * Math.sin((k * Math.PI) / 4), t);
            sum[0] = (sum[0] ?? 0) + cr * r;
            sum[1] = (sum[1] ?? 0) + cg * r;
            sum[2] = (sum[2] ?? 0) + cb * r;
            weight += r;
          }
        }
      }
      return sum.map((v) => v / weight);
    };
    const centre = [0, 0, 0];
    for (let t = 0; t < 1; t += 1 / 256) {
      smallInlay(0, 0, t).forEach((v, i) => {
        centre[i] = (centre[i] ?? 0) + v / 256;
      });
    }
    const near = (got: number[], want: number[], tolerance: number): void => {
      got.forEach((v, i) => {
        expect(Math.abs(v - (want[i] ?? 0)) / (want[i] ?? 1), `${JSON.stringify(got)} vs ${JSON.stringify(want)}`).toBeLessThan(tolerance);
      });
    };
    near(centre, [2.03, 0.8, 0.051], 0.1);
    near(mean(22.5), [0.49, 0.17, 0.008], 0.2);
    near(mean(11.3), [0.89, 0.34, 0.019], 0.2);
  });

  it("the curtains' noise: mean 0.075 and deviation 0.055, wrapping round a curtain without a seam", () => {
    const values: number[] = [];
    for (let i = 0; i < 20000; i++) values.push(CURTAIN_NOISE.mean + (CURTAIN_NOISE.sd * (padNoise((i * 0.37) % 29, i * 0.113, 29, 7) - 0.5)) / CURTAIN_NOISE.raw);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    expect(mean).toBeCloseTo(0.075, 2);
    expect(Math.abs(sd - 0.055), `sd ${String(sd)}`).toBeLessThan(0.004);
    expect(padNoise(29, 3.3, 29, 7)).toBeCloseTo(padNoise(0, 3.3, 29, 7), 9);
    expect(padNoise(28.999, 3.3, 29, 7)).toBeCloseTo(padNoise(0, 3.3, 29, 7), 2);
  });

  it("the curtains' band: brightest at v 0.857 (just above the surface), nothing at the top", () => {
    expect(curveAt(PAD_CURVES.curtain, 0.857)).toBe(1);
    expect(curveAt(PAD_CURVES.curtain, 0)).toBe(0);
    expect(curveAt(PAD_CURVES.curtain, 0.5)).toBeCloseTo(0.08, 6);
  });
});

describe("boost pads", () => {
  const pads = [
    { pos: vec3(0, -4240, 64), big: false, active: true, cooldown: 0 },
    { pos: vec3(-3584, 0, 72), big: true, active: true, cooldown: 0 },
    { pos: vec3(1788, 2302, 64), big: false, active: true, cooldown: 0 },
  ];
  const mesh = (view: BoostPadsView, name: string): InstancedMesh => {
    const found: unknown = view.root.children.find((c) => c.name === name);
    if (!(found instanceof InstancedMesh)) throw new Error(name);
    return found as InstancedMesh;
  };
  /** Where an instance is drawn (the game's x, y, z), null where hidden */
  const at = (view: BoostPadsView, name: string, slot: number): [number, number, number] | null => {
    const m = new Matrix4();
    mesh(view, name).getMatrixAt(slot, m);
    const p = new Vector3().setFromMatrixPosition(m);
    return m.determinant() === 0 ? null : [p.x, p.z, p.y];
  };
  const colour = (view: BoostPadsView, name: string, slot: number): Color => {
    const c = new Color();
    mesh(view, name).getColorAt(slot, c);
    return c;
  };

  it("draws every pad's base on the floor where it is, its first arm turned as VT-11c's yaw; big pads' orbs at z 84, no pellets", () => {
    const view = new BoostPadsView(pads);
    expect(at(view, "big base", 0)).toEqual([-3584, 0, 0]);
    expect(at(view, "small base", 0)).toEqual([0, -4240, 0]);
    expect(at(view, "small base", 1)).toEqual([1788, 2302, 0]);
    expect(at(view, "big orb", 0)).toEqual([-3584, 0, 84]);
    expect(view.root.children.some((c) => c.name.startsWith("small orb"))).toBe(false);
    // (the big pad's first arm's tip: 89.7 along (-sin yaw, cos yaw), its yaw +90)
    const m = new Matrix4();
    mesh(view, "big base").getMatrixAt(0, m);
    const tip = new Vector3(89.7, 0, 0).applyMatrix4(m);
    const [dx, dy] = padArmDirection(90);
    expect(tip.x).toBeCloseTo(-3584 + 89.7 * dx, 4);
    expect(tip.z).toBeCloseTo(89.7 * dy, 4);
  });

  it("taken: the FX's Brightness fades 1 -> 0 over 0.1 s, the base as it was (a big orb gone at once); back: the orb at once, the FX fading in", () => {
    const view = new BoostPadsView(pads);
    const base = new Matrix4();
    mesh(view, "small base").getMatrixAt(0, base);
    const taken = pads.map((p) => ({ ...p, active: false }));
    view.update(taken, 0.05);
    expect(at(view, "big orb", 0)).toBeNull();
    expect(at(view, "big orb glow", 0)).toBeNull();
    expect(colour(view, "big inlays", 0).r).toBeCloseTo(0.5, 6);
    expect(colour(view, "small curtains", 1).r).toBeCloseTo(0.5, 6);
    view.update(taken, 0.06);
    expect(colour(view, "small inlays", 0).r).toBe(0);
    expect(colour(view, "big curtains", 0).r).toBe(0);
    const after = new Matrix4();
    mesh(view, "small base").getMatrixAt(0, after);
    expect(after.equals(base)).toBe(true);
    view.update(pads, 0.025);
    expect(at(view, "big orb", 0)).toEqual([-3584, 0, 84]);
    expect(colour(view, "big inlays", 0).r).toBeCloseTo(0.25, 6);
    view.update(pads, 0.1);
    expect(colour(view, "big inlays", 0).r).toBe(1);
  });

  it("warms a taken big pad up (VT-13): the copies revealed by n, the curtains to 1 + 3 EaseInCirc(n); puffs in the last second", () => {
    const view = new BoostPadsView(pads);
    const big = (cooldown: number): typeof pads => pads.map((p, i) => (i === 1 ? { ...p, active: false, cooldown } : p));
    view.update(big(5));
    expect(at(view, "big warm-up curtains", 0)).toEqual([-3584, 0, 0]);
    const warm = colour(view, "big warm-up curtains", 0);
    expect(warm.g).toBeCloseTo(0.5, 6);
    expect(warm.r).toBeCloseTo(1 + 3 * (1 - Math.sqrt(0.75)), 5);
    expect(at(view, "big warm-up puffs", 0)).toBeNull();
    view.update(big(0.75));
    const puff = new Matrix4();
    mesh(view, "big warm-up puffs").getMatrixAt(0, puff);
    expect(Math.cbrt(puff.determinant())).toBeCloseTo(56 + 224 * 0.25, 4);
    expect(colour(view, "big warm-up puffs", 0).r).toBeCloseTo(0.75, 6);
    expect(at(view, "big warm-up puffs", 1)).toBeNull();
    view.update(big(0.25));
    expect(at(view, "big warm-up puffs", 1)).toEqual([-3584, 0, 101]);
    // Back: the warm-up gone at once
    view.update(pads);
    for (const name of ["big warm-up inlays", "big warm-up curtains"]) expect(at(view, name, 0)).toBeNull();
    for (const slot of [0, 1]) expect(at(view, "big warm-up puffs", slot)).toBeNull();
    // (small pads have no warm-up at all)
    expect(view.root.children.some((c) => c.name.startsWith("small warm-up"))).toBe(false);
  });
});
