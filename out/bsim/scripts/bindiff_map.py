# Map function addresses from the 2026-06-16 build to the live build using a BinDiff result (SQLite), and list what the
# update changed.
#   bindiff_map.py RESULT.BinDiff OUTDIR [notes files...]
# Writes OUTDIR/function_map.tsv (every matched function: old, new, similarity, confidence, names),
#        OUTDIR/cited_map.tsv (every 0x14…/FUN_14… address cited in the given notes, with its function's new address),
#        OUTDIR/changed_region.tsv (Bullet region functions with similarity < 1) and prints a summary.
import os, re, sqlite3, sys, bisect

res, outdir = sys.argv[1], sys.argv[2]
notes = sys.argv[3:]
os.makedirs(outdir, exist_ok=True)
db = sqlite3.connect(res)
cols = [r[1] for r in db.execute('pragma table_info(function)')]
rows = db.execute('select address1, address2, similarity, confidence, name1, name2, algorithm from function').fetchall()
algos = dict(db.execute('select id, name from functionalgorithm').fetchall()) if 'functionalgorithm' in [
    r[0] for r in db.execute("select name from sqlite_master where type='table'")] else {}
m = {r[0]: r for r in rows}
with open(os.path.join(outdir, 'function_map.tsv'), 'w') as f:
    f.write('old\tnew\tdelta\tsimilarity\tconfidence\tname_old\tname_new\talgorithm\n')
    for a1, a2, sim, conf, n1, n2, alg in sorted(rows):
        f.write('%x\t%x\t%+x\t%.4f\t%.4f\t%s\t%s\t%s\n' % (a1, a2, a2 - a1, sim, conf, n1, n2, algos.get(alg, alg)))

# Function starts of the old build (from the BinExport-matched set plus the old project's function list if available)
starts = sorted(m)

def lookup(addr):
    """Exact function start, or the function containing addr (nearest start below, within 64 KiB)."""
    if addr in m:
        return addr, 0
    i = bisect.bisect_right(starts, addr) - 1
    if i >= 0 and addr - starts[i] < 0x10000:
        return starts[i], addr - starts[i]
    return None, None

cited = {}
for path in notes:
    text = open(path, errors='replace').read()
    for tok in re.findall(r'(?:FUN_|0x)(14[0-9a-fA-F]{7})\b', text):
        a = int(tok, 16)
        if 0x140001000 <= a < 0x141a38000:          # .text only (data addresses are handled separately)
            cited.setdefault(a, set()).add(os.path.basename(path))
# Exact instruction-level matches for cited addresses that are not function starts
mid = [a for a in cited if a not in m]
inst = {}
for k in range(0, len(mid), 500):
    chunk = mid[k:k + 500]
    q = 'select address1, address2 from instruction where address1 in (%s)' % ','.join('?' * len(chunk))
    inst.update(dict(db.execute(q, chunk).fetchall()))
with open(os.path.join(outdir, 'cited_map.tsv'), 'w') as f:
    f.write('old\tnew\tsimilarity\tconfidence\tnote\tcited_in\n')
    unmatched = 0
    for a in sorted(cited):
        fs, off = lookup(a)
        if fs is None:
            unmatched += 1
            f.write('%x\t-\t-\t-\tno match\t%s\n' % (a, ','.join(sorted(cited[a]))))
            continue
        a1, a2, sim, conf = m[fs][:4]
        if off == 0:
            new, note = a2, ''
        elif a in inst:
            new, note = inst[a], 'instruction match, in %x' % fs
        else:
            new, note = a2 + off, 'offset estimate, in %x +0x%x' % (fs, off)
        f.write('%x\t%x\t%.4f\t%.4f\t%s\t%s\n' % (a, new, sim, conf, note, ','.join(sorted(cited[a]))))

region = [r for r in rows if 0x140268000 <= r[0] < 0x1402d4000]
changed = sorted([r for r in region if r[2] < 0.9999], key=lambda r: r[2])
with open(os.path.join(outdir, 'changed_region.tsv'), 'w') as f:
    f.write('old\tnew\tsimilarity\tconfidence\n')
    for a1, a2, sim, conf, *_ in changed:
        f.write('%x\t%x\t%.4f\t%.4f\n' % (a1, a2, sim, conf))

n_old = db.execute('select functions from file where id = 1').fetchone()
n_new = db.execute('select functions from file where id = 2').fetchone()
ident = sum(1 for r in rows if r[2] >= 0.9999)
print('functions old/new:', n_old, n_new, ' matched:', len(rows), ' identical (sim≥0.9999):', ident,
      ' changed:', len(rows) - ident)
print('Bullet region: matched %d, changed %d' % (len(region), len(changed)))
print('cited addresses: %d, unmatched %d' % (len(cited), unmatched))
