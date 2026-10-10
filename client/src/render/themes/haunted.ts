// A haunted graveyard at night (original designs, spooky rather than gory): a big full moon low behind a haunted
// mansion on the hill; fenced graveyards of tombstones, crosses and obelisks, some leaning; a crypt; bare twisted trees;
// a path up to the mansion lit by lanterns and jack-o'-lanterns; will-o'-wisps over the graves, bats circling, fog banks
// rolling. Pale glowing field markings keep the play readable in the dark. Generated and seeded like the other themes.
import { AmbientLight, Color, DirectionalLight, Fog, Group, HemisphereLight, Vector3 } from "three";
import { type GroundPalette, type Land, buildGround, free, landscape } from "./nature";
import { seededRandom } from "./random";
import { Sky } from "./sky";
import {
  type Spot,
  buildBats,
  buildBuildings,
  buildDeadTrees,
  buildFences,
  buildFogBanks,
  buildGlows,
  buildGraves,
  buildLanternPosts,
  buildMoon,
  buildPumpkins,
  buildWisps,
  graveRows,
} from "./spooky";
import { PLAYING_VOLUME, type Theme } from "./theme";

const SEED = 20261012;

const GRAVEYARD_GROUND: GroundPalette = {
  grassDark: 0x232a1e,
  grassLight: 0x3a4330,
  field: 0x2e3526,
  dirt: 0x3d3329, // the path up to the mansion
  sand: 0x2f2a22,
  water: 0x1c2a26, // a black pond
};

const FLAT = { halfX: 5300, halfZ: 7300, radius: 1200 };
/** The path's centre line: from behind the orange goal up the hill to the mansion. */
const pathX = (z: number): number => 700 * Math.sin((z - FLAT.halfZ) / 2600);

function graveyardLand(seed: number): Land {
  return landscape(seed, {
    flat: FLAT,
    pond: { x: 10500, z: 6200, radius: 1500 },
    path: (x, z) => (z < FLAT.halfZ - 500 ? Infinity : Math.abs(x - pathX(z))),
    hills: { low: 100, high: 900, rise: 3500, horizon: 2000 },
  });
}

const outside = (x: number, z: number): number => Math.max(Math.abs(x) - PLAYING_VOLUME.halfX, Math.abs(z) - PLAYING_VOLUME.halfZ);

