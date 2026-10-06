"""Decode UE3 (v868) tagged properties of package exports.

Object data: int32 NetIndex, then FPropertyTag* until Name == "None".
FPropertyTag: FName Name, FName Type, int32 Size, int32 ArrayIndex,
              + FName StructName (StructProperty) | uint8 BoolVal (BoolProperty) | FName EnumName (ByteProperty)
Atomic structs (Vector, Rotator, ...) are raw; other structs are nested tagged lists.
Array element types are not in the tag, so they are inferred from the element byte size.

Usage: props.py PACKAGE PATH_SUFFIX [PATH_SUFFIX...]
"""
import struct
import sys

from package import Package
from upk import Reader

RF_HAS_STACK = 0x0200000000000000

ATOMIC = {
    "Vector": ("fff", ("X", "Y", "Z")),
    "Rotator": ("iii", ("Pitch", "Yaw", "Roll")),
    "Vector2D": ("ff", ("X", "Y")),
    "Vector4": ("ffff", ("X", "Y", "Z", "W")),
    "Quat": ("ffff", ("X", "Y", "Z", "W")),
    "Color": ("BBBB", ("B", "G", "R", "A")),
    "LinearColor": ("ffff", ("R", "G", "B", "A")),
    "Guid": ("IIII", ("A", "B", "C", "D")),
    "IntPoint": ("ii", ("X", "Y")),
    "Box": ("ffffffB", ("MinX", "MinY", "MinZ", "MaxX", "MaxY", "MaxZ", "IsValid")),
    "Plane": ("ffff", ("X", "Y", "Z", "W")),
    "Matrix": ("f" * 16, tuple(f"M{i}" for i in range(16))),
}


class PropReader:
    def __init__(self, pkg):
        self.p = pkg

    def read_object(self, export):
        """NetIndex, then (for UComponent templates) TemplateOwnerClass [+ TemplateName], then tags.
        The component header is detected by trying each layout and keeping the one whose tag list
        ends exactly at the object's end."""
        end = export["offset"] + export["size"]
        start = export["offset"]
        if export["flags"] & RF_HAS_STACK:
            # FStateFrame: Node, StateNode, uint64 ProbeMask, uint16 LatentAction, [int32 Offset if Node]
            r = Reader(self.p.data, start)
            node = r.i32()
            r.i32()
            r.u64()
            r.u16()
            if node:
                r.i32()
            start = r.p
        best = None
        for skip in (0, 4, 12):
            r = Reader(self.p.data, start)
            net_index = r.i32()
            r.p += skip
            if not self._looks_like_tag(r.p):
                continue
            props = self.read_tags(r, end)
            ok = r.p == end and not any(isinstance(v, str) and v.startswith("<error") for v in props.values())
            if ok:
                return {"_net_index": net_index, **({"_component_header": skip} if skip else {}), **props}, r.p, end
            if best is None:
                best = ({"_net_index": net_index, **props}, r.p, end)
        if best is None:
            r = Reader(self.p.data, start)
            best = ({"_net_index": r.i32(), **self.read_tags(r, end)}, r.p, end)
        return best

    def _looks_like_tag(self, pos):
        d = self.p.data
        if pos + 8 > len(d):
            return False
        idx, num = struct.unpack_from("<ii", d, pos)
        if not (0 <= idx < len(self.p.names)) or not (0 <= num < 1000):
            return False
        if self.p.names[idx] == "None":
            return True
        tidx = struct.unpack_from("<i", d, pos + 8)[0]
        return 0 <= tidx < len(self.p.names) and self.p.names[tidx].endswith("Property")

    def read_tags(self, r, end):
        out = {}
        while r.p < end:
            name = self.p.fname(r)
            if name == "None":
                break
            typ = self.p.fname(r)
            size, idx = r.i32(), r.i32()
            extra = None
            if typ == "StructProperty":
                extra = self.p.fname(r)
            elif typ == "BoolProperty":
                extra = r.u8()
            elif typ == "ByteProperty":
                extra = self.p.fname(r)
            start = r.p
            try:
                val = self.read_value(r, typ, size, extra)
            except Exception as ex:  # keep going; record raw bytes
                val = f"<error {ex}: {self.p.data[start:start + size].hex()}>"
            r.p = start + size
            key = name if idx == 0 else f"{name}[{idx}]"
            out[key] = val
        return out

    def read_value(self, r, typ, size, extra):
        if typ == "BoolProperty":
            return bool(extra)
        if typ == "FloatProperty":
            return r.f32()
        if typ == "IntProperty":
            return r.i32()
        if typ == "QWordProperty":
            return r.u64()
        if typ == "NameProperty":
            return self.p.fname(r)
        if typ == "StrProperty":
            return r.fstring()
        if typ in ("ObjectProperty", "ClassProperty", "ComponentProperty", "InterfaceProperty"):
            ref = r.i32()
            return f"obj:{self.p.path(ref) if ref else 'None'}"
        if typ == "DelegateProperty":
            r.i32()
            return f"delegate:{self.p.fname(r)}"
        if typ == "ByteProperty":
            if size == 8:
                return f"{extra}::{self.p.fname(r)}"
            return r.u8()
        if typ == "StructProperty":
            return self.read_struct(r, extra, size)
        if typ == "ArrayProperty":
            return self.read_array(r, size)
        return f"<{typ} {self.p.data[r.p:r.p + size].hex()}>"

    def read_struct(self, r, struct_name, size):
        if struct_name in ATOMIC and struct.calcsize("<" + ATOMIC[struct_name][0]) == size:
            fmt, names = ATOMIC[struct_name]
            vals = struct.unpack_from("<" + fmt, self.p.data, r.p)
            return {"_struct": struct_name, **dict(zip(names, vals))}
        return {"_struct": struct_name, **self.read_tags(r, r.p + size)}

    def read_array(self, r, size):
        count = r.i32()
        body = size - 4
        if count == 0:
            return []
        if body == count * 4:
            raw = self.p.data[r.p:r.p + body]
            ints = struct.unpack(f"<{count}i", raw)
            flts = struct.unpack(f"<{count}f", raw)
            # Heuristic: object refs are small ints; floats look "reasonable".
            if all(-len(self.p.imports) <= v <= len(self.p.exports) for v in ints) and any(ints):
                return [f"obj:{self.p.path(v) if v else 'None'}" for v in ints]
            return list(flts)
        if body == count * 8:
            # names or pairs; try names
            out = []
            for _ in range(count):
                out.append(self.p.fname(r))
            return out
        # Assume tagged structs per element.
        end = r.p + body
        out = []
        for _ in range(count):
            if r.p >= end:
                break
            out.append(self.read_tags(r, end))
        return out


