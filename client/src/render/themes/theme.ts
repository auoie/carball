// The map's look: everything around the playing field that is only for show (sky, lighting, fog, scenery, the arena's
// walls, floor and pads, its team colours). Collision and gameplay are the engine's, as in the game.
// Scenery is in the Three.js frame (x, y up, z = the game's y) and stays out of the playing volume.
import type { Color, Fog, Group, Material, Object3D, Vector3 } from "three";
import { CAMERA_FAR } from "../renderer";
import type { ArenaSurface } from "../arenaSurface";
import type { PadsView } from "../tokenPads";
import type { BoostPadState } from "../../engine/world";

export interface WallStyle {
  /** The teams' colours (linear) on the arena: its walls' bars and boards, the goals and their glows */
  readonly blue: Color;
  readonly orange: Color;
}

/** A goal's glow: a ribbon from its attached edge (glowing, 1 unless said) to its free edge (0), game frame, the +y goal's
 *  (src/render/arena.ts goalGlows mirrors it for the other) */
export interface GlowRibbon {
  readonly attached: readonly number[];
  readonly free: readonly number[];
  readonly glow?: number;
  readonly part?: string;
}

export interface ArenaStyle {
  readonly arena: CustomArena;
  readonly walls: WallStyle;
}

/** The arena's clock (uniforms the arena sets each frame): the seconds' fraction and the goal explosion's shockwave
 *  (src/render/cageBeams.ts shockWave) */
export interface ArenaClock {
  readonly time: { value: number };
  readonly shockWave: { value: number };
}

/** The map's walls and floor, built from the arena's swept surface (src/render/arenaSurface.ts), in its team colours, lit
 *  round the ball (its centre, Three's frame, updated each frame); its goals' glows and its boost pads */
export interface CustomArena {
  walls(surface: ArenaSurface, ball: Vector3, blue: Color, orange: Color, clock: ArenaClock): Object3D;
  goalGlows(): readonly GlowRibbon[];
  pads(pads: readonly BoostPadState[]): PadsView;
  /** The floor's material (the flat floor out to the wall's foot) */
  floor(): Material;
}

export interface Theme {
  readonly background: Color;
  readonly fog: Fog | null;
  readonly style: ArenaStyle;
  /** Lights and scenery */
  readonly root: Group;
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
