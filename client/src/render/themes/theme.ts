// Arena themes: everything around the playing field that is only for show (sky, lighting, fog, scenery, the field's
// and walls' colours). Collision and gameplay are the same in every theme, as in the game, whose arenas share one
// collision mesh.
// Scenery is in the Three.js frame (x, y up, z = the game's y) and stays out of the playing volume.
import type { Color, Fog, Group, Vector3 } from "three";

export interface WallStyle {
  readonly neutral: Color; // hexagon colour around midfield
  readonly blue: Color; // towards each team's end
  readonly orange: Color;
  /** Opacity of the hexagon lines on the walls, and on the ceiling */
  readonly lines: number;
  readonly ceilingLines: number;
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
  readonly fog: Fog;
  readonly style: ArenaStyle;
  /** Lights and scenery */
  readonly root: Group;
  /** Animates the scenery: seconds since it was built, and the ball's centre (Three.js frame) */
  update(seconds: number, ball: Vector3): void;
}

/** The playing volume in the Three.js frame (x, y up, z), goals included, that scenery must stay out of. */
export const PLAYING_VOLUME = { halfX: 4096, halfZ: 6000, height: 2048 } as const;
