// A frozen summit (original designs, in the spirit of the snowbound final peaks of creature-collecting adventures):
// the arena on a snowy plateau high above a sea of clouds; the ground falling away all round to jagged, snowy peaks;
// snow-laden pines, blue ice-crystal formations, a frozen lake, a cairn and a tattered flag on the summit behind the
// orange goal; a blizzard of driven snow and wind streaks (never inside the arena), drifts of haze. Its creatures: a
// great ice bird circling the summit, a gentle giant snow beast sitting on a ledge, little snowpuffs waddling about,
// ice sprites drifting and frost moths fluttering. An icy-blue field, so the white ball stands out.
import { AmbientLight, Color, DirectionalLight, Fog, Group, HemisphereLight, Vector3 } from "three";
import { buildBlizzard, buildCairn, buildCloudSea, buildIceBird, buildIceCrystals, buildSnowBeast, buildSnowyPines, buildSparkles, snowpuff } from "./frost";
import { type GroundPalette, type Land, buildGround, buildMountains, buildRocks, free, landscape, smoothstep } from "./nature";
import { buildGhosts } from "./phantoms";
import { seededRandom } from "./random";
import type { Placement } from "./shapes";
import { Sky } from "./sky";
import { buildFogBanks } from "./spooky";
import { PLAYING_VOLUME, type Theme } from "./theme";
import { type Home, buildWildlife, walkers } from "./wildlife";

const SEED = 20261015;
const FLAT = { halfX: 5400, halfZ: 7400, radius: 1500 };
/** The summit, behind the orange goal (Three.js frame) */
const SUMMIT = { x: 600, z: 14500 };

const SNOW_GROUND: GroundPalette = {
  grassDark: 0xc9d6e6, // snow in shadow
  grassLight: 0xf6f9fd,
  field: 0xe2eaf4,
  dirt: 0xd2dce8, // a trodden path to the summit
  sand: 0xc4d8ea, // the lake's frozen shore
  water: 0x9ccbea, // ice
};

const outside = (x: number, z: number): number => Math.max(Math.abs(x) - PLAYING_VOLUME.halfX, Math.abs(z) - PLAYING_VOLUME.halfZ);

function summitLand(seed: number): Land {
  const base = landscape(seed, {
    flat: FLAT,
    pond: { x: -9000, z: -3500, radius: 1700 },
    path: (x, z) => (z < FLAT.halfZ - 500 || z > SUMMIT.z - 1500 ? Infinity : Math.abs(x - 600 * Math.sin((z - FLAT.halfZ) / 2600))),
    // Ridges and hollows near the plateau, then the mountain falling away into the clouds
    hills: { low: -900, high: 700, rise: 4000, horizon: -7000 },
  });
  const height = (x: number, z: number): number => {
    const toSummit = Math.hypot(x - SUMMIT.x, z - SUMMIT.z);
    return base.height(x, z) + 4200 * Math.exp(-(toSummit * toSummit) / (2 * 3800 * 3800)) * smoothstep(0, 3000, base.flatDistance(x, z));
  };
  return { ...base, height };
}

