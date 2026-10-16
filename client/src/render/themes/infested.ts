// An infested ruin: the arena in a cleared yard amid a ruined industrial zone overrun by a parasitic biomass (original
// designs, in the spirit of a sci-fi shooter's quarantine zone). Low overcast sky and a murky haze; jagged ruins with the
// growth creeping up their walls; a wrecked freighter fused with a colossal hive spire on the horizon; tendrils, twisted
// spires, carpets of biomass and pustules glowing a sickly green; a toxic pool; spores drifting everywhere. Everything
// alive moves slowly (breathing, throbbing). Generated and seeded like the other themes; about a dozen draw calls.
import { AmbientLight, Color, DirectionalLight, Fog, Group, HemisphereLight, Vector3 } from "three";
import { type Spire, buildBiomass, buildPustules, buildRuins, buildSpires, buildTendrils, layoutRuins } from "./blight";
import { type GroundPalette, type Land, buildGround, buildRocks, free, landscape } from "./nature";
import { seededRandom } from "./random";
import { Sky } from "./sky";
import { PLAYING_VOLUME, type Theme } from "./theme";
import { buildPollen } from "./woods";

const SEED = 20261009;

const BLIGHTED_GROUND: GroundPalette = {
  grassDark: 0x47402f,
  grassLight: 0x685c42,
  field: 0x57503d,
  dirt: 0x4b4741, // a cracked road
  sand: 0x786a3c, // sludge round the pool
  water: 0x7c9a32, // toxic
};

function blightedLand(seed: number): Land {
  const flat = { halfX: 5200, halfZ: 7200, radius: 1200 };
  return landscape(seed, {
    flat,
    pond: { x: -9800, z: 4600, radius: 1500 },
    // An old road, out from behind the blue goal
    path: (x, z) => (z > -(flat.halfZ - 500) ? Infinity : Math.abs(x - 500 * Math.sin((-z - flat.halfZ) / 2600))),
    hills: { low: 60, high: 900, rise: 3500, horizon: 1400 },
  });
}

export function infestedTheme(): Theme {
  const land = blightedLand(SEED);
  const random = seededRandom(SEED + 1);
  const haze = new Color(0x8a8460);
  const sunDirection = new Vector3(0.3, 0.6, -0.5).normalize();

  const root = new Group();
  const sun = new DirectionalLight(0xe6d6a6, 0.95);
  sun.position.copy(sunDirection).multiplyScalar(10000);
  root.add(new HemisphereLight(0xb8b088, 0x3a3022, 1.15), new AmbientLight(0xffffff, 0.15), sun);

  const sky = new Sky({
    zenith: new Color(0x3c4232),
    horizon: haze,
    sunDirection,
    sunStrength: 0.25, // a pale smudge behind the overcast
    radius: 30000,
    clouds: { color: new Color(0x6c6852), cover: 0.92 },
  });

  const ruins = layoutRuins(land, SEED + 2, 26, 8000, 19000);
  // Spires among the ruins, kept well back from the arena (they lean and waver), and one colossal hive on the wreck
  const wreck = { x: 13500, z: 15500 };
  const spires: Spire[] = [];
  for (let tries = 0; spires.length < 16 && tries < 2000; tries++) {
    const angle = random() * Math.PI * 2;
    const r = 7500 + random() * 8000;
    const x = Math.cos(angle) * r * 0.85;
    const z = Math.sin(angle) * r;
    if (!free(land, x, z, 1600)) continue;
    if (ruins.some((o) => Math.abs(o.x - x) < o.width / 2 + 500 && Math.abs(o.z - z) < o.depth / 2 + 500)) continue;
    spires.push({ x, z, y: land.height(x, z), height: 1800 + random() * 3800, radius: 180 + random() * 260 });
  }
  spires.push({ x: wreck.x - 1500, z: wreck.z + 600, y: land.height(wreck.x, wreck.z), height: 11000, radius: 1400 });

  // Where the growth gathers: round the ruins' feet and the spires' bases
  const patches: [number, number][] = [
    ...ruins.map((r): [number, number] => [r.x + (random() - 0.5) * r.width, r.z + (random() - 0.5) * r.depth]),
    ...spires.map((s): [number, number] => [s.x, s.z]),
  ];
  const spots: { x: number; y: number; z: number; size: number }[] = [];
  for (const [cx, cz] of patches) {
    for (let k = 0; k < 9; k++) {
      const a = random() * Math.PI * 2;
      const r = 150 + random() * 700;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (!free(land, x, z, 200)) continue;
      const size = 0.7 + random() * 1.3;
      spots.push({ x, y: land.height(x, z) + 30 * size, z, size });
    }
  }

  const spireMesh = buildSpires(spires, SEED + 3);
  const tendrils = buildTendrils(land, SEED + 4, ruins, spires, 70);
  const biomass = buildBiomass(land, SEED + 5, patches);
  const pustules = buildPustules(spots);
  const spores = buildPollen(land, SEED + 6, {
    count: 1400,
    within: 14000,
    beyond: (x, z) => Math.abs(x) > PLAYING_VOLUME.halfX + 300 || Math.abs(z) > PLAYING_VOLUME.halfZ + 300,
    color: 0xd6e07a,
    size: 24,
    height: 2500,
  });
  root.add(
    sky.mesh,
    buildGround(land, SEED + 7, BLIGHTED_GROUND),
    buildRuins(land, ruins, SEED + 8, wreck),
    buildRocks(land, SEED + 9, { clusters: 26, perCluster: [2, 6], spread: 900, minRadius: 7000, maxRadius: 18000, clearance: 300 }),
    spireMesh.mesh,
    tendrils.mesh,
    biomass.mesh,
    pustules.root,
    spores.points,
  );

  return {
    background: haze,
    fog: new Fog(haze, 3000, 22000),
    style: {
      floor: new Color(0x645c45),
      floorStripe: new Color(0x6b634b), // (worn)
      markings: null,
      walls: {
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
      },
    },
    root,
    update(elapsedSeconds) {
      sky.update(elapsedSeconds);
      for (const clock of [spireMesh.time, tendrils.time, biomass.time, pustules.time, spores.time]) clock.value = elapsedSeconds;
    },
  };
}
