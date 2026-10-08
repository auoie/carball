// RocketSim collision mesh files (.cmf): int32 triangle count, int32 vertex count,
// int32x3 indices per triangle, float32x3 vertices (Bullet units = uu / 50). Little-endian.

export interface TriangleMesh {
  readonly positions: Float32Array; // uu, Rocket League frame
  readonly indices: Uint32Array;
}

export const BULLET_TO_UU = 50;

export function parseCmf(bytes: Uint8Array): TriangleMesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8) throw new Error("cmf: file too short");
  const numTris = view.getInt32(0, true);
  const numVerts = view.getInt32(4, true);
  const expected = 8 + numTris * 12 + numVerts * 12;
  if (numTris <= 0 || numVerts <= 0 || bytes.byteLength !== expected) {
    throw new Error(`cmf: bad header (${numTris} tris, ${numVerts} verts, ${bytes.byteLength} bytes)`);
  }

  const indices = new Uint32Array(numTris * 3);
  for (let i = 0; i < indices.length; i++) {
    const index = view.getInt32(8 + i * 4, true);
    if (index < 0 || index >= numVerts) throw new Error(`cmf: vertex index ${index} out of range`);
    indices[i] = index;
  }

  const positions = new Float32Array(numVerts * 3);
  const vertexBase = 8 + numTris * 12;
  for (let i = 0; i < positions.length; i++) {
    positions[i] = view.getFloat32(vertexBase + i * 4, true) * BULLET_TO_UU;
  }
  return { positions, indices };
}

/** Several meshes as one (the arena is several .cmf files, one per piece). */
export function mergeMeshes(meshes: readonly TriangleMesh[]): TriangleMesh {
  const positions = new Float32Array(meshes.reduce((n, m) => n + m.positions.length, 0));
  const indices = new Uint32Array(meshes.reduce((n, m) => n + m.indices.length, 0));
  let p = 0;
  let i = 0;
  for (const mesh of meshes) {
    const base = p / 3;
    positions.set(mesh.positions, p);
    for (let k = 0; k < mesh.indices.length; k++) indices[i + k] = (mesh.indices[k] ?? 0) + base;
    p += mesh.positions.length;
    i += mesh.indices.length;
  }
  return { positions, indices };
}
