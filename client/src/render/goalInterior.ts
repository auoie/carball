// The goals' insides with the game's materials (notes/arena-visuals.md AV-13; static analysis RV-76): the floor isn't an
// opaque metal sheet but see-through and layered. On our goal floor (the collision's: flat, then the ramp): the frame's
// strip across the goal line and its sides (Goal_STD_Frame's Frame_01_V2, opaque), the grate behind it and along the
// ramp (Goal_STD_Glass[1], CrossHatched_Grate_TL), the hex glass on the ramp (Goal_STD_Glass[0]); 16 uu under it a second
// glass (Goal_STD_Glass_Outer), the glows (Goal_STD_Glow, src/render/arena.ts), and dark metal under all (OOBFloor_Trim).
// The zones and charts are the meshes' (measured: their outlines and UVs); the grate's pattern is drawn, not the
// game's texture: its square cells, 8 a texture tile, their holes 43 % of the area (measured), soft at the edges.
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, ShaderMaterial, type Texture, UniformsLib, UniformsUtils, Vector3 } from "three";
import { ENV_GLSL, ENV_RADIAL, ENV_SPREAD, PACK_G, PACK_G_MEAN } from "./gameSurfaces";
import { GRASS_CUBE_BLUR_LOD } from "./grassCube";

/** The zones (|x|, |y| in uu): the hex glass on the ramp, the grate (behind the goal line's strip, and beside and under
 *  the glass along the ramp); the frame elsewhere */
export const GOAL_GLASS = { x: 640, y0: 5344, y1: 5809 } as const;
export const GOAL_GRATE = { x: 768, y0: 5264, y1: 5809 } as const;
/** The lower glass (Goal_STD_Glass_Outer): this far under the top, over |x| 768, |y| 5264-5860 */
export const GOAL_UNDER_GLASS = { depth: 16, x: 768, y0: 5264, y1: 5860 } as const;
/** The dark metal under the goal (OOBFloor_Trim, DarkMetal_LessShine) */
export const GOAL_BASE_Z = -20;
/** Goal_STD_Frame's floor pieces: FrameTexture_PACK's mean R and G there (decoded, outside the stripes) and their baked
 *  light (the mesh's lightmap mean, facing up) */
const FRAME = { r: 0.146, g: 0.158, light: [1.0209, 0.9177, 0.7189] } as const;

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
    colour = glass(vec2(0.003424 * ay - 18.0243, -0.004896 * xy.x + 3.761), toCamera);
  #else
    if (ax <= ${GOAL_GLASS.x.toFixed(1)} && ay >= ${GOAL_GLASS.y0.toFixed(1)} && ay <= ${GOAL_GLASS.y1.toFixed(1)}) {
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
      colour = vec4(clamp(vec3(${FRAME.r}) + 4.0 * (0.125 + 0.625 * ${FRAME.g}) * cube, 0.0, 1.0) * frameLight, 1.0);
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

/** Under each goal's floor (`floor`: its geometry, Three's frame): the lower glass (the floor 16 uu down) and the dark
 *  metal at z -20 over the goal's floor */
export function goalUnderlayers(floor: BufferGeometry, cube: { value: Texture }): Mesh[] {
  const under = new Mesh(floor.clone().translate(0, -GOAL_UNDER_GLASS.depth, 0), new GoalFloorMaterial(cube, true));
  under.renderOrder = 1;
  under.name = "goal under glass";
  const base = new BufferGeometry();
  const pos: number[] = [];
  for (const sy of [-1, 1]) {
    const [y0, y1] = [sy * 5120, sy * 6000];
    // (Three's frame: x, up, the game's y)
    pos.push(-893, GOAL_BASE_Z, y0, 893, GOAL_BASE_Z, y0, 893, GOAL_BASE_Z, y1, -893, GOAL_BASE_Z, y0, 893, GOAL_BASE_Z, y1, -893, GOAL_BASE_Z, y1);
  }
  base.setAttribute("position", new Float32BufferAttribute(pos, 3));
  const dark = new Mesh(base, new MeshBasicMaterial({ color: 0x050506, side: DoubleSide }));
  dark.name = "goal base";
  return [under, dark];
}
