// Fewer draw calls: static parts sharing a material are baked into one mesh.
import { type BufferGeometry, Group, type Material, Mesh, type Object3D } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * The meshes directly under `parts`, merged into one mesh per material (named after it), positioned as they were.
 * Only positions and normals are kept, which is all the untextured materials here use.
 */
export function mergeByMaterial(parts: Object3D): Group {
  const byMaterial = new Map<Material, BufferGeometry[]>();
  for (const part of parts.children) {
    if (!(part instanceof Mesh) || Array.isArray(part.material)) throw new Error("mergeByMaterial: plain meshes only");
    const material = part.material as Material;
    part.updateMatrix();
    const source = part.geometry as BufferGeometry;
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
    }
    geometry.applyMatrix4(part.matrix);
    const list = byMaterial.get(material) ?? [];
    list.push(geometry);
    byMaterial.set(material, list);
  }
  const merged = new Group();
  for (const [material, geometries] of byMaterial) {
    const mesh = new Mesh(mergeGeometries(geometries), material);
    mesh.name = material.name;
    merged.add(mesh);
    for (const g of geometries) g.dispose();
  }
  return merged;
}
