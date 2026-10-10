// The goals' insides with the game's materials (notes/arena-visuals.md AV-13; static analysis RV-76): the floor isn't an
// opaque metal sheet but see-through and layered. On our goal floor (the collision's: flat, then the ramp): the frame's
// strip across the goal line and its sides (Goal_STD_Frame's Frame_01_V2, opaque), the grate behind it and along the
// ramp (Goal_STD_Glass[1], CrossHatched_Grate_TL), the hex glass on the ramp (Goal_STD_Glass[0]); 16 uu under it a second
// glass (Goal_STD_Glass_Outer), the glows (Goal_STD_Glow, src/render/arena.ts), and under all OOBFloor (RV-104), a hex
// metal slope (Reflective_Floor_V2) seen through them.
// The zones and charts are the meshes' (measured: their outlines and UVs); the grate's pattern is drawn, not the
// game's texture: its square cells, 8 a texture tile, their holes 43 % of the area (measured), soft at the edges.
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, ShaderMaterial, type Texture, UniformsLib, UniformsUtils, Vector3 } from "three";
import { ENV_GLSL, ENV_RADIAL, ENV_SPREAD, PACK_G, PACK_G_MEAN } from "./gameSurfaces";
import { GRASS_CUBE_BLUR_LOD } from "./grassCube";
import { HexFloorMaterial } from "./stadiumField";
import type { LightProfile } from "./stadiumFieldRules";

/** The zones (|x|, |y| in uu): the hex glass on the ramp, the grate (behind the goal line's strip, and beside and under
 *  the glass along the ramp); the frame elsewhere */
export const GOAL_GLASS = { x: 640, y0: 5344, y1: 5809 } as const;
export const GOAL_GRATE = { x: 768, y0: 5264, y1: 5809 } as const;
/** The lower glass (Goal_STD_Glass_Outer): this far under the top, over |x| 768, |y| 5264-5860; its V across x 256 uu a
 *  unit in mirrored 256 uu strips (RV-111) */
export const GOAL_UNDER_GLASS = { depth: 16, x: 768, y0: 5264, y1: 5860, strip: 256 } as const;
/** The opaque strips over the goal floor (RV-111): Goal_STD_Frame and Goal_STD_Trim across the front to |y| 5280 and
 *  beside (|x| from 672) to 5344; AdvertStrip_Frame's bars, 12 wide, across at |y| 5338-5350 and along |x| 634-646
 *  from 5264 to 5760 */
export const GOAL_STRIPS = { front: 5280, sideX: 672, sideTo: 5344, across: [5338, 5350], along: { x: [634, 646], y: [5264, 5760] } } as const;

/** What the goal floor's top layer is at |x|, |y| (the shader's zones, for tests) */
export function goalFloorZone(ax: number, ay: number): "frame" | "glass" | "grate" {
  const s = GOAL_STRIPS;
  const strip = ay < s.front || (ax > s.sideX && ay < s.sideTo) || (ay >= s.across[0] && ay <= s.across[1]) || (ax >= s.along.x[0] && ax <= s.along.x[1] && ay >= s.along.y[0] && ay <= s.along.y[1]);
  if (strip) return "frame";
  if (ax <= GOAL_GLASS.x && ay >= GOAL_GLASS.y0 && ay <= GOAL_GLASS.y1) return "glass";
  if (ax <= GOAL_GRATE.x && ay >= GOAL_GRATE.y0 && ay <= GOAL_GRATE.y1) return "grate";
  return "frame";
}
/** OOBFloor under each goal (RV-104): a slope from |x| 768 at the goal line (|y| 5120, z -128) to |x| 896 at |y| 6144
 *  (z 0), Reflective_Floor_V2 (H-3: its lines 2 P_team there), with near-black 45-degree bevels (0.05) up its sides to
 *  |x| 896, z 0 */
export const GOAL_BASE = { y0: 5120, y1: 6144, x0: 768, x1: 896, z0: -128, bevel: 0.05 } as const;
/** OOBFloor's baked light along |y| (128 uu bins from the goal line; the static session's statistics, linear), the blue
 *  goal's and the orange's */
