# Are functions of one RocketLeague.exe build still present in another? Samples 24-byte windows from each function of
# the OLD exe and searches the NEW one (moved code changes call/data offsets, so partial matches are normal).
#   python3 scripts/pe_funcmatch.py OLD.exe NEW.exe Name=0x140f5ff00 ...
# For each function address in the old exe, take byte windows from it and look for them in the new exe
import struct, sys
def load(path):
    data = open(path, 'rb').read()
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    nsec = struct.unpack_from('<H', data, pe + 6)[0]
    optsize = struct.unpack_from('<H', data, pe + 20)[0]
    base = struct.unpack_from('<Q', data, pe + 24 + 24)[0]
    secs = []; off = pe + 24 + optsize
    for i in range(nsec):
        vsize, va, rawsize, rawptr = struct.unpack_from('<IIII', data, off + 8); secs.append((va, vsize, rawptr, rawsize)); off += 40
    return data, base, secs
old, base, secs = load(sys.argv[1]); new = open(sys.argv[2], 'rb').read()
def raw(va, n):
    rva = va - base
    for sva, vsize, rawptr, rawsize in secs:
        if sva <= rva < sva + vsize: return old[rawptr + rva - sva: rawptr + rva - sva + n]
for name_addr in sys.argv[3:]:
    name, addr = name_addr.split('=')
    a = int(addr, 16); hits = 0; total = 0
    for off in range(0, 512, 32):
        w = raw(a + off, 24)
        total += 1
        if new.find(w) >= 0: hits += 1
    print(f"{name:28s} {hits}/{total} windows found in the new exe")
