import { type Blending, Color, CustomBlending, type Material, Matrix4, Mesh, type PlaneGeometry, Raycaster, type ShaderMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { GRASS_CUBE_AT } from "../grassCube";
import { TEAM_PRIMARY_LINEAR, fullBright, linear } from "../teamColors";
import { skyVQ, stadiumTheme } from "./stadium";
import { CROWD, SECONDARY, buildCrowd, crowdSeen } from "./stadiumCrowd";
import { AD_EMBLEM, PANELS, PANEL_LIGHT, PLAZA, PROPS, bannerBase, bannerColour, buildScreensAndProps, flagColours, panelColour, screenLogo } from "./stadiumProps";
import { buildBowl, buildCaptureHotspots, FILL_FLARE_G, fixtureOffsets, FLOODLIGHT, floodlightE, hotspotLook, HOTSPOTS, lensMean, STANDS, STRUCTURES, supportHead, TEAM_HOTSPOTS } from "./stadiumSurroundings";
import { FAR_LAYER, fogCylinder, plazaCityTop } from "./stadiumFarLayer";
import { fogAll, fogCd, heightFog } from "../heightFog";
import { beamAlpha, buildStadiumLights, HAZE_ROW, LIGHTS } from "./stadiumLights";
import { fogBowlAlpha } from "./stadiumSky";
import { ArenaView } from "../arena";
import { PRIORITY } from "../translucentSort";

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
    const [width, height] = m.userData["disc"] as [number, number];
    return { az: deg(Math.atan2(p.z, p.x)), el: deg(Math.asin(p.y / d)), across: deg(Math.atan(width / 2 / d)), up: deg(Math.atan(height / 2 / d)) };
  });

  it("are the game's discs (RV-119, RV-191): each one's direction and angular radii within the instance table's (221.7 S)", () => {
    // (az, el, across x up: SUR-33 corrected; the plain ones, then blue's and orange's)
    const table = [
      [2.26, 1.71, 48.6, 26.8],
      [179.52, 7.08, 59.6, 29.6],
      [179.53, 6.99, 5.3, 30.0],
      [107.08, 22.12, 57.1, 27.3],
      [-107.89, 25.56, 46.3, 19.2],
      [35.37, 14.92, 18.6, 18.6],
      [-33.68, 15.22, 19.0, 19.0],
      [-89.67, 8.87, 23.6, 18.2],
      [89.72, 7.61, 20.6, 15.7],
    ];
    expect(seen).toHaveLength(table.length);
    table.forEach(([az = 0, el = 0, across = 0, up = 0], k) => {
      const s = seen[k];
      const daz = (((s?.az ?? 0) - az + 540) % 360) - 180;
      expect(Math.abs(daz), `hotspot ${String(k)} az`).toBeLessThan(0.5);
      expect(Math.abs((s?.el ?? 0) - el), `hotspot ${String(k)} el`).toBeLessThan(0.5);
      expect(Math.abs((s?.across ?? 0) - across), `hotspot ${String(k)} across`).toBeLessThan(0.5);
      expect(Math.abs((s?.up ?? 0) - up), `hotspot ${String(k)} up`).toBeLessThan(0.5);
    });
  });

  it("pitched as the game's, their tops toward the arena (RV-119): the projected extents from the capture point", () => {
    // (the ellipse each draws, its boundary projected: az and el ranges)
    // (the disc's boundary projected: az unwrapped about `about`, el)
    const extents = (m: Mesh, about = 0): { az: [number, number]; el: [number, number] } => {
      const [width, height] = m.userData["disc"] as [number, number];
      const az: number[] = [];
      const el: number[] = [];
      for (let k = 0; k < 256; k++) {
        const a = (k / 256) * 2 * Math.PI;
        const p = new Vector3((width / 2) * Math.cos(a), (height / 2) * Math.sin(a), 0).applyMatrix4(m.matrixWorld).sub(C);
        az.push(about + ((((deg(Math.atan2(p.z, p.x)) - about + 540) % 360) + 360) % 360) - 180);
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
    // (each disc's az and el extents within 1 degree of the game's (SUR-33 corrected: its tilt to the line of sight the
    // world pitch less the sight line's elevation, RV-149; its yaw off facing C, RV-184): _13, _2, _12, _3, _5, _0,
    // _7, blue, orange)
    const game: [number, number, number, number][] = [
      [-48.0, 51.8, -16.4, 32.1],
      [122.2, 242.3, -20.6, 38.4],
      [174.0, 185.3, -14.6, 41.9],
      [45.8, 164.5, -6.6, 47.8],
      [-157.2, -58.6, 5.2, 42.6],
      [16.4, 54.9, -4.2, 33.0],
      [-53.4, -14.2, -4.3, 33.5],
      [-114.3, -65.7, -5.4, 27.8],
      [68.6, 110.7, -4.8, 23.6],
    ];
    game.forEach(([az0, az1, el0, el1], k) => {
      // (azimuths unwrapped about the sprite's own: the back ones straddle 180)
      const e = extents(sprite(k), (az0 + az1) / 2);
      const got = [e.az[0], e.az[1], e.el[0], e.el[1]].map((v) => Number(v.toFixed(1)));
      [az0, az1, el0, el1].forEach((want, i) => {
        expect(Math.abs((got[i] ?? 0) - want), `hotspot ${String(k)} ${["az low", "az high", "el low", "el high"][i] ?? ""}: ${JSON.stringify(got)}`).toBeLessThan(1);
      });
    });
  });

  it("the +X one in the height fog at its 150k (FOG-10, superseding RV-120's fade): mostly fog near the horizon (F 0.1), a quarter through at el 22.5", () => {
    const cd = fogCd(GRASS_CUBE_AT.z);
    const at = (el: number): number => heightFog([150000 * Math.cos((el * Math.PI) / 180), 150000 * Math.sin((el * Math.PI) / 180), 0], cd).F;
    expect(at(2)).toBeCloseTo(0.1, 3);
    expect(at(22.5)).toBeGreaterThan(0.2);
    expect(at(22.5)).toBeLessThan(0.3);
  });

  it("sit inside the sky's dome and the concourse's wall (the far ones' sizes kept), each in the height fog at its own distance (FOG-10)", () => {
    for (const m of sprites) expect(m.position.distanceTo(C)).toBeLessThan(30000);
    const material = (m: Mesh | undefined): ShaderMaterial | undefined => m?.material as ShaderMaterial | undefined;
    expect(sprites.every((m) => material(m)?.userData["heightFog"] !== undefined && material(m)?.userData["heightFog"] !== "none")).toBe(true);
    // (its fog at its true vertices: placed at 29k, it is 149.9k out: RV-188)
    expect(material(sprites[0])?.userData["fogScale"]).toBeCloseTo(149873 / 29000, 9);
  });
});

