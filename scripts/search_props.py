"""Decode every non-class export in packages and grep property names (recursively) by regex.
Usage: search_props.py REGEX PKG [PKG...]"""
import re, sys
from package import Package
from props import PropReader

pat = re.compile(sys.argv[1], re.I)
SKIP = re.compile(r"Property$|^(Function|Class|ScriptStruct|Enum|State|Const|Texture2D|AkSoundCue|Package)$")


def walk(v, prefix=""):
    if isinstance(v, dict):
        for k, x in v.items():
            yield from walk(x, f"{prefix}.{k}" if prefix else k)
    elif isinstance(v, list):
        for i, x in enumerate(v):
            yield from walk(x, f"{prefix}[{i}]")
    else:
        yield prefix, v


for path in sys.argv[2:]:
    p = Package(path)
    pr = PropReader(p)
    for e in p.exports:
        cn = p.class_name(e["index"])
        if SKIP.search(cn) or e["size"] <= 0:
            continue
        try:
            obj, _, _ = pr.read_object(e)
        except Exception:
            continue
        for k, v in walk(obj):
            if pat.search(k):
                print(f"{path.split('/')[-1]}: {p.path(e['index'])}  {k} = {v!r}")
