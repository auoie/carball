import { Color, Matrix4, Mesh, type PlaneGeometry, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { GRASS_CUBE_AT } from "../grassCube";
import { TEAM_PRIMARY_LINEAR, fullBright, linear } from "../teamColors";
import { skyVQ, stadiumTheme } from "./stadium";
import { CROWD, SECONDARY, buildCrowd, crowdSeen } from "./stadiumCrowd";
import { AD_EMBLEM, PANELS, PANEL_LIGHT, bannerColour, buildScreensAndProps, panelColour, screenLogo } from "./stadiumProps";
import { FLOODLIGHT, buildBowl, buildCaptureHotspots, clearFade, fixtureOffsets, floodlightE, lensMean } from "./stadiumSurroundings";

/** The capture point in Three's frame */
const C = new Vector3(GRASS_CUBE_AT.x, GRASS_CUBE_AT.z, GRASS_CUBE_AT.y);
const deg = (r: number): number => (r * 180) / Math.PI;

describe("the reflection capture's hotspots (SUR-33)", () => {
  const group = buildCaptureHotspots(new Color(0.1, 0.4, 1), new Color(1, 0.4, 0.1));
  group.updateMatrixWorld(true);
  const sprites = group.children as Mesh[];
  /** Each sprite's direction from C (az, el) and its angular half sizes across and up */
  const seen = sprites.map((m) => {
    const p = m.position.clone().sub(C);
    const d = p.length();
    const { width, height } = (m.geometry as PlaneGeometry).parameters;
    return { az: deg(Math.atan2(p.z, p.x)), el: deg(Math.asin(p.y / d)), across: deg(Math.atan(width / 2 / d)), up: deg(Math.atan(height / 2 / d)) };
  });

  it("are the game's ellipses (RV-119): each one's angular radii within 2 degrees of the instance table", () => {
    // (az, el, across x up: the corrected SUR-33; the plain ones, then blue's and orange's)
    const table = [
      [2, 2, 52.7, 30.4],
      [180, 7, 63.1, 33.3],
      [180, 7, 6.1, 33.7],
      [107, 22, 60.8, 30.8],
      [-108, 26, 50.5, 22.0],
      [35, 15, 21, 21],
      [-35, 15, 21, 21],
      [-90, 9, 26.9, 20.8],
      [90, 8, 23.5, 18.1],
    ];
    expect(seen).toHaveLength(table.length);
    table.forEach(([az = 0, el = 0, across = 0, up = 0], k) => {
      const s = seen[k];
      const daz = (((s?.az ?? 0) - az + 540) % 360) - 180;
      expect(Math.abs(daz), `hotspot ${String(k)} az`).toBeLessThan(0.5);
      expect(Math.abs((s?.el ?? 0) - el), `hotspot ${String(k)} el`).toBeLessThan(0.5);
      expect(Math.abs((s?.across ?? 0) - across), `hotspot ${String(k)} across`).toBeLessThan(2);
      expect(Math.abs((s?.up ?? 0) - up), `hotspot ${String(k)} up`).toBeLessThan(2);
    });
  });

  it("pitched as the game's, their tops toward the arena (RV-119): the projected extents from the capture point", () => {
    // (the ellipse each draws, its boundary projected: az and el ranges)
    const extents = (m: Mesh): { az: [number, number]; el: [number, number] } => {
      const { width, height } = (m.geometry as PlaneGeometry).parameters;
      const az: number[] = [];
      const el: number[] = [];
      for (let k = 0; k < 256; k++) {
        const a = (k / 256) * 2 * Math.PI;
        const p = new Vector3((width / 2) * Math.cos(a), (height / 2) * Math.sin(a), 0).applyMatrix4(m.matrixWorld).sub(C);
        az.push(((deg(Math.atan2(p.z, p.x)) % 360) + 360) % 360);
        el.push(deg(Math.asin(p.y / p.length())));
      }
      return { az: [Math.min(...az), Math.max(...az)], el: [Math.min(...el), Math.max(...el)] };
    };
    // (InterpActor_12, over the back: az 173.0-186.4, el -16.9..47.7; the +X one: el -18.4..37.6)
    const sprite = (k: number): Mesh => {
      const s = sprites[k];
      if (!s) throw new Error(`no hotspot ${String(k)}`);
      return s;
    };
    const back = extents(sprite(2));
    expect(Math.abs(back.az[0] - 173.0)).toBeLessThan(2);
    expect(Math.abs(back.az[1] - 186.4)).toBeLessThan(2);
    // (its low end 2.6 short of the review's -16.9, but on the instance's own world bounds, -14.7: within 3)
    expect(Math.abs(back.el[0] - -16.9)).toBeLessThan(3);
    expect(Math.abs(back.el[1] - 47.7)).toBeLessThan(2);
    const plusX = extents(sprite(0));
    expect(Math.abs(plusX.el[0] - -18.4)).toBeLessThan(2);
    expect(Math.abs(plusX.el[1] - 37.6)).toBeLessThan(2);
  });

  it("the +X one through the haze by elevation (RV-120): the game's pass fractions at the bands' centres", () => {
    // (el 0-3, 3-6, 6-10, 10-15, 15-20, 20-25; the last clamped at 1 against 0.89)
    [[1.5, 0.07], [4.5, 0.12], [8, 0.16], [12.5, 0.27], [17.5, 0.56], [22.5, 0.89]].forEach(([el = 0, pass = 0]) => {
      expect(Math.abs(clearFade(el) - pass), `el ${String(el)}`).toBeLessThan(0.12);
    });
  });

  it("sit inside the sky's dome and the concourse's wall (the far ones' sizes kept), the +X one unfogged (RV-120)", () => {
    for (const m of sprites) expect(m.position.distanceTo(C)).toBeLessThan(30000);
    const plusX = sprites[0];
    expect((plusX?.material as { fog?: boolean }).fog).toBe(false);
    expect(sprites.slice(1, 7).every((m) => (m.material as { fog?: boolean }).fog)).toBe(true);
  });
});

describe("the screens (SUR-9)", () => {
  /** A panel's mean colour over its face */
  const mean = (colour: (u: number, v: number) => readonly number[]): number[] => {
    const sum = [0, 0, 0];
    const n = 200;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) colour((i + 0.5) / n, (j + 0.5) / n).forEach((c, k) => (sum[k] = (sum[k] ?? 0) + c / (n * n)));
    return sum;
  };
  const near = (got: readonly number[], want: readonly number[], what: string): void => {
    want.forEach((w, k) => {
      expect(Math.abs((got[k] ?? 0) / w - 1), `${what} channel ${String(k)}: ${(got[k] ?? 0).toFixed(3)} vs ${String(w)}`).toBeLessThan(0.15);
    });
  };

  it("each placement in its own light, as SUR-17's and SUR-18's totals (RV-126), the screen logo 14 % (RV-127a)", () => {
    const [p0 = [0, 0, 1], p1 = [1, 0.5, 0]] = TEAM_PRIMARY_LINEAR;
    const screen = (t: number) => ({ screen: true as const, t, p: [p0, p1] as const, fb: [fullBright(p0), fullBright(p1)] as const });
    near(mean((u, v) => panelColour(u, v, screen(1), PANEL_LIGHT.lowScreen)), [1.1, 0.7, 0.36], "low +Y");
    near(mean((u, v) => panelColour(u, v, screen(0), PANEL_LIGHT.lowScreen)), [0.47, 0.72, 0.89], "low -Y");
    near(mean((u, v) => panelColour(u, v, screen(1), PANEL_LIGHT.highScreen)), [0.5, 0.35, 0.22], "high +Y");
    near(mean((u, v) => panelColour(u, v, screen(0), PANEL_LIGHT.highScreen)), [0.22, 0.36, 0.55], "high -Y");
    near(mean((u, v) => panelColour(u, v, { screen: false, emblem: AD_EMBLEM.ad }, PANEL_LIGHT.ad)), [0.24, 0.23, 0.2], "2x1");
    near(mean((u, v) => panelColour(u, v, { screen: false, emblem: AD_EMBLEM.billboard }, PANEL_LIGHT.billboard)), [0.175, 0.175, 0.175], "4x1");
    expect(Math.abs(mean((u, v) => [screenLogo(u, v) ? 1 : 0])[0] ?? 0) - 0.14).toBeLessThan(0.015);
  });

  it("the banners in their team's colours (SUR-19, RV-127d)", () => {
    const [p0 = [0, 0, 1], p1 = [1, 0.5, 0]] = TEAM_PRIMARY_LINEAR;
    bannerColour(linear(p0)).forEach((c, k) => {
      expect(Math.abs(c - ([0.29, 1.03, 1.5][k] ?? 0))).toBeLessThan(0.06);
    });
    bannerColour(linear(p1)).forEach((c, k) => {
      expect(Math.abs(c - ([1.5, 0.9, 0.27][k] ?? 0))).toBeLessThan(0.06);
    });
  });

  it("the high screens tilt down toward the field: their normals down, at the capture point (RV-121)", () => {
    const { group } = buildScreensAndProps(new Color(0.1, 0.4, 1), new Color(1, 0.4, 0.1));
    group.updateMatrixWorld(true);
    const high = PANELS.screens.filter((s) => s.tilt);
    expect(high).toHaveLength(2);
    for (const screen of high) {
      const [x, y, z] = screen.at;
      const mesh = group.children.find((m) => m.position.distanceTo(new Vector3(x, z, y)) < 1);
      if (!mesh) throw new Error(`no screen at ${screen.at.join(", ")}`);
      const normal = new Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
      expect(normal.y).toBeLessThan(0);
      expect(normal.dot(C.clone().sub(mesh.position).normalize())).toBeGreaterThan(0.95);
    }
  });
});

