// A bright, blocky platformer world (original designs, in the spirit of classic side-scrolling platform games): a
// blue sky with chunky clouds, green hills with striped bump-hills behind, floating rows of brick and golden blocks,
// grass-topped floating platforms with arcs of spinning coins, block staircases, pipes of every colour, puffy trees,
// and a sandy path out to a little castle with a flagpole. Generated and seeded like the other themes.
import { AmbientLight, Color, DirectionalLight, Fog, Group, HemisphereLight, Vector3 } from "three";
import { BLOCK, type BlockKind, buildBlocks, buildBumpHills, buildCastle, buildClouds, buildCoins, buildPipes } from "./blocks";
import { type GroundPalette, type Land, buildFlowers, buildGround, buildTrees, free, landscape } from "./nature";
import { seededRandom } from "./random";
import type { Placement } from "./shapes";
import { Sky } from "./sky";
import { PLAYING_VOLUME, type Theme } from "./theme";
import { buildBushes } from "./woods";

const SEED = 20261011;

const PLATFORMER_GROUND: GroundPalette = {
  grassDark: 0x4cbf3c,
  grassLight: 0x7ad85a,
  field: 0x5cc84a,
  dirt: 0xe0b070, // the sandy path to the castle
  sand: 0xf2dc9a,
  water: 0x3fa8ff,
};

function platformerLand(seed: number): Land {
  const flat = { halfX: 5600, halfZ: 7600, radius: 1400 };
  return landscape(seed, {
    flat,
    pond: { x: -10500, z: -4000, radius: 1800 },
    path: (x, z) => (z < flat.halfZ - 500 ? Infinity : Math.abs(x - 900 * Math.sin((z - flat.halfZ) / 3000))),
    hills: { low: 200, high: 1300, rise: 4000, horizon: 1600 },
  });
}

/** How far outside the playing area a point is (negative inside), in x/z. */
const outside = (x: number, z: number): number => Math.max(Math.abs(x) - PLAYING_VOLUME.halfX, Math.abs(z) - PLAYING_VOLUME.halfZ);

