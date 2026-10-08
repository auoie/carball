# Every test of a FeatureSystem flag word (load of the global UFeatureSystem*, then test [reg+0x70],MASK) in an exe.
#   feature_bits.py EXE GLOBAL_VA function_map.tsv old|new   -> function-start<TAB>site<TAB>disp<TAB>mask
import bisect, re, subprocess, sys
exe, glob, fmap_path, side = sys.argv[1], int(sys.argv[2], 16), sys.argv[3], sys.argv[4]
col = 0 if side == 'old' else 1
starts = sorted({int(l.split('\t')[col], 16) for l in open(fmap_path) if not l.startswith('old')})
p = subprocess.Popen(['objdump', '-d', '-M', 'intel', '--no-show-raw-insn', exe], stdout=subprocess.PIPE, text=True,
                     bufsize=1 << 20)
reg = {}
for line in p.stdout:
    m = re.match(r'\s*([0-9a-f]+):\s+(\w+)\s+(.*)$', line)
    if not m:
        continue
    a, op, args = int(m.group(1), 16), m.group(2), m.group(3)
    g = re.match(r'(\w+),QWORD PTR \[rip\+0x[0-9a-f]+\]\s+# (0x[0-9a-f]+)', args)
    if op == 'mov' and g and int(g.group(2), 16) == glob:
        reg[g.group(1)] = a
        continue
    t = re.match(r'(?:DWORD|BYTE) PTR \[(\w+)\+(0x[0-9a-f]+)\],(0x[0-9a-f]+)', args)
    if op == 'test' and t and t.group(1) in reg and a - reg[t.group(1)] < 0x40:
        f = starts[bisect.bisect_right(starts, a) - 1]
        width = 1 if args.startswith('BYTE') else 4
        print('%x\t%x\t%s\t%s\t%d' % (f, a, t.group(2), t.group(3), width))