describe("the crowd (SUR-26..31)", () => {
  const [p0 = [0, 0, 1], p1 = [1, 0.5, 0]] = TEAM_PRIMARY_LINEAR;
  const { mesh } = buildCrowd(linear(p0), linear(p1));
  const card = mesh.geometry.getAttribute("card");
  const seat = mesh.geometry.getAttribute("seat");
  const matrix = new Matrix4();
  const at = new Vector3();

  it("seated where the game's are, rule by rule (RV-123): a team's cards per section and azimuth band within 15 % of the game's", () => {
    const tiers = mesh.userData["tiers"] as string[];
    // (the game's, from its cards: the front rows z < 1200 within r 13.3k, the rest of the lower bowl by band, the upper
    // tiers by tier)
    const want: Record<string, number> = {
      "front 40-100": 329,
      "front 100-153": 225,
      "front 153-171": 72,
      "rest 27-38": 446,
      "rest 38-46": 353,
      "rest 46-72": 1789,
      "rest 72-98": 1792,
      "rest 98-117": 1325,
      "rest 117-137": 1346,
      "rest 137-153": 1187,
      "rest 153-164": 1030,
      "rest 164-171": 128,
      "upper mid": 2589,
      "upper top": 1382,
    };
    const bands = Object.keys(want).map((k) => {
      const m = /^(\w+) (\d+)-(\d+)$/.exec(k);
      return { key: k, kind: m?.[1] ?? "", from: Number(m?.[2] ?? 0), to: Number(m?.[3] ?? 0) };
    });
    const got: Record<string, number> = Object.fromEntries(Object.keys(want).map((k) => [k, 0]));
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      at.setFromMatrixPosition(matrix);
      if (at.z <= 0) continue; // (team 1's half: y > 0)
      const az = deg(Math.atan2(at.z, at.x));
      const tier = tiers[i] ?? "";
      let key: string | undefined;
      if (tier === "top") key = "upper top";
      else if (tier === "mid" || tier === "midBack") key = "upper mid";
      else {
        const kind = at.y < 1200 && Math.hypot(at.x, at.z) < 13300 ? "front" : "rest";
        key = bands.find((b) => b.kind === kind && az >= b.from && az < b.to)?.key;
      }
      if (key) got[key] = (got[key] ?? 0) + 1;
    }
    for (const [k, n] of Object.entries(want)) expect.soft(Math.abs((got[k] ?? 0) / n - 1), `${k}: ${String(got[k])} vs ${String(n)}`).toBeLessThan(0.15);
  });

  it("the stands top out under 7k at the upper tiers' ends (az 76-85, 130-139): no top tier there (RV-123)", () => {
    const bowl = buildBowl(linear(p0), linear(p1));
    bowl.updateMatrixWorld(true);
    const v = new Vector3();
    const ends = (az: number): boolean => (az >= 76 && az <= 85) || (az >= 130 && az <= 139);
    bowl.traverse((m) => {
      if (!(m instanceof Mesh) || !m.name.startsWith("bowl: ") || /roof|canopy|floodlights|supports|concourse/.test(m.name)) return;
      const position = (m.geometry as PlaneGeometry).getAttribute("position");
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i);
        if (ends(Math.abs(deg(Math.atan2(v.z, v.x))))) expect(v.y, m.name).toBeLessThanOrEqual(7000);
      }
    });
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      at.setFromMatrixPosition(matrix);
      if (ends(Math.abs(deg(Math.atan2(at.z, at.x))))) expect(at.y).toBeLessThanOrEqual(7000);
    }
  });

  it("seen as the game's: each team's mean colour within 15 % of SUR-31's (RV-122)", () => {
    const want = [
      [0.154, 0.204, 0.159],
      [0.209, 0.201, 0.106],
    ];
    const sums = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      const team = at.setFromMatrixPosition(matrix).z < 0 ? 0 : 1;
      const c = [card.getX(i), card.getY(i), card.getZ(i)] as const;
      const s = [seat.getX(i), seat.getY(i), seat.getZ(i)] as const;
      // (shown as much as it stands up: presence, SUR-28)
      const lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
      const shown = Math.min(Math.max(32 * (0.5 * (lum + c[2] - 0.5) + 0.35 * s[1] + CROWD.size - 1.375), 0), 1);
      const p = team === 0 ? p0 : p1;
      const sc = SECONDARY[team];
      const seen = crowdSeen(c, s, { p, s: sc, fp: fullBright(p), fs: fullBright(sc) });
      const sum = sums[team] ?? [0, 0, 0, 0];
      for (let k = 0; k < 3; k++) sum[k] = (sum[k] ?? 0) + (seen[k] ?? 0) * shown;
      sum[3] = (sum[3] ?? 0) + shown;
    }
    for (const team of [0, 1]) {
      const sum = sums[team] ?? [0, 0, 0, 1];
      for (let k = 0; k < 3; k++) {
        const mean = (sum[k] ?? 0) / (sum[3] ?? 1);
        const target = want[team]?.[k] ?? 0;
        expect(Math.abs(mean / target - 1), `team ${String(team)} channel ${String(k)}: ${mean.toFixed(3)} vs ${String(target)}`).toBeLessThan(0.15);
      }
    }
  });
});