def compact_curve(v):
    """InterpCurveFloat dict -> 'curve in->out ...' when every point is linear with zero tangents."""
    if not (isinstance(v, dict) and v.get("_struct") == "InterpCurveFloat"):
        return None
    pts = v.get("Points", [])
    if not all(isinstance(p, dict) for p in pts):
        return None
    parts = [f"{p.get('InVal', 0.0):g}->{round(p.get('OutVal', 0.0), 6):g}" for p in pts]
    modes = {p.get("InterpMode", "EInterpCurveMode::CIM_Linear") for p in pts}
    tail = "" if modes <= {"EInterpCurveMode::CIM_Linear"} else f"  modes={sorted(modes)}"
    return "curve " + " ".join(parts) + tail


def fmt(v, ind=0):
    pad = "  " * ind
    c = compact_curve(v)
    if c is not None:
        return f"{pad}{c}"
    if isinstance(v, dict):
        lines = []
        for k, x in v.items():
            if isinstance(x, (dict, list)) and x:
                lines.append(f"{pad}{k}:")
                lines.append(fmt(x, ind + 1))
            else:
                lines.append(f"{pad}{k} = {x!r}")
        return "\n".join(lines)
    if isinstance(v, list):
        if all(not isinstance(x, (dict, list)) for x in v):
            return f"{pad}{v!r}"
        return "\n".join(f"{pad}[{i}]\n{fmt(x, ind + 1)}" for i, x in enumerate(v))
    return f"{pad}{v!r}"


if __name__ == "__main__":
    pkg = Package(sys.argv[1])
    pr = PropReader(pkg)
    for suffix in sys.argv[2:]:
        for e in pkg.find(suffix):
            obj, pos, end = pr.read_object(e)
            print(f"=== {pkg.class_name(e['index'])} {pkg.path(e['index'])}  "
                  f"(archetype {pkg.path(e['archetype']) if e['archetype'] else 'None'}, "
                  f"parsed {pos - e['offset']}/{e['size']} bytes)")
            print(fmt(obj, 1))
