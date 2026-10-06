"""Parse a decrypted Rocket League (UE3 v868) package: names, imports, exports, object paths.

Table layouts (licensee >= 22, per RLUPKTool):
  FNameEntry   FString Name; uint64 Flags
  FObjectImport FName ClassPackage; FName ClassName; int32 Outer; FName ObjectName
  FObjectExport int32 Class, Super, Outer; FName Name; int32 Archetype; uint64 ObjectFlags;
                int32 SerialSize; int64 SerialOffset; int32 ExportFlags; TArray<int32> NetObjects;
                FGuid PackageGuid; int32 PackageFlags
Object references: 0 = null, >0 = export[i-1], <0 = import[-i-1].
"""
import sys

from upk import Reader, Summary


class Package:
    def __init__(self, path):
        self.data = open(path, "rb").read()
        self.s = Summary(self.data)
        s, d = self.s, self.data

        r = Reader(d, s.name_offset)
        self.names = []
        for _ in range(s.name_count):
            self.names.append(r.fstring())
            r.u64()

        r = Reader(d, s.import_offset)
        self.imports = []
        for _ in range(s.import_count):
            cls_pkg, cls_name = self.fname(r), self.fname(r)
            outer = r.i32()
            name = self.fname(r)
            self.imports.append({"class_package": cls_pkg, "class": cls_name, "outer": outer, "name": name})

        r = Reader(d, s.export_offset)
        self.exports = []
        for i in range(s.export_count):
            e = {"index": i + 1, "class": r.i32(), "super": r.i32(), "outer": r.i32(), "name": self.fname(r),
                 "archetype": r.i32(), "flags": r.u64(), "size": r.i32(), "offset": r.i64(),
                 "export_flags": r.i32()}
            net_objects = r.i32()
            r.p += 4 * net_objects + 16 + 4  # NetObjects, PackageGuid, PackageFlags
            self.exports.append(e)

    def fname(self, r):
        idx, num = r.i32(), r.i32()
        n = self.names[idx] if 0 <= idx < len(self.names) else f"<bad name {idx}>"
        return n if num == 0 else f"{n}_{num - 1}"

    def obj(self, ref):
        if ref > 0:
            return self.exports[ref - 1]
        if ref < 0:
            return self.imports[-ref - 1]
        return None

    def obj_name(self, ref):
        o = self.obj(ref)
        return o["name"] if o else "None"

    def class_name(self, ref):
        """Class name of an export (exports with class 0 are UClass objects)."""
        e = self.obj(ref)
        if e is None:
            return "None"
        return self.obj_name(e["class"]) if e["class"] else "Class"

    def path(self, ref):
        parts = []
        while ref:
            o = self.obj(ref)
            parts.append(o["name"])
            ref = o["outer"]
        return ".".join(reversed(parts))

    def find(self, path_suffix):
        return [e for e in self.exports if self.path(e["index"]).endswith(path_suffix)]


if __name__ == "__main__":
    p = Package(sys.argv[1])
    print(f"{len(p.names)} names, {len(p.imports)} imports, {len(p.exports)} exports")
    for e in p.exports[:15]:
        print(e["index"], p.class_name(e["index"]), p.path(e["index"]), e["size"], hex(e["offset"]))
