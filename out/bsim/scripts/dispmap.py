# Field-offset translation between two builds from code: align each matched function pair (BinDiff function_map.tsv)
# and collect [reg+disp] displacements that differ in otherwise identical instructions.
#   dispmap.py OLD_EXE NEW_EXE function_map.tsv LO HI [DMIN DMAX]
# Prints old disp -> new disp with vote counts (only for old disps in [DMIN, DMAX), default 0x100..0x2000).
import collections, difflib, re, subprocess, sys

old_exe, new_exe, fmap_path = sys.argv[1:4]
lo, hi = int(sys.argv[4], 16), int(sys.argv[5], 16)
dmin = int(sys.argv[6], 16) if len(sys.argv) > 6 else 0x100
dmax = int(sys.argv[7], 16) if len(sys.argv) > 7 else 0x2000
pairs = []
for line in open(fmap_path):
    p = line.rstrip('\n').split('\t')
    if p[0] == 'old':
        continue
    a, b, sim = int(p[0], 16), int(p[1], 16), float(p[3])
    if lo <= a < hi and sim >= 0.9:
        pairs.append((a, b))

def dis(exe, start, n=6000):
    out = subprocess.run(['objdump', '-d', '-M', 'intel', '--no-show-raw-insn', '--start-address=0x%x' % start,
                          '--stop-address=0x%x' % (start + n), exe], capture_output=True, text=True).stdout
    ins = []
    for line in out.split('\n'):
        m = re.match(r'\s*[0-9a-f]+:\s+(\S+)\s*(.*)$', line)
        if not m:
            continue
        mn, ops = m.group(1), m.group(2).split('#')[0].strip()
        if mn == 'int3' and len(ins) > 2:
            break
        disps = [int(x, 16) for x in re.findall(r'\[(?:r[a-z0-9]+|e[a-z]+)[^\]]*?\+0x([0-9a-f]+)\]', ops)]
        norm = re.sub(r'\+0x[0-9a-f]+\]', '+D]', ops)
        norm = re.sub(r'0x[0-9a-f]+', 'N', norm)
        ins.append((mn + ' ' + norm, disps))
    return ins

votes = collections.defaultdict(collections.Counter)
for a, b in pairs:
    A, B = dis(old_exe, a), dis(new_exe, b)
    sm = difflib.SequenceMatcher(None, [x[0] for x in A], [x[0] for x in B], autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != 'equal':
            continue
        for k in range(i2 - i1):
            da, db = A[i1 + k][1], B[j1 + k][1]
            for x, y in zip(da, db):
                if dmin <= x < dmax:
                    votes[x][y] += 1
for x in sorted(votes):
    c = votes[x]
    best, n = c.most_common(1)[0]
    tot = sum(c.values())
    flag = '' if best == x else '  CHANGED %+#x' % (best - x)
    print('%#06x -> %#06x  (%d/%d)%s' % (x, best, n, tot, flag))
