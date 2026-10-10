// Arena themes: everything around the playing field that is only for show (sky, lighting, fog, scenery, the field's
// and walls' colours). Collision and gameplay are the same in every theme, as in the game, whose arenas share one
// collision mesh.
// Scenery is in the Three.js frame (x, y up, z = the game's y) and stays out of the playing volume.
import type { Color, Fog, Group, Object3D, Vector3 } from "three";
import { CAMERA_FAR } from "../renderer";

export interface WallStyle {
  readonly neutral: Color; // hexagon colour around midfield
  readonly blue: Color; // towards each team's end
  readonly orange: Color;
  /** Opacity of the hexagon lines on the walls, and on the ceiling */
  readonly lines: number;
  readonly ceilingLines: number;
  /** The game's own arena materials (notes/arena-visuals.md H-1..11: the cage's beams, the walls' overlay round the
   *  ball, the glass), with `blue` and `orange` as the teams' linear primaries; else our own look */
  readonly game?: boolean;
}

export interface ArenaStyle {
  readonly floor: Color;
  /** Mown stripes across the field: the second colour, or null for a plain floor */
  readonly floorStripe: Color | null;
  /** Glowing field markings in this colour (for dark arenas), or null for plain white lines lit by the scene */
  readonly markings: Color | null;
  readonly walls: WallStyle;
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
