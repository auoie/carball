// DFH Stadium (Stadium_P), the game's own soccar arena at sunset, from the static session's spec
// (notes/arena-visuals.md): its sky (H-10), its sun low from -X (AV-17), its sky light (AV-18), its height fog (the
// exe's, from 10240 uu out: FOG-1..15, render/heightFog.ts), and the game's own arena materials for the cage, the walls
// and the glass (H-6, H-8, H-9) in the teams' primaries (AV-2). Values only: the look is built in code.
import { Color, DirectionalLight, Group, HemisphereLight } from "three";
import { fogAll } from "../heightFog";
import { TEAM_PRIMARY_LINEAR, linear } from "../teamColors";
import { buildCrowd } from "./stadiumCrowd";
import { buildStadiumLights } from "./stadiumLights";
import { buildPlaza, buildScreensAndProps } from "./stadiumProps";
import { buildFogBowl, buildSkyDome } from "./stadiumSky";
import { buildFarLayer } from "./stadiumFarLayer";
import { buildBowl, buildCaptureHotspots } from "./stadiumSurroundings";
import type { Theme } from "./theme";
import { buildFlagRing, updateFlagRing } from "./stadiumFlags";
import { buildCanopy } from "./stadiumCanopy";

/** The sky's v and q (H-10: stadiumSky.ts) */
export { skyVQ } from "./stadiumSky";

export function stadiumTheme(): Theme {
  const root = new Group();
  // The sun (DirectionalLight__LC_1): from -X, 23.2 degrees up, (255, 241, 204), brightness 1; the sky light 1.5
  // (x pi: three.js's Lambert divides by pi where the game's doesn't: RV-70a)
  const sun = new DirectionalLight(linear([1, 0.883, 0.612]), Math.PI);
  sun.position.set(-0.919 * 10000, 0.393 * 10000, -0.007 * 10000);
  // The sky light: upper (255, 235, 186), lower (206, 255, 140), x 1.5 (the bytes ^2.2: RV-79a)
  const sky = new HemisphereLight(linear([1, 0.8355, 0.4995]), linear([0.6254, 1, 0.2674]), 1.5 * Math.PI);
  // The sky: H-10 in full, the clouds and stars on our own noises (stadiumSky.ts)
  const skyDome = buildSkyDome();
  const dome = skyDome.mesh;
  const [p0 = [0, 0, 1], p1 = [1, 0.5, 0]] = TEAM_PRIMARY_LINEAR;
  // (the reflection capture's own glows: SUR-33)
  const hotspots = buildCaptureHotspots(linear(p0), linear(p1));
  // The stands, roof, canopy and floodlights round the arena (SUR-1..21), the crowd on them (SUR-26..31)
  const crowd = buildCrowd(linear(p0), linear(p1));
  // The screens, ads and the near-field props (SUR-9, 10, 17..19)
  const props = buildScreensAndProps(linear(p0), linear(p1));
  // The skyline, the city's glow and the horizon's fog band beyond (SUR-11, 22, 23)
  // The team beams, flare sheets, bulbs, the canopy's light dots, the haze and the near fog sheets (SUR-8, 13, 14, 23)
  // The roof arch's ring of flags (SUR-11, FLG1)
  const flags = buildFlagRing();
  // The glass canopy's panels and fins (SUR-6, 15)
  root.add(buildCanopy(linear(p0), linear(p1)));
  root.add(sun, sky, dome, buildFogBowl(), hotspots, buildBowl(), crowd.mesh, props.group, buildPlaza(), buildStadiumLights(linear(p0), linear(p1)), buildFarLayer(), flags);
  // (the height fog in every material out here: opaque per pixel, translucent per vertex; the sky, the far layer and
  // the hotspots their own ways, set where they're built. The arena's, the cars' and the ball's the renderer fogs each
  // frame (renderer.heightFog: RV-187); nothing within 10240 uu of the camera takes any)
  fogAll(root);
  return {
    background: new Color(0x0b1418),
    fog: null,
    heightFog: true,
    style: {
      floor: new Color(0x3d5a2c),
      floorStripe: null,
      markings: null,
      walls: {
        neutral: new Color(0xffffff),
        blue: linear(p0),
        orange: linear(p1),
        lines: 0.2,
        ceilingLines: 0.06,
        game: true,
      },
    },
    root,
    captureOnly: hotspots,
    update: (elapsedSeconds) => {
      skyDome.update(elapsedSeconds);
      crowd.update(elapsedSeconds);
      props.update(elapsedSeconds);
      updateFlagRing(flags, elapsedSeconds);
    },
  };
}
