# Read qwords at virtual addresses from a PE file: readva.py EXE VA [COUNT]
import struct, sys
data = open(sys.argv[1], 'rb').read()
pe = struct.unpack_from('<I', data, 0x3c)[0]
nsec = struct.unpack_from('<H', data, pe + 6)[0]
optsize = struct.unpack_from('<H', data, pe + 20)[0]
base = struct.unpack_from('<Q', data, pe + 24 + 24)[0]
secs = []
off = pe + 24 + optsize
for i in range(nsec):
    name = data[off:off+8].rstrip(b'\0').decode()
    vsize, va, rawsize, rawptr = struct.unpack_from('<IIII', data, off + 8)
    secs.append((name, va, vsize, rawptr, rawsize))
    off += 40
def read(va, n):
    rva = va - base
    for name, sva, vsize, rawptr, rawsize in secs:
        if sva <= rva < sva + max(vsize, rawsize):
            return data[rawptr + rva - sva: rawptr + rva - sva + n]
    raise ValueError('unmapped %x' % va)
va = int(sys.argv[2], 16); cnt = int(sys.argv[3]) if len(sys.argv) > 3 else 4
for i in range(cnt):
    print(hex(va + 8*i), hex(struct.unpack('<Q', read(va + 8*i, 8))[0]))
