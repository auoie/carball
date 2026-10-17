// Night's greenhouse (ours, the user's request of 2026-10-17): Night's sky, lights and ground round our glasshouse arena
// and football pitch (src/render/greenhouse.ts); Night's team colours on the goals, the bars and the boards.
import { Color } from "three";
import { goalOutline, greenhouseWalls, pitchLayout, pitchMaterial } from "../greenhouse";
import { floorOutline } from "../arenaSurface";
import { TokenPadsView } from "../tokenPads";
import { nightTheme } from "./night";
import type { Theme } from "./theme";

/** The grass's two mown shades and the chalk (sRGB) */
const GRASS = [0x3b7834, 0x316a2c] as const;
const CHALK = 0xeef1ea;

export function greenhouseTheme(): Theme {
  const night = nightTheme();
  return {
    ...night,
    style: {
      ...night.style,
      gameField: false,
      arena: {
        walls: (surface, ball, blue, orange, clock) => greenhouseWalls(surface, ball, blue, orange, clock).group,
        goalGlows: () => [goalOutline()],
        pads: (pads) => new TokenPadsView(pads),
        floor: () => pitchMaterial(pitchLayout(floorOutline()), new Color(GRASS[0]), new Color(GRASS[1]), new Color(CHALK)),
      },
    },
  };
}
