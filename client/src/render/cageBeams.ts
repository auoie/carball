// The cage's beams drawn (src/render/cage.ts): each a ribbon on the surface along its centre line, an 8 uu core (the
// game's beams' width) in a glow,
// tinted towards each team's colour at its end of the field (colours and strengths from the theme, as the walls'),
// lighting up around the ball, fainter on the ceiling. Seen from far off a beam stays at least about a pixel wide,
// dimmer instead of thinner, so it doesn't break up or shimmer. Visible from both sides, as the game's.
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from "three";
import type { CageGraph } from "./cage";
import type { WallStyle } from "./themes/theme";

/** The ribbon's half width (uu): the beam's core (the game's beams are 8 uu wide) and its glow round it */
const HALF_WIDTH = 10;
const CORE_HALF_WIDTH = 4;
/** The glow's strength next to the core, and the beams' against the walls' lines (themes' `lines`) */
const GLOW = 0.45;
const STRENGTH = 1.3;
/** The least half width on screen (pixels) */
const MIN_HALF_PIXELS = 0.75;

const vertexShader = /* glsl */ `
attribute vec3 side;
attribute float across;
attribute vec3 beamNormal;
uniform float halfWidth;
uniform float minHalfPixels;
uniform vec2 viewport;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vAcross;
varying float vFade;
#include <fog_pars_vertex>

void main() {
  // How many pixels the beam's half width is here: widened to the least, and dimmed by as much
  mat4 toClip = projectionMatrix * viewMatrix * modelMatrix;
  vec4 centre = toClip * vec4(position, 1.0);
  vec4 edge = toClip * vec4(position + side * halfWidth, 1.0);
  float widen = 1.0;
  if (centre.w > 0.0 && edge.w > 0.0) {
    float pixels = length((edge.xy / edge.w - centre.xy / centre.w) * 0.5 * viewport);
    widen = max(1.0, minHalfPixels / max(pixels, 1e-4));
  }
  vec4 world = modelMatrix * vec4(position + side * (halfWidth * widen * across), 1.0);
  vWorldPosition = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * beamNormal);
  vAcross = across;
  vFade = 1.0 / widen;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 ballPosition;
uniform float ballRadius;
uniform vec3 neutralColor;
uniform vec3 blueColor;
uniform vec3 orangeColor;
uniform float lineStrength;
uniform float ceilingLineStrength;
uniform float halfWidth;
uniform float coreHalfWidth;
uniform float glow;
uniform float strength;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vAcross;
varying float vFade;
#include <fog_pars_fragment>

void main() {
  // The core, anti-aliased, in its glow (uu from the centre line)
  float d = abs(vAcross) * halfWidth;
  float aa = max(fwidth(d), 1e-3);
  float core = 1.0 - smoothstep(coreHalfWidth - aa, coreHalfWidth + aa, d);
  float profile = max(core, glow * (1.0 - smoothstep(coreHalfWidth, halfWidth, d)));
  // Team tint towards each end (Three z = the game's y; blue defends -y)
  float end = vWorldPosition.z;
  vec3 team = end < 0.0 ? blueColor : orangeColor;
  vec3 tint = mix(neutralColor, team, smoothstep(1000.0, 4800.0, abs(end)));
  float near = 1.0 - smoothstep(ballRadius, ballRadius + 1100.0, length(ballPosition - vWorldPosition));
  float ceiling = smoothstep(0.5, 0.9, -normalize(vWorldNormal).y);
  float alpha = profile * vFade * (strength * mix(lineStrength, ceilingLineStrength, ceiling) + 0.75 * near);
  gl_FragColor = vec4(mix(tint, vec3(1.0), 0.2 + 0.6 * near), clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The game frame (x, y, z up) to Three's (x, z up, y) */
const three = (v: readonly [number, number, number]): [number, number, number] => [v[0], v[2], v[1]];

export class CageBeams {
  readonly mesh: Mesh;
  /** The ball's centre (Three.js frame), read every frame */
  readonly ballPosition = new Vector3(0, -100_000, 0);

  constructor(graph: CageGraph, ballRadius: number, style: WallStyle) {
    const positions: number[] = [];
    const sides: number[] = [];
    const acrosses: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const beam of graph.beams) {
      const { points, normals: beamNormals } = beam;
      const n = points.length;
      points.forEach((point, k) => {
        const before = points[Math.max(0, k - 1)] ?? point;
        const after = points[Math.min(n - 1, k + 1)] ?? point;
        const tangent = new Vector3(...three(after)).sub(new Vector3(...three(before))).normalize();
        const normal = new Vector3(...three(beamNormals[k] ?? [0, 0, 1]));
        const side = new Vector3().crossVectors(tangent, normal).normalize();
        // (the ends reach a core's half width on, so beams meeting at a point overlap there instead of leaving a notch)
        const reach = k === 0 ? -CORE_HALF_WIDTH : k === n - 1 ? CORE_HALF_WIDTH : 0;
        const centre = new Vector3(...three(point)).addScaledVector(tangent, reach);
        const base = positions.length / 3;
        for (const across of [-1, 1]) {
          positions.push(centre.x, centre.y, centre.z);
          sides.push(side.x, side.y, side.z);
          acrosses.push(across);
          normals.push(normal.x, normal.y, normal.z);
        }
        if (k > 0) indices.push(base - 2, base - 1, base, base - 1, base + 1, base);
      });
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("side", new BufferAttribute(new Float32Array(sides), 3));
    geometry.setAttribute("across", new BufferAttribute(new Float32Array(acrosses), 1));
    geometry.setAttribute("beamNormal", new BufferAttribute(new Float32Array(normals), 3));
    geometry.setIndex(indices);
    const viewport = new Vector2(1280, 720);
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ballPosition: { value: this.ballPosition },
        ballRadius: { value: ballRadius },
        halfWidth: { value: HALF_WIDTH },
        coreHalfWidth: { value: CORE_HALF_WIDTH },
        glow: { value: GLOW },
        strength: { value: STRENGTH },
        minHalfPixels: { value: MIN_HALF_PIXELS },
        viewport: { value: viewport },
        neutralColor: { value: style.neutral },
        blueColor: { value: style.blue },
        orangeColor: { value: style.orange },
        lineStrength: { value: style.lines },
        ceilingLineStrength: { value: style.ceilingLines },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false; // (it surrounds the field: always in view)
    this.mesh.renderOrder = 2; // (over the walls' see-through fill)
    this.mesh.onBeforeRender = (renderer: WebGLRenderer) => {
      renderer.getDrawingBufferSize(viewport);
    };
  }
}
