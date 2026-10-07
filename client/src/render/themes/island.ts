// A tropical volcanic island on a sunny day (original designs, in the spirit of the sun-drenched island chains of
// creature-collecting adventures): the arena's pitch on the island, the land sloping to a sand beach, a turquoise
// lagoon with surf and the open sea beyond; a volcano rising from the sea off to one side, smoke drifting from its
// crater (kept dark and smoky, glowing only deep red at the top, so it doesn't compete with the orange team's colour);
// swaying palms, tropical bushes, flowers, black rocks. Its creatures: manta rays gliding over the lagoon, leapers
// arcing out of the sea, crabs scuttling sideways on the beach, seabirds wheeling, butterflies.
import { AmbientLight, Color, DirectionalLight, Fog, Group, HemisphereLight, Vector3 } from "three";
import { type Land, buildFlowers, buildRocks } from "./nature";
import { seededRandom } from "./random";
import { Sky } from "./sky";
import { buildGlows } from "./spooky";
import { PLAYING_VOLUME, type Theme } from "./theme";
import { SEA_LEVEL, type Volcano, buildIslandGround, buildLeapers, buildMantas, buildPalms, buildSea, buildSmoke, crab, islandLand } from "./tropics";
import { type Home, buildBirds, buildWildlife, walkers } from "./wildlife";
import { buildBushes } from "./woods";

const SEED = 20261018;
const FLAT = { halfX: 6200, halfZ: 8200, radius: 1800 };
/** Beyond the orange end, off to its left, rising from the sea: in view down the field */
const VOLCANO: Volcano = { x: -9500, z: 20500, height: 9000, radius: 14000 };

const outside = (x: number, z: number): number => Math.max(Math.abs(x) - PLAYING_VOLUME.halfX, Math.abs(z) - PLAYING_VOLUME.halfZ);

/** Points round the island where the land is between `low` and `high` above the sea (the beach, the shallows...). */
function band(land: Land, random: () => number, count: number, low: number, high: number, minOut: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let tries = 0; out.length < count && tries < count * 400; tries++) {
    const x = (random() * 2 - 1) * 17000;
    const z = (random() * 2 - 1) * 19000;
    const above = land.height(x, z) - SEA_LEVEL;
    if (above < low || above > high || outside(x, z) < minOut) continue;
    if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.radius * 0.45) continue; // (not up the volcano)
    out.push({ x, z });
  }
  return out;
}

