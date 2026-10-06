"""Find RIP-relative code references (disp32, modrm mod=00 rm=101) to target VAs. Usage: riprefs.py VA [VA...]"""
import struct, sys
from pe import PE

pe = PE()
_, tva, tvs, traw, trs = pe.section(".text")
targets = {int(a, 16) for a in sys.argv[1:]}
d = pe.data
for off in range(traw + 1, traw + trs - 4):
    if (d[off - 1] & 0xC7) != 0x05:
        continue
    disp = struct.unpack_from("<i", d, off)[0]
    end = pe.off2va(off) + 4
    for extra in (0, 1, 4):  # trailing imm8/imm32 shifts rip
        if end + extra + disp in targets:
            print(f"{hex(end + extra + disp)} <- insn ending ~{hex(end + extra)} (modrm @ {hex(pe.off2va(off - 1))})")