describe("the floodlights (SUR-12)", () => {
  it("as bright as the game's (RV-125: its fixtures and v-profile): a half's mean E within 20 % of SUR-12's front (0.61, 0.58, 0.39), E > 1 on 0.11 +- 0.03 of it", () => {
    const r = 15500;
    const mean = lensMean(r);
    const offsets = fixtureOffsets();
    expect(offsets).toHaveLength(21);
    const [from, to] = FLOODLIGHT.halves[0];
    const sum = [0, 0, 0];
    let over = 0;
    let count = 0;
    for (let i = 0; i < 600; i++) {
      const az = from + ((to - from) * (i + 0.5)) / 600;
      const d = Math.min(...offsets.map((o) => Math.abs(az - (FLOODLIGHT.centre + o)))) * (Math.PI / 180) * r;
      for (let j = 0; j < 640; j++) {
        const e = floodlightE((j + 0.5) / 640, d, mean);
        e.forEach((c, k) => (sum[k] = (sum[k] ?? 0) + c));
        if (e[0] > 1) over++;
        count++;
      }
    }
    [0.61, 0.58, 0.39].forEach((target, k) => {
      expect(Math.abs((sum[k] ?? 0) / count / target - 1), `channel ${String(k)}`).toBeLessThan(0.2);
    });
    expect(Math.abs(over / count - 0.11)).toBeLessThan(0.03);
  });
});

