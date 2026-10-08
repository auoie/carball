# How many classes' computed property end fits the exe sizeof (end <= sizeof < end + 16)? layout_fit.py DECRYPTED_DIR CLASSES_CSV
import csv, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'scripts'))
import layout
from package import Package
ddir, ccsv = sys.argv[1], sys.argv[2]
def sizes():
    return {r['name']: int(r['sizeof'], 16) for r in csv.DictReader(open(ccsv)) if r['sizeof']}
layout.load_exe_sizes = sizes
pkg = Package(os.path.join(ddir, 'TAGame.upk'))
extra = [Package(os.path.join(ddir, f)) for f in ('ProjectX.upk', 'Engine.upk', 'Core.upk')]
lay = layout.Layout(pkg, extra)
fit = misfit = 0; bad = []
for e in pkg.exports:
    if pkg.class_name(e['index']) != 'Class':
        continue
    sz = lay.exe_sizes.get(e['name'])
    if not sz:
        continue
    try:
        _, start, fields, end = lay.class_layout(e['name'])
    except Exception:
        continue
    if not fields:
        continue
    if end <= sz < end + 16:
        fit += 1
    else:
        misfit += 1; bad.append((e['name'], hex(end), hex(sz)))
print('fit', fit, 'misfit', misfit, bad[:8])
