// Arena themes: everything around the playing field that is only for show (sky, lighting, fog, scenery, the field's
// and walls' colours). Collision and gameplay are the same in every theme, as in the game, whose arenas share one
// collision mesh.
// Scenery is in the Three.js frame (x, y up, z = the game's y) and stays out of the playing volume.
import type { Color, Fog, Group, Material, Object3D, Vector3 } from "three";
import { CAMERA_FAR } from "../renderer";
import type { ArenaSurface } from "../arenaSurface";
import type { GlowRibbon } from "../stadiumFieldRules";
import type { PadsView } from "../boostPads";
import type { BoostPadState } from "../../engine/world";

export interface WallStyle {
  /** The teams' colours (linear) on the game's net, trim and cage, which every map wears (src/render/arena.ts): the cage's
   *  overlay and beams, the glow sheets behind the walls */
  readonly blue: Color;
  readonly orange: Color;
  /** The game's stadium itself (notes/arena-visuals.md: its field, its goals' metal floors and glows), with `blue` and
   *  `orange` as the teams' linear primaries: the stadium theme's alone; else the theme's own floor and goals' floors */
  readonly game?: boolean;
}

export interface ArenaStyle {
  readonly floor: Color;
  /** Mown stripes across the field: the second colour, or null for a plain floor */
  readonly floorStripe: Color | null;
  /** Glowing field markings in this colour (for dark arenas), or null for plain white lines lit by the scene */
  readonly markings: Color | null;
  /** The game's field (its grass, hex floors, frame, boost paths and markings) for this map's floor, in its team colours,
   *  instead of `floor` and `markings` (the user's decisions, 2026-10-16: Night's) */
  readonly gameField?: boolean;
  /** A map's own arena in place of the game's cage, wall foot and floor (the greenhouse's: src/render/greenhouse.ts);
   *  the goals, their nets and glows as every map's */
  readonly arena?: CustomArena;
  readonly walls: WallStyle;
}

/** The arena's clock, as the cage's beams have it (uniforms the arena sets each frame): the seconds' fraction and the goal
 *  explosion's shockwave (src/render/cageBeams.ts shockWave) */
export interface ArenaClock {
  readonly time: { value: number };
  readonly shockWave: { value: number };
}

/** A map's own walls and floor, built from the arena's swept surface (src/render/arenaSurface.ts), in its team colours,
 *  lit round the ball (its centre, Three's frame, updated each frame) */
export interface CustomArena {
  walls(surface: ArenaSurface, ball: Vector3, blue: Color, orange: Color, clock: ArenaClock): Object3D;
  /** Its goals' glows in place of every map's (the +y goal's, mirrored for the other: src/render/arena.ts goalGlows) */
  goalGlows?(): readonly GlowRibbon[];
  /** Its boost pads in place of every map's game-style ones (the engine's pads: their places and states) */
  pads?(pads: readonly BoostPadState[]): PadsView;
  /** The floor's material (the flat floor out to the wall's foot) */
  floor(): Material;
}

export interface Theme {
  readonly background: Color;
  /** Three's fog, or none (the stadium's own height fog in its materials: render/heightFog.ts) */
  readonly fog: Fog | null;
  /** The exe's height fog over the whole scene (the renderer's: the arena, cars and ball as well as the theme) */
  readonly heightFog?: boolean;
  readonly style: ArenaStyle;
  /** Lights and scenery */
  readonly root: Group;
  /** Drawn only into the arena's reflection capture (the game's cube-only hotspots: SUR-33), kept hidden otherwise */
  readonly captureOnly?: Object3D;
  /** Animates the scenery: seconds since it was built, and the ball's centre (Three.js frame) */
  update(elapsedSeconds: number, ball: Vector3): void;
}

/** The playing volume in the Three.js frame (x, y up, z), goals included, that scenery must stay out of: its bounding box
 *  (halfX, halfZ, height), and the cage within it, the field (to |z| = fieldHalfZ, its corners cut at |x| + |z| =
 *  cornerSum: the corner curves lie inside that line) and the goals behind (|x| < goalHalfWidth, y < goalHeight). */
export const PLAYING_VOLUME = { halfX: 4096, halfZ: 6000, height: 2048, fieldHalfZ: 5120, cornerSum: 8064, goalHalfWidth: 893, goalHeight: 643 } as const;

/** How far from the field's centre a vertex may be drawn: inside the camera's far plane from anywhere in the playing
 *  volume, 500 uu to spare (what's farther is drawn nearer: scaleWithin) */
export const FAR_ROOM = CAMERA_FAR - Math.hypot(PLAYING_VOLUME.halfX, PLAYING_VOLUME.height, PLAYING_VOLUME.halfZ) - 500;