export function platformerTheme(): Theme {
  const land = platformerLand(SEED);
  const random = seededRandom(SEED + 1);
  const skyBlue = new Color(0xa8d4ff);
  const sunDirection = new Vector3(0.45, 0.8, 0.3).normalize();

  const root = new Group();
  const sun = new DirectionalLight(0xfff6e0, 2.4);
  sun.position.copy(sunDirection).multiplyScalar(10000);
  root.add(new HemisphereLight(0xdff2ff, 0x6fbf4a, 1.5), new AmbientLight(0xffffff, 0.2), sun);
  const sky = new Sky({
    zenith: new Color(0x4a8cff),
    horizon: skyBlue,
    sunDirection,
    sunStrength: 0.7,
    radius: 30000,
    clouds: { color: new Color(0xffffff), cover: 0.35 },
  });

  /** A random point around the arena, `min` to `max` outside the playing area. */
  const around = (min: number, max: number): [number, number] => {
    for (;;) {
      const x = (random() * 2 - 1) * (PLAYING_VOLUME.halfX + max);
      const z = (random() * 2 - 1) * (PLAYING_VOLUME.halfZ + max);
      const out = outside(x, z);
      if (out >= min && out <= max && Math.hypot(x - land.pond.x, z - land.pond.z) > land.pond.radius + 600) return [x, z];
    }
  };

  const blocks: Record<BlockKind, [number, number, number][]> = { brick: [], gold: [], platform: [] };
  const coins: [number, number, number][] = [];
  const pipes: { x: number; y: number; z: number; height: number; color: number; radius: number }[] = [];
  const pipeColors = [0x3fbf4a, 0x2f8f3a, 0x3f7fe0, 0xf08a2a, 0xd84a4a];
  const pipeColor = (): number => pipeColors[Math.floor(random() * pipeColors.length)] ?? 0x3fbf4a;

  // A row of blocks from (x, z) along x or z (whichever runs round the arena), `count` long, at height y
  const row = (x: number, z: number, y: number, count: number, kind: (i: number) => BlockKind): [number, number][] => {
    const alongX = Math.abs(z) / PLAYING_VOLUME.halfZ > Math.abs(x) / PLAYING_VOLUME.halfX;
    const cells: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      const bx = alongX ? x + (i - count / 2) * BLOCK : x;
      const bz = alongX ? z : z + (i - count / 2) * BLOCK;
      blocks[kind(i)].push([bx, y, bz]);
      cells.push([bx, bz]);
    }
    return cells;
  };

  // Giant pipes further out (the floating things keep clear of them)
  const giants = [[-9500, 9000], [10500, 5500], [8500, -11500]] as const;
  const clearOfGiants = (x: number, z: number): boolean => giants.every(([gx, gz]) => Math.hypot(x - gx, z - gz) > 2200);
  // Floating rows of bricks, a golden block here and there, a coin over each golden one
  for (let n = 0; n < 26; n++) {
    const [x, z] = around(1600, 9000);
    if (!clearOfGiants(x, z)) continue;
    const y = land.height(x, z) + 1400 + random() * 2800;
    const golden = new Set([Math.floor(random() * 8), Math.floor(random() * 8)]);
    row(x, z, y, 3 + Math.floor(random() * 6), (i) => (golden.has(i) ? "gold" : "brick")).forEach(([bx, bz], i) => {
      if (golden.has(i)) coins.push([bx, y + BLOCK * 1.6, bz]);
    });
  }
  // Grass-topped floating platforms, an arc of coins over each, and now and then a pipe on top
  for (let n = 0; n < 16; n++) {
    const [x, z] = around(1800, 9500);
    if (!clearOfGiants(x, z)) continue;
    const y = land.height(x, z) + 1100 + random() * 2900;
    const cells = row(x, z, y, 4 + Math.floor(random() * 6), () => "platform");
    cells.forEach(([bx, bz], i) => {
      const t = cells.length > 1 ? i / (cells.length - 1) : 0.5;
      coins.push([bx, y + BLOCK * 1.4 + Math.sin(t * Math.PI) * 450, bz]);
    });
    const middle = cells[Math.floor(cells.length / 2)];
    if (middle && random() < 0.35) {
      pipes.push({ x: middle[0], y: y + BLOCK / 2, z: middle[1], height: 200 + random() * 200, color: pipeColor(), radius: 150 });
    }
  }
  // Staircases on the ground near the arena: a block more each step
  for (let n = 0; n < 6; n++) {
    const [x, z] = around(1300, 4000);
    if (!free(land, x, z, 300)) continue;
    const ground = land.height(x, z);
    const steps = 4 + Math.floor(random() * 3);
    const alongX = Math.abs(z) / PLAYING_VOLUME.halfZ > Math.abs(x) / PLAYING_VOLUME.halfX;
    for (let s = 0; s < steps; s++) {
      for (let h = 0; h <= s; h++) {
        const bx = alongX ? x + s * BLOCK : x;
        const bz = alongX ? z : z + s * BLOCK;
        blocks.brick.push([bx, ground + BLOCK / 2 + h * BLOCK, bz]);
      }
    }
  }
  // Pipes of every colour round about, and a couple of giant ones further out
  for (let n = 0; n < 26; n++) {
    const [x, z] = around(1000, 8000);
    if (!free(land, x, z, 200)) continue;
    pipes.push({ x, y: land.height(x, z) - 20, z, height: 250 + random() * 1200, color: pipeColor(), radius: 220 + random() * 100 });
  }
  for (const [x, z] of giants) {
    pipes.push({ x, y: land.height(x, z) - 40, z, height: 3000 + random() * 1500, color: pipeColor(), radius: 650 });
  }
  // Bump-hills in the background
  const hillColors = [0x4fc04a, 0x3fae3a, 0x6fd45a];
  const hills = Array.from({ length: 14 }, (_, i) => {
    // (none straight ahead past the orange end, where the path leads to the castle)
    const angle = Math.PI / 2 + 0.45 + (i / 14) * (Math.PI * 2 - 0.9) + random() * 0.2;
    const distance = 14000 + random() * 8000;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    return {
      x,
      y: land.height(x, z),
      z,
      radius: 1500 + random() * 2700,
      height: 1200 + random() * 2600,
      color: hillColors[i % hillColors.length] ?? 0x4fc04a,
    };
  });
  const clouds = buildClouds(
    Array.from({ length: 26 }, (): Placement => {
      const angle = random() * Math.PI * 2;
      const distance = 7000 + random() * 15000;
      const s = 0.8 + random() * 0.9;
      return { position: [Math.cos(angle) * distance, 5500 + random() * 3500, Math.sin(angle) * distance], scale: [s * 1.3, s, s] };
    }),
  );
  const coinMesh = buildCoins(coins);
  const castleZ = 16500;
  const castleX = 900 * Math.sin((castleZ - 7600) / 3000);

  root.add(
    sky.mesh,
    buildGround(land, SEED + 2, PLATFORMER_GROUND),
    buildBumpHills(hills),
    buildTrees(land, SEED + 3),
    buildBushes(land, SEED + 4, { clusters: 30, perCluster: [2, 6], spread: 900, minRadius: 7400, maxRadius: 15000, clearance: 300 }),
    buildFlowers(land, SEED + 5, { clusters: 28, perCluster: [30, 80], spread: 800, minRadius: 7400, maxRadius: 14000, clearance: 100 }),
    buildBlocks(blocks),
    buildPipes(pipes),
    coinMesh.mesh,
    clouds.mesh,
    buildCastle(castleX, land.height(castleX, castleZ) - 20, castleZ, Math.PI), // facing the arena
  );

  return {
    background: skyBlue,
    fog: new Fog(skyBlue, 10000, 36000),
    style: {
      floor: new Color(0x58c24a),
      floorStripe: new Color(0x4fb442),
      markings: null,
      walls: {
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
      },
    },
    root,
    update(elapsedSeconds) {
      sky.update(elapsedSeconds);
      coinMesh.time.value = elapsedSeconds;
      clouds.time.value = elapsedSeconds;
    },
  };
}