export function islandTheme(): Theme {
  const land = islandLand(SEED, FLAT, VOLCANO);
  const random = seededRandom(SEED + 1);
  const horizon = new Color(0xbfe4f4);
  const sunDirection = new Vector3(0.4, 0.75, -0.3).normalize();

  const root = new Group();
  const sun = new DirectionalLight(0xfff4dc, 2.6);
  sun.position.copy(sunDirection).multiplyScalar(10000);
  root.add(new HemisphereLight(0xcfeaff, 0x7aa860, 1.5), new AmbientLight(0xffffff, 0.2), sun);
  const sky = new Sky({ zenith: new Color(0x2f86e0), horizon, sunDirection, sunStrength: 0.9, radius: 34000, clouds: { color: new Color(0xffffff), cover: 0.4 } });

  // Palms along the beach and inland, leaning seaward-ish
  const palmSpots = [...band(land, random, 70, 40, 420, 1500), ...band(land, random, 30, 420, 900, 1800)].map((p) => ({
    x: p.x,
    y: land.height(p.x, p.z),
    z: p.z,
    size: 0.85 + random() * 0.5,
    lean: Math.atan2(-p.z, p.x) + (random() - 0.5) * 1.2, // (the trunk curves along its +x: out, away from the arena)
  }));
  const palms = buildPalms(palmSpots, SEED + 2);
  // For bushes and flowers: the sea counts as the path does, a place nothing grows
  const dryLand: Land = { ...land, pathDistance: (x, z) => (land.height(x, z) < SEA_LEVEL + 80 ? 0 : Infinity) };

  // The volcano's crater, smoke, and a deep red glow
  const craterTop = new Vector3(VOLCANO.x, land.height(VOLCANO.x + VOLCANO.radius * 0.1, VOLCANO.z), VOLCANO.z);
  const smoke = buildSmoke(craterTop.clone().setY(craterTop.y - 300), 26);
  const glows = buildGlows([{ x: craterTop.x, y: craterTop.y - 100, z: craterTop.z, size: 7500, color: new Color(1, 0.2, 0.1), flicker: 0.2 }]);

  // Creatures
  const sea = buildSea(land);
  const lagoon = (t: number, radius: number, phase: number, height: number): Vector3 => {
    const a = t * Math.PI * 2 + phase;
    return new Vector3(Math.cos(a) * radius * 1.0 + 1500, SEA_LEVEL + height + 250 * Math.sin(a * 3), Math.sin(a) * radius * 1.25 - 2000);
  };
  const mantas = buildMantas(
    [(t) => lagoon(t, 16500, 0, 420), (t) => lagoon(t + 0.5, 15500, 1.2, 650)],
    150,
    260,
  );
  const leapers = buildLeapers(
    band(land, random, 8, -1400, -500, 4000).map((p) => ({ x: p.x, z: p.z, heading: random() * Math.PI * 2 })),
    170,
  );
  const crabHomes: Home[] = band(land, random, 24, -10, 160, 1600).map((p) => ({ x: p.x, y: land.height(p.x, p.z), z: p.z, scale: 1.3 + random() * 0.4 }));
  const crabs = walkers(crab(), crabHomes, 0.12, 120, "transformed.y += abs(sin(time * 12.0 + wanderSeed() * 20.0)) * 2.0;");
  crabs.mesh.name = "wildlife: crab";
  const birds = buildBirds(SEED + 3, { radius: [9000, 15000], height: [1600, 3400], count: 24 });
  const butterflies = buildWildlife(
    SEED + 4,
    {
      ground: [],
      air: band(land, random, 30, 300, 1100, 1000).map((p): Home => ({ x: p.x, y: land.height(p.x, p.z) + 150 + random() * 300, z: p.z, scale: 1.6 })),
    },
    [0xff4fa0, 0xffe14a, 0x3fd0ff, 0xffffff, 0xb86bff],
  );

  root.add(
    sky.mesh,
    buildIslandGround(land, SEED + 5, VOLCANO),
    sea.mesh,
    palms.mesh,
    buildBushes(dryLand, SEED + 6, { clusters: 30, perCluster: [2, 6], spread: 900, minRadius: 7500, maxRadius: 13000, clearance: 300 }),
    buildFlowers(dryLand, SEED + 7, { clusters: 30, perCluster: [20, 60], spread: 700, minRadius: 7400, maxRadius: 12000, clearance: 100 }),
    buildRocks(land, SEED + 8, { clusters: 26, perCluster: [2, 6], spread: 900, minRadius: 8000, maxRadius: 20000, clearance: 200 }),
    smoke.mesh,
    glows.mesh,
    mantas.root,
    leapers.mesh,
    crabs.mesh,
    birds.mesh,
    butterflies.root,
  );

  return {
    background: horizon,
    fog: new Fog(horizon, 9000, 40000),
    style: {
      floor: new Color(0x4a9a48), // a tropical pitch
      floorStripe: new Color(0x55a852),
      markings: null,
      walls: {
        neutral: new Color(0xffffff),
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
        lines: 0.22,
        ceilingLines: 0.03,
      },
    },
    root,
    update(seconds) {
      sky.update(seconds);
      for (const clock of [sea.time, palms.time, smoke.time, glows.time, crabs.time]) clock.value = seconds;
      mantas.update(seconds);
      leapers.update(seconds);
      birds.update(seconds);
      butterflies.update(seconds);
    },
  };
}
