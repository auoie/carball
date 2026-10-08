# Class layouts for another build without touching the shared out/classes.csv:
#   live_layout.py EXE UCLASS_CTOR_VA DECRYPTED_DIR OUT_CLASSES_CSV Class [Class...]
# 1. runs scripts/dump_classes.py against EXE (sizeof/ctor/vtable per class) -> OUT_CLASSES_CSV (skipped if it exists)
# 2. runs scripts/layout.py's Layout on DECRYPTED_DIR/TAGame.upk with sizes from OUT_CLASSES_CSV
import contextlib, csv, io, os, runpy, sys

exe, ctor, ddir, out_csv = sys.argv[1:5]
classes = sys.argv[5:]
repo_scripts = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'scripts')
sys.path.insert(0, os.path.abspath(repo_scripts))
import pe  # noqa: E402
pe.EXE = exe
pe.PE.__init__.__defaults__ = (exe,)

if not os.path.exists(out_csv):
    buf = io.StringIO()
    sys.argv = ['dump_classes.py', ctor]
    with contextlib.redirect_stdout(buf):
        runpy.run_path(os.path.join(repo_scripts, 'dump_classes.py'), run_name='__main__')
    open(out_csv, 'w').write(buf.getvalue())

import layout  # noqa: E402
from package import Package  # noqa: E402

def sizes():
    s = {}
    for row in csv.DictReader(open(out_csv)):
        if row['sizeof']:
            s[row['name']] = int(row['sizeof'], 16)
    return s
layout.load_exe_sizes = sizes
pkg = Package(os.path.join(ddir, 'TAGame.upk'))
extra = [Package(os.path.join(ddir, f)) for f in ('ProjectX.upk', 'Engine.upk', 'Core.upk')
         if os.path.exists(os.path.join(ddir, f))]
lay = layout.Layout(pkg, extra)
for name in classes:
    try:
        sup, start, fields, end = lay.class_layout(name)
    except KeyError:
        e = lay.find_type(name, ('ScriptStruct',))
        fields, end, _ = lay.compute(e, 0)
        sup, start = '(struct)', 0
    exe_size = lay.exe_sizes.get(name)
    check = 'exe sizeof 0x%x' % exe_size if exe_size else 'exe sizeof unknown'
    print('=== %s : %s (starts 0x%x, computed end 0x%x, %s)' % (name, sup, start, end, check))
    for off, n, t in fields:
        print('  0x%04x  %-40s %s' % (off, t, n))
