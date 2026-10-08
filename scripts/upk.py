"""Rocket League .upk reader: summary parsing, AES-256-ECB header decryption, zlib chunk decompression.

Format (UE3 v868, Psyonix licensee >= 22), per RLUPKTool:
  - Header from Summary.NameOffset is AES-256-ECB encrypted;
    size = round_up16(TotalHeaderSize - GarbageSize - NameOffset).
  - The real TArray<FCompressedChunkInfo> lives inside the decrypted header at CompressedChunkInfoOffset.
  - Each chunk: FCompressedChunkHeader {Tag, BlockSize, Sum{CSize, USize}} + blocks, zlib.
"""
import struct
import zlib

PACKAGE_FILE_TAG = 0x9E2A83C1


class Reader:
    def __init__(self, data, pos=0):
        self.d, self.p = data, pos

    def u8(self):
        v = self.d[self.p]
        self.p += 1
        return v

    def i32(self):
        v = struct.unpack_from("<i", self.d, self.p)[0]
        self.p += 4
        return v

    def u32(self):
        v = struct.unpack_from("<I", self.d, self.p)[0]
        self.p += 4
        return v

    def u16(self):
        v = struct.unpack_from("<H", self.d, self.p)[0]
        self.p += 2
        return v

    def i64(self):
        v = struct.unpack_from("<q", self.d, self.p)[0]
        self.p += 8
        return v

    def u64(self):
        v = struct.unpack_from("<Q", self.d, self.p)[0]
        self.p += 8
        return v

    def f32(self):
        v = struct.unpack_from("<f", self.d, self.p)[0]
        self.p += 4
        return v

    def bytes(self, n):
        v = self.d[self.p:self.p + n]
        self.p += n
        return v

    def fstring(self):
        n = self.i32()
        if n == 0:
            return ""
        if n > 0:
            return self.bytes(n)[:-1].decode("latin1")
        return self.bytes(-n * 2)[:-2].decode("utf-16-le")


class Summary:
    def __init__(self, data):
        r = Reader(data)
        self.tag = r.u32()
        if self.tag != PACKAGE_FILE_TAG:
            raise ValueError("not a UE package")
        self.file_version = r.u16()
        self.licensee_version = r.u16()
        self.total_header_size = r.i32()
        self.folder_name = r.fstring()
        self.package_flags = r.u32()
        self.name_count, self.name_offset = r.i32(), r.i32()
        self.export_count, self.export_offset = r.i32(), r.i32()
        self.import_count, self.import_offset = r.i32(), r.i32()
        self.depends_offset = r.i32()
        self.unknown = [r.i32() for _ in range(4)]
        self.guid = r.bytes(16)
        self.generations = [(r.i32(), r.i32(), r.i32()) for _ in range(r.i32())]
        self.engine_version, self.cooker_version = r.u32(), r.u32()
        self.compression_flags = r.u32()
        self.wide = self.licensee_version >= 22
        self.compressed_chunks_summary = [self._chunk_info(r) for _ in range(r.i32())]
        self.unknown5 = r.i32()
        self.unknown_strings = [r.fstring() for _ in range(r.i32())]
        self.unknown_types = []
        for _ in range(r.i32()):
            vals = [r.i32() for _ in range(5)]
            arr = [r.i32() for _ in range(r.i32())]
            self.unknown_types.append((vals, arr))
        self.garbage_size = r.i32()
        self.compressed_chunk_info_offset = r.i32()
        self.last_block_size = r.i32()
        self.end = r.p

    def _chunk_info(self, r):
        uoff = r.i64() if self.wide else r.i32()
        usize = r.i32()
        coff = r.i64() if self.wide else r.i32()
        csize = r.i32()
        return (uoff, usize, coff, csize)

    @property
    def encrypted_size(self):
        n = self.total_header_size - self.garbage_size - self.name_offset
        return (n + 15) & ~15

    def __repr__(self):
        keys = ["file_version", "licensee_version", "total_header_size", "folder_name", "package_flags",
                "name_count", "name_offset", "export_count", "export_offset", "import_count",
                "import_offset", "depends_offset", "engine_version", "cooker_version",
                "compression_flags", "garbage_size", "compressed_chunk_info_offset",
                "last_block_size", "end"]
        return "\n".join(f"{k:30s} {getattr(self, k)!r}" for k in keys)


def aes_ecb_decrypt(key, data):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    dec = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
    return dec.update(data) + dec.finalize()


def read_chunk_table(dec, s):
    """The real chunk table inside the decrypted header. Licensee 32 (builds up to 2026-06) uses 24-byte entries
    {i64 UncompressedOffset, i32 UncompressedSize, i64 CompressedOffset, i32 CompressedSize}; licensee 34 (2026-10-06)
    appends 12 more bytes per entry (zero so far). The entry size is picked by checking that the chunks are contiguous."""
    count = struct.unpack_from("<i", dec, s.compressed_chunk_info_offset)[0]
    for size in ((24, 36) if s.wide else (16,)):
        chunks = []
        for i in range(count):
            p = s.compressed_chunk_info_offset + 4 + i * size
            if not s.wide:
                uoff, usize, coff, csize = struct.unpack_from("<iiii", dec, p)
            else:
                uoff, usize, coff, csize = struct.unpack_from("<qiqi", dec, p)
            chunks.append((uoff, usize, coff, csize))
        if all(b[0] == a[0] + a[1] and b[2] == a[2] + a[3] for a, b in zip(chunks, chunks[1:])):
            return chunks
    raise ValueError("chunk table entries are neither 24 nor 36 bytes")


def decrypt_package(data, key):
    """Return a plain UE3 package: header decrypted, chunks decompressed, compression flags cleared."""
    s = Summary(data)
    enc = data[s.name_offset:s.name_offset + s.encrypted_size]
    dec = aes_ecb_decrypt(key, enc)

    chunks = read_chunk_table(dec, s)

    total = max([s.total_header_size] + [u + n for (u, n, _, _) in chunks])
    out = bytearray(total)
    out[:s.name_offset] = data[:s.name_offset]
    out[s.name_offset:s.name_offset + len(dec)] = dec

    for (uoff, usize, coff, csize) in chunks:
        cr = Reader(data, coff)
        cr.i32()  # tag
        cr.i32()  # block size
        sum_c, sum_u = cr.i32(), cr.i32()
        blocks, got = [], 0
        while got < sum_u:
            bc, bu = cr.i32(), cr.i32()
            blocks.append((bc, bu))
            got += bu
        pos, upos = cr.p, uoff
        for bc, bu in blocks:
            raw = zlib.decompress(data[pos:pos + bc])
            if len(raw) != bu:
                raise ValueError(f"block size mismatch at {pos}: {len(raw)} != {bu}")
            out[upos:upos + bu] = raw
            pos += bc
            upos += bu
    return bytes(out), s, chunks