export function summitTheme(): Theme {
  const land = summitLand(SEED);
  const random = seededRandom(SEED + 1);
  const haze = new Color(0xd6e2ee);
  const sunDirection = new Vector3(-0.55, 0.42, 0.5).normalize();

  const root = new Group();
  const sun = new DirectionalLight(0xfff4e6, 2.2);
  sun.position.copy(sunDirection).multiplyScalar(10000);
  root.add(new HemisphereLight(0xeaf2ff, 0x8a9ab4, 1.7), new AmbientLight(0xdfe8f5, 0.3), sun);
  const sky = new Sky({
    zenith: new Color(0x6f92c4),
    horizon: haze,
    sunDirection,
    sunStrength: 0.45,
    radius: 32000,
    clouds: { color: new Color(0xf2f6fb), cover: 0.7 },
  });

  // Creatures
  const puffHomes: Home[] = [];
  for (let tries = 0; puffHomes.length < 36 && tries < 4000; tries++) {
    const x = (random() * 2 - 1) * 10000;
    const z = (random() * 2 - 1) * 12000;
    if (outside(x, z) < 800 || outside(x, z) > 3500 || !free(land, x, z, 200)) continue;
    puffHomes.push({ x, y: land.height(x, z), z, scale: 1.2 + random() * 0.4 });
  }
  const puffs = walkers(snowpuff(), puffHomes, 0.07, 170, "transformed.y += abs(sin(time * 5.0 + wanderSeed() * 20.0)) * 4.0;");
  puffs.mesh.name = "wildlife: snowpuff";
  const sprites = buildGhosts(
    "crystal",
    Array.from({ length: 30 }, (): Placement & { tint: Color } => {
      for (;;) {
        const x = (random() * 2 - 1) * 11000;
        const z = (random() * 2 - 1) * 13000;
        if (outside(x, z) < 1200 || outside(x, z) > 7000) continue;
        const s = 1.2 + random() * 0.6;
        return { position: [x, land.height(x, z) + 400 + random() * 1600, z], scale: [s, s, s], tint: new Color(random() < 0.5 ? 0xc8f0ff : 0xe8f6ff) };
      }
    }),
  );
  const moths = buildWildlife(
    SEED + 2,
    {
      ground: [],
      air: Array.from({ length: 30 }, (): Home => {
        for (;;) {
          const x = (random() * 2 - 1) * 9000;
          const z = (random() * 2 - 1) * 11000;
          if (outside(x, z) < 900 || outside(x, z) > 3000) continue;
          return { x, y: land.height(x, z) + 150 + random() * 300, z, scale: 1.5 };
        }
      }),
    },
    [0xe8f8ff, 0xbfe8ff, 0xffffff, 0xd8e8ff],
  );
  const summitTop = new Vector3(SUMMIT.x, land.height(SUMMIT.x, SUMMIT.z), SUMMIT.z);
  const bird = buildIceBird(new Vector3(SUMMIT.x, summitTop.y + 2600, SUMMIT.z), 3800, 70);
  const beastAt = new Vector3(-8600, 0, 6800);
  beastAt.y = land.height(beastAt.x, beastAt.z) - 60;
  const beast = buildSnowBeast(beastAt, Math.atan2(-beastAt.x, -beastAt.z)); // looking at the arena

  // Weather
  const blizzard = buildBlizzard(SEED + 3, 5000, 16000);
  const drifts = buildFogBanks(
    Array.from({ length: 50 }, (): [number, number, number] => {
      for (;;) {
        const x = (random() * 2 - 1) * 15000;
        const z = (random() * 2 - 1) * 17000;
        if (outside(x, z) > 1800) return [x, land.height(x, z) + 250, z];
      }
    }),
    new Color(0.92, 0.95, 1),
  );
  const clouds = buildCloudSea(-2600);

  root.add(
    sky.mesh,
    clouds.mesh,
    buildGround(land, SEED + 4, SNOW_GROUND),
    buildMountains(SEED + 5, {
      forest: 0x6a7686,
      rock: 0x7c8494,
      snow: 0xf6f9fd,
      treeline: 0.12,
      snowline: 0.42,
      distance: [21000, 28000],
      height: [7000, 13000],
      base: -4000,
      count: 22,
    }),
    buildSnowyPines(land, SEED + 6, { clusters: 26, perCluster: [3, 9], spread: 1200, minRadius: 7600, maxRadius: 16000, clearance: 400 }),
    buildIceCrystals(land, SEED + 7, { clusters: 16, perCluster: [1, 3], spread: 800, minRadius: 7400, maxRadius: 14000, clearance: 350 }),
    buildRocks(land, SEED + 8, { clusters: 24, perCluster: [2, 6], spread: 900, minRadius: 7000, maxRadius: 16000, clearance: 300 }),
    buildCairn(summitTop),
    buildSparkles(SEED + 9, 1500, (x, z) => outside(x, z) < 400, land),
    puffs.mesh,
    sprites.mesh,
    moths.root,
    bird.root,
    beast.mesh,
    blizzard.root,
    drifts.mesh,
  );

  return {
    background: haze,
    fog: new Fog(haze, 3000, 30000),
    style: {
      floor: new Color(0x6f8ca6), // icy blue: the white ball stands out on it
      floorStripe: new Color(0x7894ad),
      markings: new Color(0xffffff),
      walls: {
        neutral: new Color(0xeaf6ff),
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
        lines: 0.24,
        ceilingLines: 0.03,
      },
    },
    root,
    update(elapsedSeconds) {
      sky.update(elapsedSeconds);
      for (const clock of [puffs.time, sprites.time, blizzard.time, drifts.time, clouds.time, beast.time]) clock.value = elapsedSeconds;
      moths.update(elapsedSeconds);
      bird.update(elapsedSeconds);
    },
  };
}
