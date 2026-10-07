// A crystal crater at dusk (original designs, in the spirit of the crystal-studded craters and caves of
// creature-collecting adventures): the arena on the floor of a vast crater, its walls rising steeply all round in
// strata; giant glowing crystals jutting from the walls and floor; a colossal crystal, the heart of the impact, glowing
// beyond the orange goal with light rising from it; a glowing pool; a research station on the rim; stars. Its
// creatures: a colossal crystal tortoise resting on a ledge, little ones walking the floor, glimmer sprites drifting,
// gem moths, floating lights. Generated and seeded like the other themes.
import { AmbientLight, Color, DirectionalLight, Fog, Group, HemisphereLight, Vector3 } from "three";
import {
  CRYSTAL_COLORS,
  type Formation,
  buildColossus,
  buildCraterGround,
  buildCrystals,
  buildHeartCrystal,
  buildStars,
  buildStation,
  littleTortoise,
} from "./geode";
import { type Land, landscape, smoothstep } from "./nature";
import { buildGhosts } from "./phantoms";
import { seededRandom } from "./random";
import { buildUpfalls } from "./rift";
import type { Placement } from "./shapes";
import { Sky } from "./sky";
import { buildGlows, buildWisps } from "./spooky";
import { PLAYING_VOLUME, type Theme } from "./theme";
import { type Home, buildWildlife, walkers } from "./wildlife";

const SEED = 20261016;
const FLAT = { halfX: 6500, halfZ: 8500, radius: 2500 };
const POOL = { x: 6200, z: -6000, radius: 1300 };
/** The colossus's ledge on the crater wall: where, and how wide */
const LEDGE = { x: -10200, z: 3500, radius: 2300 };

const outside = (x: number, z: number): number => Math.max(Math.abs(x) - PLAYING_VOLUME.halfX, Math.abs(z) - PLAYING_VOLUME.halfZ);
/** Clear of the pool by `margin`. */
const offPool = (x: number, z: number, margin: number): boolean => Math.hypot(x - POOL.x, z - POOL.z) > POOL.radius + margin;

function craterLand(seed: number): Land {
  const base = landscape(seed, {
    flat: FLAT,
    pond: POOL,
    path: () => Infinity,
    // Walls rising steeply from the floor to a rim, the land beyond falling away
    hills: { low: 3400, high: 4700, rise: 5200, horizon: -1800 },
  });
  // A level ledge cut into the wall for the colossus, blending back into the slope round its edge
  const ledgeY = base.height(LEDGE.x, LEDGE.z);
  const height = (x: number, z: number): number => {
    const t = smoothstep(LEDGE.radius, LEDGE.radius + 1100, Math.hypot(x - LEDGE.x, z - LEDGE.z));
    return ledgeY + (base.height(x, z) - ledgeY) * t;
  };
  return { ...base, height };
}

/** The ground's slope at (x, z): its normal, from the heights round about. */
function groundNormal(land: Land, x: number, z: number): Vector3 {
  const d = 120;
  return new Vector3(land.height(x - d, z) - land.height(x + d, z), 2 * d, land.height(x, z - d) - land.height(x, z + d)).normalize();
}

