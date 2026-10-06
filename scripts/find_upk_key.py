"""Find the package AES-256 key inside RocketLeague.exe by trial-decrypting a package header.

A candidate is accepted when the first decrypted block is a plausible FString (first name entry)
and the TArray<FCompressedChunkInfo> at CompressedChunkInfoOffset decodes to sane chunks.
Writes the key (hex) to the path given as argv[2]; never prints it.
"""
import struct, sys
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from pe import PE
from upk import Summary

pkg = open(sys.argv[1], "rb").read()
s = Summary(pkg)
blk0 = pkg[s.name_offset:s.name_offset + 16]
ci = s.compressed_chunk_info_offset
ci_blk = (ci // 16) * 16
blk_ci = pkg[s.name_offset + ci_blk:s.name_offset + ci_blk + 48]


def plausible_name(b):
    n = struct.unpack_from("<i", b)[0]
    return 2 <= n <= 64 and all(32 <= c < 127 for c in b[4:4 + min(n - 1, 12)])


def plausible_chunks(b, rel):
    cnt = struct.unpack_from("<i", b, rel)[0]
    if not 1 <= cnt <= 100000:
        return False
    uoff, usize, coff, csize = struct.unpack_from("<qiqi", b, rel + 4)
    return 0 < usize <= 1 << 26 and 0 < csize <= 1 << 26 and 0 <= coff < len(pkg) and uoff >= 0


pe = PE()
found = []
for sec in (".rdata", ".data"):
    _, va, vsize, raw, rsize = pe.section(sec)
    data = pe.data[raw:raw + rsize]
    for off in range(0, len(data) - 32, 4):
        key = data[off:off + 32]
        if key.count(0) > 8:
            continue
        dec = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
        if not plausible_name(dec.update(blk0)):
            continue
        dec2 = Cipher(algorithms.AES(key), modes.ECB()).decryptor().update(blk_ci)
        if plausible_chunks(dec2, ci - ci_blk):
            found.append((sec, va + off, key))
            print(f"key candidate in {sec} at {hex(va + off)}", flush=True)

if found:
    with open(sys.argv[2], "w") as f:
        for sec, va, key in found:
            f.write(f"{hex(va)} {key.hex()}\n")
print(f"{len(found)} candidate(s)")
