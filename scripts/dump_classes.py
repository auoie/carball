"""Recover UE3 native class registrations: name, package, sizeof, InternalConstructor, vtable.

Each IMPLEMENT_CLASS emits GetPrivateStaticClass<T>(), which calls the static UClass constructor
with stack args built as `lea rcx,[rip+X]; mov [rsp+NN],rcx`:
    rsp+0x28 name (TEXT(#T)+1, i.e. without the A/U prefix)   rsp+0x30 package
    rsp+0x38 config name                                       rsp+0x48 InternalConstructor
and `mov r8d, imm32` = sizeof(T).
InternalConstructor runs the inlined ctor chain; the last `lea rax,[rip+X]; mov [rbx],rax` is T's vtable.

Usage: dump_classes.py [UClassCtorVA] > out/classes.csv
"""
import csv
import struct
import sys

from pe import PE

UCLASS_STATIC_CTOR = int(sys.argv[1], 16) if len(sys.argv) > 1 else 0x140322CB0

pe = PE()
d = pe.data
_, tva, tvs, traw, trs = pe.section(".text")
_, rva, rvs, _, _ = pe.section(".rdata")


def wstr(va, maxlen=256):
    off = pe.va2off(va)
    if off is None:
        return None
    end = off
    while end < off + maxlen * 2 and d[end:end + 2] != b"\0\0":
        end += 2
    try:
        return d[off:end].decode("utf-16-le")
    except UnicodeDecodeError:
        return None


def rip_target(off, insn_len):
    disp = struct.unpack_from("<i", d, off + insn_len - 4)[0]
    return pe.off2va(off) + insn_len + disp


def call_sites(target):
    out = []
    for off in range(traw, traw + trs - 5):
        if d[off] == 0xE8 and rip_target(off, 5) == target:
            out.append(off)
    return out


def parse_args(call_off, window=160):
    """Collect stack args and r8d from the instructions before the call."""
    args, size = {}, None
    start = call_off - window
    for off in range(start, call_off):
        # lea rcx,[rip+disp32]  -> 48 8D 0D
        if d[off:off + 3] == b"\x48\x8d\x0d":
            tgt = rip_target(off, 7)
            # followed by mov [rsp+imm8],rcx -> 48 89 4C 24 NN
            if d[off + 7:off + 11] == b"\x48\x89\x4c\x24":
                args[d[off + 11]] = tgt
        # mov r8d, imm32 -> 41 B8 imm32
        if d[off:off + 2] == b"\x41\xb8":
            size = struct.unpack_from("<I", d, off + 2)[0]
    return args, size


def vtable_from_ctor(ctor_va, window=400):
    """Last `lea reg,[rip+X]` into .rdata that is stored to [reg] (mov [r],rax/rcx/...)."""
    off = pe.va2off(ctor_va)
    if off is None:
        return None
    last = None
    for o in range(off, off + window):
        b = d[o:o + 3]
        # lea r64,[rip+disp32]: 48|4C 8D modrm(00 rrr 101)
        if b[0] in (0x48, 0x4C) and b[1] == 0x8D and (b[2] & 0xC7) == 0x05:
            tgt = rip_target(o, 7)
            if rva <= tgt < rva + rvs:
                reg = (b[2] >> 3) & 7
                n = d[o + 7:o + 10]
                # mov [base],reg : 48|49 89 modrm(00 reg base) with base != rsp/rbp
                if n[0] in (0x48, 0x49) and n[1] == 0x89 and (n[2] >> 6) == 0 and ((n[2] >> 3) & 7) == reg \
                        and (n[2] & 7) not in (4, 5):
                    last = tgt
        if d[o] == 0xC3 and d[o + 1] in (0xCC, 0x48, 0x40, 0x4C):  # ret (heuristic end)
            break
    return last


def main():
    w = csv.writer(sys.stdout)
    w.writerow(["name", "package", "config", "sizeof", "internal_ctor", "vtable", "getclass_fn_call"])
    n = 0
    for call_off in call_sites(UCLASS_STATIC_CTOR):
        args, size = parse_args(call_off)
        name = wstr(args.get(0x28)) if 0x28 in args else None
        if not name:
            continue
        pkg = wstr(args[0x30]) if 0x30 in args else ""
        cfg = wstr(args[0x38]) if 0x38 in args else ""
        ctor = args.get(0x48)
        vt = vtable_from_ctor(ctor) if ctor else None
        w.writerow([name, pkg, cfg, hex(size) if size is not None else "", hex(ctor) if ctor else "",
                    hex(vt) if vt else "", hex(pe.off2va(call_off))])
        n += 1
    print(f"{n} classes", file=sys.stderr)


if __name__ == "__main__":
    main()