export function craterTheme(): Theme {
  const land = craterLand(SEED);
  const random = seededRandom(SEED + 1);
  const dusk = new Color(0x2a1f44);

  const root = new Group();
  const moonlight = new DirectionalLight(0xc8c0ff, 1.0);
  moonlight.position.set(-6000, 9000, -4000);
  root.add(new HemisphereLight(0x8a7acc, 0x241a30, 1.5), new AmbientLight(0x6a5a90, 0.5), moonlight);
  const sky = new Sky({
    zenith: new Color(0x0c0820),
    horizon: new Color(0x4a3466),
    sunDirection: new Vector3(0, -1, 0),
    sunStrength: 0,
    radius: 32000,
    clouds: { color: new Color(0x3a2c58), cover: 0.35 },
  });

  // Crystal formations: big ones on the walls, leaning out of the slope towards the sky; smaller ones on the floor
  const pick = (): Color => CRYSTAL_COLORS[Math.floor(random() * CRYSTAL_COLORS.length)] ?? new Color(0xffffff);
  const formations: Formation[] = [];
  for (let tries = 0; formations.length < 42 && tries < 6000; tries++) {
    const x = (random() * 2 - 1) * 17000;
    const z = (random() * 2 - 1) * 19000;
    const onWall = land.flatDistance(x, z);
    // (up the walls, not at their feet: the walls themselves should show)
    if (onWall < 1300 || onWall > 5200 || !offPool(x, z, 600)) continue;
    const up = groundNormal(land, x, z).lerp(new Vector3(0, 1, 0), 0.45).normalize();
    formations.push({ at: new Vector3(x, land.height(x, z), z), up, size: 0.8 + random() * 1.3 + onWall / 5000, color: pick() });
  }
  for (let tries = 0; formations.length < 66 && tries < 6000; tries++) {
    const x = (random() * 2 - 1) * 9000;
    const z = (random() * 2 - 1) * 11000;
    if (outside(x, z) < 1500 || land.flatDistance(x, z) > 300 || !offPool(x, z, 400)) continue;
    formations.push({ at: new Vector3(x, land.height(x, z), z), up: new Vector3((random() - 0.5) * 0.4, 1, (random() - 0.5) * 0.4).normalize(), size: 0.5 + random() * 0.9, color: pick() });
  }

  // The heart of the impact, on the far wall beyond the orange goal, and light rising from it
  const heartAt = new Vector3(0, 0, 14500);
  heartAt.y = land.height(heartAt.x, heartAt.z);
  const heartColor = new Color(0xc9a2ff);
  const heart = buildHeartCrystal(heartAt, 5200, heartColor);
  const pillars = buildUpfalls(
    [
      { at: heartAt.clone().setY(heartAt.y + 1200), height: 9000, width: 1500 },
      { at: heartAt.clone().add(new Vector3(-1400, 900, -300)), height: 6500, width: 700 },
      { at: heartAt.clone().add(new Vector3(1300, 900, 200)), height: 7000, width: 800 },
    ],
    new Color(0.75, 0.6, 1),
  );

  // The station on the rim beyond the blue goal, facing the crater
  const stationAt = new Vector3(2500, 0, -15600);
  stationAt.y = land.height(stationAt.x, stationAt.z) - 20;
  const station = buildStation(stationAt, 0);

  // Creatures
  // At the front of its ledge, looking out over the crater (its front feet near the lip)
  const toArena = new Vector3(-LEDGE.x, 0, -LEDGE.z).normalize();
  const colossusAt = new Vector3(LEDGE.x, 0, LEDGE.z).addScaledVector(toArena, LEDGE.radius - 1300);
  colossusAt.y = land.height(colossusAt.x, colossusAt.z) - 20;
  const colossus = buildColossus(colossusAt, Math.atan2(-colossusAt.x, -colossusAt.z), 1300);
  const tortoiseHomes: Home[] = [];
  for (let tries = 0; tortoiseHomes.length < 22 && tries < 4000; tries++) {
    const x = (random() * 2 - 1) * 10000;
    const z = (random() * 2 - 1) * 12000;
    if (outside(x, z) < 900 || land.flatDistance(x, z) > 200 || !offPool(x, z, 300)) continue;
    tortoiseHomes.push({ x, y: land.height(x, z), z, scale: 1.2 + random() * 0.5 });
  }
  const tortoises = walkers(littleTortoise(), tortoiseHomes, 0.03, 160, "transformed.y += abs(sin(time * 2.5 + wanderSeed() * 20.0)) * 3.0;");
  tortoises.mesh.name = "wildlife: tortoise";
  const sprites = buildGhosts(
    "crystal",
    Array.from({ length: 28 }, (): Placement & { tint: Color } => {
      for (;;) {
        const x = (random() * 2 - 1) * 12000;
        const z = (random() * 2 - 1) * 14000;
        if (outside(x, z) < 1300 || outside(x, z) > 7500) continue;
        const s = 1.3 + random() * 0.6;
        return { position: [x, land.height(x, z) + 400 + random() * 1500, z], scale: [s, s, s], tint: pick().clone().lerp(new Color(1, 1, 1), 0.4) };
      }
    }),
  );
  const moths = buildWildlife(
    SEED + 2,
    {
      ground: [],
      air: Array.from({ length: 34 }, (): Home => {
        for (;;) {
          const x = (random() * 2 - 1) * 9500;
          const z = (random() * 2 - 1) * 11500;
          if (outside(x, z) < 900 || outside(x, z) > 3500) continue;
          return { x, y: land.height(x, z) + 150 + random() * 350, z, scale: 1.5 };
        }
      }),
    },
    [0xb47cff, 0x5fe8ff, 0xff7ac8, 0x7cffc4],
  );

  // Lights: a glow round every crystal, the station's windows, floating orbs
  const glows = buildGlows([
    ...formations.map((f) => {
      const top = f.at.clone().addScaledVector(f.up, 500 * f.size);
      return { x: top.x, y: top.y, z: top.z, size: 650 * f.size, color: f.color, flicker: 0.06 };
    }),
    { x: heartAt.x, y: heartAt.y + 3200, z: heartAt.z, size: 15000, color: heartColor, flicker: 0.04 },
    // The crystals on the colossus's shell
    { x: colossusAt.x, y: colossusAt.y + 1.25 * 1300, z: colossusAt.z, size: 3800, color: new Color(0xc8a0ff), flicker: 0.05 },
    ...station.lights.map((l) => ({ x: l.x, y: l.y, z: l.z, size: 450, color: new Color(0x8ff0ff), flicker: 0.05 })),
  ]);
  const floaters = Array.from({ length: 50 }, (): [number, number, number] => {
    for (;;) {
      const x = (random() * 2 - 1) * 13000;
      const z = (random() * 2 - 1) * 15000;
      if (outside(x, z) > 1200) return [x, land.height(x, z) + 300 + random() * 2200, z];
    }
  });
  const orbs = [buildWisps(floaters.slice(0, 25), new Color(0.6, 0.45, 1)), buildWisps(floaters.slice(25), new Color(0.35, 0.95, 1))];

  root.add(
    sky.mesh,
    buildStars(SEED + 3, 1600, 29000),
    buildCraterGround(land, SEED + 4, POOL),
    buildCrystals(formations),
    heart,
    pillars.mesh,
    station.root,
    colossus.root,
    tortoises.mesh,
    sprites.mesh,
    moths.root,
    glows.mesh,
    ...orbs.map((o) => o.mesh),
  );

  return {
    background: dusk,
    fog: new Fog(dusk, 5000, 32000),
    style: {
      floor: new Color(0x433c5c),
      floorStripe: new Color(0x494262),
      markings: new Color(0xc8f4ff), // glowing pale cyan
      walls: {
        neutral: new Color(0xd8c8ff),
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
        lines: 0.26,
        ceilingLines: 0.04,
      },
    },
    root,
    update(seconds) {
      sky.update(seconds);
      for (const clock of [pillars.time, colossus.time, tortoises.time, sprites.time, glows.time, ...orbs.map((o) => o.time)]) {
        clock.value = seconds;
      }
      moths.update(seconds);
      station.update(seconds);
    },
  };
}
