// A ruined temple on a summit under a cosmic sky (original designs, in the spirit of the sky-high ruins where
// creature-collecting adventures meet their legends): the arena at the heart of a paved plaza on a mountaintop, cliffs
// falling away all round into a sea of clouds, other peaks rising from it; a colonnade of standing, broken and toppled
// columns; ruined arches; behind the orange goal, stairs up to an altar with a portal of swirling light, broken stones
// floating round it, braziers of pale flame; a night of stars, a spiral galaxy, great rings of light turning in the
// air. Its creatures: sky whales (a mother and her calf) swimming through the stars, guardian statues with glowing
// eyes, star sprites, birds circling the peak. Generated and seeded like the other themes.
import { AmbientLight, Color, DirectionalLight, Fog, Group, HemisphereLight, Vector3 } from "three";
import { buildAltar, buildArches, buildColonnade, buildGalaxy, buildGuardians, buildPaving, buildSkyRings, buildSkyWhales } from "./celestial";
import { buildCloudSea } from "./frost";
import { buildStars } from "./geode";
import { GROUND_LEVEL, type GroundPalette, type Land, buildGround, buildMountains, landscape } from "./nature";
import { buildGhosts } from "./phantoms";
import { seededRandom } from "./random";
import { buildDriftingRocks, buildRift } from "./rift";
import type { Placement } from "./shapes";
import { Sky } from "./sky";
import { buildGlows } from "./spooky";
import { PLAYING_VOLUME, type Theme } from "./theme";
import { buildBirds } from "./wildlife";

const SEED = 20261017;
/** The plaza on the summit (its paving; the cliffs begin round its edge) */
const PLAZA = { halfX: 7800, halfZ: 11200, radius: 2400 };
const ALTAR = new Vector3(0, GROUND_LEVEL, 9600);

const SUMMIT_ROCK: GroundPalette = {
  grassDark: 0x5a5868,
  grassLight: 0x7a7888,
  field: 0x8a8678,
  dirt: 0x8a8678,
  sand: 0x6a6878,
  water: 0x6a6878,
};

const outside = (x: number, z: number): number => Math.max(Math.abs(x) - PLAYING_VOLUME.halfX, Math.abs(z) - PLAYING_VOLUME.halfZ);

function summitLand(seed: number): Land {
  return landscape(seed, {
    flat: PLAZA,
    pond: { x: 40000, z: 40000, radius: 1 }, // (none: far off)
    path: () => Infinity,
    // Cliffs falling away from the plaza's edge into the clouds
    hills: { low: -5200, high: -3400, rise: 2600, horizon: -2500 },
  });
}

/** The whales' way through the sky: a wide loop, rising and falling (t: 0..1 a lap). */
function whalePath(t: number): Vector3 {
  const a = t * Math.PI * 2;
  return new Vector3(Math.cos(a) * 17000, 7000 + 1500 * Math.sin(a * 2), Math.sin(a) * 19000);
}

