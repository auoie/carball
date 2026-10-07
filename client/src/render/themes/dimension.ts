// An upside-down dimension (original designs, in the spirit of the distorted other-worlds that creature-collecting
// adventures sometimes visit): the arena on a floating island in a violet-green void; islands hanging all round at odd
// angles, some upside down with their glowing trees hanging; waterfalls flowing up; stairs, pillars and arches adrift;
// motes rising; a vast rift swirling far off. Its creatures: a serpent winding through the sky, jellies drifting,
// eye-orbs that turn to watch the ball, and critters walking upside down under the inverted islands.
// Generated and seeded like the other themes.
import { AmbientLight, Color, DirectionalLight, Euler, Fog, Group, HemisphereLight, Vector3 } from "three";
import { GHOST_TINTS, buildGhosts } from "./phantoms";
import { seededRandom } from "./random";
import {
  type Island,
  buildDriftingRocks,
  buildFlora,
  buildIslands,
  buildRift,
  buildRisingMotes,
  buildRuins,
  buildSerpent,
  buildUpfalls,
  buildWatchers,
  island,
  onIsland,
} from "./rift";
import type { Placement } from "./shapes";
import { Sky } from "./sky";
import { PLAYING_VOLUME, type Theme } from "./theme";
import { type Home, buildWildlife } from "./wildlife";

const SEED = 20261014;

const outside = (x: number, z: number): number => Math.max(Math.abs(x) - PLAYING_VOLUME.halfX, Math.abs(z) - PLAYING_VOLUME.halfZ);

/** The serpent's way round the arena: a wide, wavering loop through the sky (t: 0..1 a lap). */
function serpentPath(t: number): Vector3 {
  const a = t * Math.PI * 2;
  const r = 15500 + 2500 * Math.sin(a * 3);
  return new Vector3(Math.cos(a) * r, 4600 + 2300 * Math.sin(a * 2 + 1), Math.sin(a) * r * 1.15);
}

