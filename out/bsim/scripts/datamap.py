# Map data addresses (globals, vtables, constants) from the 2026-06-16 exe to the live exe through matched functions:
# for each data address, take functions that reference it (REFS file from Ghidra's Recon.java), find their BinDiff
# match (function_map.tsv), align both functions' instruction streams and read the corresponding operand address.
#   datamap.py OLD_EXE NEW_EXE function_map.tsv REFS.txt DATA_VA...
# REFS.txt: Recon.java output lines "REF <data> <- <from> in <func>@<entry> [...]".
import collections, difflib, re, subprocess, sys

old_exe, new_exe, fmap_path, refs_path = sys.argv[1:5]
targets = [int(a, 16) for a in sys.argv[5:]]
fmap = {}
for line in open(fmap_path):
    p = line.rstrip('\n').split('\t')
    if p[0] == 'old':
        continue
    fmap[int(p[0], 16)] = (int(p[1], 16), float(p[3]))
refs = collections.defaultdict(list)
for line in open(refs_path):
    m = re.search(r'REF ([0-9a-f]+) <- ([0-9a-f]+) in .*?@([0-9a-f]+)', line)
    if m:
        refs[int(m.group(1), 16)].append((int(m.group(2), 16), int(m.group(3), 16)))

def dis(exe, start, n=4000):
    out = subprocess.run(['objdump', '-d', '-M', 'intel', '--no-show-raw-insn', '--start-address=0x%x' % start,
                          '--stop-address=0x%x' % (start + n), exe], capture_output=True, text=True).stdout
    ins = []
    for line in out.split('\n'):
        m = re.match(r'\s*([0-9a-f]+):\s+(\S+)\s*(.*)$', line)
        if not m:
            continue
        va, mn, ops = int(m.group(1), 16), m.group(2), m.group(3)
        tgt = re.search(r'# (0x[0-9a-f]+)', ops)
        tgt = int(tgt.group(1), 16) if tgt else None
        if tgt is None:   # direct absolute targets of call/jmp/lea are not data; immediates may be
            mm = re.search(r'\b0x(14[0-9a-f]{7})\b', ops)
            tgt = int(mm.group(1), 16) if mm and mn not in ('call', 'jmp') and not mn.startswith('j') else None
        norm = re.sub(r'0x[0-9a-f]+', 'N', ops.split('#')[0])
        ins.append((va, mn + ' ' + norm, tgt))
        if mn == 'int3' and len(ins) > 4:
            break
    return ins

for t in targets:
    votes = collections.Counter()
    for frm, fstart in refs.get(t, []):
        if fstart not in fmap:
            continue
        nstart, sim = fmap[fstart]
        a = dis(old_exe, fstart); b = dis(new_exe, nstart)
        ia = [i for i, x in enumerate(a) if x[0] == frm]
        if not ia:
            continue
        sm = difflib.SequenceMatcher(None, [x[1] for x in a], [x[1] for x in b], autojunk=False)
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == 'equal' and i1 <= ia[0] < i2:
                nb = b[j1 + ia[0] - i1]
                if nb[2] is not None:
                    votes[nb[2]] += 1
                break
    best = votes.most_common(3)
    print('%x -> %s   (votes %s, refs %d)' % (t, '%x' % best[0][0] if best else '?',
                                              ', '.join('%x:%d' % v for v in best), len(refs.get(t, []))))