export function templeTheme(): Theme {
  const land = summitLand(SEED);
  const random = seededRandom(SEED + 1);
  const night = new Color(0x1a1c3a);

  const root = new Group();
  const moonlight = new DirectionalLight(0xd0d8ff, 1.3);
  moonlight.position.set(5000, 9000, -3000);
  root.add(new HemisphereLight(0xa8b4ff, 0x3a3550, 1.6), new AmbientLight(0x7a80b0, 0.5), moonlight);
  const sky = new Sky({
    zenith: new Color(0x070a22),
    horizon: new Color(0x3a3a6a),
    sunDirection: new Vector3(0, -1, 0),
    sunStrength: 0,
    radius: 32000,
    clouds: { color: new Color(0x4a3a7a), cover: 0.3 }, // (a nebula's wisps)
  });

  // The colonnade round the arena: gaps for the stairs behind the orange goal and an entrance behind the blue
  const colonnade = buildColonnade(
    { x: 5900, z: 7900 },
    950,
    2600,
    GROUND_LEVEL,
    (x, z) => Math.abs(x) < 1500 && Math.abs(z) > 7000,
    SEED + 2,
  );
  const arches = buildArches([
    { at: new Vector3(-6900, GROUND_LEVEL, -9300), facing: 0.6, whole: true },
    { at: new Vector3(6900, GROUND_LEVEL, -9100), facing: -0.5, whole: false },
    { at: new Vector3(-7000, GROUND_LEVEL, 2500), facing: Math.PI / 2, whole: false },
    { at: new Vector3(7000, GROUND_LEVEL, -1500), facing: Math.PI / 2, whole: true },
  ]);
  const altar = buildAltar(ALTAR);
  const portalAt = new Vector3(ALTAR.x, altar.top + 1700, ALTAR.z + 200);
  const portal = buildRift(
    portalAt,
    1100,
    { a: new Color(0.85, 0.6, 0.25), b: new Color(0.3, 0.45, 1.0), eye: new Color(0.55, 0.5, 0.45) },
    new Vector3(0, portalAt.y, 0),
    false,
  );
  const fragments = buildDriftingRocks(
    Array.from({ length: 16 }, () => {
      const a = random() * Math.PI * 2;
      const r = 1500 + random() * 1500;
      return { at: new Vector3(portalAt.x + Math.cos(a) * r, portalAt.y - 600 + random() * 2200, portalAt.z + Math.sin(a) * r * 0.6), size: 70 + random() * 160 };
    }),
  );
  const rings = buildSkyRings([
    // A ring framing the portal, upright, facing the arena, spinning
    { at: portalAt, radius: 1250, tilt: -Math.PI / 2, speed: 0.25 },
    { at: new Vector3(ALTAR.x, 6500, ALTAR.z + 1500), radius: 3600, tilt: 0.25, speed: 0.04 },
    { at: new Vector3(ALTAR.x, 7400, ALTAR.z + 1500), radius: 2500, tilt: -0.4, speed: -0.06 },
    { at: new Vector3(-9000, 5600, -3000), radius: 2200, tilt: 0.9, speed: 0.05 },
    { at: new Vector3(10000, 6200, 2000), radius: 2800, tilt: -0.7, speed: -0.035 },
  ]);

  // Creatures
  const whales = buildSkyWhales(whalePath, 220, [
    { size: 950, lag: 0 },
    { size: 480, lag: 0.025 },
  ]);
  const guardians = buildGuardians([
    { at: new Vector3(-2000, GROUND_LEVEL, ALTAR.z - 1700), facing: Math.PI, size: 520 },
    { at: new Vector3(2000, GROUND_LEVEL, ALTAR.z - 1700), facing: Math.PI, size: 520 },
    { at: new Vector3(-1900, GROUND_LEVEL, -8200), facing: 0, size: 480 },
    { at: new Vector3(1900, GROUND_LEVEL, -8200), facing: 0, size: 480 },
  ]);
  const sprites = buildGhosts(
    "orb",
    Array.from({ length: 30 }, (): Placement & { tint: Color } => {
      for (;;) {
        const x = (random() * 2 - 1) * 10000;
        const z = (random() * 2 - 1) * 12500;
        if (outside(x, z) < 1500 || outside(x, z) > 6000) continue;
        return { position: [x, 300 + random() * 2500, z], scale: [1.1, 1.1, 1.1], tint: new Color(random() < 0.5 ? 0xfff0c8 : 0xd8e4ff) };
      }
    }),
  );
  const birds = buildBirds(SEED + 3, { radius: [9000, 14000], height: [1500, 3500], count: 22 });

  const flame = new Color(0.6, 0.85, 1);
  const glows = buildGlows([
    ...altar.flames.map((f) => ({ x: f.x, y: f.y, z: f.z, size: 900, color: flame, flicker: 0.4 })),
    { x: portalAt.x, y: portalAt.y, z: portalAt.z, size: 3400, color: new Color(0.35, 0.3, 0.25), flicker: 0.05 },
    ...guardians.eyes.map((e) => ({ x: e.x, y: e.y, z: e.z, size: 260, color: new Color(0.6, 0.9, 1), flicker: 0.1 })),
  ]);

  root.add(
    sky.mesh,
    buildStars(SEED + 4, 2400, 29000),
    buildGalaxy(new Vector3(-9000, 14000, 24000), 7500, 0.5),
    buildCloudSea(-2400).mesh,
    buildMountains(SEED + 5, {
      forest: 0x4a4a62,
      rock: 0x5a5a72,
      snow: 0xd8dcf0,
      treeline: 0.0,
      snowline: 0.55,
      distance: [20000, 28000],
      height: [6000, 11000],
      base: -4000,
      count: 18,
    }),
    buildGround(land, SEED + 6, SUMMIT_ROCK),
    buildPaving({ x: PLAZA.halfX, z: PLAZA.halfZ }, PLAZA.radius, GROUND_LEVEL + 8),
    colonnade,
    arches,
    altar.mesh,
    portal.mesh,
    fragments.mesh,
    rings.root,
    whales.root,
    guardians.root,
    sprites.mesh,
    birds.mesh,
    glows.mesh,
  );

  return {
    background: night,
    fog: new Fog(night, 6000, 34000),
    style: {
      floor: new Color(0x55546c), // inlaid slate, darker than the paving round it
      floorStripe: new Color(0x5b5a72),
      markings: new Color(0xffe6a8), // glowing gold
      walls: {
        neutral: new Color(0xfff0d0),
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
        lines: 0.24,
        ceilingLines: 0.04,
      },
    },
    root,
    update(seconds) {
      sky.update(seconds);
      for (const clock of [portal.time, fragments.time, sprites.time, glows.time]) clock.value = seconds;
      rings.update(seconds);
      whales.update(seconds);
      birds.update(seconds);
    },
  };
}
