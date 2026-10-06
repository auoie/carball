"""UE3 (v868, Rocket League) UnrealScript bytecode disassembler -> readable pseudo-code.

On disk, object refs are 4-byte package indices (8 bytes in memory) and FNames are 8 bytes.
Jump offsets are memory offsets, so a memory position is tracked alongside the disk position.
Native function indices (tokens 0x60+ and >= 0x70) resolve via UFunction.iNative from Core/Engine.

UFunction on disk: NetIndex, 'None', Next, SuperField, ScriptText, Children, CppText, Line, TextPos,
                   BytecodeSize, StorageSize, script[StorageSize], uint16 iNative, uint8 OperPrecedence,
                   uint32 FunctionFlags, [uint16 RepOffset if FUNC_Net], FString (Psyonix), FName FriendlyName

Usage: ubytecode.py PACKAGE FUNCTION_PATH_SUFFIX [...]   (natives from Core.upk/Engine.upk next to PACKAGE)
"""
import os
import struct
import sys

from package import Package

FUNC_NET = 0x40
FUNC_OPERATOR = 0x1000
FUNC_PREOPERATOR = 0x10
FIRST_NATIVE = 0x70


def function_info(pkg, e):
    d = pkg.data
    base = e["offset"]
    storage = struct.unpack_from("<i", d, base + 44)[0]
    script = d[base + 48:base + 48 + storage]
    pos = base + 48 + storage
    inative, prec = struct.unpack_from("<HB", d, pos)
    flags = struct.unpack_from("<I", d, pos + 3)[0]
    pos += 7
    if flags & FUNC_NET:
        pos += 2
    slen = struct.unpack_from("<i", d, pos)[0]
    pos += 4 + (slen if slen >= 0 else -2 * slen)
    fi, fn = struct.unpack_from("<ii", d, pos)
    friendly = pkg.names[fi] if 0 <= fi < len(pkg.names) else e["name"]
    return {"script": script, "inative": inative, "prec": prec, "flags": flags, "friendly": friendly}


def native_table(paths):
    table = {}
    for path in paths:
        if not os.path.exists(path):
            continue
        pkg = Package(path)
        for e in pkg.exports:
            if pkg.class_name(e["index"]) != "Function":
                continue
            try:
                fi = function_info(pkg, e)
            except Exception:
                continue
            if fi["inative"]:
                table[fi["inative"]] = (e["name"], fi["friendly"], fi["flags"], fi["prec"])
    return table


