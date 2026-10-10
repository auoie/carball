// The game's translucent order (notes/arena-surroundings.md SUR-32, TRN1: UE3's RenderTranslucency, per view, the
// capture's six faces each its own): ascending TranslucencySortPriority (our renderOrder), then the view-space depth of
// each primitive's bounds origin, farthest first. Not three's default, the projected z of the same point: behind the
// camera (a big object's origin behind a cube face) that misorders. And for a sprite drawn nearer than it is, its depth
// as if at its true place (withTrueDepth), so what stands between covers it.
import type { Camera, InstancedMesh, Mesh, Object3D, Scene, ShaderMaterial, WebGLRenderer } from "three";
import { Matrix4, Vector3 } from "three";

/** TranslucencySortPriority as the game sets it (TRN1; the class default 0): the stadium's layers */
export const PRIORITY = {
  /** the four big capture hotspots (_13, _2, _12, _3): drawn first, under every fog layer and the canopy's glass */
  bigHotspot: -16,
  /** the FogCylinder (our far layer: the city and the band) */
  fogCylinder: -14,
  /** the four big fog sheets (the -X plaza's and the three far ones) */
  bigFogSheet: -10,
  /** the canopy's glass (Stadium_Glass) */
  canopy: -9,
  /** the fog bowl (FogHemisphere_V2) and the canopy's mullions (GlassSupports) */
  fogBowl: -8,
  glassSupports: -8,
  /** the low fog sheets behind the goals (48, +-7700, -192) */
  lowFogSheet: -5,
  /** the haze (FogMesh_01) and the floodlights' flare sheets (additive) */
  haze: -4,
  flares: -4,
  /** the other hotspots (_0, _5, _7), the team light cones, the building lights */
  base: 0,
  /** the team hotspots (_6, _1, additive) */
  teamHotspot: 4,
  /** the stands' base glass (HexGlass) and hand rails; the canopy's second glass (Stadium_Glass_02) */
  baseGlass: -11,
  canopy2: -7,
} as const;

/** The arena's pieces' (TRN1: the main view sorted as the capture; spawned boost pads the class default) */
export const ARENA_PRIORITY = {
  /** AdvertStrip_Field_Outer (DarkMetal_SeeThru) */
  advertStrip: -5,
  /** Field_Center_Trim (TrimLight_None); Goal_STD_Glass_Outer (HexGlass) */
  centreTrim: -3,
  goalGlassOuter: -3,
  /** Field_Center_Lines (PaintedLine) */
  centreLines: -2,
  /** FieldFrame_Outer (Frame_01_CamFade); Field_STD_Glass (HexGlass); Field_STD_Glow, Side_Trim (TrimLight_Glow) */
  frameOuter: -1,
  fieldGlass: -1,
  fieldGlow: -1,
  /** FFCage_Full; the nets; Field_Side_Lines, Goal_Lines; Goal_STD_Glass; Goal_STD_Glow, Goal_STD_Outer; boost pads */
  base: 0,
} as const;

/** A render list's item (three's WebGLRenderLists) as far as the sort reads it */
export interface SortItem {
  readonly id: number;
  readonly object: Object3D;
  readonly groupOrder: number;
  readonly renderOrder: number;
}

const view = new Matrix4();
const centre = new Vector3();

/** The view the next sort is for (the camera drawing: set before each render, a cube face's too) */
export function sortFor(camera: Camera): void {
  view.copy(camera.matrixWorldInverse);
}

/** How far in front of the view an object's bounds origin is (its bounding sphere's centre, the box's centre: an
 *  instanced mesh's over all its copies) */
export function viewDepth(object: Object3D): number {
  const instanced = object as Partial<InstancedMesh>;
  const geometry = (object as Partial<Mesh>).geometry;
  let sphere: { center: Vector3 } | null = null;
  if (instanced.isInstancedMesh === true && instanced.computeBoundingSphere) {
    if (!instanced.boundingSphere) instanced.computeBoundingSphere();
    sphere = instanced.boundingSphere ?? null;
  } else if (geometry) {
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    sphere = geometry.boundingSphere;
  }
  if (sphere) centre.copy(sphere.center);
  else centre.set(0, 0, 0);
  return -centre.applyMatrix4(object.matrixWorld).applyMatrix4(view).z;
}

/** The order: three's group order, then the priority, then farthest first (the game's ties have no order: ours by id) */
export function gameTranslucentSort(a: SortItem, b: SortItem): number {
  return a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || viewDepth(b.object) - viewDepth(a.object) || a.id - b.id;
}

/** The renderer's translucents in the game's order, for every view the scene is drawn from */
export function useGameTranslucentSort(gl: WebGLRenderer, scene: Scene): void {
  const before = scene.onBeforeRender.bind(scene);
  scene.onBeforeRender = (renderer, s, camera, geometry, material, group) => {
    sortFor(camera);
    before(renderer, s, camera, geometry, material, group);
  };
  gl.setTransparentSort(gameTranslucentSort as (a: unknown, b: unknown) => number);
}

/** The largest depth written short of the far plane's (a true place past it: in front of nothing but the sky) */
const DEPTH_MAX = 1 - 2 ** -22;

/** A sprite drawn at `scale`'s fraction of its distance from `about` (Three's frame) given the depth of its true place:
 *  each fragment's own point scaled back out (its triangle's barycentrics kept: the scaling is affine), past the far
 *  plane held just short of it. Depth-tested as there, so whatever stands between covers it (a shader material's own
 *  shaders, no instancing) */
export function withTrueDepth(material: ShaderMaterial, scale: number, about: readonly [number, number, number]): ShaderMaterial {
  const a = `vec3(${about.map((v) => v.toFixed(3)).join(", ")})`;
  material.vertexShader = wrap(
    `varying vec4 vTrueClip;\n${material.vertexShader}`,
    `  vec3 rlWorld = (modelMatrix * vec4(position, 1.0)).xyz;\n  vTrueClip = projectionMatrix * viewMatrix * vec4(${a} + (rlWorld - ${a}) * ${scale.toFixed(6)}, 1.0);`,
  );
  material.fragmentShader = wrap(
    `varying vec4 vTrueClip;\n${material.fragmentShader}`,
    `  gl_FragDepth = min(0.5 * vTrueClip.z / vTrueClip.w + 0.5, ${DEPTH_MAX.toFixed(9)});`,
  );
  material.userData["trueDepth"] = scale;
  return material;
}

/** A shader's main renamed, and a new main calling it, then `after` */
function wrap(shader: string, after: string): string {
  const main = /\bvoid\s+main\s*\(\s*(void)?\s*\)/;
  if (!main.test(shader)) throw new Error("a shader without a main");
  return `${shader.replace(main, "void rlTrueDepthMain()")}\nvoid main() {\n  rlTrueDepthMain();\n${after}\n}\n`;
}
