"""Find which packages EXPORT objects with given names (reads + decrypts headers only).
Usage: scan_exports.py KEYFILE DIR NAME [NAME...]"""
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
        fh.seek(s.name_offset)
        enc = fh.read(s.encrypted_size)
    try:
        dec = aes_ecb_decrypt(key, enc[: len(enc) & ~15])
        r = Reader(dec)
        names = []
        for _ in range(s.name_count):
            names.append(r.fstring())
            r.u64()
        idx = {i for i, n in enumerate(names) if n in wanted}
        if not idx:
            continue
        r = Reader(dec, s.export_offset - s.name_offset)
        for _ in range(s.export_count):
            r.p += 12
            ni, nn = r.i32(), r.i32()
            r.p += 4 + 8 + 4 + 8 + 4
            cnt = r.i32()
            r.p += 4 * cnt + 20
            if ni in idx:
                print(os.path.basename(f), names[ni])
    except Exception:
        continue
