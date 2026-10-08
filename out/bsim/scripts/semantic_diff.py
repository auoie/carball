# Logic-level diff of matched functions between two builds (BinDiff function_map.tsv), ignoring what an update moves:
# addresses, field displacements ([reg+disp]) and stack frames. Flags changed instructions, immediates, values of
# RIP-relative constants (read from each exe) and call targets that are not BinDiff matches of each other.
#   semantic_diff.py OLD_EXE NEW_EXE function_map.tsv LO HI [MAXFUNCS]  > report
#   semantic_diff.py OLD_EXE NEW_EXE function_map.tsv @LIST            (LIST: one old-build hex address per line)
import difflib, os, re, struct, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'scripts'))
from pe import PE  # noqa: E402

old_exe, new_exe, fmap_path = sys.argv[1:4]
LIST = None
if sys.argv[4].startswith('@'):
    LIST = [int(l.split()[0], 16) for l in open(sys.argv[4][1:]) if l.strip() and not l.startswith('#')]
    lo, hi, maxf = 0, 0, 10 ** 9
else:
    lo, hi = int(sys.argv[4], 16), int(sys.argv[5], 16)
    maxf = int(sys.argv[6]) if len(sys.argv) > 6 else 10 ** 9
fmap, sims = {}, {}
for line in open(fmap_path):
    p = line.rstrip('\n').split('\t')
    if p[0] == 'old':
        continue
    fmap[int(p[0], 16)] = int(p[1], 16); sims[int(p[0], 16)] = float(p[3])
peo, pen = PE(old_exe), PE(new_exe)
import bisect
OLD_STARTS = sorted(fmap); NEW_STARTS = sorted(fmap.values())
def fend(starts, a):
    i = bisect.bisect_right(starts, a)
    return min(starts[i] if i < len(starts) else a + 0x4000, a + 0x4000)

def const(pe_, va, width):
    off = pe_.va2off(va)
    if off is None:
        return '?'
    raw = pe_.data[off:off + width]
    if width == 4:
        u = struct.unpack('<I', raw)[0]
        if u < 0x00800000 or u > 0xff000000:                 # small or negative ints (denormal as float)
            return 'I%d' % struct.unpack('<i', raw)[0]
        return '%.7g' % struct.unpack('<f', raw)[0]
    if width == 8:
        u = struct.unpack('<Q', raw)[0]
        if 0x140000000 <= u < 0x150000000 or u == 0:        # pointers into the image move with the build
            return 'P'
        if (u >> 52) & 0x7ff == 0 or (u >> 52) & 0x7ff == 0x7ff: # denormal/NaN-like: an integer pair (e.g. FName)
            return 'Q%d' % u
        return '%.12g' % struct.unpack('<d', raw)[0]
    return raw.hex()

def dis(exe, pe_, start, mapcalls, end=None):
    end = end or fend(OLD_STARTS if pe_ is peo else NEW_STARTS, start)
    out = subprocess.run(['objdump', '-d', '-M', 'intel', '--no-show-raw-insn', '--start-address=0x%x' % start,
                          '--stop-address=0x%x' % end, exe], capture_output=True, text=True).stdout
    ins = []
    for line in out.split('\n'):
        m = re.match(r'\s*([0-9a-f]+):\s+(\S+)\s*(.*)$', line)
        if not m:
            continue
        mn, ops = m.group(2), m.group(3)
        if mn == 'int3' and len(ins) > 2:
            break
        tgt = re.search(r'# (0x[0-9a-f]+)', ops)
        ops = ops.split('#')[0].strip()
        if tgt and 'rip+' in ops:
            width = 8 if ('QWORD' in ops or mn.endswith('sd')) else 4 if ('DWORD' in ops or mn.endswith('ss')) else 16
            val = const(pe_, int(tgt.group(1), 16), width) if width in (4, 8) else 'ptr'
            ops = re.sub(r'\[rip\+0x[0-9a-f]+\]', '[C=%s]' % val, ops)
        if mn in ('call', 'jmp') and re.match(r'^[0-9a-f]+', ops):
            t = int(ops.split()[0], 16)
            if not (start <= t < end):           # external call/tail-jump: compare by mapped identity
                ops = 'F%x' % (mapcalls(t) if mapcalls else t)
            else:
                ops = 'L'
        elif mn.startswith('j'):
            ops = 'L'
        ops = re.sub(r'(r[sb]p|esp)\+0x[0-9a-f]+', r'\1+S', ops)          # stack slots
        ops = re.sub(r'\+0x[0-9a-f]+\]', '+D]', ops)                        # field displacements
        ins.append(mn + ' ' + ops)
    return ins

report = []
pairs = sorted(a for a in fmap if (a in LIST if LIST is not None else lo <= a < hi))[:maxf]
if LIST is not None:
    print('# unmapped: %s' % ' '.join('%x' % a for a in LIST if a not in fmap), file=sys.stderr)
for a in pairs:
    b = fmap[a]
    A = dis(old_exe, peo, a, lambda t: fmap.get(t, t))
    B = dis(new_exe, pen, b, None)
    if A == B:
        continue
    if any('(bad)' in x for x in A + B):                     # data decoded as code (jump tables): set aside
        print('=== %x -> %x  bindiff %.4f  (contains data decoded as code; not compared)' % (a, b, sims[a]), flush=True)
        continue
    if len(A) * len(B) > 4_000_000:          # huge functions: difflib alignment is quadratic; compare multisets only
        if sorted(A) != sorted(B):
            print('=== %x -> %x  bindiff %.4f  (too large to align: %d vs %d instructions, multisets differ)'
                  % (a, b, sims[a], len(A), len(B)), flush=True)
        continue
    sm = difflib.SequenceMatcher(None, A, B, autojunk=False)
    diffs = [(tag, A[i1:i2], B[j1:j2]) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != 'equal']
    # ignore pure register-allocation noise: same mnemonic multiset and no constant/call change
    sig = lambda xs: sorted(re.sub(r'\b[re]?[a-d]x|\b[re]?[sd]i|\br\d+d?|\bxmm\d+|\b[re]?[sb]p', 'R', x) for x in xs)
    if sig(A) == sig(B):
        continue
    report.append(a)
    print('=== %x -> %x  bindiff %.4f  semantic ratio %.4f' % (a, b, sims[a], sm.ratio()))
    for tag, x, y in diffs[:12]:
        print('  %s  - %s' % (tag, ' | '.join(x[:4])))
        print('  %s  + %s' % (' ' * len(tag), ' | '.join(y[:4])))
    sys.stdout.flush()
print('# %d of %d functions in range differ beyond layout/addresses' % (len(report), len(pairs)), file=sys.stderr)
