"""Minimal PE32+ helper: section table, VA <-> file offset, string and pointer search."""
import struct
import sys

EXE = "/mnt/primary/home/arch/documents/binaries/rocket-league/rocketleague/Binaries/Win64/RocketLeague.exe"


class PE:
    def __init__(self, path=EXE):
        self.data = open(path, "rb").read()
        d = self.data
        e_lfanew = struct.unpack_from("<I", d, 0x3C)[0]
        nsec = struct.unpack_from("<H", d, e_lfanew + 6)[0]
        opt_size = struct.unpack_from("<H", d, e_lfanew + 20)[0]
        opt = e_lfanew + 24
        self.image_base = struct.unpack_from("<Q", d, opt + 24)[0]
        self.sections = []
        sec = opt + opt_size
        for i in range(nsec):
            name = d[sec:sec + 8].rstrip(b"\0").decode()
            vsize, va, rsize, raw = struct.unpack_from("<IIII", d, sec + 8)
            self.sections.append((name, self.image_base + va, vsize, raw, rsize))
            sec += 40

    def section(self, name):
        for s in self.sections:
            if s[0] == name:
                return s
        raise KeyError(name)

    def off2va(self, off):
        for name, va, vsize, raw, rsize in self.sections:
            if raw <= off < raw + rsize:
                return va + (off - raw)
        return None

    def va2off(self, va):
        for name, sva, vsize, raw, rsize in self.sections:
            if sva <= va < sva + min(vsize, rsize):
                return raw + (va - sva)
        return None

    def sec_of(self, va):
        for name, sva, vsize, raw, rsize in self.sections:
            if sva <= va < sva + vsize:
                return name
        return None

    def q(self, va):
        return struct.unpack_from("<Q", self.data, self.va2off(va))[0]

    def cstr(self, va, maxlen=512):
        off = self.va2off(va)
        end = self.data.find(b"\0", off, off + maxlen)
        return self.data[off:end].decode("latin1")

    def find_all(self, needle, start=0):
        out, i = [], self.data.find(needle, start)
        while i != -1:
            out.append(i)
            i = self.data.find(needle, i + 1)
        return out

    def qword_refs(self, va):
        """File offsets where `va` appears as an 8-byte absolute pointer."""
        return self.find_all(struct.pack("<Q", va))


if __name__ == "__main__":
    pe = PE()
    print(hex(pe.image_base))
    for s in pe.sections:
        print(s[0], hex(s[1]), hex(s[2]))
