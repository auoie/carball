"""Recover the UnrealScript token -> handler table from GNatives static registrations.
Each registrar does: mov rax,[rip+ENTRY.fn]; mov [GNatives + idx*8], rax   where ENTRY = {char* name, fn}.
Writes out/gnatives.csv (index, handler_va, name)."""
import csv, struct, sys
from pe import PE

GN = 0x14237FF40
pe = PE()
d = pe.data
_, tva, tvs, traw, trs = pe.section(".text")
rows = {}
for off in range(traw, traw + trs - 7):
    if d[off:off + 3] != b"\x48\x89\x05":
        continue
    tgt = pe.off2va(off) + 7 + struct.unpack_from("<i", d, off + 3)[0]
    if not (GN <= tgt < GN + 0x1000 * 8 and (tgt - GN) % 8 == 0):
        continue
    for b in range(off - 7, off - 32, -1):
        if d[b:b + 3] == b"\x48\x8b\x05":
            entry = pe.off2va(b) + 7 + struct.unpack_from("<i", d, b + 3)[0]
            fn = pe.q(entry)
            name = pe.cstr(pe.q(entry - 8)) if pe.sec_of(pe.q(entry - 8)) == ".rdata" else "?"
            rows[(tgt - GN) // 8] = (fn, name)
            break
with open(sys.argv[1] if len(sys.argv) > 1 else "../out/gnatives.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["index", "handler_va", "name"])
    for i in sorted(rows):
        w.writerow([hex(i), hex(rows[i][0]), rows[i][1]])
print(len(rows), "registrations")
for i in sorted(rows):
    if i < 0x70:
        print(hex(i), rows[i][1])
