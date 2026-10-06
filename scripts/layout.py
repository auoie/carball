"""Compute native field offsets for UE3 classes/structs from package metadata.

Memory order = the class's Children -> Next chain (validated: CarComponent_Boost_TA BoostModifier @0x33c,
BoostForce @0x34c match the reads in its ApplyForces). Offsets start at the superclass size, taken from
the exe's GetPrivateStaticClass sizeof (out/classes.csv) when available.

Serialized layouts (v868):
  UClass/UScriptStruct/UFunction: NetIndex, [tags 'None' for non-classes], Next, SuperField, ScriptText, Children, ...
  UProperty:                      NetIndex, 'None', Next, ArrayDim, uint64 Flags, FName Category, ArraySizeEnum,
                                  [uint16 RepOffset if CPF_Net], FString Name (Psyonix), type-specific refs
Usage: layout.py PACKAGE CLASS_OR_STRUCT [...]
"""
import csv
import os
import struct
import sys

from package import Package

CPF_NET = 0x20
HERE = os.path.dirname(os.path.abspath(__file__))

# Atomic / native structs: (size, alignment)
NATIVE_STRUCTS = {
    "Vector": (12, 4), "Rotator": (12, 4), "Vector2D": (8, 4), "Vector4": (16, 16), "Quat": (16, 16),
    "Color": (4, 4), "LinearColor": (16, 4), "Guid": (16, 4), "IntPoint": (8, 4), "Plane": (16, 16),
    "Matrix": (64, 16), "Box": (28, 4), "TwoVectors": (24, 4), "Pointer": (8, 8), "QWord": (8, 8),
    "Double": (8, 8), "RawDistribution": (24, 8), "FontCharacter": (24, 4),
    # Core InterpCurves: TArray<Point> Points (16) + byte InterpMethod, padded to 8.
    "InterpCurveFloat": (24, 8), "InterpCurveVector": (24, 8), "InterpCurveVector2D": (24, 8),
    "InterpCurveTwoVectors": (24, 8), "InterpCurveQuat": (24, 8), "InterpCurveLinearColor": (24, 8),
}
SIMPLE = {
    "ByteProperty": (1, 1), "IntProperty": (4, 4), "FloatProperty": (4, 4), "QWordProperty": (8, 8),
    "NameProperty": (8, 4), "StrProperty": (16, 8), "ObjectProperty": (8, 8), "ClassProperty": (8, 8),
    "ComponentProperty": (8, 8), "InterfaceProperty": (16, 8), "DelegateProperty": (16, 8),
    "ArrayProperty": (16, 8), "MapProperty": (80, 8),
}


def load_exe_sizes():
    sizes = {}
    path = os.path.join(HERE, "..", "out", "classes.csv")
    if os.path.exists(path):
        for row in csv.DictReader(open(path)):
            if row["sizeof"]:
                sizes[row["name"]] = int(row["sizeof"], 16)
    return sizes


