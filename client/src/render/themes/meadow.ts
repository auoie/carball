// A sunny countryside stadium in the spirit of creature-collecting adventure games (all original designs): bright
// sky with drifting clouds, rolling green hills with tall grass, flowers, puffy trees and a pond, snowy mountains on
// the horizon, colourful open-air stands full of little creatures, and birds circling overhead. Everything is
// generated here (no downloads), seeded, and drawn in about twenty draw calls.
import { AmbientLight, Color, DirectionalLight, Fog, Group, HemisphereLight, Vector3 } from "three";
import { buildCrowd } from "./critters";
import { buildFlowers, buildGround, buildMountains, buildRocks, buildTallGrass, buildTrees, meadowLand } from "./nature";
import { Sky } from "./sky";
import { buildStands } from "./stands";
import type { Theme } from "./theme";
import { buildBirds } from "./wildlife";

const SEED = 20261006;

export function meadowTheme(): Theme {
  const land = meadowLand(SEED);
  const horizon = new Color(0xcfe7fb);
  const sunDirection = new Vector3(0.5, 0.72, 0.42).normalize();

  const root = new Group();
  const sun = new DirectionalLight(0xfff0d6, 2.6);
  sun.position.copy(sunDirection).multiplyScalar(10000);
  root.add(new HemisphereLight(0xcfe8ff, 0x6f9c4a, 1.5), new AmbientLight(0xffffff, 0.15), sun);

  const sky = new Sky({ zenith: new Color(0x3f93e6), horizon, sunDirection, radius: 30000 });
  const grass = buildTallGrass(land, SEED + 2);
  const stands = buildStands(SEED + 6);
  const crowd = buildCrowd(stands.seats, SEED + 7);
  const birds = buildBirds(SEED + 8, { radius: [5500, 10000], height: [3300, 4500] });
  root.add(
    sky.mesh,
    buildGround(land, SEED + 1),
    buildMountains(SEED + 5),
    buildTrees(land, SEED + 3),
    grass.mesh,
    buildFlowers(land, SEED + 4),
    buildRocks(land, SEED + 9),
    stands.mesh,
    crowd.root,
    birds.mesh,
  );

  return {
    background: horizon,
    fog: new Fog(horizon, 9000, 33000),
    style: {
      floor: new Color(0x55a845),
      floorStripe: new Color(0x63b853),
      walls: {
        neutral: new Color(0xf2f8ff),
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
        lines: 0.22,
        ceilingLines: 0.03, // (the sky shows through)
      },
    },
    root,
    update(seconds) {
      sky.update(seconds);
      grass.time.value = seconds;
      crowd.update(seconds);
      birds.update(seconds);
    },
  };
}