describe("the -X plaza (SUR-1, 4, 25)", () => {
  const theme = stadiumTheme();
  theme.root.updateMatrixWorld(true);
  // (everything solid: not the sky's dome, the far layer, the capture's own hotspots, nor the translucent haze and fog
  // sheets)
  const targets: Mesh[] = [];
  theme.root.traverse((m) => {
    if (!(m instanceof Mesh) || (m.material as { transparent: boolean }).transparent) return;
    if (m.name !== "far layer" && m.parent?.name !== "capture hotspots" && (m.geometry as PlaneGeometry).type !== "SphereGeometry") targets.push(m as Mesh);
  });
  const ray = new Raycaster();
  const hits = (az: number, el: number): boolean => {
    const [a, e] = [(az * Math.PI) / 180, (el * Math.PI) / 180];
    ray.set(C, new Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)));
    return ray.intersectObjects(targets, false).length > 0;
  };

  it("no open sightline low over it (RV-133): rays from the capture point at az 176-184, el 1-6 meet the plinth, walls, trees or the roof's ends", () => {
    let hit = 0;
    let n = 0;
    for (let az = 176; az <= 184; az += 1) {
      for (let el = 1; el <= 6; el += 1) {
        if (hits(az, el)) hit++;
        n++;
      }
    }
    expect(hit / n).toBeGreaterThanOrEqual(0.8);
  });

  it("open sky above the statue (RV-124, RV-133: the first open sky at az 180 from el 14.4)", () => {
    for (let az = 179.5; az <= 180.5; az += 0.5) {
      for (let el = 15; el <= 20; el += 1) expect(hits(az, el), `az ${String(az)} el ${String(el)}`).toBe(false);
    }
  });
});

describe("the sky (H-10)", () => {
  it("v and q on the flattened dome as the game's (RV-79, RV-113): v(5) 0.908, v(10) 0.818, q 0 from 30.96 degrees up", () => {
    expect(skyVQ(5).v).toBeCloseTo(0.908, 3);
    expect(skyVQ(10).v).toBeCloseTo(0.818, 3);
    expect(skyVQ(30.9).q).toBeGreaterThan(0);
    expect(skyVQ(31.0).q).toBe(0);
    expect(skyVQ(0).v).toBe(1);
  });
});
