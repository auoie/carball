// The goals' insides with the game's materials (notes/arena-visuals.md AV-13; static analysis RV-76): the floor isn't an
// opaque metal sheet but see-through and layered. On our goal floor (the collision's: flat, then the ramp): the frame's
// strip across the goal line and its sides (Goal_STD_Frame's Frame_01_V2, opaque), the grate behind it and along the
// ramp (Goal_STD_Glass[1], CrossHatched_Grate_TL), the hex glass on the ramp (Goal_STD_Glass[0]); 16 uu under it a second
// glass (Goal_STD_Glass_Outer), the glows (Goal_STD_Glow, src/render/arena.ts), and under all OOBFloor (RV-104), a hex
// metal slope (Reflective_Floor_V2) seen through them.
// The zones and charts are the meshes' (measured: their outlines and UVs); the grate's pattern is drawn, not the
// game's texture: its square cells, 8 a texture tile, their holes 43 % of the area (measured), soft at the edges.
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, ShaderMaterial, type Texture, UniformsLib, UniformsUtils, Vector3 } from "three";
import { PACK_G_MEAN } from "./gameSurfaces";
import { CONST_TABLES_GLSL, ENV_GLSL, tablesUniform } from "./constTables";
import { GRASS_CUBE_BLUR_LOD } from "./grassCube";
import { HexFloorMaterial } from "./stadiumField";
import type { LightProfile } from "./stadiumFieldRules";
import { ARENA_PRIORITY, fitIndexedBounds } from "./translucentSort";

/** The zones (|x|, |y| in uu): the hex glass on the ramp, the grate (behind the goal line's strip, and beside and under
 *  the glass along the ramp); the frame elsewhere */
export const GOAL_GLASS = { x: 640, y0: 5344, y1: 5809 } as const;
export const GOAL_GRATE = { x: 768, y0: 5264, y1: 5809 } as const;
/** The lower glass (Goal_STD_Glass_Outer): this far under the top, over |x| 768, |y| 5264-5860; its V across x 256 uu a
 *  unit in 256 uu strips (RV-111, RV-142: underGlassV) */
export const GOAL_UNDER_GLASS = { depth: 16, x: 768, y0: 5264, y1: 5860, strip: 256 } as const;
/** The opaque strips over the goal floor (RV-111, RV-142, RV-168b): Goal_STD_Frame and Goal_STD_Trim across the front to
 *  |y| 5280 and beside (|x| from 672) to 5344; Goal_STD_Trim's up-facing strip along the sides (|x| 735-768, |y|
 *  5307-5831); AdvertStrip_Frame's bars, 12 wide, across at |y| 5338-5350 and 5754-5766 and along |x| 634-646 from 5264
 *  to 5808 */
export const GOAL_STRIPS = {
  front: 5280,
  sideX: 672,
  sideTo: 5344,
  trim: { x: [735, 768], y: [5307, 5831] },
  across: [[5338, 5350], [5754, 5766]],
  along: { x: [634, 646], y: [5264, 5808] },
} as const;

/** The lower glass's V across x: 3 - fract(|x| / 256), from 3 inside to 2 out in each 256 strip, as the mesh's (its
 *  whole part counts: the tiles' V scale 7/3 makes a unit a third of a period, RV-142, RV-168a; the shader's
 *  UNDER_GLASS_V_GLSL, for tests) */
export function underGlassV(ax: number): number {
  const f = ax / GOAL_UNDER_GLASS.strip;
  return 3 - (f - Math.floor(f));
}

export const UNDER_GLASS_V_GLSL = /* glsl */ `
float underGlassV(float ax) {
  return 3.0 - fract(ax / ${GOAL_UNDER_GLASS.strip.toFixed(1)});
}
`;

