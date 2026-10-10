// A misty lake at dawn (original designs, in the spirit of the still, legend-haunted lakes of creature-collecting
// adventures): the arena on a wooden deck out over the water; the lake mirror-calm, reflecting the dawn sky, the
// shores and the deck, rippling a little; low mist drifting; forested hills round the shore; reeds, lily pads and
// flowers; paper lanterns floating; a rocky islet with a cave glowing within. Its creatures: a gentle long-necked
// guardian that rises from the mist far out, lingers and sinks away again; swans paddling; frogs on the lily pads;
// fish leaping; dragonflies; birds. Generated and seeded like the other themes.
import { AmbientLight, Color, DirectionalLight, Fog, Group, HemisphereLight, Vector3 } from "three";
import {
  WATER,
  buildDeck,
  buildFrogs,
  buildGuardian,
  buildIslet,
  buildLakeSurface,
  buildLanterns,
  buildLilies,
  buildReeds,
  lakeLand,
  shoreSpots,
  swan,
} from "./lakeside";
import { type GroundPalette, buildGround } from "./nature";
import { seededRandom } from "./random";
import { Sky } from "./sky";
import { buildFogBanks, buildGlows } from "./spooky";
import { PLAYING_VOLUME, type Theme } from "./theme";
import { buildLeapers } from "./tropics";
import { type Home, buildBirds, buildWildlife, walkers } from "./wildlife";
import { buildForest } from "./woods";

const SEED = 20261019;
/** The lake (its shore is round this) */
const LAKE = { halfX: 13500, halfZ: 16000, radius: 6000 };
/** The deck the arena stands on */
const DECK = { x: 5500, z: 7500, radius: 1500 };

const SHORE_GROUND: GroundPalette = {
  grassDark: 0x3f6a3a,
  grassLight: 0x5f8a4a,
  field: 0x6a6450, // the lake bed, seen at the shallows' edge
  dirt: 0x8a7a5a,
  sand: 0x9a8a6a,
  water: 0x4a6a7a,
};

const outside = (x: number, z: number): number => Math.max(Math.abs(x) - PLAYING_VOLUME.halfX, Math.abs(z) - PLAYING_VOLUME.halfZ);
/** Off the deck (and clear of it by `margin`) */
const offDeck = (x: number, z: number, margin: number): boolean => Math.abs(x) > DECK.x + margin || Math.abs(z) > DECK.z + margin;

