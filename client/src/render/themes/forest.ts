// A forest route: the arena stands in a clearing in a mixed forest, like the woods early in a creature-collecting
// adventure (all original designs). A dirt path comes in behind one goal and leaves by a side; tall grass, ferns,
// bushes and toadstools line the forest's edge; sunbeams slant through the trees and pollen drifts in the air. No
// stands: just wildlife going about its business outside the cage (caterpillars, beetles, butterflies, round critters)
// and birds overhead, all moving slowly. Generated and seeded like the meadow; about twenty-five draw calls.
import { AmbientLight, Color, DirectionalLight, Fog, Group, HemisphereLight, Vector3 } from "three";
import {
  type GroundPalette,
  type Land,
  buildFlowers,
  buildGround,
  buildRocks,
  buildTallGrass,
  landscape,
} from "./nature";
import { seededRandom } from "./random";
import { Sky } from "./sky";
import { PLAYING_VOLUME, type Theme } from "./theme";
import { type Home, buildBirds, buildWildlife } from "./wildlife";
import { buildBushes, buildDeadwood, buildFerns, buildForest, buildPollen, buildSunbeams, buildToadstools } from "./woods";

const SEED = 20261007;

const FOREST_GROUND: GroundPalette = {
  grassDark: 0x2f5f2a,
  grassLight: 0x5c8f3c,
  field: 0x4f9a3f,
  dirt: 0xa9875a,
  sand: 0xbfae7e,
  water: 0x3f8fb5,
};

/** How far outside the playing volume a point is (negative inside), in x/z. */
function outsideField(x: number, z: number): number {
  return Math.max(Math.abs(x) - PLAYING_VOLUME.halfX, Math.abs(z) - PLAYING_VOLUME.halfZ);
}

function forestLand(seed: number): Land {
  // A clearing just bigger than the arena
  const flat = { halfX: 4800, halfZ: 6750, radius: 1300 };
  return landscape(seed, {
    flat,
    pond: { x: 8200, z: -4200, radius: 1300 },
    // The route: in behind the orange goal (+z), out by the blue half's left side (-x)
    path: (x, z) =>
      Math.min(
        z > flat.halfZ - 500 ? Math.abs(x - 1300 * Math.sin((z - flat.halfZ) / 3200)) : Infinity,
        x < -(flat.halfX - 500) ? Math.abs(z + 2500 - 1100 * Math.sin((-x - flat.halfX) / 2800)) : Infinity,
      ),
    hills: { low: 120, high: 600, rise: 3500, horizon: 1600 },
  });
}

/** Homes for the wildlife: on the ground between the cage and the trees, or in the air above the grass. */
function wildlifeHomes(land: Land, seed: number): { ground: Home[]; air: Home[] } {
  const random = seededRandom(seed);
  const homes = (count: number, minOut: number, maxFromClearing: number, lift: () => number, scale: () => number): Home[] => {
    const out: Home[] = [];
    for (let tries = 0; out.length < count && tries < count * 200; tries++) {
      const x = (random() * 2 - 1) * 11000;
      const z = (random() * 2 - 1) * 13000;
      if (outsideField(x, z) < minOut || land.flatDistance(x, z) > maxFromClearing) continue;
      if (Math.hypot(x - land.pond.x, z - land.pond.z) < land.pond.radius + 400) continue;
      out.push({ x, y: land.height(x, z) + lift(), z, scale: scale() });
    }
    return out;
  };
  return {
    // (far enough out that their rambles, a few hundred uu, keep well clear of the field)
    ground: homes(66, 750, 2000, () => 0, () => 1 + random() * 0.3),
    air: homes(60, 1100, 2600, () => 120 + random() * 220, () => 1.4 + random() * 0.4),
  };
}

export function forestTheme(): Theme {
  const land = forestLand(SEED);
  const horizon = new Color(0xc2dccb); // a green-blue haze, deep in the woods
  const sunDirection = new Vector3(0.35, 0.8, -0.48).normalize();

  const root = new Group();
  const sun = new DirectionalLight(0xfff0d0, 2.4);
  sun.position.copy(sunDirection).multiplyScalar(10000);
  root.add(new HemisphereLight(0xdcefff, 0x3e5a2c, 1.35), new AmbientLight(0xffffff, 0.12), sun);

  const sky = new Sky({ zenith: new Color(0x4f9ad8), horizon, sunDirection, radius: 30000 });
  const grass = buildTallGrass(land, SEED + 2, { clusters: 40, perCluster: [120, 240], spread: 800, minRadius: 5400, maxRadius: 10000, clearance: 60 });
  const ferns = buildFerns(land, SEED + 4, { clusters: 50, perCluster: [10, 30], spread: 900, minRadius: 6500, maxRadius: 14000, clearance: 500 });
  const pollen = buildPollen(land, SEED + 11, { count: 900, within: 11000, beyond: (x, z) => outsideField(x, z) > 400 });
  const wildlife = buildWildlife(SEED + 12, wildlifeHomes(land, SEED + 13));
  const birds = buildBirds(SEED + 14, { radius: [6000, 12000], height: [3000, 4200], count: 18 });
  root.add(
    sky.mesh,
    buildGround(land, SEED + 1, FOREST_GROUND),
    buildForest(land, SEED + 3, { spacing: 560, outer: 22000 }),
    buildBushes(land, SEED + 5, { clusters: 40, perCluster: [3, 8], spread: 900, minRadius: 6500, maxRadius: 14000, clearance: 400 }),
    ferns.mesh,
    grass.mesh,
    buildFlowers(land, SEED + 6, { clusters: 26, perCluster: [30, 80], spread: 700, minRadius: 5600, maxRadius: 9500, clearance: 80 }),
    buildToadstools(land, SEED + 7, { clusters: 30, perCluster: [3, 8], spread: 220, minRadius: 6000, maxRadius: 11000, clearance: 300 }),
    buildRocks(land, SEED + 8, { clusters: 20, perCluster: [1, 4], spread: 700, minRadius: 6500, maxRadius: 14000, clearance: 400 }),
    buildDeadwood(
      land,
      SEED + 9,
      { clusters: 14, perCluster: [1, 2], spread: 400, minRadius: 6500, maxRadius: 11000, clearance: 500 },
      { x: 600, z: 7050, facing: Math.PI }, // by the path, where it leaves the clearing; facing the arena
    ),
    buildSunbeams(land, SEED + 10, sunDirection, 14),
    pollen.points,
    wildlife.root,
    birds.mesh,
  );

  return {
    background: horizon,
    fog: new Fog(horizon, 5500, 24000),
    style: {
      floor: new Color(0x4f9a3f),
      floorStripe: new Color(0x55a144), // (faint: a clearing, not a stadium)
      markings: null,
      walls: {
        neutral: new Color(0xe9f7e4),
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
        lines: 0.18,
        ceilingLines: 0.02, // (the canopy and sky show through)
      },
    },
    root,
    update(seconds) {
      sky.update(seconds);
      grass.time.value = seconds;
      ferns.time.value = seconds;
      pollen.time.value = seconds;
      wildlife.update(seconds);
      birds.update(seconds);
    },
  };
}