/** What the goal floor's top layer is at |x|, |y| (the shader's zones, for tests) */
export function goalFloorZone(ax: number, ay: number): "frame" | "glass" | "grate" {
  const s = GOAL_STRIPS;
  const strip =
    ay < s.front ||
    (ax > s.sideX && ay < s.sideTo) ||
    (ax >= s.trim.x[0] && ax <= s.trim.x[1] && ay >= s.trim.y[0] && ay <= s.trim.y[1]) ||
    s.across.some(([a, b]) => ay >= a && ay <= b) ||
    (ax >= s.along.x[0] && ax <= s.along.x[1] && ay >= s.along.y[0] && ay <= s.along.y[1]);
  if (strip) return "frame";
  if (ax <= GOAL_GLASS.x && ay >= GOAL_GLASS.y0 && ay <= GOAL_GLASS.y1) return "glass";
  if (ax <= GOAL_GRATE.x && ay >= GOAL_GRATE.y0 && ay <= GOAL_GRATE.y1) return "grate";
  return "frame";
}
/** OOBFloor under each goal (RV-104): a slope from |x| 768 at the goal line (|y| 5120, z -128) to |x| 896 at |y| 6144
 *  (z 0), Reflective_Floor_V2 (H-3: its lines 2 P_team there), with near-black 45-degree bevels (GOAL_BEVEL_LIGHT) up its sides to
 *  |x| 896, z 0 */
export const GOAL_BASE = { y0: 5120, y1: 6144, x0: 768, x1: 896, z0: -128 } as const;
/** OOBFloor's slope's baked light along |y| (128 uu bins from the goal line; the static session's statistics of the
 *  slope alone, linear: RV-145), the blue goal's and the orange's; its 45-degree bevels' own means */
export const GOAL_BASE_LIGHT: readonly [LightProfile, LightProfile] = [
  { axis: "|y|", start: 5120, bin: 128, rgb: [[0.0532, 0.0514, 0.0427], [0.4392, 0.3961, 0.3086], [1.018, 0.9142, 0.7094], [1.1529, 1.0358, 0.8263], [0.9014, 0.8214, 0.6669], [0.8257, 0.7539, 0.6076], [1.0404, 0.9389, 0.7584], [1.0436, 0.9375, 0.7502]] },
  { axis: "|y|", start: 5120, bin: 128, rgb: [[0.0576, 0.0604, 0.0527], [0.4102, 0.3732, 0.2903], [0.905, 0.8073, 0.6327], [1.0625, 0.9545, 0.7559], [0.8324, 0.7547, 0.6052], [0.7436, 0.675, 0.542], [0.9654, 0.8656, 0.6913], [1.0221, 0.916, 0.7316]] },
];
export const GOAL_BEVEL_LIGHT = [[0.0589, 0.0552, 0.0455], [0.0455, 0.0411, 0.0322]] as const;

/** OOBFloor's height at |y| */
export function goalBaseZ(y: number): number {
  const { y0, y1, z0 } = GOAL_BASE;
  return z0 * (1 - Math.min(Math.max((Math.abs(y) - y0) / (y1 - y0), 0), 1));
}
/** Goal_STD_Frame's floor pieces: FrameTexture_PACK's mean R and G there (decoded, outside the stripes), their baked
 *  light (the mesh's lightmap mean, facing up) and H-4's tire-mark factor (its mean: RV-105b) */
const FRAME = { r: 0.146, g: 0.158, light: [1.0209, 0.9177, 0.7189], tireMarks: 0.931 } as const;

