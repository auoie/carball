// A kawaii candy land (original designs): a pastel pink and periwinkle sky with cotton-candy clouds, mint hills with
// lollipop and cotton-candy trees, gumdrops, gift boxes and candy canes, a village of cupcake houses, a pink-lemonade
// lake, a rainbow over the far end, four giant plush bears sitting round the arena, and hearts, stars, balloons and
// sparkles floating about. A candy-striped pink field. All gentle. Generated and seeded like the other themes.
import { AmbientLight, Color, DirectionalLight, Fog, Group, HemisphereLight, Vector3 } from "three";
import {
  CANDY,
  buildBalloons,
  buildBears,
  buildCandyCanes,
  buildCottonCandy,
  buildCupcakeHouses,
  buildFloaters,
  buildGifts,
  buildGumdrops,
  buildLollipops,
  buildRainbow,
} from "./confection";
import { type GroundPalette, type Land, buildFlowers, buildGround, landscape } from "./nature";
import { seededRandom } from "./random";
import type { Placement } from "./shapes";
import { Sky } from "./sky";
import { PLAYING_VOLUME, type Theme } from "./theme";
import { buildPollen } from "./woods";

const SEED = 20261010;

const CANDY_GROUND: GroundPalette = {
  grassDark: 0x9fe0b4, // mint
  grassLight: 0xc8f5d6,
  field: 0xb8efc9,
  dirt: 0xffe3ef, // a sugar-pink path
  sand: 0xfff4c2,
  water: 0xff9ecb, // pink lemonade
};

function candyLand(seed: number): Land {
  const flat = { halfX: 5600, halfZ: 7600, radius: 1600 };
  return landscape(seed, {
    flat,
    pond: { x: 11500, z: -3000, radius: 2200 },
    path: (x, z) => (z < flat.halfZ - 500 ? Infinity : Math.abs(x - 1500 * Math.sin((z - flat.halfZ) / 3800))),
    hills: { low: 250, high: 1500, rise: 4500, horizon: 1800 },
  });
}

/** Points around the arena, at least `margin` outside the playing area and within `within` of the centre. */
function around(random: () => number, count: number, margin: number, within: number): [number, number][] {
  const out: [number, number][] = [];
  while (out.length < count) {
    const x = (random() * 2 - 1) * within;
    const z = (random() * 2 - 1) * within * 1.2;
    if (Math.abs(x) < PLAYING_VOLUME.halfX + margin && Math.abs(z) < PLAYING_VOLUME.halfZ + margin) continue;
    out.push([x, z]);
  }
  return out;
}

export function kawaiiTheme(): Theme {
  const land = candyLand(SEED);
  const random = seededRandom(SEED + 1);
  const blush = new Color(0xffd6ea);
  const sunDirection = new Vector3(-0.4, 0.75, 0.5).normalize();

  const root = new Group();
  const sun = new DirectionalLight(0xfff6ea, 1.8);
  sun.position.copy(sunDirection).multiplyScalar(10000);
  root.add(new HemisphereLight(0xfff0fb, 0xc9f0d8, 1.7), new AmbientLight(0xffffff, 0.25), sun);

  const sky = new Sky({
    zenith: new Color(0xb7c8ff), // periwinkle
    horizon: blush,
    sunDirection,
    sunStrength: 0.6,
    radius: 30000,
    clouds: { color: new Color(0xfff4fa), cover: 0.55 }, // cotton candy
  });

  const hearts = [new Color(0xff8fc4), new Color(0xffa8a8), new Color(0xff6fae), new Color(0xd9a8ff)];
  const floaters = buildFloaters(
    around(random, 60, 1600, 14000).map(([x, z]) => {
      const s = 0.8 + random() * 0.8;
      return {
        position: [x, 2700 + random() * 3300, z],
        scale: [s, s, s],
        tint: hearts[Math.floor(random() * hearts.length)] ?? new Color(0xff8fc4),
      } satisfies Placement & { tint: Color };
    }),
  );
  const balloons = buildBalloons(
    around(random, 70, 1200, 14000).map(([x, z]) => {
      const s = 1 + random() * 0.5;
      return {
        position: [x, land.height(x, z), z],
        scale: [s, s, s],
        tint: CANDY[Math.floor(random() * CANDY.length)] ?? new Color(0xffffff),
      } satisfies Placement & { tint: Color };
    }),
  );
  // Four plush bears, one by each corner, looking on
  const bearColors = [0xa8ecc8, 0xc9b6ff, 0xffc7a8, 0xa8d8ff];
  const bears = buildBears(
    [-1, 1].flatMap((sx) =>
      [-1, 1].map((sz, i) => {
        const x = sx * 7000;
        const z = sz * 9200;
        return { x, y: land.height(x, z) - 20, z, facing: Math.atan2(-x, -z), color: bearColors[(sx > 0 ? 2 : 0) + i] ?? 0xffffff, scale: 1.2 };
      }),
    ),
  );
  const sparkles = buildPollen(land, SEED + 2, {
    count: 1200,
    within: 14000,
    beyond: (x, z) => Math.abs(x) > PLAYING_VOLUME.halfX + 300 || Math.abs(z) > PLAYING_VOLUME.halfZ + 300,
    color: 0xffffff,
    size: 30,
    height: 4000,
  });

  root.add(
    sky.mesh,
    buildGround(land, SEED + 3, CANDY_GROUND),
    buildRainbow(new Vector3(0, -600, 22000), 14000, 0),
    buildLollipops(land, SEED + 4, { clusters: 22, perCluster: [3, 7], spread: 1400, minRadius: 8500, maxRadius: 18000, clearance: 400 }),
    buildCottonCandy(land, SEED + 5, { clusters: 26, perCluster: [3, 8], spread: 1500, minRadius: 8500, maxRadius: 19000, clearance: 500 }),
    buildGumdrops(land, SEED + 6, { clusters: 34, perCluster: [4, 10], spread: 900, minRadius: 7600, maxRadius: 15000, clearance: 150 }),
    buildCupcakeHouses(land, SEED + 7, { clusters: 9, perCluster: [2, 4], spread: 1800, minRadius: 9500, maxRadius: 16000, clearance: 900 }),
    buildGifts(land, SEED + 8, { clusters: 20, perCluster: [2, 5], spread: 700, minRadius: 7400, maxRadius: 14000, clearance: 250 }),
    buildCandyCanes(land, SEED + 9, { clusters: 18, perCluster: [2, 5], spread: 900, minRadius: 7500, maxRadius: 16000, clearance: 200 }),
    buildFlowers(land, SEED + 10, { clusters: 36, perCluster: [30, 90], spread: 900, minRadius: 7400, maxRadius: 15000, clearance: 100 }),
    bears.mesh,
    floaters.root,
    balloons.mesh,
    sparkles.points,
  );

  return {
    background: blush,
    fog: new Fog(blush, 9000, 34000),
    style: {
      floor: new Color(0xffc6de),
      floorStripe: new Color(0xffd8e8), // candy stripes
      markings: new Color(0xff5fa2), // (white would vanish on the pink)
      walls: {
        neutral: new Color(0xffffff),
        blue: new Color(0x6fa8ff),
        orange: new Color(0xffa36b),
        lines: 0.25,
        ceilingLines: 0.03,
      },
    },
    root,
    update(seconds) {
      sky.update(seconds);
      for (const clock of [floaters.time, balloons.time, bears.time, sparkles.time]) clock.value = seconds;
    },
  };
}
