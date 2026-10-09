// The game's wall, glass and glow materials (notes/arena-visuals.md H-5, H-6, H-9), drawn in code: the hexagon
// textures they sample replaced by a procedural flat-top hex grid fitted to the game's (TiledPatterns.Hexagons_Pack
// and CS_FX Hexagons_Pack_01_T: 2 x 2 cells a tile, columns half a tile apart, rows half a tile apart across the flats,
// odd columns half a row down; ForcefieldHex the same at 16 x 16), and their channels by profiles measured against the
// hex radius (0 at a cell's centre, 1 at its edge). Values only; the textures stay local.
import { DoubleSide, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";
import type { Color } from "three";

/** By hex radius in 32 steps, measured from the game's textures (the mean over each step: 16 over r 0-0.8, then 16
 *  over 0.8-1 where the lines are): TiledPatterns.Hexagons_Pack G (the lower glass's alpha shape); the ball tracker's
 *  Hexagons_Pack_01_T R (glowing lines) and G (a band inside each cell); ForcefieldHex R (the fine net) */
const PACK_G = [
  0.93, 0.93, 0.928, 0.911, 0.908, 0.908, 0.908, 0.908, 0.908, 0.908, 0.913, 0.988, 1, 1, 1, 0.899, 0.745, 0.742, 0.742, 0.743, 0.744,
  0.742, 0.736, 0.727, 0.716, 0.702, 0.687, 0.668, 0.64, 0.601, 0.533, 0.453,
];
const TRACKER_R = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.001, 0.01, 0.044, 0.087, 0.145, 0.206, 0.267, 0.345, 0.425, 0.514, 0.669,
  0.797,
];
const TRACKER_G = [0.004, 0.004, 0.004, 0, 0, 0, 0, 0, 0, 0, 0.004, 0.756, 1, 1, 1, 0.351, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const NET_R = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.01, 0.044, 0.139, 0.263, 0.387, 0.517, 0.596, 0.71, 0.825, 0.957,
  0.984,
];

const hexGlsl = /* glsl */ `
// The hex radius (0 at a cell's centre, 1 at its edge) at tile coordinates (2 columns a tile): the game's flat-top
// cells, edge 1/3 of a tile, columns 1/2 apart, rows 1/2 apart across the flats (squashed: across flats / edge = 1.5)
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
// A 32-step profile (16 steps over r 0-0.8, 16 over 0.8-1), interpolated between the steps' middles
float profile32(float table[32], float r) {
  float rr = clamp(r, 0.0, 1.0);
  float x = (rr < 0.8 ? rr * 20.0 : 16.0 + (rr - 0.8) * 80.0) - 0.5;
  int i = int(clamp(floor(x), 0.0, 31.0));
  int j = min(i + 1, 31);
  return mix(table[i], table[j], clamp(x - float(i), 0.0, 1.0));
}
float saturate1(float x) { return clamp(x, 0.0, 1.0); }
`;