export function hauntedTheme(): Theme {
  const land = graveyardLand(SEED);
  const random = seededRandom(SEED + 1);
  const night = new Color(0x1a2030);
  const moonDirection = new Vector3(0.08, 0.3, 1).normalize(); // low over the mansion

  const root = new Group();
  const moonlight = new DirectionalLight(0xa8bcff, 1.3);
  moonlight.position.copy(moonDirection).multiplyScalar(10000);
  // (bright enough that the cars and ball read clearly on the field)
  root.add(new HemisphereLight(0x6a7aaa, 0x161a16, 1.7), new AmbientLight(0x4a5470, 0.6), moonlight);
  const sky = new Sky({
    zenith: new Color(0x070a18),
    horizon: new Color(0x2a3048),
    sunDirection: moonDirection,
    sunStrength: 0,
    radius: 30000,
    clouds: { color: new Color(0x1c2030), cover: 0.55 },
  });

  // Three fenced graveyards (sides, and behind the blue end), the graves facing the field
  const plots = [
    { rect: { x0: -12500, x1: -6600, z0: -6000, z1: 4000 }, facing: Math.PI / 2 },
    { rect: { x0: 6600, x1: 12000, z0: -8000, z1: 1500 }, facing: -Math.PI / 2 },
    { rect: { x0: -4500, x1: 4500, z0: -14000, z1: -8600 }, facing: 0 },
  ];
  const graves = plots.flatMap((p, i) => graveRows(p.rect, p.facing, land.height, SEED + 10 + i));
  const inPlot = (x: number, z: number, margin: number): boolean =>
    plots.some(({ rect: r }) => x > r.x0 - margin && x < r.x1 + margin && z > r.z0 - margin && z < r.z1 + margin);
  const spot = (x: number, z: number, facing = random() * Math.PI * 2): Spot => ({ x, y: land.height(x, z), z, facing, lean: 0 });

  // The mansion up the path, the crypt between the left graveyard and the far end
  const mansionZ = 15000;
  const mansion = spot(pathX(mansionZ) + 300, mansionZ, Math.PI);
  const crypt = spot(-9500, 6200, Math.PI / 2 + 0.4);
  const buildings = buildBuildings(mansion, crypt);

  // Lanterns along the path, both sides by turns; jack-o'-lanterns between them and among the graves
  const lanterns: Spot[] = [];
  const pumpkins: Spot[] = [];
  for (let z = FLAT.halfZ - 200, k = 0; z < mansionZ - 1600; z += 700, k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const x = pathX(z) + side * 420;
    if (k % 2 === 0) lanterns.push(spot(x, z, side > 0 ? -Math.PI / 2 : Math.PI / 2));
    else pumpkins.push(spot(x, z, Math.PI));
  }
  for (const g of graves) if (random() < 0.08) pumpkins.push(spot(g.x + Math.sin(g.facing) * 140, g.z + Math.cos(g.facing) * 140, g.facing));
  for (const dx of [-900, 900]) pumpkins.push(spot(mansion.x + dx, mansion.z - 2300, Math.PI));
  for (const p of plots) {
    // A pair by each graveyard's gate (the middle of its first side)
    const gx = (p.rect.x0 + p.rect.x1) / 2;
    for (const dx of [-260, 260]) pumpkins.push(spot(gx + dx, p.rect.z0 - 160, Math.PI));
  }

  // Bare trees round about, out of the graveyards and off the path
  const trees: Spot[] = [];
  for (let tries = 0; trees.length < 46 && tries < 5000; tries++) {
    const x = (random() * 2 - 1) * 17000;
    const z = (random() * 2 - 1) * 19000;
    // (their crooked branches reach a long way out: well clear of the arena)
    if (outside(x, z) < 2800 || inPlot(x, z, 300) || !free(land, x, z, 300)) continue;
    if (Math.hypot(x - mansion.x, z - mansion.z) < 3500 || Math.hypot(x - crypt.x, z - crypt.z) < 1500) continue;
    trees.push({ ...spot(x, z), lean: (random() - 0.5) * 0.15 });
  }

  const orange = new Color(0xff8a2a);
  const glows = buildGlows([
    ...pumpkins.map((p) => ({ x: p.x, y: p.y + 90, z: p.z, size: 560, color: orange, flicker: 0.5 })),
    ...lanterns.map((l) => ({
      x: l.x + Math.sin(l.facing) * 110,
      y: l.y + 440,
      z: l.z + Math.cos(l.facing) * 110,
      size: 700,
      color: new Color(0xffc070),
      flicker: 0.25,
    })),
    ...buildings.lit.map((w, i) => ({ ...w, size: 900, color: new Color(i % 3 === 2 ? 0x8fffb0 : 0xffc070), flicker: 0.12 })),
  ]);
  const wisps = buildWisps(
    Array.from({ length: 36 }, (): [number, number, number] => {
      const { rect: r } = plots[Math.floor(random() * plots.length)] ?? { rect: { x0: 7000, x1: 9000, z0: 0, z1: 1000 } };
      const x = r.x0 + random() * (r.x1 - r.x0);
      const z = r.z0 + random() * (r.z1 - r.z0);
      return [x, land.height(x, z) + 160 + random() * 340, z];
    }),
  );
  const fog = buildFogBanks(
    Array.from({ length: 40 }, (): [number, number, number] => {
      for (;;) {
        const x = (random() * 2 - 1) * 14000;
        const z = (random() * 2 - 1) * 16000;
        if (outside(x, z) > 1800) return [x, land.height(x, z) + 300, z];
      }
    }),
  );
  const bats = buildBats(
    Array.from({ length: 30 }, (_, i): [number, number, number] => {
      // Most round the mansion's tower, the rest over the graveyards
      if (i < 14) return [mansion.x + 1700 * Math.cos(Math.PI), mansion.y + 4500 + random() * 1500, mansion.z];
      const { rect: r } = plots[i % plots.length] ?? { rect: { x0: 7000, x1: 9000, z0: 0, z1: 1000 } };
      const x = (r.x0 + r.x1) / 2;
      const z = (r.z0 + r.z1) / 2;
      return [x, land.height(x, z) + 2600 + random() * 1200, z];
    }),
  );

  root.add(
    sky.mesh,
    buildMoon(moonDirection, 26000, 1800),
    buildGround(land, SEED + 2, GRAVEYARD_GROUND),
    buildGraves(graves, SEED + 3),
    buildFences(plots.map((p) => p.rect), land.height),
    buildDeadTrees(trees, SEED + 4),
    buildings.stone,
    buildings.windows,
    buildLanternPosts(lanterns),
    buildPumpkins(pumpkins),
    glows.mesh,
    wisps.mesh,
    fog.mesh,
    bats.mesh,
  );

  return {
    background: night,
    fog: new Fog(night, 2500, 20000),
    style: {
      floor: new Color(0x46523c),
      floorStripe: new Color(0x4d5a42),
      markings: new Color(0xcfe0ff), // pale and glowing, readable at night
      walls: {
        neutral: new Color(0x9fb4ff), // a ghostly blue
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
        lines: 0.24,
        ceilingLines: 0.05,
      },
    },
    root,
    update(elapsedSeconds) {
      sky.update(elapsedSeconds);
      for (const clock of [glows.time, wisps.time, fog.time, bats.time]) clock.value = elapsedSeconds;
    },
  };
}
