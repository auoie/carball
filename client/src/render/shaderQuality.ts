// High Quality Shaders (notes/post-processing.md §13: bAllowHighQualityMaterials, off in Render Detail Performance): a
// material with a low-quality path (its shader's CARBALL_LQ branch: the game's materials' low-quality resources as GQ1
// read them) is marked here, and the switch turns that branch on or off on every marked material (a recompile each)
import type { Material, Object3D } from "three";

/** Marks `material` as having a CARBALL_LQ branch; returns it */
export function lowQualityPath<T extends Material>(material: T): T {
  (material.userData as { lowQualityPath?: boolean }).lowQualityPath = true;
  return material;
}

/** Every marked material under `root` (High Quality Shaders on: their full shaders; off: their CARBALL_LQ branches); the
 *  count changed */
export function applyShaderQuality(root: Object3D, highQuality: boolean): number {
  const seen = new Set<Material>();
  let changed = 0;
  root.traverse((o) => {
    const material = (o as Object3D & { material?: Material | Material[] }).material;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      if (seen.has(m) || !(m.userData as { lowQualityPath?: boolean }).lowQualityPath) continue;
      seen.add(m);
      const shader = m as Material & { defines?: Record<string, unknown> };
      shader.defines ??= {};
      const low = "CARBALL_LQ" in shader.defines;
      if (low === !highQuality) continue;
      if (highQuality) delete shader.defines["CARBALL_LQ"];
      else shader.defines["CARBALL_LQ"] = "";
      m.needsUpdate = true;
      changed++;
    }
  });
  return changed;
}
