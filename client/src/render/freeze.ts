// Still objects: their matrices made once and kept, not composed and multiplied again every frame (the scene no longer
// forces every object's world matrix each frame: src/render/renderer.ts)
import { type BufferGeometry, type Material, Mesh, type Object3D } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** `piece` never moves: its world matrix made now (under its parent's, as it stands) and kept, its subtree's too */
export function freeze(piece: Object3D): void {
  piece.updateMatrixWorld(true);
  piece.traverse((o) => {
    o.matrixAutoUpdate = false;
  });
}

/** One piece of a merged mesh: its name and its vertices' range (userData.pieces) */
export interface MergedPiece {
  readonly name: string;
  readonly start: number;
  readonly count: number;
}

/** Still pieces one material draws, merged into one mesh (one draw; the pieces' order kept, as one mesh draws its
 *  triangles), each piece's name and vertex range in userData.pieces */
export function mergedPieces(pieces: readonly (readonly [string, BufferGeometry])[], material: Material): Mesh {
  const geometry = mergeGeometries(pieces.map(([, g]) => g)) as BufferGeometry | null;
  if (!geometry) throw new Error(`mergedPieces: ${pieces.map(([name]) => name).join(", ")} have different attributes`);
  const mesh = new Mesh(geometry, material);
  let start = 0;
  const ranges: MergedPiece[] = pieces.map(([name, g]) => {
    const count = g.getAttribute("position").count;
    const piece = { name, start, count };
    start += count;
    return piece;
  });
  mesh.name = pieces.map(([name]) => name).join(" + ");
  mesh.userData["pieces"] = ranges;
  for (const [, g] of pieces) g.dispose();
  return mesh;
}