const vertexShader = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
attribute vec2 glassTile;
varying vec2 vGlassTile;
#include <fog_pars_vertex>
void main() {
  vGlassTile = glassTile;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** FF_Side / FF_Roof (Beach_NetFence_MIC, AV-16, H-9): over the walls and ceiling, a faint fine hex net everywhere
 *  (25 % on its lines), and round the ball a hex disc within 220-300 uu and a thin team-coloured ring at 312-325 uu */
const overlayFragment = /* glsl */ `
uniform vec3 ballPosition;
uniform vec3 primary0;
uniform vec3 primary1;
uniform float trackerR[32];
uniform float trackerG[32];
uniform float netR[32];
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
#include <fog_pars_fragment>
${hexGlsl}
void main() {
  // (the game's frame: Three's x, z, y)
  vec3 p = vWorldPosition.xzy;
  vec3 n = abs(normalize(vWorldNormal).xzy);
  // UV: 256 uu a unit along the surface (each wall its own plane, the ceiling flat)
  vec2 uv = (n.z > 0.7 ? p.xy : n.x > n.y ? p.yz : p.xz) / 256.0;
  float d = length(p - ballPosition.xzy);
  float F = saturate1(1.0 - 0.04 * (d - 300.0));
  float outside = saturate1(12.0 * (0.5 - F));
  float ring = saturate1(2.0 * (outside * F - 0.001));
  // The ball tracker (Hexagons_Pack_01_T) at uv x 1.75; ForcefieldHex (16 columns a tile) at uv x (0.99, 0.9)
  float hexR = hexRadius(uv * 1.75);
  float hex = 8.0 * profile32(trackerR, hexR) * saturate1((220.0 - d) * 0.0015)
    + saturate1(0.025 * profile32(trackerG, hexR) * saturate1((300.0 - d) * 0.01));
  vec2 netTile = uv * vec2(0.99, 0.9) * 8.0;
  float net = profile32(netR, hexRadius(netTile));
  // (where the net's cells shrink under a few pixels: their average, not shimmer)
  float shrink = smoothstep(0.08, 0.25, length(fwidth(netTile)));
  net = mix(net, 0.13, shrink);
  float alpha = mix(ring * (1.0 - net - 0.25 * outside * net) + 0.25 * outside * net, hex, F);
  vec3 team = 2.0 * mix(primary0, primary1, saturate1(p.y / 400.0 + 0.5));
  vec3 colour = mix(mix(vec3(0.25), team, ring), vec3(0.6), saturate1(hex));
  gl_FragColor = vec4(1.0 - exp(-colour), saturate1(alpha));
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The lower glass (Field_STD_Glass, Goal_STD_Glass; H-6): white, not team-tinted, its alpha 0.1875 x Hexagons_Pack.G
 *  at its tile coordinates (`glassTile`: the mesh UV0 x (3, 7/3)) */
const glassFragment = /* glsl */ `
uniform float packG[32];
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec2 vGlassTile;
#include <fog_pars_fragment>
${hexGlsl}
void main() {
  float g = profile32(packG, hexRadius(vGlassTile));
  // (cells under a few pixels: the tile's average)
  g = mix(g, 0.85, smoothstep(0.1, 0.3, length(fwidth(vGlassTile))));
  float alpha = 0.1875 * g;
  // ENVPack.G seen along the view (a stylised reflection), + 1/12: brighter at grazing angles
  vec3 toCamera = normalize(cameraPosition - vWorldPosition);
  float grazing = 1.0 - abs(dot(normalize(vWorldNormal), toCamera));
  vec3 colour = vec3(1.0 / 12.0 + 0.45 * grazing * grazing);
  gl_FragColor = vec4(colour, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The team glow strips (TrimLight_Glow_Team1/2, H-5): unlit, two-sided; `glow` 1 at the edge a sheet is attached by,
 *  0 at its far edge; colour C0 + k (2 FB - C0) with k = sat(glow^2 - 0.75), C0 the team's primary; alpha 0.5 glow^4 */
const glowVertex = /* glsl */ `
attribute float glow;
varying float vGlow;
#include <fog_pars_vertex>
void main() {
  vGlow = glow;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const glowFragment = /* glsl */ `
uniform vec3 primary;
uniform vec3 bright;
varying float vGlow;
#include <fog_pars_fragment>
void main() {
  float u = clamp(vGlow, 0.0, 1.0);
  float k = clamp(u * u - 0.75, 0.0, 1.0);
  vec3 colour = primary + k * (2.0 * bright - primary);
  gl_FragColor = vec4(colour, 0.5 * u * u * u * u);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class GlowStripMaterial extends ShaderMaterial {
  /** `primary` and `bright`: the team's primary and its FullBright (linear) */
  constructor(primary: Color, bright: Color) {
    super({
      vertexShader: glowVertex,
      fragmentShader: glowFragment,
      uniforms: { ...UniformsUtils.clone(UniformsLib.fog), primary: { value: primary }, bright: { value: bright } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
  }
}

/** The walls' and ceiling's overlay round the ball, in the teams' linear primaries */
export class ForceFieldMaterial extends ShaderMaterial {
  readonly ballPosition: Vector3;

  constructor(primary0: Color, primary1: Color) {
    const ballPosition = new Vector3(0, -100_000, 0);
    super({
      vertexShader,
      fragmentShader: overlayFragment,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ballPosition: { value: ballPosition },
        primary0: { value: primary0 },
        primary1: { value: primary1 },
        trackerR: { value: TRACKER_R },
        trackerG: { value: TRACKER_G },
        netR: { value: NET_R },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
    this.ballPosition = ballPosition;
  }
}

/** The lower glass: its mesh carries `glassTile` (tile coordinates: its UV0 x (3, 7/3)) */
export class HexGlassMaterial extends ShaderMaterial {
  constructor() {
    super({
      vertexShader,
      fragmentShader: glassFragment,
      uniforms: { ...UniformsUtils.clone(UniformsLib.fog), packG: { value: PACK_G } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
  }
}
