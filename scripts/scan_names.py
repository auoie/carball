"""Scan every package's (encrypted) name table for exact names. Reads only header bytes.
Usage: scan_names.py KEYFILE DIR NAME [NAME...]"""
import glob, os, sys
from upk import Summary, aes_ecb_decrypt, Reader

key = open(sys.argv[1], "rb").read()
wanted = set(sys.argv[3:])
for f in sorted(glob.glob(os.path.join(sys.argv[2], "*.upk"))):
    with open(f, "rb") as fh:
        head = fh.read(1 << 16)
        try:
            s = Summary(head)
        except Exception:
            continue
        # names come first in the encrypted region; read up to the import table
        n = min(s.encrypted_size, ((s.import_offset - s.name_offset) + 15) & ~15)
        fh.seek(s.name_offset)
        enc = fh.read(n)
    try:
        dec = aes_ecb_decrypt(key, enc[: len(enc) & ~15])
        r = Reader(dec)
        names = set()
        for _ in range(s.name_count):
            names.add(r.fstring())
            r.u64()
    except Exception:
        continue
    hit = wanted & names
    if hit:
        print(os.path.basename(f), sorted(hit))
