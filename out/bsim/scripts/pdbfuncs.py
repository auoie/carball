# List functions from a PDB via llvm-pdbutil: VA, size, object module, name.  pdbfuncs.py DLL PDB [NAME_REGEX] > out.tsv
# A function defined in several modules (COMDAT) is listed once, with the module whose copy the linker kept (same VA).
import re, subprocess, struct, sys
dll, pdb = sys.argv[1], sys.argv[2]
d = open(dll, 'rb').read(); pe = struct.unpack_from('<I', d, 0x3c)[0]
base = struct.unpack_from('<Q', d, pe + 24 + 24)[0]
nsec = struct.unpack_from('<H', d, pe + 6)[0]; opt = struct.unpack_from('<H', d, pe + 20)[0]
secva = [struct.unpack_from('<I', d, pe + 24 + opt + 40 * i + 12)[0] for i in range(nsec)]
out = subprocess.run(['llvm-pdbutil', 'dump', '-symbols', pdb], capture_output=True, text=True).stdout
pat = re.compile(sys.argv[3]) if len(sys.argv) > 3 else None
mod = '?'; seen = set()
lines = out.split('\n')
for i, line in enumerate(lines):
    m = re.match(r'\s*Mod \d+ \| `(.*)`', line)
    if m:
        mod = m.group(1).split('\\')[-1]; continue
    m = re.search(r'S_[GL]PROC32 \[size = \d+\] `(.*)`', line)
    if m:
        a = re.search(r'addr = (\d+):(\d+), code size = (\d+)', lines[i + 1])
        name = m.group(1); sec, off, size = int(a.group(1)), int(a.group(2)), int(a.group(3))
        va = base + secva[sec - 1] + off
        if va in seen or (pat and not pat.search(name)): continue
        seen.add(va)
        print('%x\t%d\t%s\t%s' % (va, size, mod, name))
