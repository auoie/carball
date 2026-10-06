"""Dump UE3 native function registration tables ({char* "ClassexecFunc", fnptr}) from .data to CSV."""
import csv, re, struct, sys
from pe import PE

pe = PE()
_, dva, dvs, draw, drs = pe.section(".data")
_, rva, rvs, _, _ = pe.section(".rdata")
_, tva, tvs, _, _ = pe.section(".text")
ident = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{2,200}$")

rows = []
for off in range(draw, draw + drs - 16, 8):
    a, b = struct.unpack_from("<QQ", pe.data, off)
    if rva <= a < rva + rvs and tva <= b < tva + tvs:
        s = pe.cstr(a, 256)
        if ident.match(s) and "exec" in s:
            cls, fn = s.split("exec", 1)
            rows.append((hex(b), cls, "exec" + fn, hex(pe.off2va(off))))

out = sys.argv[1] if len(sys.argv) > 1 else "../out/natives.csv"
with open(out, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["func_va", "class", "native", "table_entry_va"])
    w.writerows(rows)
print(f"{len(rows)} natives, {len({r[1] for r in rows})} classes -> {out}")