class Disasm:
    def __init__(self, pkg, natives):
        self.p = pkg
        self.natives = natives

    def run(self, script):
        self.d, self.pos, self.mem = script, 0, 0
        lines = []
        while self.pos < len(self.d):
            mem = self.mem
            tok = self.d[self.pos]
            if tok == 0x4C and self.pos == len(self.d) - 1:  # trailing EndOfScript (0x4C in RL)
                break
            try:
                s = self.expr()
            except Exception as ex:
                lines.append(f"  [{mem:04x}] <decode error: {ex}; raw {self.d[self.pos:self.pos + 24].hex()}>")
                break
            if s is not None:
                lines.append(f"  [{mem:04x}] {s}")
        return "\n".join(lines)

    # -- primitive readers (track disk + memory positions) --
    def u8(self):
        v = self.d[self.pos]
        self.pos += 1
        self.mem += 1
        return v

    def u16(self):
        v = struct.unpack_from("<H", self.d, self.pos)[0]
        self.pos += 2
        self.mem += 2
        return v

    def i32(self):
        v = struct.unpack_from("<i", self.d, self.pos)[0]
        self.pos += 4
        self.mem += 4
        return v

    def f32(self):
        v = struct.unpack_from("<f", self.d, self.pos)[0]
        self.pos += 4
        self.mem += 4
        return v

    def obj(self):
        v = struct.unpack_from("<i", self.d, self.pos)[0]
        self.pos += 4
        self.mem += 8
        o = self.p.obj(v)
        return o["name"] if o else "None"

    def name(self):
        i, n = struct.unpack_from("<ii", self.d, self.pos)
        self.pos += 8
        self.mem += 8
        s = self.p.names[i] if 0 <= i < len(self.p.names) else f"<name{i}>"
        return s if n == 0 else f"{s}_{n - 1}"

    def params(self):
        args = []
        while self.d[self.pos] != 0x16:
            a = self.expr()
            if a is not None:
                args.append(a)
        self.u8()
        return args

    # -- expressions --
    def expr(self):
        t = self.u8()
        if t >= 0x60:
            idx = ((t - 0x60) << 8 | self.u8()) if t < FIRST_NATIVE else t
            return self.native_call(idx)
        h = {
            0x01: lambda: self.obj(),                                  # InstanceVariable
            0x02: lambda: f"default.{self.obj()}",                     # DefaultVariable
            0x03: lambda: self.obj(),                                  # StateVariable
            0x04: lambda: f"return {self.expr()};",
            0x05: lambda: self._switch(),
            0x06: lambda: f"goto [{self.u16():04x}];",
            0x07: lambda: self._jumpifnot(),
            0x08: lambda: "stop;",
            0x09: lambda: self._assert(),
            0x0A: lambda: self._case(),
            0x0B: lambda: None,                                        # Nothing
            0x0D: lambda: f"goto {self.expr()};",
            0x0E: lambda: (self.obj(), None)[1],                       # EatReturnValue
            0x0F: lambda: self._let(),
            0x10: lambda: self._dynelem(),
            0x11: lambda: f"new({', '.join(str(self.expr()) for _ in range(4))})",
            0x12: lambda: self._context(static=True),
            0x13: lambda: f"class<{self.obj()}>({self.expr()})",
            0x14: lambda: self._let(),
            0x15: lambda: None,                                        # EndParmValue
            0x16: lambda: None,
            0x17: lambda: "self",
            0x18: lambda: (self.u16(), self.expr())[1],                # Skip
            0x19: lambda: self._context(),
            0x1A: lambda: self._elem(),
            0x1B: lambda: self._call(self.name()),
            0x1C: lambda: self._call(self.obj()),
            0x1D: lambda: str(self.i32()),
            0x1E: lambda: f"{self.f32():g}",
            0x1F: lambda: self._cstr(),
            0x20: lambda: f"obj'{self.obj()}'",
            0x21: lambda: f"'{self.name()}'",
            0x22: lambda: f"rot({self.i32()},{self.i32()},{self.i32()})",
            0x23: lambda: f"vect({self.f32():g},{self.f32():g},{self.f32():g})",
            0x24: lambda: str(self.u8()),
            0x25: lambda: "0",
            0x26: lambda: "1",
            0x27: lambda: "true",
            0x28: lambda: "false",
            0x29: lambda: self.obj(),                                  # NativeParm
            0x2A: lambda: "None",
            0x2C: lambda: str(self.u8()),
            0x2D: lambda: self.expr(),                                 # BoolVariable
            0x2E: lambda: f"{self.obj()}({self.expr()})",              # DynamicCast
            0x2F: lambda: (lambda e: (self.u16(), f"foreach {e}")[1])(self.expr()),
            0x30: lambda: "iterator_pop;",
            0x31: lambda: "iterator_next;",
            0x32: lambda: (lambda s, a, b: f"({a} == {b})")(self.obj(), self.expr(), self.expr()),
            0x33: lambda: (lambda s, a, b: f"({a} != {b})")(self.obj(), self.expr(), self.expr()),
            0x34: lambda: self._ustr(),
            0x35: lambda: self._member(),
            0x36: lambda: f"{self.expr()}.Length",
            0x37: lambda: self._call("global." + self.name()),
            0x38: lambda: (lambda c, e: f"cast{c}({e})")(self.u8(), self.expr()),
            0x39: lambda: self._dynop("Insert", skip=False),
            0x3A: lambda: (self.obj(), "return;")[1],
            0x3B: lambda: f"({self.expr()} == {self.expr()})",
            0x3C: lambda: f"({self.expr()} != {self.expr()})",
            0x3D: lambda: f"({self.expr()} == {self.expr()})",
            0x3E: lambda: f"({self.expr()} != {self.expr()})",
            0x3F: lambda: "None",
            0x40: lambda: self._dynop("Remove", skip=False),
            0x42: lambda: (lambda b, o, n: f"delegate {n}")(self.u8(), self.obj(), self.name()),
            0x43: lambda: (lambda n, o: f"delegate {n}")(self.name(), self.obj()),
            0x44: lambda: self._let(),
            0x45: lambda: self._cond(),
            # --- Rocket League token layout (stock UE3 values differ from here on) ---
            0x2B: lambda: self.obj(),                                  # LocalVariable (stock 0x00)
            0x46: lambda: self.obj(),                                  # LocalOutVariable (stock 0x48)
            0x47: lambda: self._defparm(),                             # DefaultParmValue (stock 0x49)
            0x48: lambda: None,                                        # EmptyParmValue (stock 0x4A)
            0x49: lambda: f"delegate {self.name()}",                   # InstanceDelegate (stock 0x4B)
            0x4A: lambda: self.expr(),                                 # InterfaceContext-like passthrough
            0x4C: lambda: None,                                        # EndOfScript (stock 0x53)
            0x4D: lambda: (self.u16(), None)[1],                       # 2-byte no-op
            0x59: lambda: f"'{self.name()}'",                          # 8-byte constant
            0x5E: lambda: self.expr(),                                 # passthrough (clears None-check flag)
            0x57: lambda: self._arrayop(),                             # RL: dynamic-array op family (sub-op byte)
        }.get(t)
        if h is None:
            raise ValueError(f"unknown token 0x{t:02x}")
        return h()

    def native_call(self, idx):
        name, friendly, flags, prec = self.natives.get(idx, (f"native{idx}", f"native{idx}", 0, 0))
        args = self.params()
        if flags & FUNC_OPERATOR:
            if flags & FUNC_PREOPERATOR or len(args) == 1:
                return f"({friendly}{args[0]})" if args else friendly
            if len(args) == 2:
                return f"({args[0]} {friendly} {args[1]})"
        return f"{friendly}({', '.join(args)})"

    def _call(self, fname):
        return f"{fname}({', '.join(self.params())})"

    def _let(self):
        a = self.expr()
        b = self.expr()
        return f"{a} = {b};"

    def _jumpifnot(self):
        off = self.u16()
        return f"if (!{self.expr()}) goto [{off:04x}];"

    def _assert(self):
        line = self.u16()
        self.u8()
        return f"assert({self.expr()}); // line {line}"

    def _switch(self):
        self.obj()
        self.u8()
        return f"switch ({self.expr()})"

    def _case(self):
        nxt = self.u16()
        if nxt == 0xFFFF:
            return "default:"
        return f"case {self.expr()}: // next [{nxt:04x}]"

    def _context(self, static=False):
        self.u8()  # Psyonix: skip-None-check flag
        o = self.expr()
        self.u16()
        self.obj()
        self.u8()
        inner = self.expr()
        return f"{o}.{inner}" if not static else f"{o}.static.{inner}"

    def _elem(self):
        i = self.expr()
        a = self.expr()
        return f"{a}[{i}]"

    def _dynelem(self):
        return self._elem()

    def _member(self):
        prop = self.obj()
        self.obj()
        self.u8()
        self.u8()
        s = self.expr()
        return f"{s}.{prop}"

    def _cond(self):
        c = self.expr()
        self.u16()
        a = self.expr()
        self.u16()
        b = self.expr()
        return f"({c} ? {a} : {b})"

    def _defparm(self):
        self.u16()
        e = self.expr()
        if self.d[self.pos] == 0x15:
            self.u8()
        return f"default_parm = {e};"

    def _dynop(self, op, skip):
        arr = self.expr()
        if skip:
            self.u16()
        return f"{arr}.{op}({', '.join(self.params())})"

    def _dyniter(self):
        arr = self.expr()
        item = self.expr()
        has_index = self.u8()
        idx = self.expr()
        self.u16()
        return f"foreach {arr}({item}{', ' + str(idx) if has_index else ''})"

    # RL 0x57 sub-ops (from the 64-entry table filled by FUN_140367990): dynamic-array operations.
    # 0x01 = Length; 0x0b-0x0f and 0x20-0x33 carry a uint16 skip after the array expression.
    ARRAY_SUBOPS = {0x01: "Length", 0x02: "Insert", 0x03: "Remove", 0x04: "op04", 0x05: "op05",
                    0x06: "Add", 0x07: "op07", 0x08: "op08", 0x09: "op09", 0x0a: "op0a"}

    def _arrayop(self):
        sub = self.u8()
        arr = self.expr()
        if sub == 0x01:
            return f"{arr}.Length"
        if 0x0b <= sub <= 0x0f or 0x20 <= sub <= 0x33:
            self.u16()
        name = self.ARRAY_SUBOPS.get(sub, f"arrayop{sub:02x}")
        return f"{arr}.{name}({', '.join(self.params())})"

    def _cstr(self):
        end = self.d.index(b"\0", self.pos)
        s = self.d[self.pos:end].decode("latin1")
        n = end + 1 - self.pos
        self.pos += n
        self.mem += n
        return repr(s)

    def _ustr(self):
        end = self.pos
        while self.d[end:end + 2] != b"\0\0":
            end += 2
        s = self.d[self.pos:end].decode("utf-16-le")
        n = end + 2 - self.pos
        self.pos += n
        self.mem += n
        return repr(s)


def main():
    pkg_path = sys.argv[1]
    d = os.path.dirname(pkg_path)
    natives = native_table([os.path.join(d, f) for f in ("Core.upk", "Engine.upk")])
    pkg = Package(pkg_path)
    dis = Disasm(pkg, natives)
    for suffix in sys.argv[2:]:
        for e in pkg.exports:
            if pkg.class_name(e["index"]) == "Function" and pkg.path(e["index"]).endswith(suffix):
                fi = function_info(pkg, e)
                params = [pkg.exports[x - 1]["name"] for x in range(1, len(pkg.exports) + 1)
                          if False]
                print(f"=== {pkg.path(e['index'])}  (flags 0x{fi['flags']:x}, {len(fi['script'])} bytes)")
                print(dis.run(fi["script"]))


if __name__ == "__main__":
    main()
