# Callee tree of functions in one exe (direct calls only), bounded by the next BinDiff-mapped function start.
#   calltree.py EXE function_map.tsv old|new DEPTH ROOT [ROOT...]   -> one hex address per line (roots included)
import bisect, re, subprocess, sys
exe, fmap_path, side, depth = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
roots = [int(x, 16) for x in sys.argv[5:]]
col = 0 if side == 'old' else 1
starts = sorted({int(l.split('\t')[col], 16) for l in open(fmap_path) if not l.startswith('old')})
def callees(a):
    i = bisect.bisect_right(starts, a)
    end = min(starts[i] if i < len(starts) else a + 0x4000, a + 0x4000)
    out = subprocess.run(['objdump', '-d', '-M', 'intel', '--no-show-raw-insn', '--start-address=0x%x' % a,
                          '--stop-address=0x%x' % end, exe], capture_output=True, text=True).stdout
    return {int(m.group(1), 16) for m in re.finditer(r'\scall\s+(?:0x)?([0-9a-f]+)\b', out)}
seen, frontier = set(roots), list(roots)
for _ in range(depth):
    nxt = []
    for a in frontier:
        for c in callees(a):
            if c not in seen:
                seen.add(c); nxt.append(c)
    frontier = nxt
for a in sorted(seen):
    print('%x' % a)
