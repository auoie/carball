"""Decrypt + decompress Rocket League packages to plain UE3 packages.
Usage: decrypt_upk.py KEYFILE OUTDIR PKG [PKG...]"""
import os, struct, sys, time
from upk import decrypt_package

key = open(sys.argv[1], "rb").read()
outdir = sys.argv[2]
os.makedirs(outdir, exist_ok=True)
for path in sys.argv[3:]:
    t = time.time()
    data = open(path, "rb").read()
    out, s, chunks = decrypt_package(data, key)
    dst = os.path.join(outdir, os.path.basename(path))
    open(dst, "wb").write(out)
    print(f"{os.path.basename(path)}: {len(data)/1e6:.1f} MB -> {len(out)/1e6:.1f} MB, "
          f"{len(chunks)} chunks, {time.time()-t:.1f}s")
