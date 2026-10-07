// A haunted mountain at twilight (original designs, in the spirit of the ghost-haunted mountain graveyards and tower
// cemeteries of creature-collecting adventures): the arena on a plateau, the slopes rising round it in terraces lined
// with rows of graves and stone lanterns burning with ghostly blue-violet flames; a stone stairway through a gate up
// to a tall, many-tiered shrine tower on the summit, a pale moon rising behind it; thick violet mist, will-o'-wisps,
// bare trees, crows round the summit; and ghosts, drifting, circling the tower, peeking from behind graves, fading in
// and out of sight. Generated and seeded like the other themes.
import {
  AmbientLight,
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import { GROUND_LEVEL, type Land, free, landscape, smoothstep } from "./nature";
import { GHOST_TINTS, buildGhosts } from "./phantoms";
import { fractalNoise, seededRandom, valueNoise } from "./random";
import { type Placement, combine, part } from "./shapes";
import { Sky } from "./sky";
import {
  type Spot,
  buildBats,
  buildDeadTrees,
  buildFogBanks,
  buildGlows,
  buildGraves,
  buildMoon,
  buildWisps,
} from "./spooky";
import { PLAYING_VOLUME, type Theme } from "./theme";
import { buildPollen } from "./woods";

const SEED = 20261013;
const FLAT = { halfX: 5000, halfZ: 7000, radius: 1200 };
/** The shrine on the summit, beyond the orange end (Three.js frame) */
const SHRINE = { x: 0, z: 16500 };
/** The terraces' height (uu) */
const STEP = 240;

/** The stairway's centre line, from behind the orange goal up to the shrine. */
const stairX = (z: number): number => 500 * Math.sin((z - FLAT.halfZ) / 3000) * Math.min(1, (SHRINE.z - z) / 3000);

function mountain(seed: number): Land {
  const base = landscape(seed, {
    flat: FLAT,
    pond: { x: -12500, z: -7000, radius: 1300 },
    path: (x, z) => (z < FLAT.halfZ - 500 || z > SHRINE.z - 1200 ? Infinity : Math.abs(x - stairX(z))),
    hills: { low: 400, high: 1700, rise: 4500, horizon: 2600 },
  });
  const height = (x: number, z: number): number => {
    let h = base.height(x, z) - GROUND_LEVEL;
    // The summit, rising behind the orange end
    const toSummit = Math.hypot(x - SHRINE.x, z - SHRINE.z);
    h += 3600 * Math.exp(-(toSummit * toSummit) / (2 * 5000 * 5000)) * smoothstep(0, 3500, base.flatDistance(x, z));
    // Terraces: flat steps with short, steep risers between
    const t = h / STEP;
    const k = Math.floor(t);
    h = (k + smoothstep(0.8, 1, t - k)) * STEP;
    return GROUND_LEVEL + h;
  };
  return { ...base, height };
}

/** The mountainside: mossy terraces, stone risers, the stairway; finer near the arena, where the terraces are. */
function buildTerraces(land: Land, seed: number): Mesh {
  const noise = valueNoise(seed);
  const geometry = new PlaneGeometry(64000, 64000, 330, 330);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) position.setY(i, land.height(position.getX(i), position.getZ(i)));
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute("normal");
  const colors = new Float32Array(position.count * 3);
  const mossDark = new Color(0x2c3328);
  const mossLight = new Color(0x48503d);
  const stone = new Color(0x5a5566);
  const stair = new Color(0x6b6574);
  const field = new Color(0x343a2e);
  const color = new Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    color.copy(mossDark).lerp(mossLight, fractalNoise(noise, x / 2200, z / 2200, 3) * 0.5 + 0.5);
    color.lerp(stone, smoothstep(0.92, 0.75, normal.getY(i))); // the risers
    color.lerp(field, 1 - smoothstep(-800, 400, land.flatDistance(x, z)));
    color.lerp(stair, 1 - smoothstep(260, 340, land.pathDistance(x, z)));
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

/** On a terrace's flat (not its riser, the stairway or a slope too steep). */
function onTerrace(land: Land, x: number, z: number): boolean {
  const h = land.height(x, z);
  return [
    [70, 0],
    [-70, 0],
    [0, 70],
    [0, -70],
  ].every(([dx = 0, dz = 0]) => Math.abs(land.height(x + dx, z + dz) - h) < 8);
}

const outside = (x: number, z: number): number => Math.max(Math.abs(x) - PLAYING_VOLUME.halfX, Math.abs(z) - PLAYING_VOLUME.halfZ);
/** The way to face the arena from (x, z) (a rotation about y turning +z towards it). */
const towardArena = (x: number, z: number): number => Math.atan2(-x, -z);

/** A stone lantern: a stepped base, a post, the firebox (its light is a glow), a wide cap and a knob. */
function lanternParts(s: Spot): BufferGeometry[] {
  const at = (dy: number): [number, number, number] => [s.x, s.y + dy, s.z];
  const grey = 0x77727e;
  return [
    part(new BoxGeometry(150, 40, 150), 0x625e6b, { position: at(20) }),
    part(new CylinderGeometry(28, 34, 200, 8), grey, { position: at(140) }),
    part(new BoxGeometry(110, 90, 110), grey, { position: at(285), rotation: [0, s.facing, 0] }),
    part(new ConeGeometry(115, 70, 4), 0x5a5664, { position: at(365), rotation: [0, s.facing + Math.PI / 4, 0] }),
    part(new SphereGeometry(16, 6, 4), grey, { position: at(410) }),
  ];
}

/** The shrine tower: a stone platform and five tiers, each under a wide roof, lit windows, and a spire; facing the
 *  arena. Returns the stone and the windows (unlit, glowing), and where its lights are. */
function shrineParts(s: Spot): { stone: BufferGeometry[]; windows: BufferGeometry[]; lights: Vector3[] } {
  const at = (dx: number, dy: number, dz: number): [number, number, number] => [
    s.x + dx * Math.cos(s.facing) + dz * Math.sin(s.facing),
    s.y + dy,
    s.z - dx * Math.sin(s.facing) + dz * Math.cos(s.facing),
  ];
  const stone: BufferGeometry[] = [part(new BoxGeometry(3000, 300, 3000), 0x4a4556, { position: at(0, 150, 0), rotation: [0, s.facing, 0] })];
  const windows: BufferGeometry[] = [];
  const lights: Vector3[] = [];
  let y = 300;
  for (let tier = 0; tier < 5; tier++) {
    const w = 1700 - tier * 260;
    const h = tier === 0 ? 900 : 700;
    stone.push(part(new BoxGeometry(w, h, w), 0x3a3448, { position: at(0, y + h / 2, 0), rotation: [0, s.facing, 0] }));
    // A wide, flat roof on each tier
    stone.push(part(new ConeGeometry(w * 0.82, 260, 4), 0x231d2c, { position: at(0, y + h + 110, 0), rotation: [0, s.facing + Math.PI / 4, 0] }));
    // Windows, a pair on the front and on each side, glowing violet
    for (const dx of [-w * 0.22, w * 0.22]) {
      for (const face of [0, 1, 2]) {
        const rot = s.facing + (face - 1) * (Math.PI / 2);
        const out = w / 2 + 6;
        const [px, py, pz] = at(0, y + h * 0.55, 0);
        const wx = px + Math.sin(rot) * out + Math.cos(rot) * dx;
        const wz = pz + Math.cos(rot) * out - Math.sin(rot) * dx;
        windows.push(part(new BoxGeometry(150, 260, 10), tier % 2 === 0 ? 0xc79bff : 0x8fd8ff, { position: [wx, py, wz], rotation: [0, rot, 0] }));
        if (face === 1) lights.push(new Vector3(wx + Math.sin(rot) * 60, py, wz + Math.cos(rot) * 60));
      }
    }
    y += h + 220;
  }
  stone.push(part(new CylinderGeometry(20, 50, 900, 6), 0x231d2c, { position: at(0, y + 450, 0) }));
  lights.push(new Vector3(...at(0, y + 950, 0))); // a light at the spire's tip
  windows.push(part(new SphereGeometry(70, 10, 8), 0xe6d4ff, { position: at(0, y + 950, 0) }));
  return { stone, windows, lights };
}

/** A gate at the foot of the stairway: two pillars, two crossbeams (facing along the stairs). */
function gateParts(x: number, y: number, z: number): BufferGeometry[] {
  const dark = 0x2e2836;
  return [
    part(new CylinderGeometry(50, 60, 1300, 8), dark, { position: [x - 520, y + 650, z] }),
    part(new CylinderGeometry(50, 60, 1300, 8), dark, { position: [x + 520, y + 650, z] }),
    part(new BoxGeometry(1500, 90, 120), dark, { position: [x, y + 1340, z] }),
    part(new BoxGeometry(1250, 70, 90), dark, { position: [x, y + 1120, z] }),
  ];
}

export function ghostsTheme(): Theme {
  const land = mountain(SEED);
  const random = seededRandom(SEED + 1);
  const dusk = new Color(0x5a4470);
  const moonDirection = new Vector3(0.02, 0.32, 1).normalize(); // low, behind the shrine

  const root = new Group();
  const moonlight = new DirectionalLight(0xc8ccff, 1.1);
  moonlight.position.copy(moonDirection).multiplyScalar(10000);
  root.add(new HemisphereLight(0x8a78c0, 0x1c1624, 1.7), new AmbientLight(0x6a5a8a, 0.55), moonlight);
  const sky = new Sky({
    zenith: new Color(0x150c2c),
    horizon: dusk,
    sunDirection: moonDirection,
    sunStrength: 0,
    radius: 30000,
    clouds: { color: new Color(0x3a2c52), cover: 0.6 },
  });

  const spot = (x: number, z: number, facing: number, lean = 0): Spot => ({ x, y: land.height(x, z), z, facing, lean });

  // Graves in rows on the terraces, facing the arena; some leaning
  const graves: Spot[] = [];
  for (let gx = -15000; gx <= 15000; gx += 400) {
    for (let gz = -16000; gz <= 15000; gz += 440) {
      const x = gx + (random() - 0.5) * 120;
      const z = gz + (random() - 0.5) * 120;
      if (outside(x, z) < 1500 || outside(x, z) > 9000 || random() > 0.55) continue;
      if (!free(land, x, z, 250) || !onTerrace(land, x, z)) continue;
      graves.push(spot(x, z, towardArena(x, z) + (random() - 0.5) * 0.3, random() < 0.25 ? (random() - 0.5) * 0.3 : 0));
    }
  }

  // Stone lanterns up both sides of the stairway, and here and there on the terraces
  const lanterns: Spot[] = [];
  for (let z = FLAT.halfZ + 300, k = 0; z < SHRINE.z - 1800; z += 850, k++) {
    for (const side of [-1, 1]) lanterns.push(spot(stairX(z) + side * 480, z, Math.PI));
  }
  for (let tries = 0; lanterns.length < 70 && tries < 4000; tries++) {
    const x = (random() * 2 - 1) * 12000;
    const z = (random() * 2 - 1) * 14000;
    if (outside(x, z) < 1600 || !free(land, x, z, 250) || !onTerrace(land, x, z)) continue;
    lanterns.push(spot(x, z, towardArena(x, z)));
  }

  // Bare trees between the terraces' graves
  const trees: Spot[] = [];
  for (let tries = 0; trees.length < 34 && tries < 4000; tries++) {
    const x = (random() * 2 - 1) * 16000;
    const z = (random() * 2 - 1) * 17000;
    if (outside(x, z) < 3000 || !free(land, x, z, 300) || Math.hypot(x - SHRINE.x, z - SHRINE.z) < 2600) continue;
    trees.push({ ...spot(x, z, random() * Math.PI * 2), lean: (random() - 0.5) * 0.12 });
  }

  const shrine = shrineParts(spot(SHRINE.x, SHRINE.z, Math.PI));
  const gateZ = FLAT.halfZ + 200;
  const stone = new Mesh(
    combine([...lanterns.flatMap(lanternParts), ...shrine.stone, ...gateParts(stairX(gateZ), land.height(stairX(gateZ), gateZ), gateZ)]),
    new MeshLambertMaterial({ vertexColors: true }),
  );
  const windows = new Mesh(combine(shrine.windows), new MeshBasicMaterial({ vertexColors: true }));

  const flame = new Color(0.55, 0.5, 1);
  const glows = buildGlows([
    ...lanterns.map((l) => ({ x: l.x, y: l.y + 285, z: l.z, size: 520, color: flame, flicker: 0.45 })),
    ...shrine.lights.map((p, i) => ({ x: p.x, y: p.y, z: p.z, size: i === shrine.lights.length - 1 ? 2200 : 700, color: new Color(0.75, 0.55, 1), flicker: 0.15 })),
  ]);

  // Ghosts: sheets drifting round the arena and over the terraces, orbs circling the shrine and along the stairs,
  // peekers behind graves
  const tint = (): Color => GHOST_TINTS[Math.floor(random() * GHOST_TINTS.length)] ?? new Color(0xffffff);
  const sheetHomes: (Placement & { tint: Color })[] = [];
  for (let tries = 0; sheetHomes.length < 44 && tries < 5000; tries++) {
    const x = (random() * 2 - 1) * 11000;
    const z = (random() * 2 - 1) * 13000;
    if (outside(x, z) < 900 || outside(x, z) > 6500) continue;
    const s = 1.1 + random() * 0.6;
    sheetHomes.push({ position: [x, land.height(x, z) + 300 + random() * 900, z], rotation: [0, 0, 0], scale: [s, s, s], tint: tint() });
  }
  const orbHomes: (Placement & { tint: Color })[] = [];
  for (let i = 0; i < 26; i++) {
    const a = random() * Math.PI * 2;
    const r = 1600 + random() * 1400;
    const [x, z] = [SHRINE.x + Math.cos(a) * r, SHRINE.z + Math.sin(a) * r];
    orbHomes.push({ position: [x, land.height(SHRINE.x, SHRINE.z) + 800 + random() * 3600, z], scale: [1.4, 1.4, 1.4], tint: tint() });
  }
  for (let z = FLAT.halfZ + 1800; z < SHRINE.z - 2500; z += 1500) {
    const x = stairX(z) + (random() - 0.5) * 1400;
    orbHomes.push({ position: [x, land.height(x, z) + 500 + random() * 400, z], scale: [1.2, 1.2, 1.2], tint: tint() });
  }
  const peekerHomes = graves
    .filter((g) => outside(g.x, g.z) > 1700 && random() < 0.12)
    .map((g): Placement & { tint: Color } => ({
      // Just behind the stone, facing the arena
      position: [g.x - Math.sin(g.facing) * 110, g.y - 10, g.z - Math.cos(g.facing) * 110],
      rotation: [0, g.facing, 0],
      scale: [1, 1, 1],
      tint: new Color(0.24, 0.12, 0.34),
    }));
  const ghosts = [buildGhosts("sheet", sheetHomes), buildGhosts("orb", orbHomes), buildGhosts("peeker", peekerHomes)];

  const wisps = buildWisps(
    Array.from({ length: 40 }, (): [number, number, number] => {
      const g = graves[Math.floor(random() * graves.length)] ?? spot(9000, 0, 0);
      return [g.x, g.y + 180 + random() * 300, g.z];
    }),
    new Color(0.62, 0.55, 1),
  );
  const mist = buildFogBanks(
    Array.from({ length: 70 }, (): [number, number, number] => {
      for (;;) {
        const x = (random() * 2 - 1) * 15000;
        const z = (random() * 2 - 1) * 17000;
        if (outside(x, z) > 1800) return [x, land.height(x, z) + 280, z];
      }
    }),
    new Color(0.6, 0.52, 0.72),
  );
  const crows = buildBats(
    Array.from({ length: 22 }, (): [number, number, number] => [
      SHRINE.x + (random() - 0.5) * 1500,
      land.height(SHRINE.x, SHRINE.z) + 5200 + random() * 1600,
      SHRINE.z + (random() - 0.5) * 1500,
    ]),
  );
  const motes = buildPollen(land, SEED + 5, {
    count: 900,
    within: 13000,
    beyond: (x, z) => outside(x, z) > 300,
    color: 0xc9b4ff,
    size: 18,
    height: 2600,
  });

  root.add(
    sky.mesh,
    buildMoon(moonDirection, 26000, 2400),
    buildTerraces(land, SEED + 2),
    buildGraves(graves, SEED + 3),
    buildDeadTrees(trees, SEED + 4),
    stone,
    windows,
    glows.mesh,
    ...ghosts.map((g) => g.mesh),
    wisps.mesh,
    mist.mesh,
    crows.mesh,
    motes.points,
  );

  return {
    background: dusk,
    fog: new Fog(dusk, 2500, 24000),
    style: {
      floor: new Color(0x463f58),
      floorStripe: new Color(0x4c4560),
      markings: new Color(0xdccbff), // pale violet, glowing
      walls: {
        neutral: new Color(0xcbb8ff),
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
        lines: 0.24,
        ceilingLines: 0.04,
      },
    },
    root,
    update(seconds) {
      sky.update(seconds);
      for (const clock of [glows.time, wisps.time, mist.time, crows.time, motes.time, ...ghosts.map((g) => g.time)]) {
        clock.value = seconds;
      }
    },
  };
}