export function dimensionTheme(): Theme {
  const random = seededRandom(SEED);
  const voidColor = new Color(0x1c0f2e);

  const root = new Group();
  const riftLight = new DirectionalLight(0xb6a2ff, 1.4);
  riftLight.position.set(0, 7000, 30000);
  root.add(new HemisphereLight(0x8a7cff, 0x1a3a32, 1.7), new AmbientLight(0x5a4a7a, 0.55), riftLight);
  const sky = new Sky({
    zenith: new Color(0x07040f),
    horizon: new Color(0x2a143f),
    sunDirection: new Vector3(0, -1, 0),
    sunStrength: 0,
    radius: 34000,
    clouds: { color: new Color(0x1a4a3e), cover: 0.45 }, // (a green nebula drifting)
  });

  // The arena's own island, its flat top just under the field
  const islands: Island[] = [island(new Vector3(0, -40, 0), new Euler(0, 0, 0), 9200, 7000, true)];
  const upsideDown: Island[] = [];
  for (let tries = 0; islands.length < 28 && tries < 4000; tries++) {
    const a = random() * Math.PI * 2;
    const d = 10500 + random() * 12000;
    const radius = 700 + random() * 2000;
    const at = new Vector3(Math.cos(a) * d, -3500 + random() * 9500, Math.sin(a) * d * 1.15);
    if (islands.some((o) => o.position.distanceTo(at) < o.radius + radius + 900)) continue;
    const kind = random();
    // Upright (a little tilted), strongly tilted, or upside down
    const rotation =
      kind < 0.4
        ? new Euler((random() - 0.5) * 0.5, random() * Math.PI * 2, (random() - 0.5) * 0.5)
        : kind < 0.7
          ? new Euler((random() - 0.5) * 2.2, random() * Math.PI * 2, (random() - 0.5) * 1.6)
          : new Euler(Math.PI + (random() - 0.5) * 0.4, random() * Math.PI * 2, (random() - 0.5) * 0.3);
    const made = island(at, rotation, radius, radius * (1.2 + random() * 0.8));
    islands.push(made);
    if (kind >= 0.7) upsideDown.push(made);
  }
  const floating = islands.slice(1);

  // Waterfalls flowing up off the rims of the upright islands
  const falls = floating
    .filter((i) => Math.abs(i.rotation.x) < 0.3 && Math.abs(i.rotation.z) < 0.3)
    .slice(0, 10)
    .map((i) => ({ at: onIsland(i, random() * Math.PI * 2, 0.97, -20), height: 2500 + random() * 3000, width: 260 + random() * 200 }));

  const ruins = Array.from({ length: 15 }, () => {
    for (;;) {
      const a = random() * Math.PI * 2;
      const d = 8000 + random() * 9000;
      const at = new Vector3(Math.cos(a) * d, 300 + random() * 5000, Math.sin(a) * d * 1.15);
      if (islands.every((o) => o.position.distanceTo(at) > o.radius + 1400)) {
        return { at, rotation: new Euler(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2) };
      }
    }
  });
  const rocks = Array.from({ length: 80 }, () => {
    const a = random() * Math.PI * 2;
    const d = 7500 + random() * 15000;
    return { at: new Vector3(Math.cos(a) * d, -2500 + random() * 9000, Math.sin(a) * d * 1.15), size: 50 + random() * 230 };
  });

  // Creatures: the serpent, jellies, eye-orbs, and critters walking upside down
  const serpent = buildSerpent(serpentPath, 90, 0.14, 150);
  const near = (min: number, max: number, low: number, high: number): Vector3 => {
    for (;;) {
      const x = (random() * 2 - 1) * (PLAYING_VOLUME.halfX + max);
      const z = (random() * 2 - 1) * (PLAYING_VOLUME.halfZ + max);
      if (outside(x, z) >= min && outside(x, z) <= max) return new Vector3(x, low + random() * (high - low), z);
    }
  };
  const watchers = buildWatchers(Array.from({ length: 22 }, () => near(1400, 8000, 300, 3200)), SEED + 3);
  const jellyTints = [0x9ff7e6, 0xd9b8ff, 0xffb8e6, 0xb8d8ff].map((c) => new Color(c));
  const jellies = buildGhosts(
    "jelly",
    Array.from({ length: 40 }, (): Placement & { tint: Color } => {
      const at = near(1400, 9000, 400, 4500);
      const s = 1.2 + random() * 1.2;
      return {
        position: [at.x, at.y, at.z],
        scale: [s, s, s],
        tint: jellyTints[Math.floor(random() * jellyTints.length)] ?? GHOST_TINTS[0] ?? new Color(0xffffff),
      };
    }),
  );
  const critterHomes: Home[] = upsideDown.flatMap((i) =>
    Array.from({ length: Math.max(1, Math.round(i.radius / 500)) }, () => {
      const at = onIsland(i, random() * Math.PI * 2, random() * 0.55);
      return { x: at.x, y: at.y, z: at.z, scale: 1.3, rotation: [i.rotation.x, i.rotation.y, i.rotation.z] as const };
    }),
  );
  const critters = buildWildlife(SEED + 4, { ground: critterHomes, air: [] });

  const upfalls = buildUpfalls(falls);
  const drifting = buildDriftingRocks(rocks);
  const rift = buildRift(new Vector3(0, 7500, 31000), 9500);
  const motes = buildRisingMotes(1200, SEED + 5, (x, z) => outside(x, z) < 300);

  root.add(
    sky.mesh,
    rift.mesh,
    buildIslands(islands, SEED + 1),
    buildFlora(floating, SEED + 2),
    upfalls.mesh,
    buildRuins(ruins, SEED + 6),
    drifting.mesh,
    motes.points,
    serpent.root,
    watchers.root,
    jellies.mesh,
    critters.root,
  );

  return {
    background: voidColor,
    fog: new Fog(voidColor, 6000, 40000),
    style: {
      floor: new Color(0x2c2c48),
      floorStripe: new Color(0x32324f),
      markings: new Color(0x8ff5d8), // glowing teal
      walls: {
        neutral: new Color(0xb48cff),
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
        lines: 0.26,
        ceilingLines: 0.04,
      },
    },
    root,
    update(seconds, ball) {
      sky.update(seconds);
      for (const clock of [upfalls.time, drifting.time, rift.time, motes.time, jellies.time]) clock.value = seconds;
      serpent.update(seconds);
      watchers.update(seconds, ball);
      critters.update(seconds);
    },
  };
}