const fragmentShader = /* glsl */ `
uniform samplerCube grassCube;
uniform vec3 frameLight;
varying vec3 vWorld;
#include <fog_pars_fragment>
${CONST_TABLES_GLSL}
${ENV_GLSL}
float saturate1(float x) { return clamp(x, 0.0, 1.0); }
float hexRadius(vec2 tile) {
  const float edge = 1.0 / 3.0;
  const float sv = 1.1547005;
  vec2 p = vec2(tile.x, (tile.y - 0.25) * sv);
  float col = floor(p.x / 0.5 + 0.5);
  float best = 9.0;
  for (int dc = -1; dc <= 1; dc++) {
    float c = col + float(dc);
    float ro = mod(c, 2.0) < 0.5 ? 0.0 : 0.25 * sv;
    float row = floor((p.y - ro) / (0.5 * sv) + 0.5);
    vec2 d = abs(p - vec2(c * 0.5, row * 0.5 * sv + ro));
    best = min(best, max(d.y / (0.8660254 * edge), (d.x + d.y * 0.5773503) / edge));
  }
  return best;
}
// H-6: the glass, alpha 0.1875 Hexagons_Pack.G at its tiles (UV0 x (3, 7/3)), its colour ENVPack.G seen along the
// view (our smooth stand-in, RV-71: the floor's tangent frame, u along y and v across x) + 1/12
${UNDER_GLASS_V_GLSL}
vec4 glass(vec2 uv, vec3 toCamera) {
  vec2 tile = vec2(3.0, 7.0 / 3.0) * uv;
  float g = tableProfile(T_PACK_G, hexRadius(tile));
  g = mix(g, ${PACK_G_MEAN}, smoothstep(0.1, 0.3, length(fwidth(tile))));
  float env = envG(-normalize(vec3(toCamera.z, -toCamera.x, toCamera.y)).xy);
  return vec4(vec3(env + 1.0 / 12.0), 0.1875 * g);
}
void main() {
  vec2 xy = vec2(vWorld.x, vWorld.z); // (the game's frame: Three's x and z)
  float ax = abs(xy.x);
  float ay = abs(xy.y);
  vec3 toCamera = normalize(cameraPosition - vWorld);
  vec4 colour;
  #ifdef UNDER
    // Goal_STD_Glass_Outer: glass only (its chart along y as the mesh's, across x underGlassV)
    if (ax > ${GOAL_UNDER_GLASS.x.toFixed(1)} || ay < ${GOAL_UNDER_GLASS.y0.toFixed(1)} || ay > ${GOAL_UNDER_GLASS.y1.toFixed(1)}) discard;
    colour = glass(vec2(0.003424 * ay - 18.0243, underGlassV(ax)), toCamera);
  #else
    // (the opaque strips: goalFloorZone)
    bool strip = ay < ${GOAL_STRIPS.front.toFixed(1)} || (ax > ${GOAL_STRIPS.sideX.toFixed(1)} && ay < ${GOAL_STRIPS.sideTo.toFixed(1)})
      || (ax >= ${GOAL_STRIPS.trim.x[0].toFixed(1)} && ax <= ${GOAL_STRIPS.trim.x[1].toFixed(1)} && ay >= ${GOAL_STRIPS.trim.y[0].toFixed(1)} && ay <= ${GOAL_STRIPS.trim.y[1].toFixed(1)})
      || (ay >= ${GOAL_STRIPS.across[0][0].toFixed(1)} && ay <= ${GOAL_STRIPS.across[0][1].toFixed(1)})
      || (ay >= ${GOAL_STRIPS.across[1][0].toFixed(1)} && ay <= ${GOAL_STRIPS.across[1][1].toFixed(1)})
      || (ax >= ${GOAL_STRIPS.along.x[0].toFixed(1)} && ax <= ${GOAL_STRIPS.along.x[1].toFixed(1)} && ay >= ${GOAL_STRIPS.along.y[0].toFixed(1)} && ay <= ${GOAL_STRIPS.along.y[1].toFixed(1)});
    if (strip) {
      vec3 cube = textureLod(grassCube, vec3(-toCamera.x, toCamera.y, -toCamera.z), ${GRASS_CUBE_BLUR_LOD.toFixed(1)}).rgb;
      colour = vec4(clamp((vec3(${FRAME.r}) + 4.0 * (0.125 + 0.625 * ${FRAME.g}) * cube) * ${FRAME.tireMarks}, 0.0, 1.0) * frameLight, 1.0);
    } else if (ax <= ${GOAL_GLASS.x.toFixed(1)} && ay >= ${GOAL_GLASS.y0.toFixed(1)} && ay <= ${GOAL_GLASS.y1.toFixed(1)}) {
      // Goal_STD_Glass[0]'s chart: u along y, v across x
      colour = glass(vec2(0.005172 * ay - 26.2292, -0.004896 * xy.x + 3.761), toCamera);
    } else if (ax <= ${GOAL_GRATE.x.toFixed(1)} && ay >= ${GOAL_GRATE.y0.toFixed(1)} && ay <= ${GOAL_GRATE.y1.toFixed(1)}) {
      // H-11's grate: alpha sat(4.125 R (1 - 0.425 sat(4 (d / 1024 - 0.4)))), R its bars (0.85) or holes (0), at UV x 8;
      // albedo about 0.03. Cells too small to draw: their mean cover
      vec2 cell = 8.0 * vec2(0.000646 * ay - 3.2743, -0.004284 * xy.x + 3.416) * 8.0;
      vec2 f = abs(fract(cell) - 0.5);
      float bar = smoothstep(0.287, 0.367, max(f.x, f.y));
      float d = length(cameraPosition - vWorld);
      float alpha = saturate1(4.125 * 0.85 * bar * (1.0 - 0.425 * saturate1(4.0 * (d / 1024.0 - 0.4))));
      alpha = mix(alpha, 0.573, smoothstep(0.12, 0.3, length(fwidth(cell))));
      colour = vec4(vec3(0.03) * frameLight, alpha);
    } else {
      // H-4's frame (off its stripes): sat((R + 4 (0.125 + 0.625 G) cube) m) x its baked light (the tire marks inside the
      // saturate: RV-144, RV-168d)
      vec3 cube = textureLod(grassCube, vec3(-toCamera.x, toCamera.y, -toCamera.z), ${GRASS_CUBE_BLUR_LOD.toFixed(1)}).rgb;
      colour = vec4(clamp((vec3(${FRAME.r}) + 4.0 * (0.125 + 0.625 * ${FRAME.g}) * cube) * ${FRAME.tireMarks}, 0.0, 1.0) * frameLight, 1.0);
    }
  #endif
  gl_FragColor = colour;
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const vertexShader = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** The goal floor's top layer (`under`: the glass 16 uu below) */
export class GoalFloorMaterial extends ShaderMaterial {
  constructor(cube: { value: Texture }, under = false) {
    const [r, g, b] = FRAME.light;
    super({
      vertexShader,
      fragmentShader,
      defines: under ? { UNDER: "" } : {},
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        grassCube: cube,
        frameLight: { value: new Vector3(r, g, b) },
        constTables: tablesUniform(),
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
  }
}

/** Under each goal's floor (`floors`: each goal's geometry, Three's frame): the lower glass (the floor 16 uu down), and
 *  OOBFloor under it all, each goal's slope in its own light and the bevels beside them (`primaries`: the teams' linear
 *  primaries) */
export function goalUnderlayers(floors: readonly BufferGeometry[], cube: { value: Texture }, primaries: readonly [Color, Color]): Mesh[] {
  const glass = new GoalFloorMaterial(cube, true);
  const unders = floors.map((floor) => {
    const under = new Mesh(fitIndexedBounds(floor.clone().translate(0, -GOAL_UNDER_GLASS.depth, 0)), glass);
    under.renderOrder = ARENA_PRIORITY.goalGlassOuter; // (Goal_STD_Glass_Outer: TRN1)
    under.name = "goal under glass";
    return under;
  });
  const { y0, y1, x0, x1 } = GOAL_BASE;
  // (Three's frame: x, up, the game's y; quads as two triangles)
  const quad = (out: number[], a: number[], b: number[], c: number[], d: number[]): void => {
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  const edge = (y: number): number => x0 + ((x1 - x0) * (Math.abs(y) - y0)) / (y1 - y0);
  const meshes = ([-1, 1] as const).flatMap((sy, team) => {
    const slope: number[] = [];
    const bevels: number[] = [];
    // (in 128 uu steps along y: the light's bins)
    for (let y: number = y0; y < y1; y += 128) {
      const [ya, yb] = [sy * y, sy * (y + 128)];
      quad(slope, [-edge(ya), goalBaseZ(ya), ya], [edge(ya), goalBaseZ(ya), ya], [edge(yb), goalBaseZ(yb), yb], [-edge(yb), goalBaseZ(yb), yb]);
      for (const sx of [-1, 1]) quad(bevels, [sx * edge(ya), goalBaseZ(ya), ya], [sx * x1, 0, ya], [sx * x1, 0, yb], [sx * edge(yb), goalBaseZ(yb), yb]);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(slope, 3));
    const light = GOAL_BASE_LIGHT[team] ?? GOAL_BASE_LIGHT[0];
    const material = new HexFloorMaterial(cube, primaries[0], primaries[1], light);
    material.side = DoubleSide;
    const mesh = new Mesh(geometry, material);
    mesh.name = `goal base ${String(team)}`;
    // (the bevels in their own light: linear, the working colour space)
    const bevelGeometry = new BufferGeometry();
    bevelGeometry.setAttribute("position", new Float32BufferAttribute(bevels, 3));
    const [r, g, b] = GOAL_BEVEL_LIGHT[team] ?? GOAL_BEVEL_LIGHT[0];
    const dark = new Mesh(bevelGeometry, new MeshBasicMaterial({ color: new Color().setRGB(r, g, b), side: DoubleSide }));
    dark.name = "goal base bevels";
    return [mesh, dark];
  });
  return [...unders, ...meshes];
}
