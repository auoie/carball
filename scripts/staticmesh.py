"""Extract vertex positions and triangles from a cooked UE3 StaticMesh export (heuristic).

Looks for the LOD0 FPositionVertexBuffer header (Stride=12, NumVertices=N, ElementSize=12, ArrayNum=N)
followed by N*12 bytes of floats, then the first 16-bit index buffer (ElementSize=2, ArrayNum=M, M%3==0,
all indices < N). Used only to MEASURE Rocket League's arena locally; never ship the extracted meshes.

Usage: staticmesh.py PACKAGE MESH_PATH [--obj OUT.obj]
"""
import struct
import sys

from package import Package


def extract(pkg, export):
    d = pkg.data[export["offset"]:export["offset"] + export["size"]]
    best = None
    for off in range(0, len(d) - 16, 4):
        stride, n, esize, n2 = struct.unpack_from("<iiii", d, off)
        if stride == 12 and esize == 12 and n == n2 and 3 <= n <= 200000 and off + 16 + n * 12 <= len(d):
            best = off
            break
    if best is None:
        raise ValueError("position buffer not found")
    n = struct.unpack_from("<i", d, best + 4)[0]
    verts = [struct.unpack_from("<fff", d, best + 16 + i * 12) for i in range(n)]
    pos = best + 16 + n * 12
    tris = None
    for off in range(pos, len(d) - 8, 2):
        esize, m = struct.unpack_from("<ii", d, off)
        if esize == 2 and m >= 3 and m % 3 == 0 and off + 8 + 2 * m <= len(d):
            idx = struct.unpack_from(f"<{m}H", d, off + 8)
            if max(idx) < n:
                tris = [idx[i:i + 3] for i in range(0, m, 3)]
                break
    return verts, tris


def bounds(verts):
    xs, ys, zs = zip(*verts)
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


if __name__ == "__main__":
    pkg = Package(sys.argv[1])
    target = sys.argv[2]
    e = [e for e in pkg.exports if pkg.path(e["index"]) == target][0]
    verts, tris = extract(pkg, e)
    lo, hi = bounds(verts)
    print(f"{target}: {len(verts)} vertices, {len(tris) if tris else 0} triangles, bounds {lo} .. {hi}")
    if "--obj" in sys.argv:
        out = sys.argv[sys.argv.index("--obj") + 1]
        with open(out, "w") as f:
            for v in verts:
                f.write(f"v {v[0]} {v[1]} {v[2]}\n")
            for t in tris or []:
                f.write(f"f {t[0] + 1} {t[1] + 1} {t[2] + 1}\n")
        print("wrote", out)