class Layout:
    def __init__(self, pkg, extra_pkgs=()):
        self.p = pkg
        self.exe_sizes = load_exe_sizes()
        self.cache = {}
        # Other packages used to resolve imported structs (e.g. ProjectX._Types_X.*)
        self.extra = [Layout(x) if isinstance(x, Package) else x for x in extra_pkgs]

    def i32(self, e, off):
        return struct.unpack_from("<i", self.p.data, e["offset"] + off)[0]

    def find_type(self, name, kinds=("Class", "ScriptStruct")):
        for e in self.p.exports:
            if e["name"] == name and self.p.class_name(e["index"]) in kinds:
                return e
        return None

    def chain(self, e):
        """Properties of a class/struct in memory order."""
        is_class = self.p.class_name(e["index"]) == "Class"
        children = self.i32(e, 16 if is_class else 24)
        out, seen = [], set()
        ref = children
        while ref > 0 and ref not in seen:
            seen.add(ref)
            f = self.p.exports[ref - 1]
            if self.p.class_name(ref).endswith("Property"):
                out.append(f)
            ref = self.i32(f, 12)
        return out

    def prop_info(self, f):
        """(size, align, typename, is_bool, arraydim)"""
        cn = self.p.class_name(f["index"])
        arraydim = self.i32(f, 16)
        flags = struct.unpack_from("<Q", self.p.data, f["offset"] + 20)[0]
        pos = 20 + 8 + 8 + 4 + (2 if flags & CPF_NET else 0)
        # Psyonix addition: an FString copy of the property name precedes the type-specific refs.
        slen = self.i32(f, pos)
        pos += 4 + (slen if slen >= 0 else -2 * slen)
        if cn == "BoolProperty":
            return 4, 4, "bool", True, arraydim
        if cn == "StructProperty":
            sref = self.i32(f, pos)
            sname = self.p.obj_name(sref)
            size, align = self.struct_size(sname, sref)
            return size, align, f"struct {sname}", False, arraydim
        if cn in ("ObjectProperty", "ClassProperty", "ComponentProperty"):
            ref = self.i32(f, pos)
            return 8, 8, f"{self.p.obj_name(ref)}*", False, arraydim
        if cn == "ArrayProperty":
            inner = self.i32(f, pos)
            return 16, 8, f"TArray<{self.p.class_name(inner) if inner > 0 else '?'}>", False, arraydim
        if cn == "ByteProperty":
            ref = self.i32(f, pos)
            return 1, 1, f"byte({self.p.obj_name(ref)})" if ref else "byte", False, arraydim
        size, align = SIMPLE.get(cn, (4, 4))
        return size, align, cn.replace("Property", "").lower(), False, arraydim

    def struct_size(self, name, ref=None):
        if name in NATIVE_STRUCTS:
            return NATIVE_STRUCTS[name]
        if name in self.cache:
            return self.cache[name]
        e = self.p.exports[ref - 1] if ref and ref > 0 else self.find_type(name, ("ScriptStruct",))
        if e is None:
            for other in self.extra:
                if other.find_type(name, ("ScriptStruct",)) is not None:
                    self.cache[name] = other.struct_size(name)
                    return self.cache[name]
            self.cache[name] = (4, 4)  # unknown import; caller should treat offsets after it as suspect
            return self.cache[name]
        fields, end, align = self.compute(e, 0)
        size = (end + align - 1) // align * align
        self.cache[name] = (size, align)
        return self.cache[name]

    def compute(self, e, start):
        off, max_align, last_bool, bitpos = start, 1, False, 0
        fields = []
        for f in self.chain(e):
            size, align, typ, is_bool, dim = self.prop_info(f)
            if is_bool and last_bool and bitpos < 32:
                fields.append((off - 4, f["name"], f"bool:bit{bitpos}"))
                bitpos += 1
                continue
            off = (off + align - 1) // align * align
            max_align = max(max_align, align)
            fields.append((off, f["name"], typ + (f"[{dim}]" if dim > 1 else "")))
            off += size * max(dim, 1)
            last_bool, bitpos = is_bool, (1 if is_bool else 0)
        return fields, off, max_align

    def class_layout(self, name):
        e = self.find_type(name, ("Class",))
        if e is None:
            raise KeyError(name)
        super_ref = self.i32(e, 8)
        super_name = self.p.obj_name(super_ref)
        start = self.exe_sizes.get(super_name)
        if start is None:
            raise KeyError(f"no exe sizeof for superclass {super_name}")
        fields, end, _ = self.compute(e, start)
        return super_name, start, fields, end


if __name__ == "__main__":
    pkg = Package(sys.argv[1])
    d = os.path.dirname(sys.argv[1])
    extra = [Package(os.path.join(d, f)) for f in ("ProjectX.upk", "Engine.upk", "Core.upk")
             if os.path.exists(os.path.join(d, f)) and f != os.path.basename(sys.argv[1])]
    lay = Layout(pkg, extra)
    for name in sys.argv[2:]:
        sup, start, fields, end = lay.class_layout(name)
        exe = lay.exe_sizes.get(name)
        check = f"exe sizeof 0x{exe:x}" if exe else "exe sizeof unknown"
        print(f"=== {name} : {sup} (starts 0x{start:x}, computed end 0x{end:x}, {check})")
        for off, n, t in fields:
            print(f"  0x{off:04x}  {t:40s} {n}")