export const GOAL_BASE_LIGHT: readonly [LightProfile, LightProfile] = [
  { axis: "|y|", start: 5120, bin: 128, rgb: [[0.045, 0.044, 0.037], [0.371, 0.335, 0.261], [0.883, 0.793, 0.616], [1.03, 0.925, 0.738], [0.821, 0.749, 0.608], [0.777, 0.709, 0.572], [1.017, 0.918, 0.742], [1.04, 0.934, 0.747]] },
  { axis: "|y|", start: 5120, bin: 128, rgb: [[0.048, 0.05, 0.044], [0.348, 0.317, 0.246], [0.782, 0.698, 0.547], [0.942, 0.846, 0.67], [0.761, 0.69, 0.554], [0.695, 0.631, 0.507], [0.941, 0.844, 0.673], [1.018, 0.912, 0.728]] },
];

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
uniform float packG[32];
uniform float envRadial[9];
uniform float envSpread[9];
varying vec3 vWorld;
#include <fog_pars_fragment>
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
float profile32(float table[32], float r) {
  float rr = clamp(r, 0.0, 1.0);
  float x = (rr < 0.8 ? rr * 20.0 : 16.0 + (rr - 0.8) * 80.0) - 0.5;
  int i = int(clamp(floor(x), 0.0, 31.0));
  int j = min(i + 1, 31);
  return mix(table[i], table[j], clamp(x - float(i), 0.0, 1.0));
}
// H-6: the glass, alpha 0.1875 Hexagons_Pack.G at its tiles (UV0 x (3, 7/3)), its colour ENVPack.G seen along the
// view (our smooth stand-in, RV-71: the floor's tangent frame, u along y and v across x) + 1/12
vec4 glass(vec2 uv, vec3 toCamera) {
  vec2 tile = vec2(3.0, 7.0 / 3.0) * uv;
  float g = profile32(packG, hexRadius(tile));
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
    // Goal_STD_Glass_Outer: glass only (its chart along y as the mesh's; across x the top glass's)
    if (ax > ${GOAL_UNDER_GLASS.x.toFixed(1)} || ay < ${GOAL_UNDER_GLASS.y0.toFixed(1)} || ay > ${GOAL_UNDER_GLASS.y1.toFixed(1)}) discard;
    float strip = ax / ${GOAL_UNDER_GLASS.strip.toFixed(1)};
    colour = glass(vec2(0.003424 * ay - 18.0243, 1.0 - abs(mod(strip, 2.0) - 1.0)), toCamera);
  #else
    // (the opaque strips: goalFloorZone)
    bool strip = ay < ${GOAL_STRIPS.front.toFixed(1)} || (ax > ${GOAL_STRIPS.sideX.toFixed(1)} && ay < ${GOAL_STRIPS.sideTo.toFixed(1)})
      || (ay >= ${GOAL_STRIPS.across[0].toFixed(1)} && ay <= ${GOAL_STRIPS.across[1].toFixed(1)})
      || (ax >= ${GOAL_STRIPS.along.x[0].toFixed(1)} && ax <= ${GOAL_STRIPS.along.x[1].toFixed(1)} && ay >= ${GOAL_STRIPS.along.y[0].toFixed(1)} && ay <= ${GOAL_STRIPS.along.y[1].toFixed(1)});
    if (strip) {
      vec3 cube = textureLod(grassCube, vec3(-toCamera.x, toCamera.y, -toCamera.z), ${GRASS_CUBE_BLUR_LOD.toFixed(1)}).rgb;
      colour = vec4(clamp(vec3(${FRAME.r}) + 4.0 * (0.125 + 0.625 * ${FRAME.g}) * cube, 0.0, 1.0) * frameLight * ${FRAME.tireMarks}, 1.0);
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
      // H-4's frame (off its stripes): sat(R + 4 (0.125 + 0.625 G) cube) x its baked light
      vec3 cube = textureLod(grassCube, vec3(-toCamera.x, toCamera.y, -toCamera.z), ${GRASS_CUBE_BLUR_LOD.toFixed(1)}).rgb;
      colour = vec4(clamp(vec3(${FRAME.r}) + 4.0 * (0.125 + 0.625 * ${FRAME.g}) * cube, 0.0, 1.0) * frameLight * ${FRAME.tireMarks}, 1.0);
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
        packG: { value: PACK_G },
        envRadial: { value: ENV_RADIAL },
        envSpread: { value: ENV_SPREAD },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
  }
}

/** Under each goal's floor (`floor`: its geometry, Three's frame): the lower glass (the floor 16 uu down), and OOBFloor
 *  under it all, each goal's slope in its own light and the bevels beside them (`primaries`: the teams' linear
 *  primaries) */
export function goalUnderlayers(floor: BufferGeometry, cube: { value: Texture }, primaries: readonly [Color, Color]): Mesh[] {
  const under = new Mesh(floor.clone().translate(0, -GOAL_UNDER_GLASS.depth, 0), new GoalFloorMaterial(cube, true));
  under.renderOrder = 1;
  under.name = "goal under glass";
  const { y0, y1, x0, x1 } = GOAL_BASE;
  // (Three's frame: x, up, the game's y; quads as two triangles)
  const quad = (out: number[], a: number[], b: number[], c: number[], d: number[]): void => {
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  const edge = (y: number): number => x0 + ((x1 - x0) * (Math.abs(y) - y0)) / (y1 - y0);
  const bevels: number[] = [];
  const meshes = ([-1, 1] as const).map((sy, team) => {
    const slope: number[] = [];
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
    return mesh;
  });
  const bevelGeometry = new BufferGeometry();
  bevelGeometry.setAttribute("position", new Float32BufferAttribute(bevels, 3));
  // (linear: the working colour space)
  const dark = new Mesh(bevelGeometry, new MeshBasicMaterial({ color: new Color().setScalar(GOAL_BASE.bevel), side: DoubleSide }));
  dark.name = "goal base bevels";
  return [under, ...meshes, dark];
}