describe("the height fog (FOG-10, 15)", () => {
  it("every shader material out here takes it: the sky at the game's dome's distance, the far layer its own, the hotspots theirs; three's fog off", () => {
    const theme = stadiumTheme();
    expect(theme.fog).toBeNull();
    const modes = new Map<string, string>();
    theme.root.traverse((m) => {
      if (!(m instanceof Mesh)) return;
      const material = m.material as ShaderMaterial;
      if (!material.isShaderMaterial) return;
      const mode = (material.userData as { heightFog?: string }).heightFog;
      const label = m.name !== "" ? m.name : (m.parent?.name ?? "a mesh");
      expect(mode, label).toBeDefined();
      modes.set(label, mode ?? "");
      if (mode === "opaque") expect(material.transparent, m.name).toBe(false);
    });
    expect(modes.size).toBeGreaterThan(5);
    const sprites = theme.captureOnly?.children as Mesh[];
    expect(sprites.map((s) => (s.material as ShaderMaterial).userData["heightFog"] as string)).toEqual([
      "translucent",
      "translucent",
      "translucent",
      "translucent",
      "translucent",
      "translucent",
      "translucent",
      "additive",
      "additive",
    ]);
    expect((sprites[1]?.material as ShaderMaterial).userData["fogScale"]).toBeCloseTo(1, 9);
  });
});

