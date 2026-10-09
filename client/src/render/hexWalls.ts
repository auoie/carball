// See-through arena walls with a hexagon pattern, like the game's cage. Unlit; tinted towards each team's colour at its
// end of the field and inside its goal (colours and strengths from the theme). Around the ball the hexagons light up.
// (The game marks where the ball is with its shadow on the floor only: src/render/entities.ts.)
// The hexagons are laid on the surface's own coordinates (`surfaceUv`: in the goals uu across the goal and along its
// profile, src/render/goalSurface.ts), so they run unbroken over the curves as one structure. On the walls and ceiling
// the cage is beams (src/render/cageBeams.ts) and the material draws the see-through fill, and hexagons only on the
// lower glass below the cage (`glass`, as the game's hex-textured glass: up to z 256 all round, round the goal mouths
// up to the cage's lowest row there), in the cage's own lattice (`surfaceUv`: src/render/arenaSurface.ts) so its cells
// carry on down to the trim.

import { DoubleSide, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";
import type { WallStyle } from "./themes/theme";

const vertexShader = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
attribute vec2 surfaceUv;
varying vec2 vSurfaceUv;
#include <fog_pars_vertex>

void main() {
  vSurfaceUv = surfaceUv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 ballPosition;
uniform float ballRadius;
uniform float latticeScale;
uniform float halfWidth;
uniform vec3 neutralColor;
uniform vec3 blueColor;
uniform vec3 orangeColor;
uniform float lineStrength;
uniform float ceilingLineStrength;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec2 vSurfaceUv;
#include <fog_pars_fragment>

// 1 on the hexagon edges, 0 inside the cells (cells 1 wide across the flat sides), anti-aliased. dx and dy: the
// pattern coordinates' change per pixel.
float hexLines(vec2 uv, vec2 dx, vec2 dy, float halfWidth) {
  const vec2 r = vec2(1.0, 1.7320508);
  const vec2 slant = vec2(0.5, 0.8660254);
  vec2 a = mod(uv, r) - r * 0.5;
  vec2 b = mod(uv - r * 0.5, r) - r * 0.5;
  vec2 cell = dot(a, a) < dot(b, b) ? a : b;
  vec2 c = abs(cell);
  float slanted = dot(c, slant);
  float edge = 0.5 - max(slanted, c.x); // distance to the nearest edge
  // Its change per pixel (what fwidth would give): its gradient is the nearest edge's normal
  vec2 edgeNormal = slanted > c.x ? slant * sign(cell) : vec2(sign(cell.x), 0.0);
  float aa = abs(dot(edgeNormal, dx)) + abs(dot(edgeNormal, dy));
  // Lines thinner than a pixel are drawn a pixel wide and dimmer, instead of breaking up and shimmering
  float width = max(halfWidth, aa);
  float line = (1.0 - smoothstep(width - aa, width + aa, edge)) * (halfWidth / width);
  // Where the cells shrink to a few pixels they can't be resolved: their average (lines cover 8 x halfWidth of a cell)
  return mix(line, 8.0 * halfWidth, smoothstep(0.12, 0.3, aa));
}

void main() {
  vec3 n = normalize(vWorldNormal);
  // (the first coordinate across the hexagons' flat sides)
  vec2 uv = vSurfaceUv * latticeScale;
  float lines = hexLines(uv, dFdx(uv), dFdy(uv), halfWidth);
  #ifdef GLASS
  // Only below the cage: z 256 (its lowest row), round the goal mouths z 768
  float height = vWorldPosition.y;
  float goalSide = step(abs(vWorldPosition.x), 1140.0) * step(5000.0, abs(vWorldPosition.z));
  lines *= step(height, mix(256.0, 768.0, goalSide));
  #endif
  #ifdef NO_LINES
  lines = 0.0;
  #endif

  // Team tint towards each end (Three z = the game's y; blue defends -y)
  float end = vWorldPosition.z;
  vec3 team = end < 0.0 ? blueColor : orangeColor;
  vec3 tint = mix(neutralColor, team, smoothstep(1000.0, 4800.0, abs(end)));
  float inGoal = step(5121.0, abs(end)) * step(abs(vWorldPosition.x), 920.0);

  // The ball: hexagons light up within a few metres
  float ballDistance = length(ballPosition - vWorldPosition);
  float near = 1.0 - smoothstep(ballRadius, ballRadius + 1100.0, ballDistance);

  // The ceiling stays faint (it's mostly overhead, in the way of the view)
  float ceiling = smoothstep(0.5, 0.9, -n.y);
  float lineAlpha = lines * (mix(lineStrength, ceilingLineStrength, ceiling) + 0.75 * near);
  float fillAlpha = mix(mix(0.05, 0.02, ceiling), 0.28, inGoal) + 0.1 * near;
  vec3 lineColor = mix(tint, vec3(1.0), 0.2 + 0.6 * near);
  vec3 color = mix(tint * 0.7, lineColor, lineAlpha / max(lineAlpha + fillAlpha, 1e-4));
  gl_FragColor = vec4(color, clamp(fillAlpha + lineAlpha, 0.0, 1.0));

  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class HexWallMaterial extends ShaderMaterial {
  /** The ball's centre (Three.js frame), shared by every surface using this material. */
  readonly ballPosition: Vector3;

  /** Hexagons on the mesh's `surfaceUv` attribute times `scale` (in cells: 1 across the flat sides), their lines
   *  `halfWidth` (cells) wide either side; `lines`: "glass" only on the lower glass (see above), "none" only the fill. */
  constructor(
    ballRadius: number,
    style: WallStyle,
    options: { readonly scale?: number; readonly halfWidth?: number; readonly lines?: "all" | "glass" | "none" },
  ) {
    const ballPosition = new Vector3(0, -100_000, 0); // (far away until the first update)
    super({
      vertexShader,
      fragmentShader,
      defines: options.lines === "glass" ? { GLASS: "" } : options.lines === "none" ? { NO_LINES: "" } : {},
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ballPosition: { value: ballPosition },
        ballRadius: { value: ballRadius },
        latticeScale: { value: options.scale ?? 1 },
        halfWidth: { value: options.halfWidth ?? 0.012 },
        neutralColor: { value: style.neutral },
        blueColor: { value: style.blue },
        orangeColor: { value: style.orange },
        lineStrength: { value: style.lines },
        ceilingLineStrength: { value: style.ceilingLines },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide, // (the game's cage shows from outside the arena too)
      fog: true,
    });
    this.ballPosition = ballPosition;
  }
}
