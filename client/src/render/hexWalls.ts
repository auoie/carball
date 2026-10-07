// See-through arena walls with a hexagon pattern, like the game's. Unlit; tinted towards each team's colour at its
// end of the field and inside its goal. Around the ball the hexagons light up, and the ball's footprint shows on the
// surface it is heading for, brighter the closer it gets: that's where it will touch.
// Hexagons are projected along the surface's dominant axis (blended on the curves), in world space, so the pattern is
// continuous across separate meshes.
import { Color, FrontSide, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";

/** Hexagon width across the flat sides (uu). */
export const HEX_SIZE = 240;

const vertexShader = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
#include <fog_pars_vertex>

void main() {
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
uniform float hexSize;
uniform vec3 neutralColor;
uniform vec3 blueColor;
uniform vec3 orangeColor;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
#include <fog_pars_fragment>

// Distance from a hexagon's centre: 0.5 on its edges (cells 1 wide across the flat sides)
float hexDistance(vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x);
}

// 1 on the hexagon edges, 0 inside the cells (anti-aliased)
float hexLines(vec2 uv, float halfWidth) {
  const vec2 r = vec2(1.0, 1.7320508);
  vec2 a = mod(uv, r) - r * 0.5;
  vec2 b = mod(uv - r * 0.5, r) - r * 0.5;
  vec2 cell = dot(a, a) < dot(b, b) ? a : b;
  float edge = 0.5 - hexDistance(cell);
  float aa = fwidth(edge);
  // Fade the lines out where they get thinner than a pixel, instead of shimmering
  float fade = 1.0 - smoothstep(halfWidth * 0.5, halfWidth * 1.5, aa);
  return (1.0 - smoothstep(halfWidth - aa, halfWidth + aa, edge)) * fade;
}

void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 p = vWorldPosition / hexSize;
  vec3 weights = pow(abs(n), vec3(8.0));
  weights /= weights.x + weights.y + weights.z;
  float lines = weights.x * hexLines(p.zy, 0.025) + weights.y * hexLines(p.xz, 0.025) + weights.z * hexLines(p.xy, 0.025);

  // Team tint towards each end (Three z = the game's y; blue defends -y)
  float end = vWorldPosition.z;
  vec3 team = end < 0.0 ? blueColor : orangeColor;
  vec3 tint = mix(neutralColor, team, smoothstep(1000.0, 4800.0, abs(end)));
  float inGoal = step(5121.0, abs(end)) * step(abs(vWorldPosition.x), 920.0);

  // The ball: hexagons light up within a few metres, and its footprint on the surface grows brighter as it closes in
  vec3 toBall = ballPosition - vWorldPosition;
  float ballDistance = length(toBall);
  float height = dot(toBall, n); // the ball centre's distance in front of the surface
  float lateral = length(toBall - n * height);
  float near = 1.0 - smoothstep(ballRadius, ballRadius + 1100.0, ballDistance);
  float closing = (1.0 - smoothstep(ballRadius, ballRadius + 1400.0, height)) * step(-ballRadius, height);
  float footprint = (1.0 - smoothstep(ballRadius * 0.7, ballRadius * 1.05, lateral)) * closing;
  float ring = (1.0 - smoothstep(0.0, 6.0 + 0.004 * ballDistance, abs(lateral - ballRadius))) * closing;

  // The ceiling stays faint (it's mostly overhead, in the way of the view)
  float ceiling = smoothstep(0.5, 0.9, -n.y);
  float lineAlpha = lines * (mix(0.2, 0.06, ceiling) + 0.75 * near);
  float fillAlpha = mix(mix(0.05, 0.02, ceiling), 0.28, inGoal) + 0.1 * near + 0.22 * footprint * footprint;
  vec3 lineColor = mix(tint, vec3(1.0), 0.2 + 0.6 * near);
  vec3 color = mix(tint * 0.7, lineColor, lineAlpha / max(lineAlpha + fillAlpha, 1e-4));
  color = mix(color, vec3(1.0), max(footprint * 0.5, ring));
  gl_FragColor = vec4(color, clamp(fillAlpha + lineAlpha + ring * 0.8, 0.0, 1.0));

  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class HexWallMaterial extends ShaderMaterial {
  /** The ball's centre (Three.js frame), shared by every surface using this material. */
  readonly ballPosition: Vector3;

  constructor(ballRadius: number) {
    const ballPosition = new Vector3(0, -100_000, 0); // (far away until the first update)
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ballPosition: { value: ballPosition },
        ballRadius: { value: ballRadius },
        hexSize: { value: HEX_SIZE },
        neutralColor: { value: new Color(0x8fa6c8) },
        blueColor: { value: new Color(0x2a7fff) },
        orangeColor: { value: new Color(0xff8a1f) },
      },
      transparent: true,
      depthWrite: false,
      side: FrontSide,
      fog: true,
    });
    this.ballPosition = ballPosition;
  }
}
