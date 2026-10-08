# Normalised instruction diff between a stock DLL function and an RL function.
#   asmdiff.py STOCK_DLL STOCK_VA STOCK_SIZE RL_EXE RL_VA RL_SIZE [-v]
# Normalisation: call/jump targets and RIP-relative addresses removed; registers, immediates, [reg+disp] kept.
import re, subprocess, sys, difflib
def dis(path, va, size):
    out = subprocess.run(['objdump', '-d', '-M', 'intel', '--no-show-raw-insn', '--start-address=0x%x' % va,
                          '--stop-address=0x%x' % (va + size), path], capture_output=True, text=True).stdout
    ins = []
    for line in out.split('\n'):
        m = re.match(r'\s*([0-9a-f]+):\s+(.*)$', line)
        if not m: continue
        s = m.group(2).split('#')[0].strip()
        s = re.sub(r'\b(call|j\w+)\s+(0x)?[0-9a-f]+( <[^>]*>)?', r'\1 ADDR', s)
        s = re.sub(r'\[rip\+0x[0-9a-f]+\]', '[rip+X]', s)
        s = re.sub(r'(QWORD|DWORD|WORD|BYTE|XMMWORD) PTR ds:0x[0-9a-f]+', 'MEM', s)
        ins.append(s)
    return ins
a = dis(sys.argv[1], int(sys.argv[2], 16), int(sys.argv[3]))
b = dis(sys.argv[4], int(sys.argv[5], 16), int(sys.argv[6]))
sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
print('stock %d ins, rl %d ins, ratio %.4f' % (len(a), len(b), sm.ratio()))
if '-v' in sys.argv:
    for line in difflib.unified_diff(a, b, 'stock', 'rl', n=2, lineterm=''):
        print(line)
