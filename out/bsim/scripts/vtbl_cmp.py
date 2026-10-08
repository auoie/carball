# Compare an RL vtable with a stock class vtable slot by slot: vtbl_cmp.py RL_VTABLE STOCK_CLASS [N]
import re, struct, subprocess, sys
sys.path.insert(0, '../../scripts')
EXE = '/mnt/primary/home/arch/documents/binaries/rocket-league/rocketleague/Binaries/Win64/RocketLeague.exe'
def loadpe(path):
    d = open(path, 'rb').read(); pe = struct.unpack_from('<I', d, 0x3c)[0]
    base = struct.unpack_from('<Q', d, pe + 24 + 24)[0]
    nsec = struct.unpack_from('<H', d, pe + 6)[0]; opt = struct.unpack_from('<H', d, pe + 20)[0]
    secs = []
    for i in range(nsec):
        o = pe + 24 + opt + 40 * i; vs, va, rs, rp = struct.unpack_from('<IIII', d, o + 8); secs.append((va, max(vs, rs), rp))
    def rd(va):
        rva = va - base
        for sva, vs, rp in secs:
            if sva <= rva < sva + vs: return struct.unpack_from('<Q', d, rp + rva - sva)[0]
    return base, secs, rd
rlvt = int(sys.argv[1], 16); cls = sys.argv[2]; n = int(sys.argv[3]) if len(sys.argv) > 3 else 30
_, _, rlrd = loadpe(EXE)
sbase, ssecs, srd = loadpe('build/2.82-precise/bullet.dll')
pub = subprocess.run(['llvm-pdbutil', 'dump', '-publics', 'build/2.82-precise/bullet.pdb'], capture_output=True, text=True).stdout
m = re.search(r'`\?\?_7' + re.escape(cls) + r'@@6B@`\n\s+flags = .*?, addr = (\d+):(\d+)', pub)
svt = sbase + ssecs[int(m.group(1)) - 1][0] + int(m.group(2))
snames = {}
for line in open('build/2.82-precise/funcs.tsv'):
    va, sz, mod, nm = line.rstrip('\n').split('\t'); snames[int(va, 16)] = nm
rlmatch = {}
for line in open('region.tsv'):
    p = line.rstrip('\n').split('\t')
    if p[0] != 'rl': rlmatch[int(p[0], 16)] = (p[2], p[5][:70])
for i in range(n):
    s = srd(svt + 8 * i); r = rlrd(rlvt + 8 * i)
    sim, nm = rlmatch.get(r, ('', ''))
    print('+0x%03x stock %-55s rl %x %s %s' % (i * 8, snames.get(s, hex(s or 0))[:55], r or 0, sim, nm))