export function lakeTheme(): Theme {
  const land = lakeLand(SEED, LAKE);
  const random = seededRandom(SEED + 1);
  const mist = new Color(0xd9cfd0);
  const sunDirection = new Vector3(0.9, 0.13, 0.4).normalize(); // low: just risen

  const root = new Group();
  const sun = new DirectionalLight(0xffd8b8, 1.9);
  sun.position.copy(sunDirection).multiplyScalar(10000);
  root.add(new HemisphereLight(0xd0dcf0, 0x4a5a48, 1.45), new AmbientLight(0xffeee8, 0.25), sun);
  const sky = new Sky({
    zenith: new Color(0x7f9fd0),
    horizon: new Color(0xf2c8b0), // peach, at dawn
    sunDirection,
    sunStrength: 1,
    radius: 32000,
    clouds: { color: new Color(0xffd8d0), cover: 0.35 },
  });

  const lake = buildLakeSurface(90000, new Color(0x5a7a88), 512);
  const deck = buildDeck({ x: DECK.x, z: DECK.z }, DECK.radius);
  const isletAt = new Vector3(8500, WATER - 200, 12500);
  const islet = buildIslet(isletAt, Math.atan2(-isletAt.x, -isletAt.z), SEED + 2);

  // Reeds and lilies: along the shore, and round the deck's corners
  const nearDeck = (count: number, min: number, max: number): { x: number; z: number }[] =>
    Array.from({ length: count }, () => {
      for (;;) {
        const x = (random() * 2 - 1) * (DECK.x + max);
        const z = (random() * 2 - 1) * (DECK.z + max);
        if (offDeck(x, z, min) && outside(x, z) > 1500) return { x, z };
      }
    });
  const reedSpots = [
    ...shoreSpots(land, random, 90, -260, 60, (x, z) => outside(x, z) < 2000),
    ...nearDeck(14, 400, 1800),
  ].map((p) => ({ ...p, size: 1 + random() * 0.8 }));
  const reeds = buildReeds(reedSpots, SEED + 3);
  const lilySpots = [
    ...shoreSpots(land, random, 120, -500, -80, (x, z) => outside(x, z) < 2000),
    ...nearDeck(40, 350, 2600),
  ].map((p) => ({ ...p, size: 0.8 + random() * 0.7, flower: random() < 0.3 }));
  const lanternSpots = nearDeck(16, 900, 5000);
  const lanterns = buildLanterns(lanternSpots);

  // Creatures
  const guardian = buildGuardian(new Vector3(-6500, 0, 13500), Math.PI + 0.4, 950, 60);
  const swanHomes: Home[] = nearDeck(14, 1500, 8000).map((p) => ({ x: p.x, y: WATER - 10, z: p.z, scale: 1.4 + random() * 0.3 }));
  const swans = walkers(swan(), swanHomes, 0.03, 380, "transformed.y += sin(time * 1.2 + wanderSeed() * 12.0) * 3.0;");
  swans.mesh.name = "wildlife: swan";
  const frogs = buildFrogs(lilySpots.filter((_, i) => i % 6 === 0), SEED + 4, 2.2);
  const fish = buildLeapers(
    nearDeck(9, 1500, 7000).map((p) => ({ x: p.x, z: p.z, heading: random() * Math.PI * 2 })),
    60,
    { height: 320, length: 520 },
  );
  const dragonflies = buildWildlife(
    SEED + 5,
    { ground: [], air: reedSpots.filter((_, i) => i % 3 === 0).map((p): Home => ({ x: p.x, y: WATER + 220 + random() * 300, z: p.z, scale: 1.4 })) },
    [0x3fd0ff, 0x5fe8c8, 0x8a7cff, 0xd0f0ff],
  );
  const birds = buildBirds(SEED + 6, { radius: [9000, 15000], height: [2500, 4500], count: 12 });

  const glows = buildGlows([
    ...deck.lights.map((l) => ({ x: l.x, y: l.y, z: l.z, size: 700, color: new Color(1, 0.8, 0.5), flicker: 0.25 })),
    ...lanternSpots.map((l) => ({ x: l.x, y: WATER + 90, z: l.z, size: 520, color: new Color(1, 0.75, 0.45), flicker: 0.3 })),
    { x: islet.cave.x, y: islet.cave.y + 150, z: islet.cave.z, size: 1300, color: new Color(0.4, 0.8, 1), flicker: 0.08 },
  ]);
  const mistBanks = buildFogBanks(
    // (out on the lake and along the shores, leaving the water round the deck clear to mirror the sky)
    Array.from({ length: 45 }, (): [number, number, number] => {
      for (;;) {
        const x = (random() * 2 - 1) * 17000;
        const z = (random() * 2 - 1) * 19000;
        if (outside(x, z) > 4500) return [x, WATER + 260, z];
      }
    }),
    new Color(0.92, 0.88, 0.9),
  );

  const ground = buildGround(land, SEED + 7, SHORE_GROUND);
  const forest = buildForest(land, SEED + 8, { spacing: 650, outer: 24000 });
  lake.reflect(sky.mesh, ground, forest, deck.root, islet.mesh, guardian.root, lanterns.mesh, glows.mesh);

  root.add(
    sky.mesh,
    ground,
    lake.mesh,
    deck.root,
    forest,
    reeds.mesh,
    buildLilies(lilySpots, SEED + 9),
    lanterns.mesh,
    islet.mesh,
    guardian.root,
    swans.mesh,
    frogs.mesh,
    fish.mesh,
    dragonflies.root,
    birds.mesh,
    glows.mesh,
    mistBanks.mesh,
  );

  return {
    background: mist,
    fog: new Fog(mist, 4500, 30000),
    style: {
      floor: new Color(0x587a5c),
      floorStripe: new Color(0x5f8262),
      markings: null,
      walls: {
        neutral: new Color(0xf6f0ea),
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
        lines: 0.22,
        ceilingLines: 0.03,
      },
    },
    root,
    update(elapsedSeconds) {
      sky.update(elapsedSeconds);
      for (const clock of [lake.time, reeds.time, lanterns.time, swans.time, frogs.time, glows.time, mistBanks.time]) clock.value = elapsedSeconds;
      guardian.update(elapsedSeconds);
      fish.update(elapsedSeconds);
      dragonflies.update(elapsedSeconds);
      birds.update(elapsedSeconds);
    },
  };
}
