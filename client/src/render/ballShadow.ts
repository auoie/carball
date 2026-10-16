// The ball's ground reticle (notes/visual-timing.md VT-30a: Ball_GroundReticle_DMat, the static session's BR1): not a
// shadow but two thin white rings, added (unlit, no team tint, no animation, no height fade), 192 x 192 uu straight down
// from the ball's centre, square to the world's axes: the outer ring fixed at 93 uu, the inner one contracting as the
// ball's centre rises (86.5 uu at Z 0, 82.4 at rest, gone by Z 993, a four-petal dot from 1024), cut into four arcs by a
// cross along X and Y. The floor's decal is the ball view's (src/render/entities.ts); this chunk puts it on the other
// surfaces that take it (the trims, fillets, frames, the posts' bases), within the decal's window (from 50 uu above the
// ball's centre to 3096 below it) and fading only on faces turned down.
import type { MeshStandardMaterial, Vector3 } from "three";

/** The rule's numbers (VT-30a): half the decal's side (uu); the rings' centres in d2 = (r / 96)^2 (the outer fixed, the
 *  inner's 0.8125 - 0.8375 sat(Z / 1024)); their sharpness; the cross's half width (in p) and its cut; the cap; the window
 *  below the ball (uu) and its fade; the facing's divisor */
export const RETICLE = {
  half: 96,
  outer: 0.9375,
  inner: [0.8125, 0.8375] as const,
  altitude: 1024,
  sharp: 16,
  cross: 0.0625,
  crossCut: 4,
  max: 0.5,
  window: [-50, 3096] as const,
  fade: 5,
  facing: 1.0087265,
} as const;

const sat = (x: number): number => Math.min(1, Math.max(0, x));

/** sRGB to linear (the cross's texture is read as sRGB) */
function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The reticle's brightness (linear, added white) at p = (P - ball) / 96 in the world's X and Y, the ball's centre at
 *  `altitude` (uu): the game's rule */
export function reticle(px: number, py: number, altitude: number): number {
  const R = RETICLE;
  if (Math.max(Math.abs(px), Math.abs(py)) > 1) return 0;
  const d2 = px * px + py * py;
  const outer = Math.max(0, 1 - R.sharp * Math.abs(d2 - R.outer));
  const c = R.inner[0] - R.inner[1] * sat(altitude / R.altitude);
  const cross = linear(Math.max(0, 1 - Math.min(Math.abs(px), Math.abs(py)) / R.cross));
  const inner = sat(1 - R.sharp * Math.abs(d2 - c) - R.crossCut * cross);
  return Math.min(outer + inner, R.max);
}

/** GLSL: `ballReticle(p, altitude)`, `reticle` above; its rings at least a pixel and a quarter wide, as dim as they're
 *  widened (no shimmer far off) */
export const RETICLE_GLSL_FN = /* glsl */ `
float reticleLinear(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
float ballReticle(vec2 p, float altitude) {
  if (max(abs(p.x), abs(p.y)) > 1.0) return 0.0;
  float d2 = dot(p, p);
  float band = max(${(1 / RETICLE.sharp).toFixed(5)}, fwidth(d2) * 1.25);
  float dim = ${(1 / RETICLE.sharp).toFixed(5)} / band;
  float outer = max(0.0, 1.0 - abs(d2 - ${RETICLE.outer.toFixed(4)}) / band) * dim;
  float c = ${RETICLE.inner[0].toFixed(4)} - ${RETICLE.inner[1].toFixed(4)} * clamp(altitude / ${RETICLE.altitude.toFixed(1)}, 0.0, 1.0);
  float cut = reticleLinear(max(0.0, 1.0 - min(abs(p.x), abs(p.y)) / ${RETICLE.cross.toFixed(4)}));
  float inner = clamp(1.0 - abs(d2 - c) / band - ${RETICLE.crossCut.toFixed(1)} * cut, 0.0, 1.0) * dim;
  return min(outer + inner, ${RETICLE.max.toFixed(2)});
}
`;

/** A surface's chunk: gl_FragColor's rgb plus the reticle, projected straight down (Three's frame: y up), within its
 *  window and by the surface's facing (`vReticleWorld`, `vReticleNormal` (world), `reticleBall` given; after
 *  RETICLE_GLSL_FN) */
export const BALL_RETICLE_GLSL = /* glsl */ `
{
  float w = reticleBall.y - vReticleWorld.y;
  float window = step(${RETICLE.window[0].toFixed(1)}, w) * step(w, ${RETICLE.window[1].toFixed(1)})
    * clamp(${RETICLE.fade.toFixed(1)} * (1.0 - abs(w) / ${RETICLE.window[1].toFixed(1)}), 0.0, 1.0)
    * clamp((normalize(vReticleNormal).y + 1.0) / ${RETICLE.facing.toFixed(7)}, 0.0, 1.0);
  gl_FragColor.rgb += vec3(window * ballReticle((vReticleWorld.xz - reticleBall.xz) / ${RETICLE.half.toFixed(1)}, reticleBall.y));
}
`;

/** Adds the ball's reticle to `material` (a surface that takes the decal): `ballPosition` (Three's frame) read every
 *  frame */
export function addBallReticle(material: MeshStandardMaterial, ballPosition: Vector3): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["reticleBall"] = { value: ballPosition };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vReticleWorld;\nvarying vec3 vReticleNormal;")
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvReticleNormal = mat3(modelMatrix) * objectNormal;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvReticleWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vReticleWorld;\nvarying vec3 vReticleNormal;\nuniform vec3 reticleBall;\n${RETICLE_GLSL_FN}`)
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>\n${BALL_RETICLE_GLSL}`);
  };
  material.customProgramCacheKey = () => "ballReticle";
}
