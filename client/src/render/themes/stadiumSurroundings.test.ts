import { Color, Matrix4, Mesh, type PlaneGeometry, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { GRASS_CUBE_AT } from "../grassCube";
import { TEAM_PRIMARY_LINEAR, fullBright, linear } from "../teamColors";
import { skyVQ, stadiumTheme } from "./stadium";
import { CROWD, SECONDARY, buildCrowd, crowdSeen } from "./stadiumCrowd";
import { AD_EMBLEM, PANELS, PANEL_LIGHT, bannerColour, buildScreensAndProps, panelColour, screenLogo } from "./stadiumProps";
import { buildBowl, buildCaptureHotspots, floodlightE } from "./stadiumSurroundings";

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

  it("seated where the game's are (RV-123): each section's cards (a team's) within 10 % of crowd_tiers'", () => {
    const tiers = mesh.userData["tiers"] as string[];
    const counts = { lowerPlusX: 0, lowerEnd: 0, lowerBack: 0, upperMid: 0, top: 0 };
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      at.setFromMatrixPosition(matrix);
      if (at.z <= 0) continue; // (team 1's half: y > 0)
      const az = deg(Math.atan2(at.z, at.x));
      const tier = tiers[i] ?? "";
      if (tier === "top") counts.top++;
      else if (tier === "mid" || tier === "midBack") counts.upperMid++;
      else if (az < 72) counts.lowerPlusX++;
      else if (az < 117.25) counts.lowerEnd++;
      else counts.lowerBack++;
    }
    // (Crowd_03, Crowd_02, Crowd_01, Crowd_04's mid and upper)
    const want = { lowerPlusX: 2750, lowerEnd: 3283, lowerBack: 3989, upperMid: 2589, top: 1382 };
    for (const [k, n] of Object.entries(want)) expect(Math.abs(counts[k as keyof typeof counts] / n - 1), `${k}: ${String(counts[k as keyof typeof counts])} vs ${String(n)}`).toBeLessThan(0.1);
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
  it("as bright as the game's (RV-125): mean E within 20 % of (0.61, 0.58, 0.39), E > 1 on 0.11 +- 0.03 of the face", () => {
    const n = [0, 0, 0];
    let over = 0;
    let count = 0;
    for (let i = 0; i < 400; i++) {
      for (let j = 0; j < 2000; j++) {
        const e = floodlightE(((i + 0.5) / 400) * (4 / 160), (j + 0.5) / 2000);
        for (let k = 0; k < 3; k++) n[k] = (n[k] ?? 0) + (e[k] ?? 0);
        if (e[0] > 1) over++;
        count++;
      }
    }
    [0.61, 0.58, 0.39].forEach((target, k) => {
      expect(Math.abs((n[k] ?? 0) / count / target - 1)).toBeLessThan(0.2);
    });
    expect(Math.abs(over / count - 0.11)).toBeLessThan(0.03);
  });
});

describe("the -X plaza (SUR-1, 4, 25)", () => {
  it("open over it: rays from the capture point at az 175-185, el 8-15 degrees hit nothing round the arena (RV-124)", () => {
    const theme = stadiumTheme();
    theme.root.updateMatrixWorld(true);
    // (everything but the sky's dome, the far layer and the capture's own hotspots)
    const targets: Mesh[] = [];
    theme.root.traverse((m) => {
      if (m instanceof Mesh && m.name !== "far layer" && m.parent?.name !== "capture hotspots" && (m.geometry as PlaneGeometry).type !== "SphereGeometry") targets.push(m as Mesh);
    });
    const ray = new Raycaster();
    for (let az = 175; az <= 185; az += 2.5) {
      for (let el = 8; el <= 15; el += 1) {
        const [a, e] = [(az * Math.PI) / 180, (el * Math.PI) / 180];
        ray.set(C, new Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)));
        const hits = ray.intersectObjects(targets, false);
        expect(hits.map((h) => h.object.name), `az ${String(az)} el ${String(el)}`).toEqual([]);
      }
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