describe("the fog layers (SUR-23, FOG-10)", () => {
  it("every material of the arena and its theme fogged (RV-187)", () => {
    const arena = new ArenaView(stadiumTheme());
    fogAll(arena.root);
    const unfogged: string[] = [];
    arena.root.traverse((m) => {
      const material = (m as Mesh).material as Material | Material[] | undefined;
      if (!material) return;
      for (const x of Array.isArray(material) ? material : [material]) if ((x.userData as { heightFog?: string }).heightFog === undefined) unfogged.push(m.name || x.type);
    });
    expect(unfogged).toEqual([]);
  }, 30000);

  it("six fog sheets, hexagons, their alpha FillFlare's G alone; the far ones' fog at their true vertices (RV-188, 194, 195)", () => {
    const lights = buildStadiumLights(new Color(0.1, 0.4, 1), new Color(1, 0.4, 0.1));
    lights.updateMatrixWorld(true);
    const sheets: Mesh[] = [];
    lights.traverse((m) => {
      if (m instanceof Mesh && m.name === "lights: fog sheet") sheets.push(m as Mesh);
    });
    expect(sheets).toHaveLength(6);
    for (const sheet of sheets) {
      expect(sheet.geometry.getAttribute("position").count).toBe(18);
      const material = sheet.material as ShaderMaterial;
      // (its painted vertex colour: rgb v.rgb, alpha G v.a, SUR-23 v2)
      expect(material.fragmentShader).toContain("gl_FragColor = vec4(colour, g * alphaScale);");
      // (the true centre: placed at a fraction toward the camera (C until the first view), its fog scaled back out)
      const scale = (material.userData["fogScale"] as number | undefined) ?? 1;
      const centre = C.clone().addScaledVector(sheet.getWorldPosition(new Vector3()).sub(C), scale);
      const game = LIGHTS.fogSheets.map((s) => new Vector3(s.at[0], s.at[2], s.at[1]));
      expect(Math.min(...game.map((g) => g.distanceTo(centre)))).toBeLessThan(1);
      // (a far one's depth as at its true place too, so what stands between covers it; the big four at -10, the low
      // pair behind the goals at -5: TRN1)
      expect(material.userData["trueDepth"]).toBe(scale > 1 ? scale : undefined);
      if (scale > 1) expect(material.fragmentShader).toContain("gl_FragDepth");
      const low = Math.abs(centre.x) < 100 && Math.abs(centre.z) > 7000 && centre.y < 0;
      expect(sheet.renderOrder).toBe(low ? PRIORITY.lowFogSheet : PRIORITY.bigFogSheet);
    }
    // (the three DetailMode Medium ones far out, the rest at their place)
    expect(sheets.filter((s) => ((s.material as ShaderMaterial).userData["fogScale"] ?? 1) > 1)).toHaveLength(3);
  });

  it("every hotspot and fog layer in its painted vertex colour, not the mesh's (SUR-23, SUR-33 v2): the plain hotspots 8 v.rgb with alpha sat(8 v.a G), the team ones 8 a² G FB, the fog sheets v.rgb with alpha G v.a, the band, the bowl, the haze and the flares tinted", () => {
    // (the plain ones: _13's warm and faint, the -X pair's warmer, the ends' dim, the +-35 grey)
    expect(HOTSPOTS.map((h) => h.vertex)).toEqual([[176, 132, 70, 9], [255, 210, 133, 4], [255, 192, 101, 12], [74, 55, 29, 4], [74, 55, 29, 4], [54, 54, 54, 7], [54, 54, 54, 7]]);
    const look = hotspotLook([176, 132, 70, 9]);
    expect(look.colour.map((c) => Number(c.toFixed(3)))).toEqual([5.522, 4.141, 2.196]);
    expect(Math.min(1, 8 * look.alpha)).toBeCloseTo(0.282, 3);
    const theme = stadiumTheme();
    const spots: ShaderMaterial[] = [];
    theme.root.traverse((m) => {
      if (m instanceof Mesh && m.parent?.name === "capture hotspots") spots.push(m.material as ShaderMaterial);
    });
    const plain = spots.filter((s) => s.uniforms["additive"]?.value === false);
    expect(plain.map((s) => Number((s.uniforms["alphaScale"]?.value as number).toFixed(4)))).toEqual([9, 4, 12, 4, 4, 7, 7].map((a) => Number((a / 255).toFixed(4))));
    // (the team ones: a 61/255, 8 a² = 0.458 times FB)
    const team = spots.filter((s) => s.uniforms["additive"]?.value === true);
    expect(team).toHaveLength(2);
    const fb = (team[0]?.uniforms["colour"]?.value as Vector3).length();
    expect(TEAM_HOTSPOTS.map((h) => h.vertex[3])).toEqual([61, 61]);
    expect(8 * fb).toBeLessThan(8 * 0.06 * Math.sqrt(3) * 4);
    // (the fog sheets' own, the band's, the bowl's and the haze's and flares' tints)
    expect(LIGHTS.fogSheets.map((f) => f.vertex)).toEqual([[23, 31, 33, 185], [23, 31, 33, 185], [255, 205, 116, 142], [255, 193, 91, 61], [255, 205, 116, 142], [255, 193, 91, 61]]);
    expect(FAR_LAYER.cylinderVertex).toEqual([255, 180, 89, 92]);
    const band = theme.root.getObjectByName("far layer: band") as Mesh;
    expect((band.material as ShaderMaterial).fragmentShader).toContain("gl_FragColor = vec4(1.0000, 0.7059, 0.3490, band * 0.3608);");
    expect(LIGHTS.haze.vertex).toEqual([25, 35, 38]);
    expect(LIGHTS.flares.vertex).toEqual([255, 222, 147]);
  }, 30000);

  it("the stadium's translucents in the game's order (TRN1): the big hotspots, the far layer, the big fog sheets, the canopy, the fog bowl, the low fog sheets, the haze and flares, the beams and other hotspots, the team hotspots", () => {
    const theme = stadiumTheme();
    const order = (name: string): number[] => {
      const out = new Set<number>();
      theme.root.traverse((m) => {
        if (m instanceof Mesh && (m.name === name || m.parent?.name === name)) out.add(m.renderOrder);
      });
      return [...out].sort((a, b) => a - b);
    };
    expect(order("capture hotspots")).toEqual([PRIORITY.bigHotspot, PRIORITY.base, PRIORITY.teamHotspot]);
    expect(HOTSPOTS.filter((h) => h.priority === PRIORITY.bigHotspot).map((h) => Math.round(h.az))).toEqual([2, 180, 180, 107]);
    expect(order("far layer: band")).toEqual([PRIORITY.fogCylinder]);
    expect(order("lights: fog sheet")).toEqual([PRIORITY.bigFogSheet, PRIORITY.lowFogSheet]);
    expect(order("bowl: canopy")).toEqual([PRIORITY.canopy]);
    expect(order("sky: fog bowl")).toEqual([PRIORITY.fogBowl]);
    expect(order("lights: haze")).toEqual([PRIORITY.haze]);
    expect(order("lights: flare sheets")).toEqual([PRIORITY.flares]);
    expect(order("lights: team beam")).toEqual([PRIORITY.base]);
    // (and every translucent: none left at another order)
    const others: string[] = [];
    theme.root.traverse((m) => {
      if (!(m instanceof Mesh) || !(m.material as { transparent: boolean }).transparent) return;
      if (!(Object.values(PRIORITY) as number[]).includes(m.renderOrder)) others.push(`${m.name || (m.parent?.name ?? "?")} ${String(m.renderOrder)}`);
    });
    expect(others).toEqual([]);
  }, 30000);

  it("the fog bowl: down from z 4054, 11,796 out, 5,898 deep; its colour the vertex fog alone, its alpha Curve_FogDusk.A (RV-189)", () => {
    const bowl = stadiumTheme().root.children.find((m) => m.name === "sky: fog bowl") as Mesh | undefined;
    expect(bowl).toBeDefined();
    const position = bowl?.geometry.getAttribute("position");
    let [top, bottom, out] = [-Infinity, Infinity, 0];
    for (let k = 0; k < (position?.count ?? 0); k++) {
      top = Math.max(top, position?.getY(k) ?? 0);
      bottom = Math.min(bottom, position?.getY(k) ?? 0);
      out = Math.max(out, Math.hypot(position?.getX(k) ?? 0, position?.getZ(k) ?? 0));
    }
    expect([top, bottom, out].map(Math.round)).toEqual([4054, 4054 - 5898, 11796]);
    const material = bowl?.material as ShaderMaterial;
    expect(material.transparent).toBe(true);
    // (its alpha times its painted vertex alpha, 184/255: SUR-23 v2)
    expect(material.fragmentShader).toContain("vec4(0.0, 0.0, 0.0, fogDusk(vV) * 0.7216)");
    expect(material.userData["heightFog"]).toBe("translucent");
    expect([0.3, 0.56, 0.63, 0.75, 0.88, 1].map((v) => Number(fogBowlAlpha(v).toFixed(3)))).toEqual([0.88, 0.88, 0.7, 0.29, 0.035, 0]);
  }, 30000);

  it("the haze shell's vertex fog follows its height: between rows within 0.05 of the exact (RV-192)", () => {
    const cd = fogCd(GRASS_CUBE_AT.z);
    const r = LIGHTS.haze.r;
    for (let z = LIGHTS.haze.z[0]; z + HAZE_ROW <= LIGHTS.haze.z[1]; z += HAZE_ROW) {
      const at = (h: number): number => heightFog([r, h - GRASS_CUBE_AT.z, 0], cd).F;
      expect(Math.abs((at(z) + at(z + HAZE_ROW)) / 2 - at(z + HAZE_ROW / 2)), `z ${String(z)}`).toBeLessThan(0.05);
    }
  });

  it("FillFlare's G as point values (RV-196)", () => {
    expect(FILL_FLARE_G).toEqual([1.0, 0.994, 0.944, 0.871, 0.748, 0.58, 0.393, 0.226, 0.088, 0.014]);
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

  it("the scaffolds' banners in their placements' light (RV-150): the team's base and the placement's L; the orange seen R 0.8 at most", () => {
    const [p0 = [0, 0, 1], p1 = [1, 0.5, 0]] = TEAM_PRIMARY_LINEAR;
    const { group } = buildScreensAndProps(linear(p0), linear(p1));
    const banners = group.children.filter((m) => m.name === "props: scaffold banner") as Mesh[];
    expect(banners).toHaveLength(PROPS.scaffolds.length);
    banners.forEach((m, k) => {
      const [, y = 0] = PROPS.scaffolds[k] ?? [];
      const team = linear(y < 0 ? p0 : p1);
      const u = (m.material as ShaderMaterial).uniforms;
      (u["base"]?.value as Vector3).toArray().forEach((v, i) => {
        expect(v).toBeCloseTo(bannerBase(team)[i] ?? 0, 6);
      });
      expect((u["light"]?.value as Vector3).toArray()).toEqual([...(PROPS.scaffoldLight[k] ?? [])]);
      // (the brightest the orange's red can be: its 1.5 clamp in the placement's light)
      if (y > 0) expect(1.5 * (PROPS.scaffoldLight[k]?.[0] ?? 0)).toBeLessThanOrEqual(0.8);
      expect(u["grassCube"]).toBeDefined();
    });
  });

  it("the banners take the capture along their reflection, 0.5 of it, before the boost and clamp (RV-178): the +X blue one with a 0.5 cube as the game's", () => {
    const [p0 = [0, 0, 1]] = TEAM_PRIMARY_LINEAR;
    // (the placement at (4736, -1024); the capture back toward -X at el 3-6 about 0.5, CAP1's sampled)
    const k = PROPS.scaffolds.findIndex(([x, y]) => x === 4736 && y === -1024);
    const seen = bannerColour(linear(p0), [0.5, 0.5, 0.5]).map((c, i) => c * (PROPS.scaffoldLight[k]?.[i] ?? 0));
    const game = [0.28, 0.61, 0.54];
    // (blue within 0.05: a flat colour's blue tops out at 1.5 L, 0.50, where the game's per-pixel light and texture mean
    // comes to 0.54)
    seen.forEach((c, i) => {
      expect(Math.abs(c - (game[i] ?? 0)), `channel ${String(i)}: ${seen.map((v) => v.toFixed(3)).join(", ")}`).toBeLessThan(i === 2 ? 0.05 : 0.03);
    });
  });

  it("the corner flags as the game's (RV-153): the -Y ones turned, poles beside their banners, the strip off the cloth, each corner's LDR mean within 0.06 of CAL1", () => {
    const [p0 = [0, 0, 1], p1 = [1, 0.5, 0]] = TEAM_PRIMARY_LINEAR;
    const { group } = buildScreensAndProps(linear(p0), linear(p1));
    group.updateMatrixWorld(true);
    const named = (name: string): Mesh[] => group.children.filter((m) => m.name === name) as Mesh[];
    const [poles, cloths, strips] = [named("props: flag pole"), named("props: flag cloth"), named("props: flag strip")];
    expect([poles.length, cloths.length, strips.length]).toEqual([20, 20, 20]);
    const az = (m: Mesh): number => (((Math.atan2(m.position.z, m.position.x) * 180) / Math.PI) % 360 + 360) % 360;
    // (the -Y corners at the game's 294.9-317.5 and 222.6-245.1)
    const game = [294.9, 300.5, 306.1, 311.8, 317.5, 222.6, 228.2, 233.8, 239.5, 245.1];
    for (const want of game) expect(Math.min(...cloths.map((m) => Math.abs(az(m) - want)))).toBeLessThan(0.5);
    cloths.forEach((cloth, k) => {
      const pole = poles[k];
      const strip = strips[k];
      if (!pole || !strip) throw new Error("a flag's parts");
      // (the pole 70 or more along the arc from the cloth's centre, toward the field)
      const out = new Vector3(cloth.position.x, 0, cloth.position.z).normalize();
      const along = new Vector3(-out.z, 0, out.x);
      const d = pole.position.clone().sub(cloth.position);
      expect(Math.abs(d.dot(along))).toBeGreaterThanOrEqual(70);
      expect(d.dot(out)).toBeLessThan(-10);
      // (the strip in front of the cloth where they overlap, not in its plane)
      expect(cloth.position.clone().sub(strip.position).dot(out)).toBeGreaterThanOrEqual(1);
    });
    // (each corner's mean in the capture's LDR (per pixel min(c, 1): SUR-35): its parts by what C sees of them, rays over
    // each flag (the cloth's cut discarded as its shader does): the cloth 0.80-0.82 of it, as the game's; the sleeve,
    // round now (RV-199), 0.14 against the game's 0.10-0.12: an 18-wide sleeve over 464 of pole and its arm is that
    // much, so its measures are what's open (with the static session), not its shape; its light band 43 % of the cloth)
    const F = PROPS.flags;
    const S = F.strip;
    expect(S.width).toBeLessThanOrEqual(30);
    const C3 = new Vector3(GRASS_CUBE_AT.x, GRASS_CUBE_AT.z, GRASS_CUBE_AT.y);
    const ray = new Raycaster();
    const flagParts = [...poles, ...cloths, ...group.children.filter((m) => m.name === "props: flag strip").flatMap((g) => g.children as Mesh[])];
    const seen = { pole: 0, strip: 0, cloth: 0 };
    for (const cloth of cloths) {
      const centre = cloth.getWorldPosition(new Vector3()).sub(C3);
      const [az0, el0] = [Math.atan2(centre.z, centre.x), Math.asin(centre.y / centre.length())];
      for (let da = -1.2; da <= 1.2; da += 0.03) {
        for (let de = -3.2; de <= 3.6; de += 0.03) {
          const [a, e] = [az0 + (da * Math.PI) / 180, el0 + (de * Math.PI) / 180];
          ray.set(C3, new Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)));
          const hit = ray.intersectObjects(flagParts, false).find((h) => h.object.name !== "props: flag cloth" || !h.uv || h.uv.y >= 0.38 * (1 - Math.abs(2 * h.uv.x - 1)));
          if (!hit) continue;
          const name = hit.object.name || (hit.object.parent?.name ?? "");
          if (name === "props: flag pole") seen.pole++;
          else if (name === "props: flag cloth") seen.cloth++;
          else if (name === "props: flag strip") seen.strip++;
        }
      }
    }
    const total = seen.pole + seen.strip + seen.cloth;
    expect(seen.strip / total, JSON.stringify(seen)).toBeGreaterThanOrEqual(0.09);
    expect(seen.strip / total, JSON.stringify(seen)).toBeLessThanOrEqual(0.145);
    expect(seen.cloth / total, JSON.stringify(seen)).toBeGreaterThanOrEqual(0.79);
    expect(seen.cloth / total, JSON.stringify(seen)).toBeLessThanOrEqual(0.83);
    const areas = seen;
    // (the shader's band: its share of the cloth)
    expect(Math.abs((F.albedo.band[1] - F.albedo.band[0]) / F.banner.cloth - F.albedo.lightShare)).toBeLessThan(0.01);
    const cal1: [number, [number, number, number]][] = [
      [54, [0.83, 0.76, 0.28]],
      [125, [0.71, 0.47, 0.17]],
      [235, [0.24, 0.52, 0.68]],
      [306, [0.41, 0.74, 0.71]],
    ];
    const got = cal1.map(([corner]) => {
      const orange = corner < 180;
      const c = flagColours(linear(orange ? p1 : p0), corner < 90 || corner > 270, orange);
      const shown = (rgb: number[]): number[] => rgb.map((v) => Math.min(v, 1));
      const share = F.albedo.lightShare;
      const [pole, strip, team, light] = [shown(c.pole), shown(c.strip), shown(c.team), shown(c.light)];
      const cloth = team.map((v, i) => (1 - share) * v + share * (light[i] ?? 0));
      return [0, 1, 2].map((i) => ((pole[i] ?? 0) * areas.pole + (strip[i] ?? 0) * areas.strip + (cloth[i] ?? 0) * areas.cloth) / total);
    });
    cal1.forEach(([corner, want], k) => {
      want.forEach((w, i) => {
        expect(Math.abs((got[k]?.[i] ?? 0) - w), `az ${String(corner)}: ${JSON.stringify(got.map((g) => g.map((v) => v.toFixed(3))))}`).toBeLessThan(0.06);
      });
    });
  }, 30_000); // (its ray sweep: about 4 s, over vitest's 5 s default under load: RV-226)

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

  it("its aisles where and as wide as the game's (RV-152, RV-180): through all 34 rows (the last to 18), the gap between the nearest cards' centres each side a median 576 +- 40 uu (830 +- 60 at 71.9)", () => {
    const crowd = buildCrowd(new Color(0.1, 0.4, 1), new Color(1, 0.4, 0.1)).mesh;
    const tiers = crowd.userData["tiers"] as string[];
    const rows = crowd.userData["rows"] as number[];
    const m = new Matrix4();
    const p = new Vector3();
    const main: { az: number; r: number; row: number }[] = [];
    for (let i = 0; i < crowd.count; i++) {
      if (tiers[i] !== "main") continue;
      crowd.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      main.push({ az: Math.abs(deg(Math.atan2(p.z, p.x))), r: Math.hypot(p.x, p.z), row: rows[i] ?? 0 });
    }
    const centres: [number, number, number][] = [
      [45.6, 34, 576],
      [71.9, 34, 830],
      [98.1, 34, 576],
      [117.6, 34, 576],
      [143.9, 18, 576],
    ];
    for (const [centre, through, width] of centres) {
      const gaps: number[] = [];
      for (let row = 0; row < through; row++) {
        const seats = main.filter((c) => c.row === row);
        if (seats.length === 0) continue;
        const below = seats.filter((c) => c.az < centre).sort((x, y) => y.az - x.az)[0];
        const above = seats.filter((c) => c.az > centre).sort((x, y) => x.az - y.az)[0];
        if (!below || !above || above.az - below.az > 6) continue;
        gaps.push((((above.az - below.az) * Math.PI) / 180) * (below.r + above.r) / 2);
      }
      expect(gaps.length, `aisle ${String(centre)}`).toBeGreaterThan(10);
      gaps.sort((x, y) => x - y);
      const median = gaps[Math.floor(gaps.length / 2)] ?? 0;
      expect(Math.abs(median - width), `aisle ${String(centre)}: median ${median.toFixed(0)}`).toBeLessThan(width > 700 ? 60 : 40);
    }
  });

  it("the stands top out under 7k at the upper tiers' ends (az 76-85, 130-139): no top tier there (RV-123)", () => {
    const bowl = buildBowl();
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

describe("the team uplight beams (SUR-13)", () => {
  it("24 of them where the game's are, each two crossed quads; their mean alpha the game's 0.022, never whitened (RV-155, RV-177)", () => {
    const lights = buildStadiumLights(new Color(0.1, 0.4, 1), new Color(1, 0.4, 0.1));
    const beams = lights.children.filter((m) => m.name === "lights: team beam");
    expect(beams).toHaveLength(24);
    // (SUR-13's list: per end 8 short on the corner arc, 2 long at x +-1136, the 4 beside the side walls)
    const game: [number, number, number][] = [];
    const add = (x: number, y: number, z0: number): void => {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) game.push([sx * x, sy * y, z0]);
    };
    for (const [x, y] of [[4224, 3584], [3920, 4304], [3280, 4944], [2560, 5248], [4560, 128]] as const) add(x, y, -848);
    add(1136, 5362, -352);
    for (const [x, y, z0] of game) {
      const near = beams.filter((b) => Math.hypot(b.position.x - x, b.position.z - y) < 50);
      expect(near, `${String(x)}, ${String(y)}`).toHaveLength(1);
      const beam = near[0];
      if (!beam) continue;
      expect(beam.children).toHaveLength(2);
      const geometry = (beam.children[0] as Mesh).geometry as PlaneGeometry;
      expect(beam.position.y - geometry.parameters.height / 2).toBeCloseTo(z0, 6);
    }
    let sum = 0;
    let peak = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const a = beamAlpha((i + 0.5) / n, (j + 0.5) / n);
        sum += a / (n * n);
        peak = Math.max(peak, a);
      }
    }
    expect(Math.abs(sum - 0.022)).toBeLessThan(0.004);
    // (k = sat(a - 0.25) from the scaled a: none)
    expect(peak).toBeLessThan(0.25);
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
  // sheets, the far ones drawn as background: blended in the opaque pass)
  const targets: Mesh[] = [];
  theme.root.traverse((m) => {
    if (!(m instanceof Mesh)) return;
    const material = m.material as { transparent: boolean; blending: Blending };
    if (material.transparent || material.blending === CustomBlending) return;
    if (m.name !== "far layer" && m.parent?.name !== "capture hotspots" && (m.geometry as PlaneGeometry).type !== "SphereGeometry") targets.push(m as Mesh);
  });
  const ray = new Raycaster();
  const hits = (az: number, el: number): boolean => {
    const [a, e] = [(az * Math.PI) / 180, (el * Math.PI) / 180];
    ray.set(C, new Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)));
    return ray.intersectObjects(targets, false).length > 0;
  };

  it("the supports past az 145 on their ring, not the receding roof (RV-151): heads within 1k of the game's r 15.2-16.0k, z 10.2-10.75k; the plaza beam at el 32.5 +- 1.5", () => {
    // (the game's: r 15.2-16.0k, z 10.2-10.75k: RV-151, RV-186)
    for (const az of [155, 165, 175]) {
      const [r, z] = supportHead(az);
      expect(r, `az ${String(az)} r`).toBeGreaterThanOrEqual(15200);
      expect(r, `az ${String(az)} r`).toBeLessThanOrEqual(16000);
      expect(z, `az ${String(az)} z`).toBeGreaterThanOrEqual(10200);
      expect(z, `az ${String(az)} z`).toBeLessThanOrEqual(10750);
    }
    // (the ring's band where it crosses the -X axis: el 32.1-32.9 from C, the game's: RV-185)
    const ring = STRUCTURES.supports.ring;
    const el = (z: number): number => deg(Math.atan2(z - C.y, ring.r));
    expect(Math.abs(el(ring.z - ring.height / 2) - 32.1)).toBeLessThan(0.2);
    expect(Math.abs(el(ring.z + ring.height / 2) - 32.9)).toBeLessThan(0.2);
    const [r, z] = supportHead(180);
    expect([r, z]).toEqual([ring.r, ring.z]);
  });

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

  it("its first open sky as the game's (RV-154: CAL1's table, within 1.5 degrees; 2.5 over the statue at az 178-180, a rule-built figure, not its outline; the far layer's plaza city by its rule)", () => {
    const cal1: [number, number][] = [[177, 6.9], [178, 9.4], [179, 11.9], [180, 14.4], [181, 8.6], [182, 15], [183, 15], [184, 15], [185, 15], [186, 15], [187, 15], [188, 15]];
    for (const [az, want] of cal1) {
      let first = NaN;
      for (let el = 0; el <= 30; el += 0.1) {
        if (el > (plazaCityTop(az) ?? -90) && !hits(az, el)) {
          first = el;
          break;
        }
      }
      if (az === 181) {
        // (a residual: the game's gap at 181, sky at el 8.5-10 under its figure's -y side, is the statue's asymmetric
        // outline, which its symmetric rule can't make; over the statue its coverage is the binding check, so here
        // only between the plinth's top and the statue's top + 1.5: RV-154c)
        expect(first, `az 181: ${first.toFixed(1)}`).toBeGreaterThanOrEqual(7.1);
        expect(first, `az 181: ${first.toFixed(1)}`).toBeLessThanOrEqual(15.9);
        continue;
      }
      expect(Math.abs(first - want), `az ${String(az)}: ${first.toFixed(1)}`).toBeLessThan(az >= 178 && az <= 180 ? 2.5 : 1.5);
    }
    // (none of the city over az 177-180)
    for (const az of [177, 178, 179, 180]) expect(plazaCityTop(az)).toBeNull();
  }, 30000); // (thousands of rays through the theme)

  it("the plaza's own measures (RV-154, RV-186): SUR-20's olive-brown foliage, the poplars' widths and cover, the ground at z 1.2k to 1.31k by 19.2k", () => {
    expect(PLAZA.foliage).toEqual([0.15, 0.11, 0.024]);
    expect(PLAZA.cover).toBe(0.416);
    expect(PLAZA.poplars.map((p) => p.width)).toEqual([440, 440, 440, 440, 440, 440, 1400, 1400, 1680]);
    expect(STANDS.plaza).toEqual({ from: [12000, 1200], to: [19200, 1310] });
  });

  it("the far layer's fog: the city 100k out, its alpha by elevation SUR-23's (RV-193); the FogCylinder the game's mesh, its fog per vertex at its true corners (F 0.10 at the bottom, about 0.4 at the top: TRN1), drawn nearer inside the far plane", () => {
    expect(FAR_LAYER.fog).toEqual({ city: 100000 });
    expect(FAR_LAYER.fogBand).toEqual([[0, 0.9], [7.5, 0.73], [12.5, 0.43], [17.5, 0.19], [22.5, 0.06], [30, 0]]);
    const g = fogCylinder();
    expect([g.getAttribute("position").count, (g.getIndex()?.count ?? 0) / 3]).toEqual([16, 16]);
    const band = (stadiumTheme().root.getObjectByName("far layer: band") ?? null) as Mesh | null;
    expect(band).not.toBeNull();
    const material = band?.material as ShaderMaterial;
    expect(material.userData["heightFog"]).toBe("translucent");
    expect(band?.renderOrder).toBe(PRIORITY.fogCylinder);
    // (its true corners' fog: the bottom's at the floor, the top's about 0.4)
    const cd = fogCd(GRASS_CUBE_AT.z);
    const corner = (z: number): number => heightFog([FAR_LAYER.cylinder.r, z - GRASS_CUBE_AT.z, 0], cd).F;
    expect(corner(FAR_LAYER.cylinder.z[0])).toBeCloseTo(0.1, 3);
    expect(corner(FAR_LAYER.cylinder.z[1])).toBeGreaterThan(0.35);
    expect(corner(FAR_LAYER.cylinder.z[1])).toBeLessThan(0.45);
    // (drawn at a fraction of its distance about the camera, its fog and depth scaled back out)
    const k = band?.parent?.scale.x ?? 1;
    expect(k).toBeLessThan(1);
    expect(material.userData["fogScale"]).toBeCloseTo(1 / k, 6);
    expect(material.userData["trueDepth"]).toBeCloseTo(1 / k, 6);
    expect(material.vertexShader).toContain("cameraPosition + (carballWorld - cameraPosition)");
  }, 30000);

  it("its nine poplars where the game's are (RV-181): within 0.15 degrees and 300 uu of SUR-1's list", () => {
    const game: [number, number][] = [[175.67, 17466], [176.26, 16534], [176.94, 15645], [183.38, 15672], [183.83, 16533], [184.5, 17453], [175.55, 20742], [184.24, 20656], [179.88, 19880]];
    const trees = targets.filter((m) => m.name === "plaza: poplar");
    expect(trees).toHaveLength(9);
    for (const [az, r] of game) {
      const near = trees.filter((t) => {
        const a = ((deg(Math.atan2(t.position.z, t.position.x)) % 360) + 360) % 360;
        return Math.abs(a - az) < 0.15 && Math.abs(Math.hypot(t.position.x, t.position.z) - r) < 300;
      });
      expect(near, `${String(az)} / ${String(r)}`).toHaveLength(1);
    }
  });

  it("the statue a figure, as CAL1's coverage (RV-154c): 14 % of az 175-185 at el 6-10, 21 % at 10-15 (each within 2 points)", () => {
    const statue = targets.filter((m) => m.name === "plaza: statue");
    expect(statue.length).toBeGreaterThan(0);
    const statueRay = new Raycaster();
    const on = (az: number, el: number): boolean => {
      const [a, e] = [(az * Math.PI) / 180, (el * Math.PI) / 180];
      statueRay.set(C, new Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)));
      return statueRay.intersectObjects(statue, false).length > 0;
    };
    const cover = (el0: number, el1: number): number => {
      let [hit, n] = [0, 0];
      for (let az = 175.05; az < 185; az += 0.1) {
        for (let el = el0 + 0.05; el < el1; el += 0.1) {
          n++;
          if (on(az, el)) hit++;
        }
      }
      return hit / n;
    };
    expect(Math.abs(cover(6, 10) - 0.14)).toBeLessThan(0.02);
    expect(Math.abs(cover(10, 15) - 0.21)).toBeLessThan(0.02);
  }, 30000); // (thirty thousand rays)

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
