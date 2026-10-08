# Summarise QueryBSim TSV for stock Bullet functions: best RL match per stock function.
#   summarize.py QUERY.tsv FUNCS.tsv [MINSIZE]  -> prints counts; writes QUERY.best.tsv
import csv, sys, collections
q, funcs = sys.argv[1], sys.argv[2]
minsize = int(sys.argv[3]) if len(sys.argv) > 3 else 0
mods = {}
for line in open(funcs):
    va, size, mod, name = line.rstrip('\n').split('\t')
    mods[int(va, 16)] = (int(size), mod, name)
def bullet(mod): return mod.startswith(('bt', 'gim', 'SphereTriangle', 'Bullet')) and 'SoftBody' not in mod and 'Soft' not in mod
best = {}
for r in csv.DictReader(open(q), delimiter='\t'):
    a = int(r['qaddr'], 16)
    if a not in mods: continue
    size, mod, name = mods[a]
    if not bullet(mod) or size < minsize: continue
    sim = float(r['sim'])
    cur = best.get(a)
    if cur is None or sim > cur[0] + 1e-9:
        best[a] = (sim, [r['maddr']] if r['maddr'] != '-' else [], float(r['signif']), size, mod, name)
    elif abs(sim - cur[0]) < 1e-9 and r['maddr'] != '-':
        cur[1].append(r['maddr'])
bins = collections.Counter()
for a, (sim, m, sg, size, mod, name) in best.items():
    b = 'nosig' if sim < 0 else 'none' if not m else '1.0' if sim >= 0.9999 else '>=0.95' if sim >= 0.95 else '>=0.8' if sim >= 0.8 else '>=0.5' if sim >= 0.5 else '<0.5'
    bins[b] += 1
print(q, 'functions', len(best), dict(sorted(bins.items())))
with open(q.replace('.tsv', '.best.tsv'), 'w') as f:
    f.write('sim\tsignif\tsize\tmodule\tname\tstock\trl\n')
    for a, (sim, m, sg, size, mod, name) in sorted(best.items(), key=lambda kv: kv[1][0]):
        f.write('%.4f\t%.1f\t%d\t%s\t%s\t%x\t%s\n' % (sim, sg, size, mod, name, a, ','.join(m[:6]) + ('...' if len(m) > 6 else '')))
