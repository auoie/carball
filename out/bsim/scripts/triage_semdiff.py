# Triage semantic_diff output: for each flagged function pair, compare multisets of float constants, integer immediates
# and (BinDiff-mapped) call targets.   triage_semdiff.py OLD_EXE NEW_EXE function_map.tsv SEMDIFF.txt [SEMDIFF.txt...]
import collections, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
spec = importlib.util.spec_from_file_location('sd', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'semantic_diff.py'))

old_exe, new_exe, fmap_path = sys.argv[1:4]
files = sys.argv[4:]
sys.argv = ['semantic_diff.py', old_exe, new_exe, fmap_path, '0', '0', '0']   # run module top-level with an empty range
sd = importlib.util.module_from_spec(spec); spec.loader.exec_module(sd)

def bag(ins, pat):
    return collections.Counter(m for x in ins for m in re.findall(pat, x))
rows = []
for path in files:
    for line in open(path):
        m = re.match(r'=== ([0-9a-f]+) -> ([0-9a-f]+)\s+bindiff ([0-9.]+)', line)
        if not m:
            continue
        a, b, sim = int(m.group(1), 16), int(m.group(2), 16), float(m.group(3))
        A = sd.dis(old_exe, sd.peo, a, lambda t: sd.fmap.get(t, t))
        B = sd.dis(new_exe, sd.pen, b, None)
        fl = (bag(A, r'C=(-?[0-9][0-9.e+-]*)'), bag(B, r'C=(-?[0-9][0-9.e+-]*)'))
        it = (bag(A, r'C=I(-?\d+)'), bag(B, r'C=I(-?\d+)'))
        im = (bag(A, r',(0x[0-9a-f]+)$'), bag(B, r',(0x[0-9a-f]+)$'))
        ca = (bag(A, r'^call F([0-9a-f]+)'), bag(B, r'^call F([0-9a-f]+)'))
        cats = []
        if sim < 0.5:
            cats.append('MISMATCH? (bindiff similarity %.3f)' % sim)
        if fl[0] != fl[1]:
            cats.append('FLOAT -%s +%s' % (dict(fl[0] - fl[1]), dict(fl[1] - fl[0])))
        if it[0] != it[1]:
            cats.append('INTCONST -%s +%s' % (dict(it[0] - it[1]), dict(it[1] - it[0])))
        if im[0] != im[1]:
            cats.append('IMM -%s +%s' % (dict(im[0] - im[1]), dict(im[1] - im[0])))
        if ca[0] != ca[1]:
            cats.append('CALLS -%d +%d' % (sum((ca[0] - ca[1]).values()), sum((ca[1] - ca[0]).values())))
        if not cats:
            cats.append('OTHER (len %d -> %d)' % (len(A), len(B)))
        rows.append((a, b, sim, cats))
order = lambda r: (3 if r[3][0].startswith('MISMATCH') else 0 if r[3][0].startswith('FLOAT') else 1 if r[3][0].startswith('IMM') or r[3][0].startswith('INT') else 2, r[0])
for a, b, sim, cats in sorted(rows, key=order):
    print('%x -> %x  bindiff %.3f  %s' % (a, b, sim, ' ; '.join(c[:200] for c in cats)))
c = collections.Counter(r[3][0].split()[0] for r in rows)
print('# by first category:', dict(c), file=sys.stderr)
