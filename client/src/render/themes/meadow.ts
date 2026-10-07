// A sunny countryside stadium in the spirit of creature-collecting adventure games (all original designs): bright
// sky with drifting clouds, rolling green hills with tall grass, flowers, puffy trees and a pond, snowy mountains on
// the horizon, colourful open-air stands full of little creatures who cheer when the ball comes their way, and birds
// circling overhead. Everything is generated here (no downloads), seeded, and drawn in about twenty draw calls.
import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  type InstancedMesh,
  MeshLambertMaterial,
  Vector3,
} from "three";
import { buildCrowd } from "./critters";
import { buildFlowers, buildGround, buildMountains, buildRocks, buildTallGrass, buildTrees, meadowLand } from "./nature";
import { seededRandom } from "./random";
import { type Placement, animate, instances, placementMatrix } from "./shapes";
import { Sky } from "./sky";
import { buildStands } from "./stands";
import type { Theme } from "./theme";

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
  const birds = buildBirds(SEED + 8);
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
    update(seconds, ball) {
      sky.update(seconds);
      grass.time.value = seconds;
      crowd.update(seconds, ball);
      birds.update(seconds);
    },
  };
}

/** A flock circling high over the stadium, flapping. */
function buildBirds(seed: number): { mesh: InstancedMesh; update(seconds: number): void } {
  const random = seededRandom(seed);
  const bird = new BufferGeometry();
  // Two wings (spanning x) and a little body, flying along +z
  bird.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 18, -70, 0, -10, 0, 4, -14, 0, 0, 18, 0, 4, -14, 70, 0, -10, 0, -6, 22, 0, 6, -30, 0, -6, -30], 3),
  );
  bird.computeVertexNormals();
  bird.setAttribute("color", new Float32BufferAttribute(new Array<number>(27).fill(0.95), 3));
  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const uniforms = animate(
    material,
    "transformed.y += abs(position.x) * 0.75 * sin(time * 9.0 + float(gl_InstanceID) * 1.37);",
    "",
    {},
  );
  const flock = Array.from({ length: 26 }, () => ({
    radius: 5500 + random() * 4500,
    height: 3300 + random() * 1200,
    speed: (0.05 + random() * 0.04) * (random() < 0.3 ? -1 : 1),
    phase: random() * Math.PI * 2,
    bob: random() * Math.PI * 2,
  }));
  const placements = flock.map((): Placement => ({}));
  const mesh = instances(bird, material, placements);
  const update = (seconds: number): void => {
    flock.forEach((b, i) => {
      const a = b.phase + seconds * b.speed;
      const x = Math.cos(a) * b.radius;
      const z = Math.sin(a) * b.radius * 1.2;
      const y = b.height + Math.sin(seconds * 0.7 + b.bob) * 150;
      // Heading along the circle (the sign of the speed sets the direction)
      const heading = -a + (b.speed < 0 ? Math.PI : 0);
      mesh.setMatrixAt(i, placementMatrix({ position: [x, y, z], rotation: [0, heading, 0], scale: [1.4, 1.4, 1.4] }));
    });
    mesh.instanceMatrix.needsUpdate = true;
    uniforms.time.value = seconds;
  };
  update(0);
  return { mesh, update };
}
