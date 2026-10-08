# Per RL function (reverse query TSV): best stock match(es) across stock variants -> region.tsv
#   region_table.py RQ.tsv FUNCS_fast.tsv FUNCS_precise.tsv > region.tsv
import csv, sys, collections
rq = sys.argv[1]
names = {}
for tag, path in (('fast', sys.argv[2]), ('precise', sys.argv[3])):
    for line in open(path):
        va, size, mod, name = line.rstrip('\n').split('\t')
        names[(tag, int(va, 16))] = (mod, name)
rows = collections.defaultdict(list)
sizes = {}
for r in csv.DictReader(open(rq), delimiter='\t'):
    a = int(r['qaddr'], 16); sizes[a] = int(r['qsize'])
    if r['maddr'] == '-': rows[a]; continue
    tag = 'fast' if '2.82-fast' in r['mexe'] else 'precise'
    mod, name = names.get((tag, int(r['maddr'], 16)), ('?', r['mname']))
    rows[a].append((float(r['sim']), tag, mod, name, float(r['signif'])))
print('rl\tsize\tsim\tvariant\tmodule\tnames')
for a in sorted(rows):
    ms = rows[a]
    if not ms:
        print('%x\t%d\t%s\t-\t-\t-' % (a, sizes[a], '-1' if True else '')); continue
    best = max(m[0] for m in ms)
    top = [m for m in ms if m[0] >= best - 1e-9]
    variants = ','.join(sorted(set(m[1] for m in top)))
    mods = ','.join(sorted(set(m[2] for m in top)))[:60]
    nm = sorted(set(m[3] for m in top))
    print('%x\t%d\t%.4f\t%s\t%s\t%s' % (a, sizes[a], best, variants, mods, ' | '.join(nm[:4]) + (' | +%d' % (len(nm) - 4) if len(nm) > 4 else '')))
