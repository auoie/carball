// Building blocks for scenery: coloured parts merged into one geometry, instancing, and vertex animation.
import {
  type BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface Placement {
  readonly position?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number]; // Euler XYZ, radians
  readonly scale?: readonly [number, number, number];
}

/**
 * A part in one colour, placed: positions and normals only, indexed (so merged parts stay indexed, and shared vertices
 * are shaded once).
 */
export function part(geometry: BufferGeometry, color: Color | number, placement: Placement = {}): BufferGeometry {
  const g = geometry;
  if (!g.index) g.setIndex(Array.from({ length: g.getAttribute("position").count }, (_, i) => i));
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position" && name !== "normal") g.deleteAttribute(name);
  }
  g.applyMatrix4(placementMatrix(placement));
  const c = typeof color === "number" ? new Color(color) : color;
  const colors = new Float32Array(g.getAttribute("position").count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
}

/** Parts merged into one geometry (one draw call). */
export function combine(parts: readonly BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries([...parts]);
  for (const p of parts) p.dispose();
  return merged;
}

export function placementMatrix({ position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] }: Placement): Matrix4 {
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rotation[0]);
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotation[1]));
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rotation[2]));
  return new Matrix4().compose(new Vector3(...position), q, new Vector3(...scale));
}

/**
 * Fog for additive (glowing) materials, in place of `#include <fog_fragment>`: their light fades out with distance.
 * (Blending towards the fog's colour, as the standard chunk does, would add the haze colour instead: bright blotches.)
 */
export const ADDITIVE_FOG = /* glsl */ `
  #ifdef USE_FOG
    gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif`;

/**
 * Copies of a geometry (one draw call), each placed and, if `tinted`, tinted by its placement's tint. Spread over the
 * scenery: never culled.
 */
export function instances(
  geometry: BufferGeometry,
  material: Material,
  placements: readonly (Placement & { readonly tint?: Color })[],
  tinted = true,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, placements.length);
  placements.forEach((p, i) => {
    mesh.setMatrixAt(i, placementMatrix(p));
    if (tinted && p.tint) mesh.setColorAt(i, p.tint);
  });
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Adds vertex animation to a material: GLSL run after `begin_vertex`, which may move `transformed` (the vertex in the
 * model's own frame, before its instance matrix), with `time` (seconds) and the given extra uniforms available; and
 * optionally GLSL run after `beginnormal_vertex`, to turn `objectNormal` the same way (for lighting). Returns the
 * uniforms, to update. Pass a `time` in `extra` to share one clock between materials.
 */
export function animate<U extends Record<string, { value: unknown }>>(
  material: Material,
  glsl: string,
  declarations: string,
  extra: U,
  normalGlsl = "",
): U & { time: { value: number } } {
  const uniforms = { time: { value: 0 }, ...extra };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `uniform float time;\n${declarations}\n${shader.vertexShader}`
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${glsl}`)
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>\n${normalGlsl}`);
  };
  // Three.js reuses compiled shaders by this key (by default the source of onBeforeCompile, the same for every
  // animation): each animation gets its own
  const key = `${declarations}|${glsl}|${normalGlsl}`;
  material.customProgramCacheKey = () => key;
  return uniforms;
}
